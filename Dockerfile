FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Usamos root para poder instalar dependencias sin problemas de permisos
USER root

WORKDIR /usr/src/app

# Copiamos SOLO el package.json primero
COPY package.json ./

# USAMOS 'npm install' (Es más seguro que 'ci' si no tienes el lockfile)
RUN npm install

# Copiamos el resto de los archivos (index.js, etc)
COPY . .

# Comando para iniciar
CMD [ "node", "index.js" ]
