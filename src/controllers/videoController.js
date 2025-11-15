import ytdl from 'ytdl-core';
import puppeteer from 'puppeteer';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

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

// Función para determinar la ruta de yt-dlp
// En Docker/producción siempre usar desde PATH, en desarrollo local intentar ejecutable local
function getYtdlpPath() {
    // Si está en Docker o producción, usar desde PATH
    if (process.env.NODE_ENV === 'production' || 
        process.env.USE_SYSTEM_YTDLP || 
        process.env.DOCKER_ENV) {
        return 'yt-dlp';  // Usar desde PATH
    }
    // En desarrollo local, verificar si existe el ejecutable local
    const localPath = path.join(process.cwd(), 'yt-dlp');
    if (existsSync(localPath)) {
        return localPath;
    }
    // Si no existe localmente, usar desde PATH como fallback
    return 'yt-dlp';
}

const ytdlpPath = getYtdlpPath();
const cookiesPath = path.join(__dirname, "../../cookies.txt");
// ./cookies.txt en la raíz del proyecto

// Verificar que cookies.txt existe al iniciar
if (existsSync(cookiesPath)) {
    console.log(`✅ Archivo de cookies encontrado en: ${cookiesPath}`);
} else {
    console.warn(`⚠️  Archivo de cookies NO encontrado en: ${cookiesPath}`);
}

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

            // Construir argumentos base
            const args = [
                '--dump-json',
                '--no-check-certificates',
                '--no-warnings',
                '--geo-bypass',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '--referer', 'https://www.youtube.com/',
                '--add-header', 'Accept-Language:en-US,en;q=0.9',
            ];

            // Agregar cookies si el archivo existe
            if (existsSync(cookiesPath)) {
                args.push('--cookies', cookiesPath);
                console.log(`Usando cookies desde: ${cookiesPath}`);
            } else {
                console.warn(`⚠️  Archivo de cookies no encontrado, continuando sin cookies`);
            }

            // usar extractor android solo si creemos que es música protegida
            if (useAndroidExtractor) {
                args.push('--extractor-args', 'youtube:player_client=android');
            }

            args.push('--format', 'bestvideo*+bestaudio/best');
            args.push(url);

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

            // Construir argumentos base
            const args = [
                '-f', format_id || 'bestvideo+bestaudio/best',
                '--merge-output-format', 'mp4',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '--referer', 'https://www.youtube.com/',
                '--add-header', 'Accept-Language:en-US,en;q=0.9',
                '-o', '-',
            ];

            // Agregar cookies si el archivo existe
            if (existsSync(cookiesPath)) {
                args.push('--cookies', cookiesPath);
                console.log(`Usando cookies desde: ${cookiesPath}`);
            } else {
                console.warn(`⚠️  Archivo de cookies no encontrado, continuando sin cookies`);
            }

            args.push(url);

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
