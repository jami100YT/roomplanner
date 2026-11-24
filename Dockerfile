# Raumplaner – kleines Produktions-Image (~60 MB)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data

# Abhängigkeiten zuerst (wird bei Code-Änderungen aus dem Cache genommen)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY public ./public

# Datenordner gehört dem unprivilegierten Benutzer "node"
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# node direkt starten (nicht über npm), damit SIGTERM ankommt und sauber gespeichert wird
CMD ["node", "server.js"]
