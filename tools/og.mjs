#!/usr/bin/env node
// Draws img/og.png (1200 × 630), the card social networks show when the site is shared.
// Run it again after adding bornes — the headline counts them.
//   node tools/og.mjs
// Needs Chrome, Chromium or Edge (set CHROME_PATH if it is not found). No dependency:
// it writes one temporary page and asks the browser to photograph it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COVERS = ['tetris', 'pacman', 'colonnes', 'pyramide', 'bombes', 'eboulis', 'invaders', 'tuyaux'];

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

const count = [...fs.readFileSync(path.join(ROOT, 'js/catalog.js'), 'utf8').matchAll(/^\s+id: '/gm)].length;
const shots = COVERS
  .filter((id) => fs.existsSync(path.join(ROOT, 'img/games', `${id}.png`)))
  .map((id) => `<span class="shot"><img src="games/${id}.png"></span>`)
  .join('');

const html = `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; background: #0B0C0F;
         font: 400 16px system-ui, "Segoe UI", Roboto, sans-serif; color: #EDEFF3; }
  .wrap { position: relative; width: 1200px; height: 630px; padding: 52px 72px 56px; display: flex; flex-direction: column; gap: 34px; }
  .glow { position: absolute; width: 820px; height: 820px; right: -240px; top: -340px; border-radius: 50%;
          background: radial-gradient(circle, rgba(255,90,43,.26), rgba(255,90,43,0) 62%); }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 16px; }
  .mark { width: 58px; height: 58px; display: grid; place-items: center; border-radius: 15px; background: rgba(255,90,43,.16); }
  .mark svg { width: 28px; height: 34px; color: #FF5A2B; }
  .name { font-size: 28px; font-weight: 500; color: #A7AEBC; letter-spacing: -.02em; }
  .name b { color: #EDEFF3; font-weight: 700; }
  .url { font-size: 19px; color: #767E8D; }
  h1 { font-size: 66px; line-height: 1.03; font-weight: 750; letter-spacing: -.045em; max-width: 17ch; }
  h1 em { font-style: normal; color: #FF5A2B; }
  p { margin-top: 16px; font-size: 24px; line-height: 1.4; color: #A7AEBC; max-width: 40ch; }
  .strip { margin-top: auto; display: flex; gap: 14px; }
  .shot { width: 160px; aspect-ratio: 4/3; border-radius: 15px; overflow: hidden; border: 1px solid rgba(255,255,255,.1);
          background: #08070A; box-shadow: 0 18px 40px -16px rgba(0,0,0,.85); }
  .shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
<div class="wrap">
  <div class="glow"></div>
  <div class="top">
    <span class="brand">
      <span class="mark"><svg viewBox="0 0 20 24"><rect x="1" y="1" width="18" height="22" rx="3" fill="currentColor"/><rect x="4" y="5" width="12" height="9" rx="1.5" fill="#0B0C0F"/><rect x="5" y="17" width="10" height="2" rx="1" fill="#0B0C0F"/></svg></span>
      <span class="name">Mini<b>Arcade</b></span>
    </span>
    <span class="url">itsteeltv.github.io/game</span>
  </div>
  <div>
    <h1>${count} bornes <em>dans ton navigateur</em></h1>
    <p>De Pong à Doom, plus des bornes maison. Rien à installer, aucun compte.</p>
  </div>
  <div class="strip">${shots}</div>
</div>`;

const page = path.join(ROOT, 'img', '_og.html');
const out = path.join(ROOT, 'img', 'og.png');
fs.writeFileSync(page, html);
try {
  const r = spawnSync(findChrome(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1200,630', `--screenshot=${out}`, `file://${page.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' });
  if (r.error) throw r.error;
  if (!fs.existsSync(out)) throw new Error('Chrome n’a rien écrit — vérifie CHROME_PATH.');
  console.log(`img/og.png  (${(fs.statSync(out).size / 1024).toFixed(0)} Ko, ${count} bornes)`);
} finally {
  fs.unlinkSync(page);
}
