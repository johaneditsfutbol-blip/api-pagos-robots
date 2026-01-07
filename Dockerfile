FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Usamos usuario root para evitar problemas de permisos al descargar imagenes temporales
USER root

WORKDIR /usr/src/app

# Copiamos archivos
COPY package*.json ./
RUN npm ci
COPY . .

# Comando de arranque
CMD [ "node", "index.js" ]
