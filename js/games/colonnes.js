// Colonnes — dans l'esprit de Columns (1990). Une colonne de trois gemmes tombe ;
// tu peux permuter ses couleurs. Trois gemmes identiques alignées — y compris en
// diagonale — disparaissent, et ce qui est au-dessus retombe : les chaînes paient.
const COLS = 6, ROWS = 13, CELL = 34;
const W = COLS * CELL + 92, H = ROWS * CELL + 24;   // +92 : la colonne d'infos à droite
const STEP = 1000 / 60;

const INKS = ['#FF4D1F', '#FFB325', '#19D197', '#52B4FF', '#C77DFF', '#E8E3D8'];

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Facile : quatre couleurs et une chute lente. Difficile : les six couleurs, et ça tombe.
  const D = [
    { colors: 4, fall: 46, gain: 3 },
    { colors: 5, fall: 34, gain: 2.4 },
    { colors: 6, fall: 24, gain: 2 },
  ][opts.difficulty ?? 1];

  let grid, piece, next, score, level, cleared, dropT, popping, popT, chain, repeat;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;
  const key = { left: false, right: false, down: false };

  const rnd = () => (Math.random() * D.colors) | 0;
  const fallFrames = () => Math.max(5, D.fall - (level - 1) * 3);

  function spawn() {
    piece = { c: COLS >> 1, r: 0, cells: next || [rnd(), rnd(), rnd()] };
    next = [rnd(), rnd(), rnd()];
    dropT = 0;
    chain = 0;
    // La colonne n'a plus la place de naître : c'est fini.
    if (grid[0][piece.c] !== null || grid[1][piece.c] !== null) finish(false);
  }

  function finish(won) {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, won);
  }

  /** La colonne occupe les trois cases au-dessus de `r` inclus : (r-2, r-1, r). */
  const canBe = (c, r) => {
    if (c < 0 || c >= COLS || r >= ROWS) return false;
    for (let i = 0; i < 3; i++) { const rr = r - i; if (rr >= 0 && grid[rr][c] !== null) return false; }
    return true;
  };

  function lock() {
    for (let i = 0; i < 3; i++) {
      const rr = piece.r - i;
      if (rr >= 0) grid[rr][piece.c] = piece.cells[2 - i];
    }
    piece = null;
    host.sfx.move();
    resolve();
  }

  /** Toutes les gemmes prises dans un alignement de 3+, dans les quatre directions. */
  function matches() {
    const hit = new Set();
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = grid[r][c];
        if (v === null) continue;
        for (const [dc, dr] of dirs) {
          let n = 1;
          while (grid[r + dr * n]?.[c + dc * n] === v) n++;
          if (n >= 3) for (let i = 0; i < n; i++) hit.add((r + dr * i) * COLS + (c + dc * i));
        }
      }
    }
    return hit;
  }

  /** Marque les gemmes à faire disparaître, ou relance une colonne s'il n'y a rien. */
  function resolve() {
    const hit = matches();
    if (!hit.size) return spawn();
    chain++;
    popping = hit;
    popT = 18;
    score += hit.size * 10 * chain * D.gain | 0;
    cleared += hit.size;
    if (cleared >= level * 30) { level++; host.sfx.win(); }
    host.sfx[chain > 1 ? 'clear' : 'score']();
    host.onStats({ score, level });
  }

  /** Les gemmes marquées s'en vont, le reste tombe, et on recommence : c'est la chaîne. */
  function collapse() {
    for (const k of popping) grid[(k / COLS) | 0][k % COLS] = null;
    popping = null;
    for (let c = 0; c < COLS; c++) {
      let w = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (grid[r][c] !== null) { const v = grid[r][c]; grid[r][c] = null; grid[w--][c] = v; }
      }
    }
    resolve();
  }

  function update() {
    if (popping) { if (--popT <= 0) collapse(); return; }
    if (!piece) return;

    if (repeat > 0) repeat--;
    else {
      const dc = (key.right ? 1 : 0) - (key.left ? 1 : 0);
      if (dc && canBe(piece.c + dc, piece.r)) { piece.c += dc; repeat = 9; host.sfx.move(); }
    }

    dropT += key.down ? 6 : 1;
    if (dropT < fallFrames()) return;
    dropT = 0;
    if (canBe(piece.c, piece.r + 1)) piece.r++;
    else lock();
  }

  function gem(x, y, v, size = CELL, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = INKS[v];
    const p = size * 0.11;
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y + p);
    ctx.lineTo(x + size - p, y + size / 2);
    ctx.lineTo(x + size / 2, y + size - p);
    ctx.lineTo(x + p, y + size / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y + p);
    ctx.lineTo(x + size - p, y + size / 2);
    ctx.lineTo(x + size / 2, y + size / 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.fillStyle = '#0A0912';
    ctx.fillRect(0, 0, W, H);
    const bx = 8, by = 16;

    ctx.fillStyle = '#12111E';
    ctx.fillRect(bx, by, COLS * CELL, ROWS * CELL);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath(); ctx.moveTo(bx + c * CELL, by); ctx.lineTo(bx + c * CELL, by + ROWS * CELL); ctx.stroke();
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === null) continue;
        const k = popping?.has(r * COLS + c);
        gem(bx + c * CELL + 2, by + r * CELL + 2, grid[r][c], CELL - 4, k ? 0.3 + Math.sin(popT) * 0.3 : 1);
      }
    }

    if (piece) {
      for (let i = 0; i < 3; i++) {
        const rr = piece.r - i;
        if (rr >= 0) gem(bx + piece.c * CELL + 2, by + rr * CELL + 2, piece.cells[2 - i], CELL - 4);
      }
    }

    const px = bx + COLS * CELL + 14;
    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(245,242,234,0.55)';
    ctx.fillText('SUIVANTE', px, by + 12);
    if (next) next.forEach((v, i) => gem(px + 6, by + 22 + i * 24, v, 22));
    ctx.fillStyle = 'rgba(245,242,234,0.55)';
    ctx.fillText('GEMMES', px, by + 120);
    ctx.fillStyle = '#F5F2EA';
    ctx.fillText(String(cleared), px, by + 136);
    if (chain > 1) {
      ctx.fillStyle = '#FFB325';
      ctx.fillText(`CHAÎNE ×${chain}`, px, by + 162);
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

  return {
    start() {
      grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
      score = 0; level = 1; cleared = 0; popping = null; popT = 0; chain = 0; repeat = 0; next = null;
      paused = false; running = true; over = false; last = 0; acc = 0;
      key.left = key.right = key.down = false;
      spawn();
      host.onStats({ score, level });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a in key) { key[a] = down; if (down) repeat = 0; return; }
      // Haut (ou « Permute ») fait tourner les trois couleurs de la colonne.
      if (down && (a === 'up' || a === 'action') && piece) {
        piece.cells.unshift(piece.cells.pop());
        host.sfx.shoot();
      }
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
