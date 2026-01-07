FROM ghcr.io/puppeteer/puppeteer:latest

USER root
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci
COPY . .

CMD [ "node", "index.js" ]
