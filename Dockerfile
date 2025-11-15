# Usar imagen base de Node.js con Python incluido
FROM node:20-slim

# Instalar Python y dependencias necesarias para yt-dlp
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Instalar yt-dlp descargando el binario directamente (más confiable)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    yt-dlp --version && \
    echo "yt-dlp instalado correctamente"

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de Node.js
RUN npm install --production

# Copiar el resto de los archivos de la aplicación
COPY . .

# Verificar que cookies.txt existe y mostrar información
RUN if [ -f cookies.txt ]; then \

        echo "✅ Archivo cookies.txt encontrado" && \
        ls -lh cookies.txt && \
        head -5 cookies.txt; \
    else \
        echo "⚠️  Archivo cookies.txt NO encontrado - creando uno vacío" && \
        echo "# Cookies file - Reemplaza este archivo con tus cookies reales" > cookies.txt; \
    fi
    
RUN echo "Mostrando cookies en /app:" && ls -l /app && head -5 /app/cookies.txt || echo "cookies no encontradas"

# Establecer variable de entorno para producción
ENV NODE_ENV=production

# Exponer el puerto
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["npm", "start"]

