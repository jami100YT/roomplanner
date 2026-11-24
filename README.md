<img src="public/icon.svg" width="72" height="72" alt="Raumplaner logo">

# Raumplaner

Plan apartments together, live in the browser. No accounts, no login: anyone with the link can plan along.

![Version](https://img.shields.io/badge/version-2.0.0-1e5c76)
![Vibe coded](https://img.shields.io/badge/vibe%20coded-100%25-cf5a17)

> **This project is 100 % vibe coded.** Every line of code, every test and all of the documentation were written by an AI (Claude) from conversational prompts. No line was typed by hand. It is tested extensively with automated browser tests, but please keep its origin in mind.

The user interface is available in German, English, French, Spanish, Italian and Dutch.

## Features

- **Rooms:** rectangles or free-form shapes (L-shaped and others). You can draw rooms corner by corner, drag corners and walls, add extensions or cut-outs, and type exact wall lengths. Neighbouring rooms snap together and share a wall.
- **Furniture, windows and doors:** presets, L-shaped and free-form furniture, doors with or without a door leaf (open passage), groups, alignment and multi-selection.
- **Dimensions:** wall lengths for every room, placed smartly so shared walls are labelled only once, plus overall dimensions and distances to the walls.
- **Cardinal directions:** a compass for the whole plan. Walls, windows and furniture show which way they face.
- **Real-time collaboration:** changes appear instantly for everyone, and you can see the other people's cursors. Undo/redo only affects your own changes.
- **Presenting:** a view-only link shows everything live but allows no editing and does not contain the plan code. Read-only access is enforced by the server.
- **Import/export:** whole apartments or single rooms as JSON.
- **Languages:** German, English, French, Spanish, Italian and Dutch. The browser language is picked automatically and can be changed in the settings.
- Zoom, pan, show or hide rooms. Personal settings are stored in the browser.

The app explains itself: **? Hilfe** (or the `?` key) lists all keyboard shortcuts, and **⚙ Einstellungen** contains the view, editing and profile settings.

## Run it

### With Docker (no clone needed)

A ready-made image (amd64 + arm64, e.g. for a Raspberry Pi) is built automatically on every push:

```bash
docker run -d --name roomplanner --restart unless-stopped \
  -p 3000:3000 -v roomplanner-data:/app/data \
  ghcr.io/jami100yt/roomplanner:latest
```

Then open http://localhost:3000.

Or use Docker Compose: download [`docker-compose.yml`](docker-compose.yml) and run:

```bash
docker compose up -d                          # start
docker compose pull && docker compose up -d   # update
```

Image tags: `latest` (newest), a version such as `2.0.0` (pin this to stay on a version or to roll back), and `sha-<commit>`.

### Without Docker

```bash
npm install
npm start          # → http://localhost:3000
```

Other devices on the same Wi-Fi/LAN can open the address that is printed on start. The "🔗 Mitplanen-Link" button automatically copies the LAN address.

## Hosting on the internet

See **[DEPLOY.md](DEPLOY.md)** (German). It covers Docker or pm2, Nginx Proxy Manager with WebSockets, Cloudflare, backups, troubleshooting and safe updates.

The two things that matter for WebSockets:
- In Nginx Proxy Manager, turn **"Websockets Support"** on.
- On Cloudflare, turn **Rocket Loader** off.

No timeout tuning is needed, because the app sends a heartbeat every 10 seconds.

## Security and privacy

- No accounts. The plan code in the link is the key: anyone who has it can edit. New plans get a random 16-character code, so they can't be guessed. Pick your own short code (`?plan=test`) only for throwaway plans.
- **Renew link** (Settings → Plan) moves the plan to a new random code. All old collaboration and view links stop working at once, everyone currently connected is disconnected, and only you get the new link. Use it when a link got into the wrong hands.
- A connection only ever receives the plan it asked for. View-only links are derived from the plan code with a server-side secret and can't be turned back into it.
- The page loads nothing from other servers (fonts are bundled) and sends no referrer, so neither your IP address nor the plan code leaks to third parties. The server never sends IP addresses to clients; `/lan` (the Wi-Fi link helper) only answers direct requests from the server machine itself, never through a reverse proxy.
- Everything that comes in (JSON imports and live changes) is validated, size-limited and escaped before it is stored or shown. A Content-Security-Policy blocks embedding the app in other sites.
- `npm test` runs the security checks.

## Data

- Each plan is stored on the server as `data/<plan>.json`, with a `.bak` copy. Saves are automatic, atomic, and also happen on shutdown.
- `data/secret.key` is the key for the view-only links. Deleting it invalidates all existing view-only links.
- Updates never change the data format, they only extend it. Older plans and exports always load. Newer pages pass through fields they don't know, so mixing versions does not lose data, and open pages get a "new version available" notice after an update.

## Files

| File | Purpose |
|---|---|
| `server.js` | web and WebSocket server (one dependency: `ws`) |
| `public/index.html` | the entire app, including the translations |
| `public/icon.svg`, `favicon*`, `*.png`, `manifest.webmanifest` | logo, favicons and home-screen icon |
| `public/fonts/` | bundled IBM Plex fonts (SIL Open Font License) |
| `tools/i18n-table.tsv` | all UI texts (German → en, fr, es, it, nl); run `python3 tools/build-i18n.py` after editing |
| `test/security.js` | security checks (`npm test`) |
| `Dockerfile`, `docker-compose.yml` | running with Docker |
| `.github/workflows/docker.yml` | builds and publishes the Docker image |
| `ecosystem.config.js` | running with pm2 |
| `DEPLOY.md` | hosting guide |

New versions get a higher number in `package.json` and in `public/index.html` (`APP_VERSION`).
