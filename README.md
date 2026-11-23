# Raumplaner live

Der Raumplaner als eigene Web-App, mit dem du zusammen mit anderen in Echtzeit planen kannst. Es gibt keinen Login: Wer den Link zum Plan hat, plant mit.

## Starten (lokal)

Du brauchst Node.js ab Version 18 (https://nodejs.org).

```bash
npm install
npm start
```

Danach http://localhost:3000 öffnen. Die Adresse bekommt automatisch einen Plan-Code, zum Beispiel `?plan=k3v6q2rt`. Dieser Link führt genau zu diesem Plan.

## Im lokalen Netzwerk (WLAN/LAN)

Der Server ist automatisch im ganzen lokalen Netzwerk erreichbar. Beim Start zeigt er die Adresse an, zum Beispiel `http://192.168.1.23:3000`. Andere Geräte im selben WLAN öffnen diese Adresse. Wenn du die App selbst über `localhost` geöffnet hast, kopiert „Link zum Plan kopieren“ automatisch die LAN-Adresse.

Wenn andere Geräte die Seite nicht erreichen:
- **Windows:** Beim ersten Start fragt die Firewall nach. Dort „Private Netzwerke“ erlauben. Alternativ freigeben mit: `netsh advfirewall firewall add rule name="Raumplaner" dir=in action=allow protocol=TCP localport=3000`
- **macOS:** Die Frage, ob „node“ eingehende Verbindungen annehmen darf, mit „Erlauben“ beantworten.
- **Linux (ufw):** `sudo ufw allow 3000/tcp`
- Gast-WLANs blockieren oft den Kontakt zwischen Geräten. Alle Geräte müssen im selben, normalen WLAN sein.
- Anderen Port verwenden: `PORT=8080 npm start` (unter Windows PowerShell: `$env:PORT=8080; npm start`)

## Für Freunde erreichbar machen

**Variante A: am schnellsten, ohne Konto.** Lass den Server auf deinem Rechner laufen und öffne in einem zweiten Terminal einen Tunnel:

```bash
npx cloudflared tunnel --url http://localhost:3000
```

Der Tunnel zeigt eine Adresse wie `https://irgendwas.trycloudflare.com`. Öffne sie, und schick deinen Freunden den Link mit dem `?plan=…`-Teil (dafür gibt es den Knopf „Link zum Plan kopieren“). Das funktioniert, solange dein Rechner und der Tunnel laufen. Die Adresse ist bei jedem Start eine neue.

**Variante B: dauerhaft online.** Zum Beispiel bei Render.com:
1. Den Ordner in ein GitHub-Repository hochladen.
2. Auf render.com unter „New → Web Service“ das Repository wählen.
3. Build Command `npm install`, Start Command `npm start`, Plan „Free“.

Der Gratis-Plan schläft nach einer Weile Inaktivität ein (der erste Aufruf dauert dann etwa 30 Sekunden), und Dateien bleiben nicht dauerhaft erhalten. Pläne können also nach einem Neustart weg sein. Deshalb solltest du ab und zu „Als JSON-Datei speichern“ nutzen. Dauerhaft gespeichert wird mit einer „Persistent Disk“ (kostenpflichtig): als Mount-Pfad `/data` einhängen und die Umgebungsvariable `DATA_DIR=/data` setzen.

## Räume mit eigener Form (z. B. L-förmig)

- **✎ Raum zeichnen** (Karte „Wohnung“): Klicke Ecke für Ecke. Zum Abschließen den Startpunkt anklicken, doppelklicken oder Enter drücken. ⌫ entfernt die letzte Ecke, Esc bricht ab. Die Punkte rasten am 5-cm-Raster ein, an waagrechten und senkrechten Linien zur letzten Ecke und zum Startpunkt sowie an den Innen- und Außenecken der anderen Räume. So teilen sich Nachbarräume automatisch eine Wand.
- **Form bearbeiten** (Karte „Raum“): ● Ecken ziehen, ■ Wände parallel verschieben. Doppelklick auf ■ teilt eine Wand (neue Ecke), Doppelklick auf ● löscht eine Ecke. Formen, deren Wände sich überkreuzen, werden automatisch zurückgenommen.
- **＋ Anbau / Ausschnitt** (Karte „Raum“): Auf einer Wand des Raums starten, Ecken klicken, auf einer Wand enden. Liegt der Linienzug außen, wird der Raum erweitert, liegt er innen, wird das Stück herausgeschnitten. Die Statuszeile zeigt, wie viele m² dazukommen oder wegfallen.
- **Ecke an beliebiger Stelle:** Im Modus „Form bearbeiten“ irgendwo doppelt auf eine Wand klicken.
- **Wandlängen** (Karte „Raum“ → „Wandlängen“): Jede Wand hat ein Zahlenfeld. Ändert sich eine Länge, wandert die folgende Wand (im Uhrzeigersinn) parallel mit. Fährst du mit der Maus über eine Zeile, wird die Wand im Plan hervorgehoben.
- **Zu Rechteck** setzt die Form auf das umschließende Rechteck zurück. Fenster und Türen wandern dabei auf die nächstgelegene Wand.
- Alte Pläne mit Rechteckräumen werden automatisch übernommen.

## Zoomen und Ausschnitt verschieben

- **Mausrad** (oder Pinch-Geste auf dem Touchpad) zoomt zur Mausposition. **Zwei Finger** zoomen auf Handy und Tablet.
- Den **Ausschnitt verschieben** kannst du so: eine leere Fläche ziehen, mit gedrückter mittlerer Maustaste ziehen, mit **Leertaste + Ziehen** (geht auch über Möbeln und beim Zeichnen) oder auf dem Handy mit einem Finger auf einer leeren Fläche.
- Unten rechts im Plan: **− / + / Prozentanzeige**. Ein Klick auf die Prozentanzeige passt die ganze Wohnung wieder ein. Auf der Tastatur gehen **+**, **−** und **0** (einpassen).
- Der Ausschnitt gilt nur für dich, Freunde behalten ihre eigene Ansicht.

## Räume verschieben, Rückgängig

- **Raumnamen** (Häkchen oben): blendet Namen und Flächen im Plan aus oder ein. Die Einstellung gilt nur für dich und bleibt gespeichert. Ohne Namen ziehst du Räume am Boden des gewählten Raums.
- **Räume per Drag'n'Drop:** Den Raumnamen im Plan ziehen, das geht bei jedem Raum. Oder den Boden des gerade gewählten Raums ziehen. Beim Loslassen rastet der Raum an den Innen- und Außenecken der Nachbarräume ein, Nachbarn teilen sich dann eine Wand. Mit dem Häkchen **„Räume fixieren“** sperrst du das Verschieben.
- **Strg+Z / Strg+Y** (Mac: ⌘+Z / ⌘+⇧+Z) oder die Knöpfe ↶ ↷: Damit machst du **deine eigenen** Änderungen rückgängig oder wiederholst sie. Was deine Freunde an anderen Objekten ändern, bleibt erhalten. Ein Ziehvorgang oder ein umbenannter Name zählt als ein Schritt. Auch „Beispiel laden“ und „Raum löschen“ lassen sich so zurücknehmen. Beim Zeichnen entfernt Strg+Z die letzte Ecke.

## Was live geteilt wird

- Räume, Möbel, Fenster und Türen: jede Änderung, auch während du ziehst
- Die Mauszeiger der anderen, mit Namen und Farbe
- Das Objekt, das gerade jemand anderes ausgewählt hat: Es bekommt einen Rahmen in seiner Farbe

Nur für dich selbst gelten: welche Räume ausgeblendet sind, welcher Raum gerade aktiv ist, Drehschritt, Einrasten und „Räume verschieben“.

## Dateien

- `server.js`: Webserver und WebSocket-Server. Speichert jeden Plan als `data/<plan>.json`.
- `public/index.html`: die App
