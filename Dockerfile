FROM node:20-alpine
WORKDIR /app
COPY alvien-server/package.json alvien-server/package-lock.json ./
RUN npm ci --omit=dev
COPY alvien-server/ ./
RUN mkdir -p public
COPY index.html confirmation.html sample-report.html ./public/
EXPOSE 3000
CMD ["node", "server.js"]
