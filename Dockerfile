FROM ghcr.io/puppeteer/puppeteer:latest

# Cambiamos al usuario root para instalar cosas si hiciera falta, 
# pero la imagen base ya trae lo necesario.
USER root

# Copiamos los archivos del proyecto
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .

# Comando de inicio
CMD [ "node", "index.js" ]
