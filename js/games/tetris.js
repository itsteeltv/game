// Tetris with the pieces of modern guideline play: 7-bag randomiser, hold,
// lock delay, DAS/ARR, ghost piece and drop scoring.
const COLS = 10, ROWS = 20, CELL = 22, SIDE = 116;

const SHAPES = {
  I: { ink: '#12C98C', m: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]] },
  O: { ink: '#FFB020', m: [[1,1],[1,1]] },
  T: { ink: '#9D6BFF', m: [[0,1,0],[1,1,1],[0,0,0]] },
  S: { ink: '#F5F2EA', m: [[0,1,1],[1,1,0],[0,0,0]] },
  Z: { ink: '#FF4D1F', m: [[1,1,0],[0,1,1],[0,0,0]] },
  J: { ink: '#4EA8FF', m: [[1,0,0],[1,1,1],[0,0,0]] },
  L: { ink: '#FF8A3D', m: [[0,0,1],[1,1,1],[0,0,0]] },
};
const NAMES = Object.keys(SHAPES);

// ms per cell of gravity, roughly the classic curve.
const GRAVITY = [800, 720, 630, 550, 470, 380, 300, 220, 160, 110, 80, 70, 60, 50, 40];
const LOCK_DELAY = 480, LOCK_RESET_MAX = 14;
const DAS = 150, ARR = 42;

const rotate = (m) => m[0].map((_, i) => m.map((row) => row[i]).reverse());

export function createGame(canvas, host, opts = {}) {
  // Difficulty sets the starting level, how fast gravity scales, and how long
  // a piece may rest before it locks.
  const D = [
    { start: 1, lock: 700, mult: 1.35 },
    { start: 1, lock: 480, mult: 1 },
    { start: 6, lock: 320, mult: 0.7 },
  ][opts.difficulty ?? 1];

  canvas.width = COLS * CELL + SIDE;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext('2d');

  let board, cur, queue, hold, holdUsed;
  let score, level, lines, combo;
  let dropAcc, lockAcc, lockResets, dasDir, dasTime, softHeld;
  let paused = false, running = false, rafId = null, last = 0, over = false;

  // 7-bag: each piece appears once per bag, so you're never starved of an I.
  let bag = [];
  function nextName() {
    if (!bag.length) {
      bag = NAMES.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop();
  }

  function spawn(name = nextName()) {
    const s = SHAPES[name];
    return { name, m: s.m.map((r) => r.slice()), ink: s.ink, x: ((COLS - s.m.length) / 2) | 0, y: -1 };
  }

  function collides(m, px, py) {
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m.length; c++) {
        if (!m[r][c]) continue;
        const x = px + c, y = py + r;
        if (x < 0 || x >= COLS || y >= ROWS) return true;
        if (y >= 0 && board[y][x]) return true;
      }
    }
    return false;
  }

  const grounded = () => collides(cur.m, cur.x, cur.y + 1);

  function ghostY() {
    let y = cur.y;
    while (!collides(cur.m, cur.x, y + 1)) y++;
    return y;
  }

  function move(dx, dy) {
    if (collides(cur.m, cur.x + dx, cur.y + dy)) return false;
    cur.x += dx; cur.y += dy;
    if (dx && grounded() && lockResets < LOCK_RESET_MAX) { lockAcc = 0; lockResets++; }
    return true;
  }

  function spin() {
    const m = rotate(cur.m);
    for (const k of [0, -1, 1, -2, 2]) {
      if (!collides(m, cur.x + k, cur.y)) {
        cur.m = m; cur.x += k;
        if (grounded() && lockResets < LOCK_RESET_MAX) { lockAcc = 0; lockResets++; }
        host.sfx.move();
        return;
      }
    }
  }

  function swapHold() {
    if (holdUsed) return;   // one hold per piece, otherwise you could stall forever
    holdUsed = true;
    const incoming = hold;
    hold = cur.name;
    cur = spawn(incoming || queue.shift());
    while (queue.length < 3) queue.push(nextName());
    lockAcc = 0; lockResets = 0;
    host.sfx.move();
    if (collides(cur.m, cur.x, cur.y)) finish();
  }

  function lock() {
    let top = ROWS;
    cur.m.forEach((row, r) => row.forEach((v, c) => {
      if (!v) return;
      const y = cur.y + r, x = cur.x + c;
      if (y >= 0) { board[y][x] = cur.ink; top = Math.min(top, y); }
    }));
    if (top === ROWS) return finish();   // locked entirely above the ceiling: top-out

    clearLines();
    if (!running) return;

    cur = spawn(queue.shift());
    while (queue.length < 3) queue.push(nextName());
    holdUsed = false;
    lockAcc = 0; lockResets = 0;
    if (collides(cur.m, cur.x, cur.y)) finish();
  }

  function clearLines() {
    let n = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (board[y].every(Boolean)) {
        board.splice(y, 1);
        board.unshift(new Array(COLS).fill(null));
        n++; y++;
      }
    }
    if (!n) { combo = -1; return; }

    combo++;
    lines += n;
    score += [0, 100, 300, 500, 800][n] * level + Math.max(0, combo) * 50 * level;
    const next = D.start + Math.floor(lines / 10);
    if (next !== level) { level = next; host.sfx.win(); } else host.sfx.clear();
    host.onStats({ score, level });
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function hardDrop() {
    const d = ghostY() - cur.y;
    if (d > 0) { cur.y += d; score += d * 2; host.onStats({ score }); }
    host.sfx.hit();
    lock();
  }

  function update(dt) {
    // DAS/ARR: a held direction repeats fast after a short charge, instead of
    // waiting on the OS key-repeat delay.
    if (dasDir) {
      dasTime += dt;
      if (dasTime >= DAS) {
        let steps = Math.floor((dasTime - DAS) / ARR) + 1;
        dasTime = DAS + ((dasTime - DAS) % ARR);
        while (steps-- > 0 && move(dasDir, 0));
      }
    }

    const speed = GRAVITY[Math.min(level - 1, GRAVITY.length - 1)] * D.mult;
    dropAcc += dt;
    if (dropAcc >= (softHeld ? Math.min(45, speed) : speed)) {
      dropAcc = 0;
      if (move(0, 1) && softHeld) { score += 1; host.onStats({ score }); }
    }

    if (grounded()) {
      lockAcc += dt;
      if (lockAcc >= D.lock) lock();
    } else {
      lockAcc = 0;
    }
  }

  function block(x, y, ink, size = CELL) {
    ctx.fillStyle = ink;
    ctx.fillRect(x, y, size - 1, size - 1);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';   // lit top edge, like moulded plastic
    ctx.fillRect(x, y, size - 1, 2);
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(245,242,234,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, ROWS * CELL); ctx.stroke();
    }

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) if (board[y][x]) block(x * CELL, y * CELL, board[y][x]);
    }

    const gy = ghostY();
    ctx.strokeStyle = 'rgba(245,242,234,0.34)';
    cur.m.forEach((row, r) => row.forEach((v, c) => {
      if (v && gy + r >= 0) ctx.strokeRect((cur.x + c) * CELL + 1.5, (gy + r) * CELL + 1.5, CELL - 3, CELL - 3);
    }));

    cur.m.forEach((row, r) => row.forEach((v, c) => {
      if (v && cur.y + r >= 0) block((cur.x + c) * CELL, (cur.y + r) * CELL, cur.ink);
    }));

    const sx = COLS * CELL + 14;
    ctx.font = '600 10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';

    ctx.fillStyle = '#8E8A98';
    ctx.fillText('SUIVANT', sx, 14);
    queue.slice(0, 3).forEach((n, i) => {
      const s = SHAPES[n];
      s.m.forEach((row, r) => row.forEach((v, c) => {
        if (v) block(sx + c * 13, 30 + i * 52 + r * 13, s.ink, 13);
      }));
    });

    ctx.fillStyle = '#8E8A98';
    ctx.fillText('GARDE', sx, 196);
    if (hold) {
      const s = SHAPES[hold];
      ctx.globalAlpha = holdUsed ? 0.3 : 1;
      s.m.forEach((row, r) => row.forEach((v, c) => {
        if (v) block(sx + c * 13, 212 + r * 13, s.ink, 13);
      }));
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = '#8E8A98';
    ctx.fillText('LIGNES', sx, 286);
    ctx.font = '500 18px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#F5F2EA';
    ctx.fillText(String(lines), sx, 300);
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(48, last ? t - last : 16);
    last = t;
    if (!paused) { update(dt); if (running) draw(); }
    rafId = requestAnimationFrame(loop);
  }

  return {
    start() {
      board = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
      bag = []; queue = [];
      score = 0; level = D.start; lines = 0; combo = -1;
      hold = null; holdUsed = false;
      dropAcc = 0; lockAcc = 0; lockResets = 0; dasDir = 0; dasTime = 0; softHeld = false;
      paused = false; running = true; over = false; last = 0;
      cur = spawn();
      while (queue.length < 3) queue.push(nextName());
      host.onStats({ score, level });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!running) return;
      if (!down) {
        if (a === 'down') softHeld = false;
        if ((a === 'left' && dasDir === -1) || (a === 'right' && dasDir === 1)) { dasDir = 0; dasTime = 0; }
        return;
      }
      if (a === 'left') { move(-1, 0); dasDir = -1; dasTime = 0; host.sfx.move(); }
      if (a === 'right') { move(1, 0); dasDir = 1; dasTime = 0; host.sfx.move(); }
      if (a === 'down') softHeld = true;
      if (a === 'up') spin();
      if (a === 'action') hardDrop();
      if (a === 'hold') swapHold();
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
