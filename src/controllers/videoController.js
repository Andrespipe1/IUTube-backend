import ytdl from 'ytdl-core';
import puppeteer from 'puppeteer';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

// ============================================================
// FIX PARA __dirname EN ES MODULES
// ============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================
// Ruta real de cookies.txt
// ==========================
const cookiesPath = path.resolve(process.cwd(), "cookies.txt");

// Log si existe
if (existsSync(cookiesPath)) {
    console.log(`✅ Archivo cookies.txt encontrado en: ${cookiesPath}`);
} else {
    console.warn(`⚠️  NO se encontró cookies.txt en: ${cookiesPath}`);
}

/**
 * Normaliza URLs problemáticas
 */
function normalizeYouTubeURL(url) {
    try {
        if (!url) return url;

        if (url.includes("shorts/")) {
            const id = url.split("shorts/")[1].split("?")[0];
            return `https://www.youtube.com/watch?v=${id}`;
        }

        if (url.includes("music.youtube.com")) {
            url = url.replace("music.youtube.com", "www.youtube.com");
        }

        if (url.includes("youtu.be/")) {
            const id = url.split("youtu.be/")[1].split("?")[0];
            return `https://www.youtube.com/watch?v=${id}`;
        }

        if (url.includes("&list=")) {
            url = url.split("&list=")[0];
        }

        if (url.includes("&")) {
            url = url.split("&")[0];
        }

        return url;
    } catch (err) {
        console.error("Error normalizando URL:", err);
        return url;
    }
}

// ============================================================
// Determinar ruta de yt-dlp
// ============================================================
function getYtdlpPath() {
    if (process.env.NODE_ENV === 'production' ||
        process.env.USE_SYSTEM_YTDLP ||
        process.env.DOCKER_ENV) {
        return 'yt-dlp';
    }

    const localPath = path.join(process.cwd(), 'yt-dlp');
    if (existsSync(localPath)) return localPath;

    return 'yt-dlp';
}

const ytdlpPath = getYtdlpPath();


class VideoController {

    // ============================================================
    // OBTENER INFORMACIÓN DEL VIDEO
    // ============================================================
    async getVideoInfo(req, res) {
        try {
            let { url } = req.body;
            if (!url) return res.status(400).json({ error: "URL es requerida" });

            url = normalizeYouTubeURL(url);

            const useAndroidExtractor =
                url.includes("music.youtube") ||
                url.includes("list=RD") ||
                url.includes("start_radio");

            const args = [
                "--dump-json",
                "--no-check-certificates",
                "--no-warnings",
                "--geo-bypass",
                "--user-agent", "Mozilla/5.0",
                "--referer", "https://www.youtube.com/",
                "--add-header", "Accept-Language:en-US,en;q=0.9"
            ];

            if (existsSync(cookiesPath)) {
                args.push("--cookies", cookiesPath);
                console.log(`Usando cookies desde: ${cookiesPath}`);
            }

            if (useAndroidExtractor) {
                args.push("--extractor-args", "youtube:player_client=android");
            }

            args.push("--format", "bestvideo*+bestaudio/best", url);

            const child = spawn(ytdlpPath, args);

            let stdout = "";
            let stderr = "";

            child.stdout.on("data", chunk => stdout += chunk);
            child.stderr.on("data", chunk => stderr += chunk.toString());

            child.on("close", code => {
                if (code !== 0) {
                    console.error("YT-DLP ERROR (getVideoInfo):", stderr);
                    return res.status(500).json({
                        error: "Error al obtener información del video",
                        details: stderr
                    });
                }

                try {
                    const info = JSON.parse(stdout);
                    res.json({
                        video_details: {
                            id: info.id,
                            title: info.title,
                            duration: info.duration,
                            thumbnail: info.thumbnail,
                            uploader: info.uploader
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
                    console.error("Error parseando JSON:", err);
                    return res.status(500).json({ error: "Error procesando datos" });
                }
            });

            child.on("error", err => {
                console.error("Spawn error:", err);
                return res.status(500).json({ error: "Error al ejecutar yt-dlp", details: err.message });
            });

        } catch (error) {
            console.error("Error general:", error);
            res.status(500).json({ error: "Error interno" });
        }
    }

    // ============================================================
    // DESCARGAR VIDEO
    // ============================================================
    async downloadVideo(req, res) {
        try {
            let url = req.body?.url || req.query?.url;
            let format_id = req.body?.format_id || req.query?.format_id;

            if (!url) return res.status(400).json({ error: "URL requerida" });

            url = normalizeYouTubeURL(url);

            const args = [
                "-f", format_id || "bestvideo+bestaudio/best",
                "--merge-output-format", "mp4",
                "--user-agent", "Mozilla/5.0",
                "--referer", "https://www.youtube.com/",
                "--add-header", "Accept-Language:en-US,en;q=0.9",
                "-o", "-"
            ];

            if (existsSync(cookiesPath)) {
                args.push("--cookies", cookiesPath);
            }

            args.push(url);

            const child = spawn(ytdlpPath, args, { stdio: ["ignore", "pipe", "pipe"] });

            res.setHeader("Content-Disposition", 'attachment; filename="video.mp4"');
            res.setHeader("Content-Type", "application/octet-stream");

            child.stdout.pipe(res);

            child.stderr.on("data", chunk => console.error("yt-dlp ERR:", chunk.toString()));

            child.on("close", code => {
                if (code !== 0 && !res.headersSent) {
                    return res.status(500).end();
                }
                if (!res.writableEnded) res.end();
            });

        } catch (err) {
            console.error("Error general:", err);
            if (!res.headersSent)
                res.status(500).json({ error: "Error al descargar video" });
        }
    }

    // ============================================================
    // SCRAPING
    // ============================================================
    async scrapeVideoInfo(req, res) {
        try {
            const { url } = req.body;

            if (!url) return res.status(400).json({ error: "URL requerida" });

            const browser = await puppeteer.launch({
                headless: true,
                args: ["--no-sandbox", "--disable-setuid-sandbox"]
            });

            const page = await browser.newPage();
            await page.goto(url, { waitUntil: "networkidle0" });

            const data = await page.evaluate(() => {
                const video = document.querySelector("video");
                return {
                    title: document.title,
                    hasVideo: !!video,
                    videoSrc: video?.src || null
                };
            });

            await browser.close();
            res.json(data);

        } catch (err) {
            console.error("Error scraping:", err);
            res.status(500).json({ error: "Error al analizar página" });
        }
    }
}

export default new VideoController();
