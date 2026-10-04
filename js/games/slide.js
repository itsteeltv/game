// Taquin. Slide the tiles into order, the gap being the only room to move.
// The board is shuffled by legal slides from the solved position, so every deal can be solved.
// Tiles take a hue from their number along the rainbow: colour helps as much as the digits do.
export function createGame(canvas, host, opts = {}) {
  const lvl = opts.difficulty ?? 1;
  const N = [3, 4, 5][lvl];
  const SHUFFLE = [60, 200, 420][lvl];
  const PAR = [30, 120, 300][lvl], TPAR = [90, 300, 600][lvl];
  const GAP = 6, TOP = 34;
  const CELL = Math.floor((340 - GAP * (N + 1)) / N);
  const SIZE = CELL * N + GAP * (N + 1);
  canvas.width = SIZE; canvas.height = SIZE + TOP;
  const ctx = canvas.getContext('2d');

  let board, pos, moves, elapsed;       // board[i] = tile number at cell i (0 = the gap); pos[v] = animated {x, y}
  let paused = false, running = false, over = false, rafId = null, last = 0;

  const at = (r, c) => r * N + c;
  const gapAt = () => board.indexOf(0);

  /** Slide every tile between cell i and the gap one step toward the gap. Returns false if i isn't in line with it. */
  function slideTo(i) {
    const g = gapAt(), gr = Math.floor(g / N), gc = g % N, r = Math.floor(i / N), c = i % N;
    if (i === g || (r !== gr && c !== gc)) return false;
    const dr = Math.sign(gr - r), dc = Math.sign(gc - c);
    let cr = gr, cc = gc;
    while (cr !== r || cc !== c) {
      const fr = cr - dr, fc = cc - dc;
      board[at(cr, cc)] = board[at(fr, fc)];
      cr = fr; cc = fc;
    }
    board[i] = 0;
    return true;
  }

  const solved = () => board.every((v, i) => v === (i === N * N - 1 ? 0 : i + 1));

  function deal() {
    board = Array.from({ length: N * N }, (_, i) => (i === N * N - 1 ? 0 : i + 1));
    let prev = -1;
    for (let k = 0; k < SHUFFLE || solved(); k++) {
      const g = gapAt(), r = Math.floor(g / N), c = g % N;
      const opts2 = [];
      if (r > 0) opts2.push(at(r - 1, c));
      if (r < N - 1) opts2.push(at(r + 1, c));
      if (c > 0) opts2.push(at(r, c - 1));
      if (c < N - 1) opts2.push(at(r, c + 1));
      const pool = opts2.filter((i) => i !== prev);       // never undo the slide just made
      const i = pool[(Math.random() * pool.length) | 0];
      prev = g;
      slideTo(i);
    }
    pos = {};
    board.forEach((v, i) => { if (v) pos[v] = { x: i % N, y: Math.floor(i / N) }; });
  }

  function move(i) {
    if (!running || paused || over || !slideTo(i)) return;
    moves++;
    host.sfx.move();
    host.onStats({ score: 0, level: N, lives: moves });
    if (solved()) finish();
  }

  /** Arrow = the way the tile moves: Left takes the tile on the gap's right into the gap. */
  function nudge(dir) {
    const g = gapAt(), r = Math.floor(g / N), c = g % N;
    const from = { left: [r, c + 1], right: [r, c - 1], up: [r + 1, c], down: [r - 1, c] }[dir];
    if (from && from[0] >= 0 && from[0] < N && from[1] >= 0 && from[1] < N) move(at(from[0], from[1]));
  }

  function finish() {
    over = true; running = false;
    for (const v in pos) { const i = board.indexOf(Number(v)); pos[v].x = i % N; pos[v].y = Math.floor(i / N); }
    draw();
    const secs = Math.floor(elapsed / 1000);
    const score = 500 * (N - 2) + 200 + Math.max(0, PAR - moves) * 8 + Math.max(0, TPAR - secs) * 5;
    host.sfx.win();
    host.onStats({ score, level: N, lives: moves });
    host.onGameOver(score, true);
  }

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
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#8E8A98';
    ctx.font = '600 13px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(`COUPS ${moves}`, 10, TOP / 2 + 2);
    const secs = Math.floor(elapsed / 1000);
    ctx.textAlign = 'right';
    ctx.fillText(`TEMPS ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, canvas.width - 10, TOP / 2 + 2);

    // The empty well the gap leaves behind.
    for (let i = 0; i < N * N; i++) {
      ctx.fillStyle = '#121116';
      roundRect(GAP + (i % N) * (CELL + GAP), TOP + GAP + Math.floor(i / N) * (CELL + GAP), CELL, CELL, 9);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    for (let v = 1; v < N * N; v++) {
      const p = pos[v];
      const x = GAP + p.x * (CELL + GAP), y = TOP + GAP + p.y * (CELL + GAP);
      const hue = Math.round(((v - 1) / (N * N - 1)) * 300);
      const home = board.indexOf(v) === v - 1;   // already where it belongs: a little brighter
      ctx.fillStyle = `hsl(${hue} 72% ${home ? 62 : 54}%)`;
      roundRect(x, y, CELL, CELL, 9);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      roundRect(x, y, CELL, CELL * 0.45, 9);
      ctx.fill();
      ctx.fillStyle = '#0A0A0C';
      ctx.font = `700 ${Math.round(CELL * 0.42)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(String(v), x + CELL / 2, y + CELL / 2 + 2);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(64, last ? t - last : 16);
    last = t;
    if (!paused) {
      elapsed += dt;
      const k = Math.min(1, dt / 80);
      for (let i = 0; i < N * N; i++) {
        const v = board[i];
        if (!v) continue;
        const p = pos[v], tx = i % N, ty = Math.floor(i / N);
        p.x += (tx - p.x) * k; p.y += (ty - p.y) * k;
        if (Math.abs(tx - p.x) < 0.01) p.x = tx;
        if (Math.abs(ty - p.y) < 0.01) p.y = ty;
      }
      draw();
    }
    rafId = requestAnimationFrame(loop);
  }

  const onDown = (e) => {
    e.preventDefault();
    const b = canvas.getBoundingClientRect();
    const x = (e.clientX - b.left) * (canvas.width / b.width);
    const y = (e.clientY - b.top) * (canvas.height / b.height) - TOP;
    const c = Math.floor((x - GAP / 2) / (CELL + GAP)), r = Math.floor((y - GAP / 2) / (CELL + GAP));
    if (c >= 0 && c < N && r >= 0 && r < N) move(at(r, c));
  };

  return {
    start() {
      deal();
      moves = 0; elapsed = 0;
      paused = false; running = true; over = false; last = 0;
      canvas.addEventListener('pointerdown', onDown);
      host.onStats({ score: 0, level: N, lives: 0 });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (down && ['left', 'right', 'up', 'down'].includes(a)) nudge(a);
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
    },
  };
}
