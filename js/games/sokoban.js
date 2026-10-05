// Entrepôt — Sokoban. Push every crate onto a marked tile; a crate only moves if
// nothing is behind it. Levels are hand-made here, small enough to read at a glance
// on a phone and ordered so each one teaches the next. `hold` undoes a move.
//
// Level grammar: # wall · (space) floor · . target · $ crate · * crate on target
//                @ you · + you on a target
const LEVELS = [
  // 1 — one crate, one target: the push rule, nothing else.
  ['#######',
   '#     #',
   '#  $  #',
   '#  .  #',
   '#  @  #',
   '#######'],
  // 2 — two crates, corners are deadly.
  ['########',
   '#   .  #',
   '# $$   #',
   '#  @ . #',
   '#      #',
   '########'],
  // 3 — a corridor: you must walk around.
  ['#########',
   '#.  #   #',
   '# $ $ @ #',
   '#   #  .#',
   '#########'],
  // 4 — three crates in a room with a pillar.
  ['#########',
   '#  ...  #',
   '# $$$   #',
   '#   # @ #',
   '#       #',
   '#########'],
  // 5 — the classic L.
  ['##########',
   '#    #   #',
   '# $$ # . #',
   '# $  @ . #',
   '#    # . #',
   '##########'],
  // 6 — tight turns.
  ['##########',
   '#  #     #',
   '# $$ ### #',
   '# @  ..  #',
   '####  .  #',
   '#   $    #',
   '##########'],
  // 7 — four crates, one way in.
  ['##########',
   '#....    #',
   '# $$$$ @ #',
   '#        #',
   '#  ####  #',
   '#        #',
   '##########'],
  // 8 — the long haul.
  ['###########',
   '#   #  .. #',
   '# $$$  .. #',
   '#   # $$  #',
   '# @ #     #',
   '#   #######',
   '###########'],
];

// Par moves per level: beating it pays. Measured by solving each level by hand.
const PAR = [6, 12, 14, 18, 24, 30, 34, 44];
const SETS = [[0, 4], [0, 6], [2, 8]];   // facile · normal · difficile: which levels you play

const COL = {
  bg: '#08070A', floor: '#1A1920', wall: '#33313E', wallTop: '#423F50',
  target: '#12C98C', crate: '#C98A3C', crateDone: '#12C98C', you: '#4EA8FF', text: '#9E9AAA',
};

export function createGame(canvas, host, opts = {}) {
  const [from, to] = SETS[opts.difficulty ?? 1];
  const set = LEVELS.slice(from, to);
  const TOP = 32;
  // One canvas size for the whole run, taken from the biggest level: the screen must
  // not resize between two levels.
  const cols = Math.max(...set.map((l) => Math.max(...l.map((r) => r.length))));
  const rows = Math.max(...set.map((l) => l.length));
  const CELL = Math.max(26, Math.min(48, Math.floor(420 / Math.max(cols, rows))));
  canvas.width = cols * CELL;
  canvas.height = rows * CELL + TOP;
  const ctx = canvas.getContext('2d');

  let grid, you, level, moves, pushes, total, history, anim, won;
  let paused = false, running = false, rafId = null, last = 0;

  const key = (r, c) => `${r},${c}`;

  function load(i) {
    const raw = set[i];
    const h = raw.length, w = Math.max(...raw.map((r) => r.length));
    // Centre the level in the fixed canvas.
    const offR = Math.floor((rows - h) / 2), offC = Math.floor((cols - w) / 2);
    grid = { w: cols, h: rows, wall: new Set(), target: new Set(), crate: new Set() };
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const ch = raw[r][c] ?? ' ';
        const R = r + offR, C = c + offC;
        if (ch === '#') grid.wall.add(key(R, C));
        if (ch === '.' || ch === '*' || ch === '+') grid.target.add(key(R, C));
        if (ch === '$' || ch === '*') grid.crate.add(key(R, C));
        if (ch === '@' || ch === '+') you = { r: R, c: C };
      }
    }
    history = [];
    anim = null;
  }

  const solved = () => [...grid.crate].every((k) => grid.target.has(k));

  function report() {
    host.onStats({ score: total, level: level + 1, lives: moves });
  }

  function step(dr, dc) {
    if (!running || paused || won) return;
    const nr = you.r + dr, nc = you.c + dc;
    const n = key(nr, nc);
    if (grid.wall.has(n)) return;

    let pushed = null;
    if (grid.crate.has(n)) {
      const br = nr + dr, bc = nc + dc, b = key(br, bc);
      if (grid.wall.has(b) || grid.crate.has(b)) return;   // something behind it
      grid.crate.delete(n);
      grid.crate.add(b);
      pushed = { from: n, to: b };
      pushes++;
    }
    history.push({ from: { ...you }, pushed });
    if (history.length > 400) history.shift();
    anim = { fr: you.r, fc: you.c, t: 0, crate: pushed };
    you = { r: nr, c: nc };
    moves++;
    if (pushed) host.sfx.hit(); else host.sfx.move();
    report();
    if (solved()) finishLevel();
  }

  function undo() {
    if (!running || paused || won || !history.length) return;
    const h = history.pop();
    if (h.pushed) { grid.crate.delete(h.pushed.to); grid.crate.add(h.pushed.from); pushes--; }
    you = h.from;
    moves++;              // an undo is a move: it should cost something
    anim = null;
    host.sfx.move();
    report();
  }

  function finishLevel() {
    const par = PAR[from + level] ?? 20;
    total += 200 + Math.max(0, par - moves) * 10;
    host.sfx.clear();
    report();
    if (level + 1 >= set.length) {
      won = true; running = false;
      host.sfx.win();
      host.onGameOver(total, true);
      draw();
      return;
    }
    // A beat on the finished level, then the next one.
    const next = level + 1;
    anim = { hold: 650 };
    setTimeout(() => {
      if (!running) return;
      level = next; moves = 0; pushes = 0;
      load(level);
      report();
    }, 650);
  }

  /* --- drawing ----------------------------------------------------------- */

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = '600 13px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COL.text;
    ctx.textAlign = 'left';
    ctx.fillText(`NIVEAU ${level + 1}/${set.length}`, 8, TOP / 2 + 1);
    ctx.textAlign = 'center';
    ctx.fillText(`PAR ${PAR[from + level] ?? '—'}`, canvas.width / 2, TOP / 2 + 1);
    ctx.textAlign = 'right';
    ctx.fillText(`COUPS ${moves}`, canvas.width - 8, TOP / 2 + 1);

    const px = (c) => c * CELL;
    const py = (r) => TOP + r * CELL;

    // floor only where the level is: a tile with a wall, target or crate near it
    for (let r = 0; r < grid.h; r++) {
      for (let c = 0; c < grid.w; c++) {
        const k = key(r, c);
        if (grid.wall.has(k)) continue;
        if (!inside(r, c)) continue;
        ctx.fillStyle = COL.floor;
        ctx.fillRect(px(c), py(r), CELL, CELL);
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px(c) + 0.5, py(r) + 0.5, CELL - 1, CELL - 1);
      }
    }

    for (const k of grid.wall) {
      const [r, c] = k.split(',').map(Number);
      ctx.fillStyle = COL.wall;
      ctx.fillRect(px(c), py(r), CELL, CELL);
      ctx.fillStyle = COL.wallTop;
      ctx.fillRect(px(c), py(r), CELL, Math.max(3, CELL * 0.18));
    }

    for (const k of grid.target) {
      const [r, c] = k.split(',').map(Number);
      const x = px(c) + CELL / 2, y = py(r) + CELL / 2, s = CELL * 0.17;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = grid.crate.has(k) ? 'rgba(18,201,140,0.25)' : COL.target;
      ctx.shadowColor = COL.target;
      ctx.shadowBlur = grid.crate.has(k) ? 0 : 10;
      ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.restore();
    }

    for (const k of grid.crate) {
      const [r, c] = k.split(',').map(Number);
      let x = px(c), y = py(r);
      if (anim?.crate && anim.crate.to === k) {
        const [fr, fc] = anim.crate.from.split(',').map(Number);
        const t = Math.min(1, anim.t / 90);
        x = px(fc + (c - fc) * t); y = py(fr + (r - fr) * t);
      }
      const done = grid.target.has(k);
      const pad = CELL * 0.11;
      ctx.fillStyle = done ? COL.crateDone : COL.crate;
      if (done) { ctx.save(); ctx.shadowColor = COL.crateDone; ctx.shadowBlur = 14; }
      roundRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, CELL * 0.14);
      ctx.fill();
      if (done) ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = Math.max(1.5, CELL * 0.05);
      ctx.beginPath();
      ctx.moveTo(x + pad * 1.6, y + pad * 1.6); ctx.lineTo(x + CELL - pad * 1.6, y + CELL - pad * 1.6);
      ctx.moveTo(x + CELL - pad * 1.6, y + pad * 1.6); ctx.lineTo(x + pad * 1.6, y + CELL - pad * 1.6);
      ctx.stroke();
    }

    // you
    let yx = px(you.c), yy = py(you.r);
    if (anim && anim.t !== undefined) {
      const t = Math.min(1, anim.t / 90);
      yx = px(anim.fc + (you.c - anim.fc) * t);
      yy = py(anim.fr + (you.r - anim.fr) * t);
    }
    ctx.fillStyle = COL.you;
    ctx.save();
    ctx.shadowColor = COL.you;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(yx + CELL / 2, yy + CELL * 0.42, CELL * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillRect(yx + CELL * 0.33, yy + CELL * 0.6, CELL * 0.34, CELL * 0.26);

    if (won) {
      ctx.fillStyle = 'rgba(8,7,10,0.72)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = COL.target;
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ENTREPÔT RANGÉ', canvas.width / 2, canvas.height / 2);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  /** Is this tile part of the level (not the padding around a small one)? */
  function inside(r, c) {
    for (let d = 0; d <= 1; d++) {
      for (const [dr, dc] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        if (grid.wall.has(key(r + dr * (d + 1), c + dc * (d + 1)))) return true;
      }
    }
    return false;
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(64, last ? t - last : 16);
    last = t;
    if (!paused) {
      if (anim?.t !== undefined) { anim.t += dt; if (anim.t > 110) anim = null; }
      draw();
    }
    rafId = requestAnimationFrame(loop);
  }

  // A tap walks one step toward the tile you touched: no d-pad needed on a phone.
  const onDown = (e) => {
    e.preventDefault();
    const b = canvas.getBoundingClientRect();
    const c = Math.floor((e.clientX - b.left) * (canvas.width / b.width) / CELL);
    const r = Math.floor(((e.clientY - b.top) * (canvas.height / b.height) - TOP) / CELL);
    const dr = r - you.r, dc = c - you.c;
    if (!dr && !dc) return;
    if (Math.abs(dc) >= Math.abs(dr)) step(0, Math.sign(dc));
    else step(Math.sign(dr), 0);
  };

  return {
    start() {
      level = 0; moves = 0; pushes = 0; total = 0; won = false;
      paused = false; running = true; last = 0;
      load(0);
      canvas.addEventListener('pointerdown', onDown);
      report();
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down) return;
      if (a === 'up') step(-1, 0);
      else if (a === 'down') step(1, 0);
      else if (a === 'left') step(0, -1);
      else if (a === 'right') step(0, 1);
      else if (a === 'hold' || a === 'action') undo();
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
    },
  };
}
