import express from 'express';
import videoController from '../controllers/videoController.js';

const router = express.Router();

// Ruta para obtener información del video
router.post('/info', videoController.getVideoInfo);

// Ruta para descargar el video
router.post('/download', videoController.downloadVideo);

// Ruta para hacer scraping de cualquier sitio web
router.post('/scrape', videoController.scrapeVideoInfo);

export default router;
