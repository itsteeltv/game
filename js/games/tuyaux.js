// Tuyaux — dans l'esprit de Pipe Mania (1989). Pose les pièces qui arrivent avant que
// l'eau ne parte : une fois lâchée, elle ne s'arrête plus, et une fuite coûte une vie.
const COLS = 10, ROWS = 7, CELL = 42;
const PANEL = 58;                       // la colonne de gauche où défile la file
const W = PANEL + COLS * CELL, H = ROWS * CELL + 26;
const STEP = 1000 / 60;

const SIDES = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
const OPP = { N: 'S', S: 'N', W: 'E', E: 'W' };
// Une pièce est l'ensemble de ses ouvertures. La croix laisse passer tout droit, deux fois.
const PIECES = { h: 'WE', v: 'NS', ne: 'NE', nw: 'NW', se: 'SE', sw: 'SW', x: 'NSWE' };
const BAG = ['h', 'h', 'v', 'v', 'ne', 'nw', 'se', 'sw', 'x'];

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Facile : beaucoup de temps avant le départ, et il en faut peu. Difficile : ça part vite.
  const D = [
    { lives: 4, delay: 60 * 14, speed: 0.016, need: 7 },
    { lives: 3, delay: 60 * 10, speed: 0.022, need: 9 },
    { lives: 3, delay: 60 * 7, speed: 0.030, need: 11 },
  ][opts.difficulty ?? 1];

  let grid, queue, cur, flow, src, countdown, filled, score, level, lives, leak;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;

  const cellX = (c) => PANEL + c * CELL;
  const cellY = (r) => 20 + r * CELL;
  const at = (c, r) => (c >= 0 && c < COLS && r >= 0 && r < ROWS ? grid[r][c] : undefined);
  const pick = () => BAG[(Math.random() * BAG.length) | 0];

  function buildLevel() {
    grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
    queue = Array.from({ length: 5 }, pick);
    cur = { c: 0, r: ROWS >> 1 };
    // La source : une case fixe du bord gauche, l'eau en sort vers l'est.
    src = { c: 0, r: 1 + ((Math.random() * (ROWS - 2)) | 0) };
    grid[src.r][src.c] = { kind: 'src', fill: 0 };
    flow = null;
    countdown = D.delay;
    filled = 0;
    leak = 0;
  }

  function finish(won) {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, won);
  }

  function place(c, r) {
    if (!running || paused || leak) return;
    const cellNow = at(c, r);
    if (cellNow === undefined) return;
    // On peut recouvrir un tuyau tant que l'eau n'y est pas passée — jamais la source.
    if (cellNow && (cellNow.kind === 'src' || cellNow.fill > 0)) { host.sfx.hit(); return; }
    grid[r][c] = { kind: queue.shift(), fill: 0, used: 0 };
    queue.push(pick());
    host.sfx.move();
  }

  /** Par où l'eau ressort d'une pièce où elle est entrée par le côté `from`. */
  function exitOf(kind, from) {
    const open = PIECES[kind];
    if (!open || !open.includes(from)) return null;
    if (kind === 'x') return OPP[from];              // la croix passe tout droit
    return open.replace(from, '');
  }

  function startFlow() {
    const east = at(src.c + 1, src.r);
    if (!east || !PIECES[east.kind]?.includes('W')) return leakNow();
    flow = { c: src.c + 1, r: src.r, from: 'W', t: 0 };
    east.fill = 0;
    east.lastFrom = 'W';     // de quel côté l'eau est entrée, pour le dessin après coup
    host.sfx.pickup();
  }

  function leakNow() {
    leak = 80;
    host.sfx.gameover();
    navigator.vibrate?.(80);
  }

  function endRound() {
    // Assez de tuyaux remplis : tableau suivant. Sinon, une vie en moins et on recommence.
    if (filled >= D.need + (level - 1)) {
      score += 500 + filled * 50;
      level++;
      host.sfx.win();
      host.onStats({ score, level });
      if (level > 6) return finish(true);
      buildLevel();
    } else {
      lives--;
      host.onStats({ lives });
      if (lives <= 0) return finish(false);
      buildLevel();
    }
  }

  function update() {
    if (leak) { if (--leak <= 0) endRound(); return; }

    if (countdown > 0) {
      countdown--;
      if (countdown === 0) startFlow();
      return;
    }
    if (!flow) return;

    const cell = at(flow.c, flow.r);
    if (!cell) return leakNow();
    flow.t += D.speed + level * 0.002;
    cell.fill = flow.t;
    if (flow.t < 1) return;

    // La pièce est pleine : elle compte, et l'eau cherche la suivante.
    cell.fill = 1;
    cell.used = (cell.used || 0) + 1;
    filled++;
    score += 100 + (cell.kind === 'x' ? 50 : 0);
    host.onStats({ score });
    host.sfx.score();

    const out = exitOf(cell.kind, flow.from);
    if (!out) return leakNow();
    const [dc, dr] = SIDES[out];
    const next = at(flow.c + dc, flow.r + dr);
    const from = OPP[out];
    if (!next || !PIECES[next.kind]?.includes(from)) return leakNow();
    // Une croix peut resservir une fois, dans l'autre axe ; le reste, non.
    if (next.fill >= 1 && !(next.kind === 'x' && next.used < 2)) return leakNow();
    flow = { c: flow.c + dc, r: flow.r + dr, from, t: 0 };
    next.fill = 0;
    next.lastFrom = from;
  }

  /* --- Dessin -------------------------------------------------------------- */

  function pipePath(x, y, kind, side) {
    const m = CELL / 2;
    const edge = { N: [m, 0], S: [m, CELL], W: [0, m], E: [CELL, m] }[side];
    ctx.moveTo(x + edge[0], y + edge[1]);
    ctx.lineTo(x + m, y + m);
  }

  function drawPipe(c, r, cell) {
    const x = cellX(c), y = cellY(r);
    const open = PIECES[cell.kind] || '';
    ctx.lineCap = 'round';

    ctx.strokeStyle = '#4A5370';
    ctx.lineWidth = 15;
    ctx.beginPath();
    for (const s of open) pipePath(x, y, cell.kind, s);
    ctx.stroke();

    ctx.strokeStyle = '#1A1E2C';
    ctx.lineWidth = 9;
    ctx.beginPath();
    for (const s of open) pipePath(x, y, cell.kind, s);
    ctx.stroke();

    if (!cell.fill) return;
    // L'eau remplit la moitié d'entrée puis la moitié de sortie.
    const from = (flow && flow.c === c && flow.r === r ? flow.from : cell.lastFrom) || open[0];
    const out = exitOf(cell.kind, from) || open[1] || open[0];
    ctx.strokeStyle = '#52B4FF';
    ctx.lineWidth = 9;
    ctx.beginPath();
    const m = CELL / 2;
    const pt = (s) => ({ N: [x + m, y], S: [x + m, y + CELL], W: [x, y + m], E: [x + CELL, y + m] }[s]);
    const [ix, iy] = pt(from), [ox, oy] = pt(out);
    const k = Math.min(1, cell.fill);
    if (k <= 0.5) {
      const a = k / 0.5;
      ctx.moveTo(ix, iy);
      ctx.lineTo(ix + (x + m - ix) * a, iy + (y + m - iy) * a);
    } else {
      const a = (k - 0.5) / 0.5;
      ctx.moveTo(ix, iy);
      ctx.lineTo(x + m, y + m);
      ctx.lineTo(x + m + (ox - x - m) * a, y + m + (oy - y - m) * a);
    }
    ctx.stroke();
  }

  function drawQueuePiece(x, y, kind, size = 34) {
    const open = PIECES[kind] || '';
    const m = size / 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#4A5370';
    ctx.lineWidth = 11;
    ctx.beginPath();
    for (const s of open) {
      const e = { N: [m, 0], S: [m, size], W: [0, m], E: [size, m] }[s];
      ctx.moveTo(x + e[0], y + e[1]);
      ctx.lineTo(x + m, y + m);
    }
    ctx.stroke();
    ctx.strokeStyle = '#1A1E2C';
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (const s of open) {
      const e = { N: [m, 0], S: [m, size], W: [0, m], E: [size, m] }[s];
      ctx.moveTo(x + e[0], y + e[1]);
      ctx.lineTo(x + m, y + m);
    }
    ctx.stroke();
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);

    // Le damier.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (c + r) % 2 ? '#101320' : '#131726';
        ctx.fillRect(cellX(c), cellY(r), CELL, CELL);
      }
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = grid[r][c];
        if (!cell) continue;
        if (cell.kind === 'src') {
          ctx.fillStyle = '#19D197';
          ctx.fillRect(cellX(c) + 7, cellY(r) + 7, CELL - 14, CELL - 14);
          ctx.fillStyle = '#08070A';
          ctx.font = '700 13px ui-monospace, Consolas, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('→', cellX(c) + CELL / 2, cellY(r) + CELL / 2 + 5);
          ctx.textAlign = 'start';
        } else drawPipe(c, r, cell);
      }
    }

    // Le curseur clavier.
    ctx.strokeStyle = leak ? '#FF5A52' : '#FFB325';
    ctx.lineWidth = 2;
    ctx.strokeRect(cellX(cur.c) + 1.5, cellY(cur.r) + 1.5, CELL - 3, CELL - 3);

    // La file : la pièce du haut est celle qu'on pose.
    ctx.fillStyle = '#101320';
    ctx.fillRect(0, 20, PANEL, ROWS * CELL);
    queue.forEach((k, i) => {
      if (i === 0) {
        ctx.fillStyle = 'rgba(255,179,37,0.16)';
        ctx.fillRect(6, 24, 46, 46);
      }
      drawQueuePiece(12, 30 + i * 46, k, i === 0 ? 34 : 28);
    });

    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = countdown > 0 && countdown < 180 ? '#FF5A52' : 'rgba(245,242,234,0.6)';
    ctx.fillText(countdown > 0 ? `DÉPART DANS ${Math.ceil(countdown / 60)}s` : 'ÇA COULE', PANEL + 4, 14);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(245,242,234,0.6)';
    ctx.fillText(`${filled} / ${D.need + (level - 1)} TUYAUX`, W - 6, 14);
    ctx.textAlign = 'start';

    if (leak) {
      ctx.fillStyle = 'rgba(255,90,82,0.18)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = '700 20px ui-monospace, Consolas, monospace';
      ctx.fillStyle = '#FF5A52';
      ctx.textAlign = 'center';
      ctx.fillText('FUITE', W / 2, H / 2);
      ctx.textAlign = 'start';
    }
  }

  function loop(t) {
    if (!running) return;
    acc = paused ? 0 : acc + Math.min(100, last ? t - last : STEP);
    last = t;
    for (; acc >= STEP && running; acc -= STEP) update();
    if (running && !paused) draw();
    rafId = requestAnimationFrame(loop);
  }

  // On pose au doigt ou à la souris, là où on touche — et le curseur suit.
  const onPointer = (e) => {
    e.preventDefault();
    const box = canvas.getBoundingClientRect();
    const x = (e.clientX - box.left) * (W / box.width);
    const y = (e.clientY - box.top) * (H / box.height);
    const c = Math.floor((x - PANEL) / CELL), r = Math.floor((y - 20) / CELL);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    cur = { c, r };
    place(c, r);
  };

  return {
    start() {
      score = 0; level = 1; lives = D.lives;
      paused = false; running = true; over = false; last = 0; acc = 0;
      buildLevel();
      canvas.addEventListener('pointerdown', onPointer);
      host.onStats({ score, level, lives });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down) return;
      if (a === 'left') cur.c = Math.max(0, cur.c - 1);
      if (a === 'right') cur.c = Math.min(COLS - 1, cur.c + 1);
      if (a === 'up') cur.r = Math.max(0, cur.r - 1);
      if (a === 'down') cur.r = Math.min(ROWS - 1, cur.r + 1);
      if (a === 'action') place(cur.c, cur.r);
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onPointer);
    },
  };
}
