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

## Ansicht & Maße (Menü „Ansicht ▾“)

- **Maße: alle Räume (intelligent)** – Jede Wand jedes Raums wird beschriftet:
  - Außenwand → Maß außen
  - Wand grenzt an einen Nachbarraum → Maß **innen** im jeweiligen Raum, so sieht man die Maße jedes Raums
  - Zwei deckungsgleiche Nachbarwände gleicher Länge → **ein gemeinsames Maß** auf der Wand
  - Maße des aktiven Raums sind farbig hervorgehoben
  - Alternativ: „nur aktiver Raum“ oder „aus“
- **Gesamtmaße der Wohnung** (außen über alles), sobald mehr als ein Raum sichtbar ist
- **Schrift Möbel** (50–250 %), **Möbelmaße anzeigen** (z. B. „140×200“) und **Schrift Maße**
- Alle persönlichen Einstellungen werden im Browser gespeichert: Raster, Drehschritt, Räume fixieren, Raumnamen, alle Ansichtsoptionen, die aufgeklappte Wandliste und der Zoom-Ausschnitt (pro Plan).

## Zoomen und Ausschnitt verschieben

- **Mausrad** (oder Pinch-Geste auf dem Touchpad) zoomt zur Mausposition. **Zwei Finger** zoomen auf Handy und Tablet.
- Den **Ausschnitt verschieben** kannst du so: eine leere Fläche ziehen, mit gedrückter mittlerer Maustaste ziehen, mit **Leertaste + Ziehen** (geht auch über Möbeln und beim Zeichnen) oder auf dem Handy mit einem Finger auf einer leeren Fläche.
- Unten rechts im Plan: **− / + / Prozentanzeige**. Ein Klick auf die Prozentanzeige passt die ganze Wohnung wieder ein. Auf der Tastatur gehen **+**, **−** und **0** (einpassen).
- Der Ausschnitt gilt nur für dich, Freunde behalten ihre eigene Ansicht.

## Möbel in L-Form oder freier Form

- Beim Hinzufügen gibt es **Form: Rechteck / L-Form** mit Schenkeltiefe und neue Vorlagen: **Ecksofa, Eckschreibtisch, Küche L-Form, Eckbank**.
- Für ein ausgewähltes Möbelstück: **Form: Rechteck / L-Form / Frei (Ecken)**.
  - L-Form: **Schenkel links** und **Schenkel vorne** als Zahl, **⇋ Spiegeln** für die andere Seite, Drehen wie gewohnt (Q/E, R).
  - **Ecken bearbeiten:** ● Ecke ziehen, ■ Kante verschieben, Doppelklick auf ■ fügt eine Ecke ein, Doppelklick auf ● löscht sie, Esc beendet. Das funktioniert wie bei den Wänden.
  - Breite/Tiefe ändern skaliert die Form mit. „Rechteck“ macht sie wieder eckig.
- Die Beschriftung sitzt automatisch im breitesten Teil der Form. Die Vorderkante ist dick markiert.
- **Mittlere Maustaste gedrückt halten und ziehen** verschiebt die Ansicht, auch über Möbeln.

## Himmelsrichtungen

- Oben rechts im Plan sitzt eine **Kompassrose**. Die rote Nadel zeigt nach Norden. Du kannst die Nadel **ziehen** (rastet auf 5° ein, mit Shift frei) oder auf **„N 0°“** klicken. Dort gibt es Winkel eingeben, ±15°, ±90° und „Norden = oben/rechts/unten/links“.
- Die Richtung gilt für den **ganzen Plan und alle Personen**, sie wird live geteilt und auf dem Server gespeichert. Strg+Z funktioniert auch hier.
- Angezeigt wird die Himmelsrichtung bei
  - **Wänden** (Wandlängen-Liste und Wandauswahl), z. B. „Wand 1 · oben · SO“
  - **Fenstern und Türen** (Liste „Im Raum“ und Auswahl: „Fenster blickt nach Süd (180°)“)
  - **Möbeln**: „Vorderseite zeigt nach Ost (90°)“, praktisch für Sofa, Bett oder Schreibtisch.
- Der Plan selbst bleibt gerade, nur die Richtungsangaben richten sich nach dem Kompass.

## Mehrere Möbel auswählen & gruppieren

- **Mehrfachauswahl:** Mit Shift- oder Strg-Klick auf Möbel (auch in der Liste) fügst du hinzu oder entfernst. **Shift + Ziehen** auf freier Fläche zieht ein Auswahlrechteck. **Strg+A** wählt alle Möbel des Raums.
- **Gruppieren:** **Strg+G** oder der Knopf „Gruppieren“. Der Gruppenname ist frei wählbar, z. B. „Essplatz“. **Strg+⇧+G** hebt die Gruppierung auf.
- Ein Klick auf ein Gruppenmitglied wählt die **ganze Gruppe**. Ziehen, Drehen um die Gruppenmitte (Q/E/R), Pfeiltasten, Duplizieren und Entf wirken auf alle. **Alt+Klick** wählt ein einzelnes Möbel daraus. Dort gibt es auch „Aus Gruppe lösen“.
- **Ausrichten** (bei mehreren Möbeln): links, mittig, rechts, oben, mittig oder unten bündig.
- Die Liste „Im Raum“ zeigt Gruppen als eigenen Block. Ein Klick auf den Gruppenkopf wählt die Gruppe.

## Räume verschieben, Rückgängig

- **Raumnamen** (Häkchen oben): blendet Namen und Flächen im Plan aus oder ein. Die Einstellung gilt nur für dich und bleibt gespeichert. Ohne Namen ziehst du Räume am Boden des gewählten Raums.
- **Räume per Drag'n'Drop:** Den Raumnamen im Plan ziehen, das geht bei jedem Raum. Oder den Boden des gerade gewählten Raums ziehen. Beim Loslassen rastet der Raum an den Innen- und Außenecken der Nachbarräume ein, Nachbarn teilen sich dann eine Wand. Mit dem Häkchen **„Räume fixieren“** sperrst du das Verschieben.
- **Strg+Z / Strg+Y** (Mac: ⌘+Z / ⌘+⇧+Z) oder die Knöpfe ↶ ↷: Damit machst du **deine eigenen** Änderungen rückgängig oder wiederholst sie. Was deine Freunde an anderen Objekten ändern, bleibt erhalten. Ein Ziehvorgang oder ein umbenannter Name zählt als ein Schritt. Auch „Beispiel laden“ und „Raum löschen“ lassen sich so zurücknehmen. Beim Zeichnen entfernt Strg+Z die letzte Ecke.

## Einzelne Räume exportieren / importieren

In der Karte „Raum“:
- **Raum exportieren** speichert den gewählten Raum mit Form, Fenstern, Türen und Möbeln als `raum-<Name>.json`.
- **Raum importieren** fügt die Räume aus einer Datei zum aktuellen Plan **hinzu**, ohne etwas zu ersetzen. Sie erscheinen rechts neben der Wohnung und lassen sich am Namen an ihren Platz ziehen. Gibt es den Namen schon, wird „(2)“ angehängt. Das funktioniert auch mit einer ganzen Wohnungsdatei oder einem Zimmer aus der alten Version. Mit Strg+Z nimmst du den Import zurück.

## Was live geteilt wird

- Räume, Möbel, Fenster und Türen: jede Änderung, auch während du ziehst
- Die Mauszeiger der anderen, mit Namen und Farbe
- Das Objekt, das gerade jemand anderes ausgewählt hat: Es bekommt einen Rahmen in seiner Farbe

Nur für dich selbst gelten: welche Räume ausgeblendet sind, welcher Raum gerade aktiv ist, Drehschritt, Einrasten und „Räume verschieben“.

## Version

- In der Karte **„Version“** (unten links) steht, welche Version **diese Seite** und welche der **Server** hat: Versionsnummer, Git-Commit und Build-Kennung. Dazu kommt, seit wann der Server läuft.
  - **✓ aktuell**: Seite und Server passen zusammen.
  - **⚠ Neue Version verfügbar**: Oben erscheint ein Hinweis mit Knopf **„Jetzt neu laden“**.
  - **⚠ Neustart nötig**: Neue Dateien liegen auf dem Server (z. B. nach `git pull`), aber der Server läuft noch mit der alten Version. Dann auf dem Server `pm2 restart raumplaner` ausführen.
- In **„Gemeinsam planen“** steht bei jeder Person die Version ihrer Seite. Veraltete Seiten sind mit ⚠ rot markiert.
- Für Admins: `curl http://<server>:3000/version` zeigt die Version als JSON, inklusive `restartNeeded`.
- Die Versionsnummer steht in `package.json` und wird bei jedem Update erhöht.

## Dateien

- `server.js`: Webserver und WebSocket-Server. Speichert jeden Plan als `data/<plan>.json`.
- `public/index.html`: die App
