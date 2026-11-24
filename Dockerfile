# Raumplaner – kleines Produktions-Image (~60 MB)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data

# Abhängigkeiten zuerst (wird bei Code-Änderungen aus dem Cache genommen)
RUN apk add --no-cache su-exec
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js docker-entrypoint.sh ./
COPY public ./public

# Datenordner gehört dem unprivilegierten Benutzer "node". Der Server selbst läuft immer als "node";
# das Startskript macht vorher nur den Datenordner beschreibbar (auch bei Ordnern vom Host).
RUN mkdir -p /app/data && chown -R node:node /app/data && chmod +x /app/docker-entrypoint.sh
VOLUME ["/app/data"]
ENTRYPOINT ["/app/docker-entrypoint.sh"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# node direkt starten (nicht über npm), damit SIGTERM ankommt und sauber gespeichert wird
CMD ["node", "server.js"]
