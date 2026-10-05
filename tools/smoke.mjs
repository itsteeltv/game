#!/usr/bin/env node
// Smoke test for a borne, without a browser: fakes a canvas and a 60 Hz clock, then
// pumps real frames through the module while mashing the controls.
//   node tools/smoke.mjs js/games/flipper.js js/games/rally.js
// Takes the bornes to drive, as paths from the repo root. It suits the canvas-loop
// bornes; the ones that build their own DOM (Le Mot, Tape-Taupe, Freedoom…) want a
// browser and are not for this tool.
// It fails loudly on a crash, and prints what the borne actually did (sounds, score,
// how long a run lasted) — enough to catch a table whose ball drains without ever
// touching anything, which is exactly what it caught when it was written.
const noop = () => {};
const grad = { addColorStop: noop };
const canvas = {
  width: 0, height: 0,
  getContext: () => new Proxy({ createRadialGradient: () => grad, createLinearGradient: () => grad }, {
    get: (t, k) => (k in t ? t[k] : noop), set: () => true,
  }),
  addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 340, height: 520 }),
};
globalThis.performance ??= { now: () => Date.now() };
let pending = null;
globalThis.requestAnimationFrame = (cb) => { pending = cb; return 1; };
globalThis.cancelAnimationFrame = () => { pending = null; };

const seen = {};
const host = {
  onStats: (o) => { if (o && o.lives !== undefined) console.log('  lives: ' + o.lives); },
  onGameOver: (s) => console.log('  gameover score=' + s),
  sfx: new Proxy({}, { get: (t, k) => () => { seen[k] = (seen[k] || 0) + 1; } }),
  tone: noop,
};

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mods = process.argv.slice(2);
if (!mods.length) { console.error('Usage: node tools/smoke.mjs js/games/<borne>.js […]'); process.exit(2); }

let failed = 0;
for (const m of mods) {
  console.log(m);
  const { createGame } = await import(pathToFileURL(path.resolve(m)).href);
  const g = createGame(canvas, host, { difficulty: 1 });
  g.start();
  g.input('action', true); g.input('action', false);
  let t = 0, frames = 0;
  try {
    while (pending && frames < 3000) {
      const cb = pending; pending = null;
      t += 16.7; frames++;
      if (frames % 40 === 0) { g.input('left', true); g.input('right', false); }
      if (frames % 40 === 20) { g.input('left', false); g.input('right', true); }
      if (frames % 45 === 0) { g.input('action', true); g.input('action', false); }
      cb(t);
    }
    console.log('  frames run: ' + frames + (pending ? '' : ' (loop stopped)'));
    console.log('  sfx: ' + JSON.stringify(seen));
    for (const k of Object.keys(seen)) delete seen[k];
  } catch (e) {
    failed++;
    console.log('  CRASH at frame ' + frames);
    console.log(e);
  }
  g.destroy();
}
if (failed) { console.error(failed + ' borne(s) en erreur'); process.exit(1); }
