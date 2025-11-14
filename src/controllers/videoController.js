import ytdl from 'ytdl-core';
import puppeteer from 'puppeteer';
import axios from 'axios';
import * as cheerio from 'cheerio';

function normalizeYouTubeURL(url) {
    try {
        if (!url) return url;

        // Shorts
        if (url.includes("shorts/")) {
            const id = url.split("shorts/")[1].split("?")[0];
            return `https://www.youtube.com/watch?v=${id}`;
        }

        // YouTube Music → usar solo si realmente es music.yt
        if (url.includes("music.youtube.com")) {
            url = url.replace("music.youtube.com", "www.youtube.com");
        }

        // youtu.be
        if (url.includes("youtu.be/")) {
            const id = url.split("youtu.be/")[1].split("?")[0];
            return `https://www.youtube.com/watch?v=${id}`;
        }

        // Eliminar listas
        if (url.includes("&list=")) {
            url = url.split("&list=")[0];
        }

        // Quitar extras
        if (url.includes("&")) {
            url = url.split("&")[0];
        }

        return url;

    } catch (err) {
        console.error("Error normalizando URL:", err);
        return url;
    }
}

class VideoController {

    // ============================================================
    //  OBTENER INFORMACIÓN DEL VIDEO
    // ============================================================

    async getVideoInfo(req, res) {
        try {
            let { url } = req.body;

            if (!url) return res.status(400).json({ error: 'URL es requerida' });

            url = normalizeYouTubeURL(url);
            console.log("URL normalizada:", url);

            const { spawn } = await import('child_process');

            // 👇🔥 SOLO usar player_client=android si es música
            const useAndroidExtractor =
                url.includes("music.youtube") ||
                url.includes("list=RD") ||
                url.includes("start_radio");

            const args = [
                '--dump-json',
                '--no-check-certificates',
                '--no-warnings',
                '--geo-bypass',

                // Usarlo solo si es música real
                ...(useAndroidExtractor
                    ? ['--extractor-args', 'youtube:player_client=android']
                    : []),

                '--format', 'bestvideo*+bestaudio/best',

                url
            ];

            const ytDlp = spawn('/usr/local/bin/yt-dlp', args);


            let data = '';
            let errorData = '';

            ytDlp.stdout.on('data', c => data += c);
            ytDlp.stderr.on('data', c => errorData += c.toString());

            ytDlp.on('close', code => {
                if (code !== 0) {
                    console.error("YT-DLP ERROR:", errorData);
                    return res.status(500).json({
                        error: 'Error al obtener información del video',
                        details: errorData
                    });
                }

                try {
                    const info = JSON.parse(data);

                    res.json({
                        video_details: {
                            id: info.id || info.url?.split('v=')[1]?.split('&')[0] || '',
                            title: info.title,
                            duration: info.duration,
                            thumbnail: info.thumbnail,
                            uploader: info.uploader,
                        },
                        formats: info.formats.map(f => ({
                            format_id: f.format_id,
                            ext: f.ext,
                            resolution: f.resolution,
                            fps: f.fps,
                            filesize: f.filesize,
                            vcodec: f.vcodec,
                            acodec: f.acodec
                        }))
                    });

                } catch (err) {
                    console.error("Error parseando JSON:", err);
                    res.status(500).json({ error: 'Error procesando datos' });
                }
            });

        } catch (error) {
            console.error("Error general:", error);
            res.status(500).json({ error: 'Error interno' });
        }
    }

    // ============================================================
    //  DESCARGAR VIDEO / AUDIO
    // ============================================================

    async downloadVideo(req, res) {
        try {
            let { url, format_id } = req.body;

            if (!url) {
                return res.status(400).json({ error: 'URL es requerida' });
            }

            url = normalizeYouTubeURL(url);

            const { spawn } = await import('child_process');

            const args = [
                '-f', format_id || 'bestvideo+bestaudio/best',
                '--merge-output-format', 'mp4',
                '-o', '-',
                url
            ];

            const ytDlp = spawn('/usr/local/bin/yt-dlp', args);


            res.header('Content-Disposition', 'attachment; filename="video.mp4"');

            ytDlp.stdout.pipe(res);

            ytDlp.stderr.on('data', c => console.error('Error en descarga:', c.toString()));

            ytDlp.on('close', code => {
                if (code !== 0) res.status(500).end();
            });

        } catch (error) {
            console.error("Error en descarga:", error);
            res.status(500).json({ error: 'Error al descargar el video' });
        }
    }

    // ============================================================
    //  SCRAPING UNIVERSAL
    // ============================================================

    async scrapeVideoInfo(req, res) {
        try {
            const { url } = req.body;

            if (!url) return res.status(400).json({ error: 'URL es requerida' });

            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle0' });

            const pageData = await page.evaluate(() => {
                const video = document.querySelector('video');
                return {
                    title: document.title,
                    hasVideo: !!video,
                    videoSrc: video?.src || null
                };
            });

            await browser.close();
            res.json(pageData);

        } catch (error) {
            console.error('Error scraping:', error);
            res.status(500).json({ error: 'Error al analizar la página' });
        }
    }
}

export default new VideoController();
