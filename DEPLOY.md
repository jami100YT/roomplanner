# Raumplaner betreiben (Deployment)

Für eine Handvoll Nutzer reicht ein kleiner Server (1 vCPU, 512 MB RAM). Der Raumplaner ist **ein einziger Node-Prozess**:

- liefert die Seite unter `/` aus
- Echtzeit über **WebSocket** unter `/ws`
- speichert jeden Plan als `data/<plan>.json` (plus `.bak`), dazu `data/secret.key` für die Ansehen-Links
- `/health` antwortet mit `ok` (für Monitoring/Healthchecks)

> Wichtig: Es darf immer nur **ein** Prozess laufen. Mehrere Instanzen hinter einem Load-Balancer würden die Echtzeit-Daten aufteilen.

---

## Variante A: Docker (empfohlen) – ohne Repository zu klonen

Bei jedem Push nach `main` baut GitHub automatisch ein fertiges Image: `ghcr.io/jami100yt/roomplanner` (amd64 + arm64). Docker ersetzt bei jedem Update den kompletten Prozess. Das Problem „alte Version läuft im Hintergrund weiter“ kann dabei nicht auftreten.

```bash
mkdir -p /opt/roomplanner && cd /opt/roomplanner
curl -fsSLO https://raw.githubusercontent.com/jami100YT/roomplanner/main/docker-compose.yml   # oder Datei von Hand anlegen
docker compose up -d
curl -s localhost:3000/health        # → ok
```
Ist das Repository privat, lege `docker-compose.yml` einfach von Hand an, sie ist nur 15 Zeilen lang. Oder ohne Compose:
```bash
docker run -d --name roomplanner --restart unless-stopped -p 3000:3000 \
  -v roomplanner-data:/app/data ghcr.io/jami100yt/roomplanner:latest
```

**Update:**
```bash
cd /opt/roomplanner && docker compose pull && docker compose up -d
```
Der Container wird in wenigen Sekunden ersetzt. Offene Seiten verbinden sich neu und zeigen „Neue Version verfügbar – Neu laden“.

**Feste Version / zurückrollen:** In `docker-compose.yml` statt `:latest` eine Version eintragen, z. B. `ghcr.io/jami100yt/roomplanner:2.0.0`, dann `docker compose up -d`.

**Image nicht ladbar („denied“ / „unauthorized“)?** Das Paket ist noch privat. Entweder auf GitHub unter *Profil → Packages → roomplanner → Package settings → Change visibility → Public* umstellen, oder auf dem Server einmalig anmelden: `docker login ghcr.io -u jami100YT` (als Passwort ein Token mit `read:packages`).

**Selbst bauen statt Image laden** (im geklonten Repository): `docker build -t ghcr.io/jami100yt/roomplanner:latest . && docker compose up -d`

**Logs:** `docker compose logs -f`

**Backup** (z. B. täglich per cron):
```bash
docker compose cp roomplanner:/app/data ./backup-$(date +%F)
```

**Bisherige Daten übernehmen** (z. B. vom pm2-Betrieb in `/opt/roomplanner/data`):
```bash
pm2 delete raumplaner; pm2 save        # alten Prozess beenden (gibt Port 3000 frei)
cd /opt/roomplanner
docker compose up -d
docker compose cp ./data/. roomplanner:/app/data/
docker compose exec -u root roomplanner chown -R node:node /app/data
docker compose restart
```
Die Pläne und `secret.key` werden übernommen, alle bisherigen Links (Mitplanen und Ansehen) bleiben gültig.

## Variante B: pm2 (ohne Docker)

```bash
cd /opt/roomplanner
npm ci --omit=dev
pm2 start ecosystem.config.js && pm2 save
pm2 startup                            # einmalig: Autostart nach Neustart
```

**Update:**
```bash
cd /opt/roomplanner && git pull && npm ci --omit=dev && pm2 reload ecosystem.config.js
```

Den Server **nie zusätzlich mit `npm start`** starten. Sonst läuft eine zweite, alte Instanz am pm2 vorbei. Prüfen kannst du das mit `ss -ltnp | grep :3000`: Es darf genau ein `node`-Prozess erscheinen.

---

## Reverse Proxy (Nginx Proxy Manager) – WebSocket richtig einstellen

Proxy Host → **Details**:
| Einstellung | Wert |
|---|---|
| Scheme | `http` |
| Forward Hostname / IP | IP des Servers (bzw. `roomplanner`, wenn NPM im selben Docker-Netz ist) |
| Forward Port | `3000` |
| **Websockets Support** | **an** (ohne das hängt die Seite bei „verbinde…“) |
| Block Common Exploits | an |

Reiter **SSL**: Let's-Encrypt-Zertifikat, **Force SSL** und **HTTP/2** an.

Timeouts musst du nicht anpassen. Der Raumplaner schickt alle 10 s ein Lebenszeichen, dadurch bleiben die Verbindungen auch hinter nginx (60 s) und Cloudflare (100 s) offen.

<details><summary>Ohne NPM: eigene nginx-Konfiguration</summary>

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 120s;
}
```
</details>

## Cloudflare (falls die Domain darüber läuft)

- DNS-Eintrag mit oranger Wolke ist ok.
- **SSL/TLS → Full (strict)** (NPM hat ein gültiges Zertifikat).
- **Network → WebSockets: an** (Standard).
- **Speed → Rocket Loader: aus.** Rocket Loader verändert Skripte und kann die App kaputt machen.
- Kein „Cache Everything“ für die Seite. Sonst bekommen Nutzer nach einem Update die alte Seite.

## Firewall

Öffentlich nur Port 80 und 443 freigeben. Port 3000 muss nur für den Proxy erreichbar sein. Läuft der Proxy auf demselben Rechner, aber nicht in Docker, kannst du in `docker-compose.yml` `"127.0.0.1:3000:3000"` eintragen.

---

## Fehlersuche

| Symptom | Ursache / Lösung |
|---|---|
| Seite hängt bei „verbinde…“ | WebSocket wird blockiert. In NPM „Websockets Support“ einschalten, bei Cloudflare WebSockets prüfen. Test siehe unten. |
| „DNS-Adresse nicht gefunden“ | DNS-Cache: `ipconfig /flushdns`, Router neu starten oder testweise im Mobilfunknetz öffnen. |
| Nach einem Update ist alles wie vorher | Alter Prozess läuft weiter (nur bei pm2): `ss -ltnp \| grep :3000`, alten Prozess beenden, `pm2 reload …`. |
| `Port 3000 ist schon belegt` im Log | wie oben: zweiter Prozess. |
| Personen erscheinen doppelt | Verschwindet nach spätestens ~20 s von selbst. Bleibt es, haben die Betroffenen eine sehr alte Seite offen und müssen neu laden. |

**WebSocket von außen testen** (die Antwort muss `101 Switching Protocols` enthalten):
```bash
curl -si -N --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: SGVsbG8gV29ybGQ=" \
  "https://deine-domain.de/ws?plan=test" | head -1
```

---

## Updates ohne Risiko

Diese Regeln stellen sicher, dass ein Update nichts kaputt macht:

1. **Daten werden nur erweitert, nie umgebaut.** Neue Funktionen bekommen neue Felder. Bestehende Felder behalten Namen und Bedeutung. Alte Pläne werden beim Laden automatisch verstanden (z. B. die früheren Rechteck-Wände).
2. **Unbekanntes wird durchgereicht.** Seiten ab v2 behalten Felder, die sie nicht kennen, und der Server speichert sie unverändert. Eine noch offene ältere Seite löscht also keine Daten einer neueren Version.
3. **Ältere offene Seiten** bekommen nach dem Update den Hinweis „Neue Version verfügbar – Neu laden“. In der Personenliste stehen veraltete Seiten mit ⚠.
4. **Speichern ist atomar**, mit `.bak` als Rückfallebene. Ein Absturz mitten im Schreiben beschädigt keinen Plan. Beim Beenden (pm2/Docker) wird vorher gespeichert.
5. **Zurückrollen** geht jederzeit, das Datenformat bleibt kompatibel:
   ```bash
   # Docker: in docker-compose.yml eine Version eintragen, z. B. :2.0.0, dann
   docker compose up -d
   # pm2: gewünschten Stand auschecken (z. B. 9e690a4 = v2.0.0) und neu laden
   git checkout 9e690a4 && pm2 reload ecosystem.config.js
   ```
6. Vor größeren Updates ein Backup von `data/` machen (siehe oben). Das dauert eine Sekunde und schadet nie.
