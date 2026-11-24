#!/bin/sh
# Startet als root nur, um den Datenordner beschreibbar zu machen (wichtig bei Ordnern vom Host,
# z. B. ./data:/app/data, die Docker als root anlegt), und läuft dann als Benutzer "node".
set -e
DATA_DIR="${DATA_DIR:-/app/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR" 2>/dev/null || echo "Hinweis: konnte $DATA_DIR nicht an den Benutzer node übergeben"
  exec su-exec node "$@"
fi
exec "$@"
