// Raumplaner live – minimaler Echtzeit-Server (Node + ws), ohne Login.
// Start: npm install && npm start  →  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const os = require('os');
const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // alle Netzwerkschnittstellen → im LAN erreichbar
function lanIPs() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

const INDEX = path.join(__dirname, 'public', 'index.html');

/* ---------- Version ----------
   version = package.json, commit = Git-Commit (falls vorhanden), build = Kennung von index.html.
   Jede ausgelieferte Seite bekommt ihre Version eingebettet; der Server schickt seine beim Verbinden mit.
   So sieht jeder, ob seine Seite oder der Server veraltet ist. */
const crypto = require('crypto');
const { execSync } = require('child_process');
const hash = buf => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 7);
function pkgVersion() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; } catch (e) { return '?'; } }
function gitCommit() {
  try { return execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; }
  catch (e) { return null; }
}
const SERVER_INFO = { version: pkgVersion(), commit: gitCommit(), build: hash(fs.readFileSync(INDEX)), code: hash(fs.readFileSync(__filename)), started: new Date().toISOString(), node: process.version };
let pageCache = { mtime: 0, html: '', info: null };
function page() { // index.html mit eingebetteter Version (neu gelesen, wenn sich die Datei ändert)
  const st = fs.statSync(INDEX);
  if (st.mtimeMs !== pageCache.mtime) {
    const raw = fs.readFileSync(INDEX, 'utf8'), build = hash(Buffer.from(raw));
    const info = build === SERVER_INFO.build ? { version: SERVER_INFO.version, commit: SERVER_INFO.commit, build } : { version: pkgVersion(), commit: gitCommit(), build };
    const json = JSON.stringify(info).replace(/</g, '\\u003c');
    pageCache = { mtime: st.mtimeMs, info, html: raw.replace('{"version":"dev","commit":null,"build":"dev"}', json) };
  }
  return pageCache.html;
}
const validId = id => /^[a-z0-9-]{1,40}$/.test(id);
const file = id => path.join(DATA, id + '.json');

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(page());
  } else if (u.pathname === '/version') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    page();
    res.end(JSON.stringify({ server: SERVER_INFO, page: pageCache.info, restartNeeded: pageCache.info.build !== SERVER_INFO.build || hash(fs.readFileSync(__filename)) !== SERVER_INFO.code }, null, 2));
  } else if (u.pathname === '/lan') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify({ ips: lanIPs(), port: PORT }));
  } else if (u.pathname === '/health') {
    res.end('ok');
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

/* ---------- Pläne im Speicher + als JSON-Datei ---------- */
const plans = new Map(); // id -> {id, state:{rooms:[]}, clients:Set, timer}
function getPlan(id) {
  let p = plans.get(id);
  if (!p) {
    let state = { rooms: [] };
    try { const s = JSON.parse(fs.readFileSync(file(id), 'utf8')); if (Array.isArray(s.rooms)) state = s; } catch (e) {}
    p = { id, state, clients: new Set(), timer: null };
    plans.set(id, p);
  }
  return p;
}
function persist(p) {
  clearTimeout(p.timer);
  p.timer = setTimeout(() => fs.writeFile(file(p.id), JSON.stringify(p.state), () => {}), 800);
}
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
function apply(s, o) {
  if (!isObj(o)) return false;
  if (o.t === 'room' && isObj(o.r) && typeof o.r.id === 'string') {
    const { items, hidden, ...r } = o.r;
    const ex = s.rooms.find(x => x.id === r.id);
    if (ex) Object.assign(ex, r); else s.rooms.push({ ...r, items: [] });
  } else if (o.t === 'roomDel' && typeof o.id === 'string') {
    s.rooms = s.rooms.filter(x => x.id !== o.id);
  } else if (o.t === 'item' && isObj(o.it) && typeof o.it.id === 'string') {
    const r = s.rooms.find(x => x.id === o.rid); if (!r) return true;
    const i = r.items.findIndex(x => x.id === o.it.id);
    if (i >= 0) r.items[i] = o.it; else r.items.push(o.it);
  } else if (o.t === 'itemDel' && typeof o.id === 'string') {
    const r = s.rooms.find(x => x.id === o.rid);
    if (r) r.items = r.items.filter(x => x.id !== o.id);
  } else return false;
  return true;
}
function bcast(p, msg, except) {
  const t = JSON.stringify(msg);
  for (const c of p.clients) if (c !== except && c.readyState === 1) c.send(t);
}

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 });
let cid = 0;
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const id = (q.get('plan') || '').toLowerCase();
  if (!validId(id)) { ws.close(1008, 'bad plan'); return; }
  const sid = /^[a-z0-9]{6,40}$/.test(q.get('sid') || '') ? q.get('sid') : null;
  const p = getPlan(id);
  // Dieselbe Browser-Seite verbindet sich neu → alte (hängende) Verbindung sofort entfernen,
  // sonst taucht man doppelt auf.
  if (sid) for (const c of [...p.clients]) if (c.sid === sid) {
    p.clients.delete(c); c.gone = true;
    bcast(p, { t: 'leave', id: c.cid });
    try { c.terminate(); } catch (e) {}
  }
  ws.cid = 'c' + (++cid); ws.sid = sid; ws.pres = null; ws.alive = true;
  p.clients.add(ws);
  ws.send(JSON.stringify({
    t: 'init', you: ws.cid, state: p.state, server: SERVER_INFO,
    peers: [...p.clients].filter(c => c !== ws && c.pres).map(c => ({ id: c.cid, p: c.pres }))
  }));
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', buf => {
    ws.alive = true;
    let m; try { m = JSON.parse(buf); } catch (e) { return; }
    if (m.t === 'hb') { if (ws.readyState === 1) ws.send('{"t":"hb"}'); return; }
    if (m.t === 'ops' && Array.isArray(m.ops)) {
      const ops = m.ops.filter(o => apply(p.state, o));
      if (!ops.length) return;
      persist(p);
      bcast(p, { t: 'ops', from: ws.cid, ops }); // auch an den Absender (Bestätigung, Reihenfolge)
    } else if (m.t === 'pres' && isObj(m.p) && JSON.stringify(m.p).length < 2000) {
      ws.pres = m.p;
      bcast(p, { t: 'pres', id: ws.cid, p: m.p }, ws);
    }
  });
  ws.on('close', () => {
    if (ws.gone) return; // schon als ersetzt gemeldet
    p.clients.delete(ws);
    bcast(p, { t: 'leave', id: ws.cid });
  });
});
// Tote Verbindungen (z. B. Handy im Standby, WLAN weg) nach spätestens ~20 s entfernen
setInterval(() => {
  for (const c of wss.clients) { if (!c.alive) { c.terminate(); continue; } c.alive = false; try { c.ping(); } catch (e) {} }
}, 10000);

server.listen(PORT, HOST, () => {
  console.log(`\nRaumplaner live v${SERVER_INFO.version}${SERVER_INFO.commit ? ' (' + SERVER_INFO.commit + ')' : ''} · Build ${SERVER_INFO.build} läuft:`);
  console.log(`  Auf diesem Rechner:   http://localhost:${PORT}`);
  const ips = lanIPs();
  for (const ip of ips) console.log(`  Im lokalen Netzwerk: http://${ip}:${PORT}`);
  if (!ips.length) console.log('  (keine LAN-Adresse gefunden – ist der Rechner mit einem Netzwerk verbunden?)');
  console.log('\nAndere Geräte im selben WLAN/LAN öffnen die Netzwerk-Adresse.\n');
});
