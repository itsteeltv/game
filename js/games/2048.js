// 2048. Sliding-tile merge puzzle with animated tile motion.

const TILE = {
  2: '#2B2733', 4: '#37313F', 8: '#FF8A3D', 16: '#FF4D1F', 32: '#FF5C8A',
  64: '#9D6BFF', 128: '#4EA8FF', 256: '#12C98C', 512: '#8BE04E',
  1024: '#FFB020', 2048: '#FFD34E',
};
const inkFor = (v) => TILE[v] || '#FFD34E';
const textFor = (v) => (v <= 4 ? '#F5F2EA' : '#08070A');

export function createGame(canvas, host, opts = {}) {
  // A 5x5 board gives far more room to recover; hard seeds 4s more often.
  const D = [
    { n: 5, four: 0.10 },
    { n: 4, four: 0.10 },
    { n: 4, four: 0.35 },
  ][opts.difficulty ?? 1];

  const N = D.n, GAP = 10;
  const CELL = Math.round((360 - (N + 1) * GAP) / N);
  const SIZE = N * CELL + (N + 1) * GAP;

  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  let grid, tiles, score, best2048, anim;
  let paused = false, running = false, rafId = null, last = 0, over = false;

  const empties = () => {
    const out = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) out.push({ r, c });
    return out;
  };

  function addTile() {
    const free = empties();
    if (!free.length) return;
    const { r, c } = free[(Math.random() * free.length) | 0];
    grid[r][c] = Math.random() < D.four ? 4 : 2;
    tiles.push({ r, c, v: grid[r][c], fr: r, fc: c, t: 0, pop: 1 });
  }

  /** Slide+merge one line; returns the compacted line and the points scored. */
  function collapse(line) {
    const vals = line.filter(Boolean);
    const out = [];
    let gained = 0;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] === vals[i + 1]) {
        out.push(vals[i] * 2);
        gained += vals[i] * 2;
        i++;                       // a tile merges at most once per move
      } else out.push(vals[i]);
    }
    while (out.length < N) out.push(0);
    return { out, gained };
  }

  function canMove() {
    if (empties().length) return true;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (c + 1 < N && grid[r][c] === grid[r][c + 1]) return true;
        if (r + 1 < N && grid[r][c] === grid[r + 1][c]) return true;
      }
    }
    return false;
  }

  function move(dir) {
    if (!running || anim > 0) return;
    const before = grid.map((row) => row.slice());
    let gained = 0;

    const read = (i, j) => {
      if (dir === 'left') return grid[i][j];
      if (dir === 'right') return grid[i][N - 1 - j];
      if (dir === 'up') return grid[j][i];
      return grid[N - 1 - j][i];
    };
    const write = (i, j, v) => {
      if (dir === 'left') grid[i][j] = v;
      else if (dir === 'right') grid[i][N - 1 - j] = v;
      else if (dir === 'up') grid[j][i] = v;
      else grid[N - 1 - j][i] = v;
    };

    for (let i = 0; i < N; i++) {
      const line = [];
      for (let j = 0; j < N; j++) line.push(read(i, j));
      const res = collapse(line);
      gained += res.gained;
      for (let j = 0; j < N; j++) write(i, j, res.out[j]);
    }

    const moved = grid.some((row, r) => row.some((v, c) => v !== before[r][c]));
    if (!moved) return;

    score += gained;
    if (gained) host.sfx.move();

    // Rebuild sprites from the new grid; they fade/pop in rather than teleporting.
    tiles = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) if (grid[r][c]) tiles.push({ r, c, v: grid[r][c], t: 1, pop: 0 });
    }
    addTile();
    anim = 90;

    const top = Math.max(...grid.flat());
    host.onStats({ score, level: Math.max(1, Math.log2(top) - 1) });

    if (top >= 2048 && !best2048) {
      best2048 = true;
      host.sfx.win();
    }
    if (!canMove()) finish();
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.sfx.gameover();
    host.onGameOver(score, best2048);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, SIZE, SIZE);

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        ctx.fillStyle = '#17151C';
        roundRect(GAP + c * (CELL + GAP), GAP + r * (CELL + GAP), CELL, CELL, 5);
      }
    }

    tiles.forEach((t) => {
      const grow = t.pop < 1 ? 0.7 + 0.3 * t.pop : 1;
      const s = CELL * grow;
      const x = GAP + t.c * (CELL + GAP) + (CELL - s) / 2;
      const y = GAP + t.r * (CELL + GAP) + (CELL - s) / 2;
      ctx.fillStyle = inkFor(t.v);
      roundRect(x, y, s, s, 5);

      ctx.fillStyle = textFor(t.v);
      const digits = String(t.v).length;
      const fs = Math.round(CELL * (digits > 3 ? 0.29 : digits > 2 ? 0.37 : 0.44));
      ctx.font = `600 ${fs}px ui-monospace, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(t.v), x + s / 2, y + s / 2 + 1);
    });
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(48, last ? t - last : 16);
    last = t;
    if (!paused) {
      if (anim > 0) anim -= dt;
      tiles.forEach((tl) => { tl.pop = Math.min(1, tl.pop + dt / 110); });
      draw();
    }
    rafId = requestAnimationFrame(loop);
  }

  return {
    start() {
      grid = Array.from({ length: N }, () => new Array(N).fill(0));
      tiles = []; score = 0; anim = 0; best2048 = false;
      paused = false; running = true; over = false; last = 0;
      addTile(); addTile();
      host.onStats({ score, level: 1 });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down) return;
      if (['up', 'down', 'left', 'right'].includes(a)) move(a);
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
