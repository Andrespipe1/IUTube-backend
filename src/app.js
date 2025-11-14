import express from 'express';
import cors from 'cors';
import videoRoutes from './routes/videoRoutes.js';

const app = express();
app.use(cors());
app.use(express.json());

// Ruta de índice para verificar que el servidor está funcionando
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server ON',
    service: 'IUTube Backend API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Ruta de health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.use('/api/videos', videoRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
