# Configuración Docker para Render

Este proyecto ahora usa Docker para instalar automáticamente `yt-dlp` y configurar el entorno.

## Archivos creados

- **Dockerfile**: Configura el contenedor con Node.js, Python, yt-dlp y ffmpeg
- **.dockerignore**: Optimiza el build excluyendo archivos innecesarios

## Cambios realizados

1. **videoController.js**: Ahora detecta automáticamente si está en producción y usa `yt-dlp` desde el PATH
2. **package.json**: Removido el script `postinstall` que no funciona en Docker
3. **cookies.txt**: Se copia automáticamente al contenedor

## Configuración en Render

### Opción 1: Usar Docker (Recomendado)

1. En Render, al crear el servicio:
   - Selecciona **"Web Service"**
   - Conecta tu repositorio
   - En **"Environment"**, selecciona **"Docker"**
   - Render detectará automáticamente el Dockerfile

2. Variables de entorno (si las necesitas):
   - `NODE_ENV=production` (se establece automáticamente)
   - `PORT=3000` (Render lo asigna automáticamente)

3. Asegúrate de que `cookies.txt` esté en el repositorio (en la raíz de `IUTube-backend/`)

### Opción 2: Forzar uso de yt-dlp del sistema

Si quieres forzar el uso de yt-dlp del sistema incluso en desarrollo local, agrega:
```
USE_SYSTEM_YTDLP=true
```

## Verificación local

Para probar localmente con Docker:

```bash
# Construir la imagen
docker build -t iutube-backend .

# Ejecutar el contenedor
docker run -p 3000:3000 iutube-backend
```

## Notas importantes

- El archivo `cookies.txt` debe estar en la raíz del proyecto (`IUTube-backend/cookies.txt`)
- yt-dlp se instala automáticamente con pip durante el build
- ffmpeg también se instala para manejar la conversión de formatos
- El código detecta automáticamente el entorno y usa la configuración correcta

