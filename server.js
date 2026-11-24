// Raumplaner – Echtzeit-Server (Node + ws), ohne Login.
// Start: npm install && npm start  →  http://localhost:3000
//
// Kompatibilität (wichtig für Updates):
//  - Das Protokoll (init / ops / pres / leave / hb / viewlink) und das Speicherformat
//    (data/<plan>.json = { rooms:[…], meta?:{…} }) werden nur ERWEITERT, nie umbenannt.
//  - Unbekannte Nachrichten und Op-Typen werden still ignoriert, unbekannte Felder in
//    Räumen/Objekten unverändert gespeichert – ältere und neuere Seiten vertragen sich.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // alle Netzwerkschnittstellen → auch im LAN erreichbar
// Öffentliche Adresse für Suchmaschinen und Link-Vorschauen (z. B. https://roomplanner.example.com).
// Leer: wird aus der Anfrage abgeleitet (Host-Header, hinter Proxy X-Forwarded-Proto).
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const INDEX = path.join(__dirname, 'public', 'index.html');
fs.mkdirSync(DATA, { recursive: true });
try { fs.accessSync(DATA, fs.constants.W_OK); } catch (e) {
  console.error(`Datenordner ${DATA} ist nicht beschreibbar (Benutzer-ID ${process.getuid ? process.getuid() : '?'}).\n` +
    `Docker mit Ordner vom Host: sudo chown -R 1000:1000 <ordner>  ·  sonst: Rechte von ${DATA} prüfen.`);
  process.exit(1);
}

// Grenzen – großzügig für normale Nutzung, schützen vor Fehlern und Missbrauch
const LIMITS = {
  maxPayload: 2 * 1024 * 1024,   // Byte pro WebSocket-Nachricht (Import ganzer Wohnungen)
  maxOpBytes: 200 * 1024,        // Byte pro einzelner Änderung
  maxRooms: 300,                 // Räume pro Plan
  maxItems: 3000,                // Objekte pro Raum
  maxClientsPerPlan: 50,         // gleichzeitige Verbindungen pro Plan
  maxClients: +process.env.MAX_CLIENTS || 500,  // Verbindungen insgesamt
  maxPlans: +process.env.MAX_PLANS || 10000,    // gespeicherte Pläne insgesamt (Schutz vor vollgeschriebener Platte)
  maxPlanBytes: 8 * 1024 * 1024, // Größe eines Plans
  msgsPer10s: 600,               // Nachrichten pro Verbindung in 10 s (Ziehen erzeugt ~25/s)
  bytesPer10s: 16 * 1024 * 1024  // Datenmenge pro Verbindung in 10 s
};

// Plan-Codes: nur a–z, 0–9, „-“. Namen interner Dateien sind gesperrt, damit kein Plan „views“
// heißen und so fremde Ansichts-Links (und damit andere Pläne) auslesen oder überschreiben kann.
const RESERVED = new Set(['views', 'secret']);
const validId = id => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id) && !RESERVED.has(id);
// Schlüssel, mit denen sich JS-Objekt-Prototypen verbiegen lassen, aus allen Daten entfernen
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const clean = v => { // tiefe Kopie ohne gefährliche Schlüssel (Daten kommen von außen)
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) if (!BAD_KEYS.has(k)) o[k] = clean(v[k]); return o; }
  return v;
};
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

/* ---------- Dateien: atomar schreiben (tmp → umbenennen), vorherige Version als .bak ---------- */
const file = id => path.join(DATA, id + '.json');
function writeAtomic(target, text) {
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, text);
  try { fs.copyFileSync(target, target + '.bak'); } catch (e) { /* erste Speicherung */ }
  fs.renameSync(tmp, target);
}
function readJSON(target) {
  for (const f of [target, target + '.bak']) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* nächste Quelle */ }
  }
  return null;
}

/* ---------- Nur-Ansehen-Links ----------
   Ansichts-Code = HMAC(Plan-Code, geheimer Schlüssel). Daraus lässt sich der Plan-Code nicht
   zurückrechnen. Verbindungen über einen Ansichts-Code sind serverseitig schreibgeschützt.
   data/secret.key löschen → alle bisherigen Ansichts-Links werden ungültig. */
const SECRET_FILE = path.join(DATA, 'secret.key');
let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE); if (SECRET.length < 32) throw new Error('kurz'); }
catch (e) { SECRET = crypto.randomBytes(32); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }
const viewToken = planId => crypto.createHmac('sha256', SECRET).update('view:' + planId).digest('base64url').slice(0, 24);
const VIEWS_FILE = path.join(DATA, 'views.json');
let views = readJSON(VIEWS_FILE) || {};
function registerView(planId) {
  const t = viewToken(planId);
  if (views[t] !== planId) { views[t] = planId; try { writeAtomic(VIEWS_FILE, JSON.stringify(views)); } catch (e) { log('views.json:', e.message); } }
  return t;
}
function forgetViews(planId) { // alle Ansichts-Codes eines Plans ungültig machen
  let changed = false;
  for (const k of Object.keys(views)) if (views[k] === planId) { delete views[k]; changed = true; }
  if (changed) try { writeAtomic(VIEWS_FILE, JSON.stringify(views)); fs.rmSync(VIEWS_FILE + '.bak', { force: true }); } catch (e) { log('views.json:', e.message); }
}
function planForView(token) {
  if (!/^[A-Za-z0-9_-]{24}$/.test(token || '')) return null;
  if (views[token]) return views[token];
  try { // Fallback, falls views.json verloren ging
    for (const f of fs.readdirSync(DATA)) {
      const id = f.replace(/\.json$/, '');
      if (f.endsWith('.json') && validId(id) && viewToken(id) === token) {
        const st = readJSON(file(id)); if (st && !st.revoked) registerView(id); // gesperrte Pläne nicht wieder eintragen
        return id;
      }
    }
  } catch (e) { /* ignorieren */ }
  return null;
}

/* ---------- HTTP ---------- */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',           // Plan-Code nie als Referrer an Dritte (z. B. GitHub-Link)
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-frame-options': 'DENY',
  // Nur eigene Inhalte: keine fremden Server (Schriften liegen lokal), kein Einbetten in fremde Seiten
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; " +
    "form-action 'none'; frame-ancestors 'none'"
};
const STATIC = {
  '/icon.svg': 'image/svg+xml', '/favicon.svg': 'image/svg+xml', '/favicon-32.png': 'image/png',
  '/apple-touch-icon.png': 'image/png', '/icon-192.png': 'image/png', '/icon-512.png': 'image/png',
  '/manifest.webmanifest': 'application/manifest+json', '/og-image.png': 'image/png'
};
STATIC['/favicon.ico'] = 'image/png'; // alte Browser fragen ohne Link danach
let FONTS = new Set();
try { FONTS = new Set(fs.readdirSync(path.join(__dirname, 'public', 'fonts')).filter(f => /^[a-z0-9-]+\.woff2$/.test(f))); } catch (e) { /* ohne Schriften: Systemschrift */ }
function lanIPs() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}
// Nur direkt vom eigenen Rechner – nie über einen Reverse-Proxy (der sitzt oft auch auf 127.0.0.1).
// Sonst könnte jeder aus dem Internet die internen IP-Adressen des Servers abfragen.
const PROXY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'x-forwarded-host', 'via'];
// Eigene Adresse: PUBLIC_URL, sonst aus Host-Header (streng geprüft, damit niemand fremde Adressen einschleust)
function origin(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = String(req.headers.host || '').toLowerCase();
  if (!/^[a-z0-9.-]{1,253}(:\d{1,5})?$|^\[[0-9a-f:]+\](:\d{1,5})?$/.test(host)) return '';
  const fp = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return ((fp === 'https' || fp === 'http') ? fp : 'http') + '://' + host;
}
// index.html einmal lesen (neu, wenn die Datei sich ändert) und gezippt vorhalten
let pageCache = { mtime: 0, text: '' };
function pageText() {
  const st = fs.statSync(INDEX);
  if (st.mtimeMs !== pageCache.mtime) pageCache = { mtime: st.mtimeMs, text: fs.readFileSync(INDEX, 'utf8'), gz: new Map() };
  return pageCache;
}
const isLocal = req => /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '') &&
  !PROXY_HEADERS.some(h => h in req.headers) && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '');

const server = http.createServer((req, res) => {
  let u; try { u = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400, SECURITY_HEADERS); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    let pc; try { pc = pageText(); } catch (e) { res.writeHead(500, SECURITY_HEADERS); return res.end(); }
    const o = origin(req);
    let body = pc.gz.get(o);
    if (!body) { body = zlib.gzipSync(pc.text.replace(/__ORIGIN__/g, o)); if (pc.gz.size < 20) pc.gz.set(o, body); }
    const h = { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', vary: 'Accept-Encoding' };
    // Pläne und Ansehen-Links sind privat: nie in Suchmaschinen aufnehmen. Nur die Startseite ist öffentlich.
    if (u.searchParams.has('plan') || u.searchParams.has('view') || u.pathname !== '/') h['x-robots-tag'] = 'noindex, nofollow';
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (gz) h['content-encoding'] = 'gzip'; else body = zlib.gunzipSync(body);
    res.writeHead(200, h);
    res.end(req.method === 'HEAD' ? undefined : body);
  } else if (u.pathname === '/robots.txt') {
    const o = origin(req);
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' });
    res.end('User-agent: *\nAllow: /\nDisallow: /ws\n' + (o ? `Sitemap: ${o}/sitemap.xml\n` : ''));
  } else if (u.pathname === '/sitemap.xml') {
    const o = origin(req);
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=86400' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${o}/</loc></url></urlset>\n`);
  } else if (STATIC[u.pathname]) { // Logo, Favicons, Web-App-Manifest (feste Liste, keine Pfade von außen)
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': STATIC[u.pathname], 'cache-control': 'public, max-age=86400' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(path.join(__dirname, 'public', u.pathname === '/favicon.ico' ? 'favicon-32.png' : u.pathname.slice(1))).on('error', () => res.end()).pipe(res);
  } else if (u.pathname.startsWith('/fonts/') && FONTS.has(u.pathname.slice(7))) {
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'font/woff2', 'cache-control': 'public, max-age=31536000, immutable' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(path.join(__dirname, 'public', 'fonts', u.pathname.slice(7))).on('error', () => res.end()).pipe(res);
  } else if (u.pathname === '/health') {
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/plain', 'cache-control': 'no-store' });
    res.end('ok');
  } else if (u.pathname === '/lan' && isLocal(req)) { // nur für den eigenen Rechner (Link fürs WLAN)
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ips: lanIPs(), port: PORT }));
  } else {
    res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain' }); res.end('Not found');
  }
});

/* ---------- Pläne im Speicher + als JSON-Datei ---------- */
const plans = new Map(); // id -> { id, state, clients:Set, timer, dirty, idleTimer }
function getPlan(id) {
  let p = plans.get(id);
  if (!p) {
    const s = readJSON(file(id));
    const state = s && Array.isArray(s.rooms) ? clean(s) : { rooms: [] };
    state.rooms = state.rooms.filter(isObj); for (const r of state.rooms) if (!Array.isArray(r.items)) r.items = [];
    p = { id, state, clients: new Set(), timer: null, dirty: false, idleTimer: null, onDisk: !!s,
      bytes: s ? JSON.stringify(state).length : 0 };
    plans.set(id, p);
  }
  clearTimeout(p.idleTimer);
  return p;
}
function flush(p) {
  clearTimeout(p.timer); p.timer = null;
  if (!p.dirty) return;
  try { const text = JSON.stringify(p.state); p.bytes = text.length; writeAtomic(file(p.id), text); p.dirty = false; p.onDisk = true; }
  catch (e) { log('Speichern fehlgeschlagen', p.id, e.message); }
}
function persist(p) { p.dirty = true; clearTimeout(p.timer); p.timer = setTimeout(() => flush(p), 800); }
function releaseIfIdle(p) { // Plan ohne Verbindungen nach 10 min aus dem Speicher nehmen
  if (p.clients.size) return;
  p.idleTimer = setTimeout(() => { if (!p.clients.size) { flush(p); plans.delete(p.id); } }, 10 * 60 * 1000);
}

let planCount = 0;
try { planCount = fs.readdirSync(DATA).filter(f => /^[a-z0-9-]+\.json$/.test(f) && f !== 'views.json').length; } catch (e) { /* leer */ }

function apply(p, o) {
  const s = p.state;
  if (!isObj(o)) return false;
  const size = JSON.stringify(o).length;
  if (size > LIMITS.maxOpBytes) return false;
  const grows = o.t === 'room' || o.t === 'item';
  if (grows && p.bytes + size > LIMITS.maxPlanBytes) return false; // Löschen geht immer
  o = clean(o);
  if (o.t === 'room' && isObj(o.r) && typeof o.r.id === 'string') {
    const { items, hidden, ...r } = o.r;
    const ex = s.rooms.find(x => x.id === r.id);
    if (ex) Object.assign(ex, r);
    else { if (s.rooms.length >= LIMITS.maxRooms) return false; s.rooms.push({ ...r, items: [] }); }
  } else if (o.t === 'roomDel' && typeof o.id === 'string') {
    s.rooms = s.rooms.filter(x => x.id !== o.id);
  } else if (o.t === 'item' && isObj(o.it) && typeof o.it.id === 'string') {
    const r = s.rooms.find(x => x.id === o.rid); if (!r) return true; // Raum inzwischen gelöscht: bestätigen, nichts tun
    const i = r.items.findIndex(x => x.id === o.it.id);
    if (i >= 0) r.items[i] = o.it;
    else { if (r.items.length >= LIMITS.maxItems) return false; r.items.push(o.it); }
  } else if (o.t === 'itemDel' && typeof o.id === 'string') {
    const r = s.rooms.find(x => x.id === o.rid);
    if (r) r.items = r.items.filter(x => x.id !== o.id);
  } else if (o.t === 'meta' && o.k === 'north' && Number.isFinite(o.v)) { // ältere Seiten (v1.9): Himmelsrichtung
    s.meta = s.meta || {}; s.meta.north = ((o.v % 360) + 360) % 360;
  } else return false; // unbekannt → ignorieren (neuere Seite, älterer Server)
  if (grows) p.bytes += size; // grobe Schätzung bis zum nächsten Speichern (dort exakt)
  return true;
}
/* ---------- Link erneuern ----------
   Der Plan zieht unter einen neuen, zufälligen Code um. Der alte Code wird zum Grabstein
   ({ revoked: true }, ohne Inhalt, ohne .bak), alte Ansehen-Links verfallen mit.
   Alle anderen Verbindungen werden getrennt – nur wer erneuert hat, bekommt den neuen Code. */
const REVOKED = 4410;
const newPlanId = () => Array.from(crypto.randomBytes(16), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
function rotate(p, by) {
  let id; do { id = newPlanId(); } while (fs.existsSync(file(id)) || plans.has(id));
  const text = JSON.stringify(p.state);
  writeAtomic(file(id), text);
  fs.writeFileSync(file(p.id), JSON.stringify({ rooms: [], revoked: true }));
  for (const ext of ['.bak', '.tmp']) fs.rmSync(file(p.id) + ext, { force: true });
  forgetViews(p.id);
  clearTimeout(p.timer); p.dirty = false;
  p.state = { rooms: [], revoked: true }; p.bytes = 0;
  log('Link erneuert (alter Plan gesperrt)');
  if (by.readyState === 1) by.send(JSON.stringify({ t: 'rotated', plan: id }));
  for (const c of [...p.clients]) { c.gone = true; try { c.close(REVOKED, 'revoked'); } catch (e) { /* zu */ } }
  p.clients.clear(); plans.delete(p.id);
}

function bcast(p, msg, except) {
  const t = JSON.stringify(msg);
  for (const c of p.clients) if (c !== except && c.readyState === 1) c.send(t);
}

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: LIMITS.maxPayload });
let cid = 0;
wss.on('connection', (ws, req) => {
  let q; try { q = new URL(req.url, 'http://x').searchParams; } catch (e) { ws.close(1008, 'bad url'); return; }
  const viewTok = q.get('view');
  const readonly = !!viewTok;
  const id = readonly ? planForView(viewTok) : (q.get('plan') || '').toLowerCase();
  if (readonly && !id) { ws.close(4404, 'unknown view'); return; }
  if (!validId(id)) { ws.close(1008, 'bad plan'); return; }
  if (wss.clients.size > LIMITS.maxClients) { ws.close(1013, 'busy'); return; }
  const sid = /^[a-z0-9]{6,40}$/.test(q.get('sid') || '') ? q.get('sid') : null;
  const p = getPlan(id);
  if (p.state.revoked) { ws.close(REVOKED, 'revoked'); releaseIfIdle(p); return; } // Link wurde erneuert
  // Dieselbe Seite verbindet sich neu → hängende alte Verbindung sofort entfernen (sonst „doppelt da“).
  // Nur gleiche Art (Ansehen/Bearbeiten), damit ein Zuschauer niemanden hinauswerfen kann.
  if (sid) for (const c of [...p.clients]) if (c.sid === sid && c.readonly === readonly) {
    p.clients.delete(c); c.gone = true;
    bcast(p, { t: 'leave', id: c.cid });
    try { c.terminate(); } catch (e) { /* schon zu */ }
  }
  if (p.clients.size >= LIMITS.maxClientsPerPlan) { ws.close(1013, 'too many clients'); releaseIfIdle(p); return; }
  ws.cid = 'c' + (++cid); ws.sid = sid; ws.readonly = readonly; ws.pres = null; ws.alive = true;
  ws.rate = { n: 0, b: 0, t: Date.now() };
  p.clients.add(ws);
  ws.send(JSON.stringify({
    t: 'init', you: ws.cid, state: p.state,
    peers: [...p.clients].filter(c => c !== ws && c.pres).map(c => ({ id: c.cid, p: c.pres }))
  }));
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', buf => { try { onMessage(buf); } catch (e) { log('Fehler bei Nachricht:', e.message); } });
  function onMessage(buf) {
    ws.alive = true;
    const now = Date.now();
    if (now - ws.rate.t > 10000) ws.rate = { n: 0, b: 0, t: now };
    ws.rate.b += buf.length;
    if (++ws.rate.n > LIMITS.msgsPer10s || ws.rate.b > LIMITS.bytesPer10s) return; // Flut bremsen
    let m; try { m = JSON.parse(buf); } catch (e) { return; }
    if (!isObj(m)) return;
    if (m.t === 'hb') { if (ws.readyState === 1) ws.send('{"t":"hb"}'); return; }
    if (ws.readonly) return; // Nur-Ansehen: keine Änderungen, keine Präsenz
    if (m.t === 'rotate') { if (p.clients.has(ws)) rotate(p, ws); return; }
    if (m.t === 'viewlink') { ws.send(JSON.stringify({ t: 'viewlink', token: registerView(p.id) })); return; }
    if (m.t === 'ops' && Array.isArray(m.ops)) {
      if (!p.onDisk && !p.dirty && planCount >= LIMITS.maxPlans) return; // keine neuen Pläne mehr
      const ops = m.ops.filter(o => apply(p, o)).map(clean);
      if (!ops.length) return;
      if (!p.onDisk && !p.dirty) planCount++;
      persist(p);
      bcast(p, { t: 'ops', from: ws.cid, ops }); // auch an den Absender (Bestätigung + Reihenfolge)
    } else if (m.t === 'pres' && isObj(m.p) && JSON.stringify(m.p).length < 2000) {
      const { sid: _s, ...pr } = clean(m.p); // Sitzungs-ID nie an andere weitergeben
      ws.pres = pr;
      bcast(p, { t: 'pres', id: ws.cid, p: pr }, ws);
    }
  }
  ws.on('close', () => {
    if (ws.gone) return; // schon als ersetzt gemeldet
    p.clients.delete(ws);
    bcast(p, { t: 'leave', id: ws.cid });
    releaseIfIdle(p);
  });
  ws.on('error', () => { /* Verbindungsfehler: close folgt */ });
});

// Tote Verbindungen (Handy im Standby, WLAN weg) nach spätestens ~20 s entfernen.
// Hält außerdem Proxys (Cloudflare: 100 s, nginx: 60 s) aktiv.
const beat = setInterval(() => {
  for (const c of wss.clients) { if (!c.alive) { c.terminate(); continue; } c.alive = false; try { c.ping(); } catch (e) { /* zu */ } }
}, 10000);

/* ---------- Sauber beenden: nichts verlieren bei Neustart (pm2 / docker stop) ---------- */
let stopping = false;
function shutdown(sig) {
  if (stopping) return; stopping = true;
  log(`${sig} – speichere und beende …`);
  clearInterval(beat);
  for (const p of plans.values()) flush(p);
  for (const c of wss.clients) { try { c.close(1012, 'restart'); } catch (e) { /* egal */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.on('error', e => {
  if (e.code === 'EADDRINUSE') log(`Port ${PORT} ist schon belegt – läuft noch ein alter Server? (ss -ltnp | grep :${PORT})`);
  else log('Serverfehler:', e.message);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  let version = '?'; try { version = require('./package.json').version; } catch (e) { /* egal */ }
  log(`Raumplaner v${version} läuft auf http://localhost:${PORT} (Daten: ${DATA})`);
  for (const ip of lanIPs()) log(`  im lokalen Netzwerk: http://${ip}:${PORT}`);
});
