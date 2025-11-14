# Usar imagen base de Node.js con Python incluido
FROM node:20-slim

# Instalar Python y dependencias necesarias para yt-dlp
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Instalar yt-dlp globalmente y verificar instalación
RUN pip3 install --no-cache-dir yt-dlp && \
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

# Verificar que cookies.txt existe (si no existe, crear uno vacío como fallback)
RUN if [ ! -f cookies.txt ]; then echo "# Cookies file" > cookies.txt; fi

# Exponer el puerto
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["npm", "start"]

