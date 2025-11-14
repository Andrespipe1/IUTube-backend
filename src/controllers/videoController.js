import ytdl from 'ytdl-core';
import puppeteer from 'puppeteer';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';
import { spawn } from 'child_process';

/**
 * Normaliza URLs problemáticas:
 *  - Shorts → watch?v=
 *  - YouTube Music → www.youtube.com
 *  - youtu.be → watch?v=
 *  - Elimina parámetros &list= y otros extras
 */
function normalizeYouTubeURL(url) {
    try {
        if (!url) return url;

        // Shorts
        if (url.includes("shorts/")) {
            const id = url.split("shorts/")[1].split("?")[0];
            return `https://www.youtube.com/watch?v=${id}`;
        }

        // YouTube Music -> normal YouTube
        if (url.includes("music.youtube.com")) {
            url = url.replace("music.youtube.com", "www.youtube.com");
        }

        // youtu.be short link
        if (url.includes("youtu.be/")) {
            const id = url.split("youtu.be/")[1].split("?")[0];
            return `https://www.youtube.com/watch?v=${id}`;
        }

        // Eliminar listas automáticas
        if (url.includes("&list=")) {
            url = url.split("&list=")[0];
        }

        // Quitar parámetros extra
        if (url.includes("&")) {
            url = url.split("&")[0];
        }

        return url;
    } catch (err) {
        console.error("Error normalizando URL:", err);
        return url;
    }
}

// Usar 'yt-dlp' desde PATH (instalado con pip) o intentar ejecutable local como fallback
const ytdlpPath = process.env.NODE_ENV === 'production' || process.env.USE_SYSTEM_YTDLP 
    ? 'yt-dlp'  // En producción/Docker, usar desde PATH
    : path.join(process.cwd(), 'yt-dlp');  // En desarrollo local, intentar ejecutable local
const cookiesPath = path.join(process.cwd(), 'cookies.txt'); // ./cookies.txt en la raíz del proyecto

class VideoController {

    // ============================================================
    //  OBTENER INFORMACIÓN DEL VIDEO
    // ============================================================
    async getVideoInfo(req, res) {
        try {
            let { url } = req.body;

            if (!url) {
                return res.status(400).json({ error: 'URL es requerida' });
            }

            url = normalizeYouTubeURL(url);
            console.log("URL normalizada:", url);

            // Detectar si es probable que necesitemos extractor android para música
            const useAndroidExtractor =
                url.includes("music.youtube") ||
                url.includes("list=RD") ||
                url.includes("start_radio");

            const args = [
                '--cookies', cookiesPath,
                '--dump-json',
                '--no-check-certificates',
                '--no-warnings',
                '--geo-bypass',
                // usar extractor android solo si creemos que es música protegida
                ...(useAndroidExtractor ? ['--extractor-args', 'youtube:player_client=android'] : []),
                '--format', 'bestvideo*+bestaudio/best',
                url
            ];

            const child = spawn(ytdlpPath, args);

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', chunk => { stdout += chunk; });
            child.stderr.on('data', chunk => { stderr += chunk.toString(); });

            child.on('close', code => {
                if (code !== 0) {
                    console.error("YT-DLP ERROR (getVideoInfo):", stderr);
                    return res.status(500).json({
                        error: 'Error al obtener información del video',
                        details: stderr
                    });
                }

                try {
                    const info = JSON.parse(stdout);

                    // Mapear respuesta limpia
                    res.json({
                        video_details: {
                            id: info.id || info.url?.split('v=')[1]?.split('&')[0] || '',
                            title: info.title,
                            duration: info.duration,
                            thumbnail: info.thumbnail,
                            uploader: info.uploader,
                        },
                        formats: (info.formats || []).map(f => ({
                            format_id: f.format_id,
                            ext: f.ext,
                            resolution: f.resolution || null,
                            fps: f.fps || null,
                            filesize: f.filesize || null,
                            vcodec: f.vcodec || null,
                            acodec: f.acodec || null
                        }))
                    });
                } catch (err) {
                    console.error("Error parseando JSON en getVideoInfo:", err);
                    return res.status(500).json({ error: 'Error procesando datos' });
                }
            });

            // protección por si child falla inmediatamente
            child.on('error', (err) => {
                console.error("Spawn error getVideoInfo:", err);
                return res.status(500).json({ error: 'Error al ejecutar yt-dlp', details: err.message });
            });

        } catch (error) {
            console.error("Error general getVideoInfo:", error);
            res.status(500).json({ error: 'Error interno' });
        }
    }

    // ============================================================
    //  DESCARGAR VIDEO / AUDIO
    // ============================================================
    async downloadVideo(req, res) {
        try {
            // Aceptamos tanto body como query por compatibilidad con distintos clientes
            let url = req.body?.url || req.query?.url;
            let format_id = req.body?.format_id || req.query?.format_id;

            if (!url) {
                return res.status(400).json({ error: 'URL es requerida' });
            }

            url = normalizeYouTubeURL(url);

            const args = [
                '--cookies', cookiesPath,
                '-f', format_id || 'bestvideo+bestaudio/best',
                '--merge-output-format', 'mp4',
                '-o', '-',
                url
            ];

            const child = spawn(ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

            // Cabeceras para fuerza descarga
            res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
            res.setHeader('Content-Type', 'application/octet-stream');

            // Pipe stdout directo al response
            child.stdout.pipe(res);

            // Log stderr para debug (no respondemos por cada chunk)
            child.stderr.on('data', chunk => {
                console.error('yt-dlp stderr (downloadVideo):', chunk.toString());
            });

            child.on('close', code => {
                if (code !== 0) {
                    console.error('yt-dlp exited with code', code);
                    // Si la respuesta ya fue enviada parcialmente, no podemos hacer mucho.
                    // Solo cerramos con error si no se ha enviado nada.
                    // Nota: es posible que el cliente ya haya recibido datos.
                    if (!res.headersSent) {
                        return res.status(500).end();
                    }
                } else {
                    // cierre normal
                    if (!res.writableEnded) res.end();
                }
            });

            child.on('error', err => {
                console.error('Spawn error downloadVideo:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error al ejecutar yt-dlp', details: err.message });
                } else {
                    res.end();
                }
            });

        } catch (error) {
            console.error("Error general downloadVideo:", error);
            if (!res.headersSent) res.status(500).json({ error: 'Error al descargar el video' });
            else res.end();
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
