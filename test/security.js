// Sicherheitstests: node test/security.js  (startet einen eigenen Server auf Port 3190)
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), net = require('net');
const WebSocket = require('ws');
const PORT = 3190, DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-sec-'));
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = (p, headers = {}) => new Promise(res => http.get({ port: PORT, path: p, headers }, r => {
  let b = ''; r.on('data', d => b += d); r.on('end', () => res({ s: r.statusCode, h: r.headers, b }));
}).on('error', e => res({ s: 0, b: e.message })));
const raw = line => new Promise(res => { const s = net.connect(PORT, '127.0.0.1', () => s.write(line)); let b = ''; s.on('data', d => b += d); s.on('close', () => res(b)); setTimeout(() => { s.destroy(); res(b); }, 800); });
function conn(q) {
  return new Promise(res => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?${q}`); ws.msgs = []; ws.closeCode = null;
    ws.on('message', d => ws.msgs.push(JSON.parse(d)));
    ws.on('close', c => { ws.closeCode = c; res(ws); });
    ws.on('open', () => setTimeout(() => res(ws), 150));
    ws.on('error', () => {});
  });
}
(async () => {
  const srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, DATA_DIR: DATA }, stdio: 'ignore' });
  await sleep(700);
  try {
    console.log('HTTP');
    const idx = await get('/');
    ok(/frame-ancestors 'none'/.test(idx.h['content-security-policy'] || ''), 'CSP-Header gesetzt');
    ok(!/googleapis|gstatic/.test(idx.b), 'keine fremden Server im HTML (Schriften lokal)');
    ok((await get('/fonts/ibm-plex-sans-latin-400-normal.woff2')).s === 200, 'Schrift wird ausgeliefert');
    ok((await get('/fonts/..%2fserver.js')).s === 404 && (await get('/fonts/../server.js')).s === 404, 'kein Pfad-Ausbruch über /fonts');
    ok((await get('/views.json')).s === 404 && (await get('/data/views.json')).s === 404, 'Daten-Dateien nicht per HTTP erreichbar');
    ok((await get('/lan')).s === 200, '/lan direkt vom eigenen Rechner');
    ok((await get('/lan', { 'x-forwarded-for': '1.2.3.4' })).s === 404, '/lan über Reverse-Proxy gesperrt (keine internen IPs)');
    ok((await get('/lan', { host: 'raumplaner.example.com' })).s === 404, '/lan mit fremdem Host gesperrt');
    await raw('GET //[ HTTP/1.1\r\nHost: x\r\n\r\n');
    ok((await get('/health')).s === 200, 'kaputte URL bringt den Server nicht zum Absturz');

    console.log('WebSocket');
    const a = await conn('plan=sectest-aaaa&sid=aaaaaaaa');
    ok(a.msgs[0] && a.msgs[0].t === 'init', 'Verbindung zu eigenem Plan');
    a.send(JSON.stringify({ t: 'ops', ops: [{ t: 'room', r: { id: 'r1', name: 'A', x: 0, y: 0, w: 300, d: 300 } }] }));
    await sleep(100);
    a.send(JSON.stringify({ t: 'viewlink' })); await sleep(150);
    const tok = (a.msgs.find(m => m.t === 'viewlink') || {}).token;
    ok(/^[A-Za-z0-9_-]{24}$/.test(tok || ''), 'Ansehen-Link erzeugt');
    const v = await conn('plan=views&sid=bbbbbbbb');
    ok(v.closeCode === 1008, 'Plan-Code „views“ abgelehnt (würde alle Ansehen-Links verraten)');
    const v2 = await conn('plan=secret');
    ok(v2.closeCode === 1008, 'Plan-Code „secret“ abgelehnt');
    const t = await conn('plan=..%2f..%2fetc&sid=cccccccc');
    ok(t.closeCode === 1008, 'Pfad im Plan-Code abgelehnt');
    const other = await conn('plan=sectest-bbbb&sid=dddddddd');
    ok(!JSON.stringify(other.msgs).includes('"A"'), 'anderer Plan sieht fremde Räume nicht');
    ok(!/\d+\.\d+\.\d+\.\d+/.test(JSON.stringify(a.msgs.concat(other.msgs))), 'keine IP-Adressen in Nachrichten');

    // Prototyp-Verschmutzung
    a.send('{"t":"ops","ops":[{"t":"room","r":{"id":"r1","__proto__":{"polluted":1},"constructor":{"x":1},"name":"B"}},{"t":"item","rid":"r1","it":{"id":"i1","type":"furn","__proto__":{"evil":1}}}]}');
    await sleep(1200);
    const saved = fs.readFileSync(path.join(DATA, 'sectest-aaaa.json'), 'utf8');
    ok(!/__proto__|polluted|"constructor"|evil/.test(saved), 'gefährliche Schlüssel werden nicht gespeichert');
    ok(({}).polluted === undefined, 'kein verbogener Prototyp');

    // Nur-Ansehen
    const ro = await conn(`view=${tok}&sid=aaaaaaaa`); // gleiche sid wie Bearbeiter!
    ok(ro.msgs[0] && ro.msgs[0].t === 'init' && ro.msgs[0].state.rooms.length === 1, 'Zuschauer bekommt den Plan');
    ok(!JSON.stringify(ro.msgs).includes('sectest-aaaa'), 'Zuschauer erfährt den Plan-Code nicht');
    ok(a.readyState === 1, 'Zuschauer mit fremder sid wirft den Bearbeiter nicht hinaus');
    ro.send(JSON.stringify({ t: 'ops', ops: [{ t: 'roomDel', id: 'r1' }] }));
    ro.send(JSON.stringify({ t: 'viewlink' })); await sleep(300);
    const s2 = JSON.parse(fs.readFileSync(path.join(DATA, 'sectest-aaaa.json'), 'utf8'));
    ok(s2.rooms.length === 1, 'Zuschauer kann nichts ändern');
    ok(!ro.msgs.some(m => m.t === 'viewlink'), 'Zuschauer kann keine Links erzeugen');
    ro.send(JSON.stringify({ t: 'rotate' })); await sleep(300);
    ok(a.readyState === 1 && fs.existsSync(path.join(DATA, 'sectest-aaaa.json')) && !JSON.parse(fs.readFileSync(path.join(DATA, 'sectest-aaaa.json'), 'utf8')).revoked,
      'Zuschauer kann den Link nicht erneuern');
    const bad = await conn('view=AAAAAAAAAAAAAAAAAAAAAAAA');
    ok(bad.closeCode === 4404, 'ungültiger Ansehen-Link abgelehnt');

    // Präsenz: Sitzungs-ID wird nicht weitergegeben
    const b = await conn('plan=sectest-aaaa&sid=eeeeeeee');
    a.send(JSON.stringify({ t: 'pres', p: { n: 'X', c: '#123456', sid: 'aaaaaaaa' } })); await sleep(200);
    const pr = b.msgs.find(m => m.t === 'pres');
    ok(pr && pr.p.n === 'X' && !('sid' in pr.p), 'Präsenz ohne Sitzungs-ID');

    // Größen
    a.send(JSON.stringify({ t: 'ops', ops: [{ t: 'room', r: { id: 'big', junk: 'x'.repeat(300 * 1024) } }] })); await sleep(200);
    ok(!b.msgs.some(m => m.t === 'ops' && m.ops.some(o => o.r && o.r.id === 'big')), 'zu große Änderung abgelehnt');
    a.send('kein json'); a.send('[1,2]'); a.send('{"t":"ops","ops":[null,1,"x",{"t":"item","rid":"r1","it":null}]}');
    await sleep(200);
    ok(a.readyState === 1 && (await get('/health')).s === 200, 'Müll-Nachrichten bringen nichts zum Absturz');
    for (const c of [a, b, other, ro]) c.close();
  } finally {
    srv.kill('SIGTERM'); await sleep(300);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
  console.log(fails ? `\n${fails} FEHLER` : '\nAlles ok');
  process.exit(fails ? 1 : 0);
})();
