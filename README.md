# Raumplaner

Wohnungen gemeinsam und live im Browser planen, ohne Konto und ohne Login: Wer den Link hat, plant mit.

![Version](https://img.shields.io/badge/version-2.0.0-1e5c76)

## Funktionen

- **Räume:** Rechtecke oder freie Formen (L-Form usw.). Du kannst sie zeichnen, Ecken und Wände ziehen, Anbauten und Ausschnitte machen und Wandlängen als Zahl eingeben. Nachbarräume rasten ein und teilen sich eine Wand.
- **Möbel, Fenster, Türen:** Vorlagen, L-förmige und freie Möbel, Türen auch ohne Türblatt (Durchgang), Gruppen, Ausrichten und Mehrfachauswahl.
- **Maße:** Wandlängen für alle Räume, intelligent platziert (gemeinsame Wände nur einmal), dazu Gesamtmaße und Abstände zur Wand.
- **Himmelsrichtungen:** Kompass für den ganzen Plan. Wände, Fenster und Möbel zeigen ihre Ausrichtung.
- **Gemeinsam:** Änderungen erscheinen sofort bei allen. Die Mauszeiger der anderen sind sichtbar. Rückgängig/Wiederholen gilt nur für eigene Änderungen.
- **Präsentieren:** Der Ansehen-Link zeigt alles live, erlaubt aber keine Änderungen und enthält den Plan-Code nicht. Der Schreibschutz wird vom Server erzwungen.
- **Import/Export:** ganze Wohnungen oder einzelne Räume als JSON.
- Zoomen, Ansicht verschieben, Räume ein- und ausblenden. Persönliche Einstellungen werden im Browser gespeichert.

Die Bedienung erklärt die App selbst: **? Hilfe** (oder die Taste `?`) zeigt alle Tastenkürzel, **⚙ Einstellungen** enthält Ansicht, Bearbeiten und Profil.

## Schnellstart (lokal)

```bash
npm install
npm start          # → http://localhost:3000
```

Andere Geräte im selben WLAN öffnen die Adresse, die beim Start angezeigt wird. „🔗 Mitplanen-Link“ kopiert automatisch die WLAN-Adresse.

## Betrieb im Internet

Siehe **[DEPLOY.md](DEPLOY.md)**: Docker Compose (empfohlen) oder pm2, Nginx Proxy Manager mit WebSocket, Cloudflare, Backups, Fehlersuche und Updates ohne Risiko.

Kurzfassung mit Docker:
```bash
docker compose up -d --build                 # starten
git pull && docker compose up -d --build     # aktualisieren
```

## Daten

- Jeder Plan liegt als `data/<plan>.json` auf dem Server (plus `.bak`). Gespeichert wird automatisch, atomar und beim Beenden.
- `data/secret.key` ist der Schlüssel für die Ansehen-Links. Löschst du ihn, werden alle bisherigen Ansehen-Links ungültig.
- Updates verändern das Datenformat nie, sie erweitern es nur. Ältere Pläne und Exporte lassen sich immer laden.

## Dateien

| Datei | Zweck |
|---|---|
| `server.js` | Web- und WebSocket-Server (eine Abhängigkeit: `ws`) |
| `public/index.html` | die komplette App |
| `Dockerfile`, `docker-compose.yml` | Betrieb mit Docker |
| `ecosystem.config.js` | Betrieb mit pm2 |
| `DEPLOY.md` | Anleitung für den Betrieb |

Neue Versionen bekommen eine höhere Nummer in `package.json` und `public/index.html` (`APP_VERSION`).
