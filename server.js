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
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // alle Netzwerkschnittstellen → auch im LAN erreichbar
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const INDEX = path.join(__dirname, 'public', 'index.html');
fs.mkdirSync(DATA, { recursive: true });

// Grenzen – großzügig für normale Nutzung, schützen vor Fehlern und Missbrauch
const LIMITS = {
  maxPayload: 2 * 1024 * 1024,   // Byte pro WebSocket-Nachricht (Import ganzer Wohnungen)
  maxOpBytes: 200 * 1024,        // Byte pro einzelner Änderung
  maxRooms: 300,                 // Räume pro Plan
  maxItems: 3000,                // Objekte pro Raum
  maxClientsPerPlan: 50,         // gleichzeitige Verbindungen pro Plan
  msgsPer10s: 600                // Nachrichten pro Verbindung in 10 s (Ziehen erzeugt ~25/s)
};

const validId = id => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id);
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
function planForView(token) {
  if (!/^[A-Za-z0-9_-]{24}$/.test(token || '')) return null;
  if (views[token]) return views[token];
  try { // Fallback, falls views.json verloren ging
    for (const f of fs.readdirSync(DATA)) {
      const id = f.replace(/\.json$/, '');
      if (f.endsWith('.json') && validId(id) && viewToken(id) === token) { registerView(id); return id; }
    }
  } catch (e) { /* ignorieren */ }
  return null;
}

/* ---------- HTTP ---------- */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',           // Plan-Code nie als Referrer an Dritte (z. B. Schriften)
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};
function lanIPs() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}
const isLocal = req => /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '');

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(INDEX).on('error', () => res.end()).pipe(res);
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
    p = { id, state: s && Array.isArray(s.rooms) ? s : { rooms: [] }, clients: new Set(), timer: null, dirty: false, idleTimer: null };
    plans.set(id, p);
  }
  clearTimeout(p.idleTimer);
  return p;
}
function flush(p) {
  clearTimeout(p.timer); p.timer = null;
  if (!p.dirty) return;
  try { writeAtomic(file(p.id), JSON.stringify(p.state)); p.dirty = false; }
  catch (e) { log('Speichern fehlgeschlagen', p.id, e.message); }
}
function persist(p) { p.dirty = true; clearTimeout(p.timer); p.timer = setTimeout(() => flush(p), 800); }
function releaseIfIdle(p) { // Plan ohne Verbindungen nach 10 min aus dem Speicher nehmen
  if (p.clients.size) return;
  p.idleTimer = setTimeout(() => { if (!p.clients.size) { flush(p); plans.delete(p.id); } }, 10 * 60 * 1000);
}

function apply(s, o) {
  if (!isObj(o)) return false;
  if (JSON.stringify(o).length > LIMITS.maxOpBytes) return false;
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
  return true;
}
function bcast(p, msg, except) {
  const t = JSON.stringify(msg);
  for (const c of p.clients) if (c !== except && c.readyState === 1) c.send(t);
}

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: LIMITS.maxPayload });
let cid = 0;
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const viewTok = q.get('view');
  const readonly = !!viewTok;
  const id = readonly ? planForView(viewTok) : (q.get('plan') || '').toLowerCase();
  if (readonly && !id) { ws.close(4404, 'unknown view'); return; }
  if (!validId(id)) { ws.close(1008, 'bad plan'); return; }
  const sid = /^[a-z0-9]{6,40}$/.test(q.get('sid') || '') ? q.get('sid') : null;
  const p = getPlan(id);
  // Dieselbe Seite verbindet sich neu → hängende alte Verbindung sofort entfernen (sonst „doppelt da“)
  if (sid) for (const c of [...p.clients]) if (c.sid === sid) {
    p.clients.delete(c); c.gone = true;
    bcast(p, { t: 'leave', id: c.cid });
    try { c.terminate(); } catch (e) { /* schon zu */ }
  }
  if (p.clients.size >= LIMITS.maxClientsPerPlan) { ws.close(1013, 'too many clients'); releaseIfIdle(p); return; }
  ws.cid = 'c' + (++cid); ws.sid = sid; ws.readonly = readonly; ws.pres = null; ws.alive = true;
  ws.rate = { n: 0, t: Date.now() };
  p.clients.add(ws);
  ws.send(JSON.stringify({
    t: 'init', you: ws.cid, state: p.state,
    peers: [...p.clients].filter(c => c !== ws && c.pres).map(c => ({ id: c.cid, p: c.pres }))
  }));
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', buf => {
    ws.alive = true;
    const now = Date.now();
    if (now - ws.rate.t > 10000) ws.rate = { n: 0, t: now };
    if (++ws.rate.n > LIMITS.msgsPer10s) return; // Flut bremsen
    let m; try { m = JSON.parse(buf); } catch (e) { return; }
    if (!isObj(m)) return;
    if (m.t === 'hb') { if (ws.readyState === 1) ws.send('{"t":"hb"}'); return; }
    if (ws.readonly) return; // Nur-Ansehen: keine Änderungen, keine Präsenz
    if (m.t === 'viewlink') { ws.send(JSON.stringify({ t: 'viewlink', token: registerView(p.id) })); return; }
    if (m.t === 'ops' && Array.isArray(m.ops)) {
      const ops = m.ops.filter(o => apply(p.state, o));
      if (!ops.length) return;
      persist(p);
      bcast(p, { t: 'ops', from: ws.cid, ops }); // auch an den Absender (Bestätigung + Reihenfolge)
    } else if (m.t === 'pres' && isObj(m.p) && JSON.stringify(m.p).length < 2000) {
      ws.pres = m.p;
      bcast(p, { t: 'pres', id: ws.cid, p: m.p }, ws);
    }
  });
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
