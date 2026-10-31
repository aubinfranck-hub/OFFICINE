FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV MODE=online DB=/data/lgo.db PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["node", "server/server.js"]
