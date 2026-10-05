#!/usr/bin/env node
// Photographs each game's own screen into img/games/<id>.png (480 × 360): the artwork the catalogue uses.
//   node tools/shoot.mjs lights slide      # these games
//   node tools/shoot.mjs                   # every game that has no picture yet
// Needs Node 22+ and Chrome, Chromium or Edge (set CHROME_PATH if it isn't found). No other dependency:
// it serves the site itself and drives the browser over the DevTools protocol.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How to stage a game before the photo: milliseconds to let it play, and optional input to give it first.
// keys: [key, ms held]; taps: [x, y as fractions of the canvas] — each followed by a short pause.
// best: take that many frames over `wait` ms and keep the busiest one (a game whose action comes and goes).
/** n appuis secs sur la même touche : un pas de grille par appui, quelle que soit la cadence. */
const rep = (k, n, hold = 180) => Array.from({ length: n }, () => [k, hold]);

const DEMO = {
  lights: { wait: 500 },
  slide: { wait: 700 },
  hanoi: { wait: 400, taps: [[0.17, 0.5], [0.83, 0.5], [0.17, 0.5], [0.5, 0.5], [0.83, 0.5], [0.5, 0.5], [0.17, 0.5], [0.83, 0.5]] },
  whack: { wait: 3500, best: 28 },
  jump: { wait: 2400, best: 20 },
  runner: { wait: 1500 },
  hockey: { wait: 1100, best: 12, keys: [['ArrowUp', 520]] },
  // sweep: click every square of a grid each round; only a legal move is accepted, so the game plays itself.
  reversi: { wait: 1700, sweep: { cols: 8, rows: 8, x0: 24, y0: 58, cell: 44, rounds: 10, gap: 1000 } },
  gems: { wait: 2600, best: 18 },
  bubbles: { wait: 1500, keys: [['ArrowLeft', 260], [' ', 60], ['ArrowRight', 420], [' ', 60]] },
  sokoban: { wait: 500, keys: [['ArrowLeft', 60], ['ArrowUp', 60], ['ArrowUp', 60]] },
  // Le Mot: the first letter is dealt by the game, so the shot shows a row being typed.
  motus: { wait: 700, keys: [['a', 60], ['r', 60], ['b', 60]] },
  defense: { wait: 5200, best: 22, taps: [[0.125, 0.45], [0.21, 0.65], [0.375, 0.35], [0.70, 0.28], [0.70, 0.75]] },
  caverne: { wait: 900, keys: [['ArrowRight', 700], [' ', 120], ['ArrowRight', 400]] },
  flipper: { wait: 2600, best: 22, keys: [[' ', 520], ['ArrowLeft', 160], ['ArrowRight', 160], ['ArrowLeft', 160]] },
  rally: { wait: 2600, best: 20, keys: [['ArrowRight', 260], ['ArrowLeft', 300]] },
  plateformes: { wait: 1600, best: 14, keys: [['ArrowRight', 420], [' ', 120], ['ArrowRight', 300]] },
  bombes: { wait: 2000, best: 16, keys: [['ArrowRight', 300], [' ', 60], ['ArrowLeft', 200], ['ArrowDown', 400], ['ArrowRight', 500]] },
  pyramide: { wait: 1200, best: 10, keys: [['ArrowDown', 60], ['ArrowLeft', 60], ['ArrowDown', 60], ['ArrowRight', 60], ['ArrowLeft', 60]] },
  tuyaux: { wait: 900, best: 8, taps: [[0.2, 0.3], [0.32, 0.3], [0.44, 0.3], [0.44, 0.55], [0.56, 0.55], [0.68, 0.55], [0.68, 0.3], [0.8, 0.3]] },
  eboulis: { wait: 900, best: 8, keys: [['ArrowRight', 1600], ['ArrowDown', 900], ['ArrowRight', 900]] },
  colonnes: { wait: 2600, best: 16, keys: [['ArrowLeft', 300], ['ArrowDown', 900], ['ArrowRight', 400], ['ArrowDown', 900]] },
  // Ces trois-là avancent case par case : une page en arrière-plan ne reçoit qu'une poignée
  // de rAF par seconde, donc une touche tenue longtemps ne vaut qu'un pas. On répète l'appui.
  foreuse: { wait: 420, keys: [...rep('ArrowDown', 5), ...rep('ArrowLeft', 4), ...rep('ArrowDown', 2), ...rep('ArrowRight', 2), [' ', 90]] },
  echelles: { wait: 600, keys: [...rep('ArrowLeft', 8), ...rep('ArrowUp', 6), ...rep('ArrowRight', 3)] },
  qix: { wait: 500, keys: [...rep('ArrowUp', 11), ...rep('ArrowLeft', 9), ...rep('ArrowDown', 13), ...rep('ArrowLeft', 4), ...rep('ArrowUp', 5)] },
};

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
};

function serve() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

function findChrome() {
  const list = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  const found = list.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome introuvable : définis CHROME_PATH.');
  return found;
}

async function launch() {
  const port = 9300 + Math.floor(Math.random() * 600);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shoot-'));
  const proc = spawn(findChrome(), ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--disable-extensions', '--window-size=1000,800', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(250); }
  }
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let n = 0; const wait = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } });
  const send = (method, params = {}) => new Promise((res) => { const id = ++n; wait.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => {
    const r = (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result;
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
  return {
    send, ev,
    async close() {
      try { ws.close(); proc.kill(); } catch { /* already gone */ }
      await sleep(600);   // Chrome still holds its profile for a moment after it is killed
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* a temp dir, the OS will reap it */ }
    },
  };
}

// Draw the game canvas, contain-fitted, onto a 480 × 360 black card. With `frames` > 1, sample over `span` ms
// and keep the card with the most lit pixels.
const capture = (frames, span) => `(async () => {
  const c = document.getElementById('game-canvas');
  let best = null, bestScore = -1;
  for (let f = 0; f < ${frames}; f++) {
    const o = document.createElement('canvas'); o.width = 480; o.height = 360;
    const x = o.getContext('2d'); x.fillStyle = '#08070A'; x.fillRect(0, 0, 480, 360);
    const s = Math.min(480 / c.width, 360 / c.height);
    x.imageSmoothingEnabled = s < 1;
    x.drawImage(c, (480 - c.width * s) / 2, (360 - c.height * s) / 2, c.width * s, c.height * s);
    let score = 0;
    if (${frames} > 1) { const d = x.getImageData(0, 0, 480, 360).data; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 330) score++; }
    if (score > bestScore) { bestScore = score; best = o; }
    if (${frames} > 1) await new Promise((r) => setTimeout(r, ${span} / ${frames}));
  }
  return best.toDataURL('image/png').split(',')[1];
})()`;

const key = (k, type) => `document.body.dispatchEvent(new KeyboardEvent('${type}', { key: ${JSON.stringify(k)}, bubbles: true }))`;

async function shoot(page, base, id) {
  await page.send('Page.navigate', { url: `${base}/#/game/${id}` });
  await sleep(300);
  await page.send('Page.reload');
  for (let i = 0; i < 60 && !(await page.ev(`!!document.getElementById('overlay-btn')`).catch(() => false)); i++) await sleep(200);
  await page.ev(`document.getElementById('overlay-btn').click()`);
  const demo = DEMO[id] || { wait: 2200 };
  await sleep(500);
  for (const [k, hold = 60] of demo.keys || []) {
    await page.ev(key(k, 'keydown')); await sleep(hold); await page.ev(key(k, 'keyup')); await sleep(220);
  }
  if (demo.sweep) {
    const s = demo.sweep;
    for (let r = 0; r < s.rounds; r++) {
      await page.ev(`(() => { const c = document.getElementById('game-canvas'), b = c.getBoundingClientRect();
        for (let i = 0; i < ${s.cols * s.rows}; i++) {
          const x = ${s.x0} + (i % ${s.cols}) * ${s.cell} + ${s.cell / 2}, y = ${s.y0} + Math.floor(i / ${s.cols}) * ${s.cell} + ${s.cell / 2};
          c.dispatchEvent(new PointerEvent('pointerdown', { clientX: b.left + x * b.width / c.width, clientY: b.top + y * b.height / c.height, pointerType: 'mouse', bubbles: true }));
        } })()`);
      await sleep(s.gap);
    }
  }
  for (const [fx, fy] of demo.taps || []) {
    await page.ev(`(() => { const c = document.getElementById('game-canvas'), b = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: b.left + b.width * ${fx}, clientY: b.top + b.height * ${fy}, pointerType: 'mouse', bubbles: true })); })()`);
    await sleep(260);
  }
  const png = demo.best
    ? await page.ev(capture(demo.best, demo.wait))
    : (await sleep(demo.wait), await page.ev(capture(1, 0)));
  const out = path.join(ROOT, 'img', 'games', `${id}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(png, 'base64'));
  console.log(`img/games/${id}.png  (${(png.length * 0.75 / 1024).toFixed(0)} Ko)`);
}

const srv = await serve();
const base = `http://127.0.0.1:${srv.address().port}`;
let ids = process.argv.slice(2);
if (!ids.length) {
  const cat = fs.readFileSync(path.join(ROOT, 'js', 'catalog.js'), 'utf8');
  ids = [...cat.matchAll(/^\s+id: '([^']+)'/gm)].map((m) => m[1]).filter((id) => !fs.existsSync(path.join(ROOT, 'img', 'games', `${id}.png`)));
  if (!ids.length) console.log('Toutes les bornes ont déjà leur image.');
}
const page = ids.length ? await launch() : null;
try { for (const id of ids) await shoot(page, base, id); }
finally { await page?.close(); srv.close(); }
