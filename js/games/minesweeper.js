// Démineur. Click to reveal, right-click (or the flag button) to mark.
// This game takes pointer input directly on the canvas; it removes its own
// listeners in destroy(), so navigating away can't leave them bound.
const CELL = 28;
const NUM_INK = ['', '#4EA8FF', '#12C98C', '#FF4D1F', '#9D6BFF', '#FFB020', '#8BE04E', '#F5F2EA', '#8E8A98'];

export function createGame(canvas, host, opts = {}) {
  const D = [
    { cols: 12, rows: 9, mines: 12 },
    { cols: 16, rows: 12, mines: 30 },
    { cols: 20, rows: 14, mines: 62 },
  ][opts.difficulty ?? 1];
  const COLS = D.cols, ROWS = D.rows, MINES = D.mines;

  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext('2d');

  let mine, near, shown, flag, left, score, started, flagMode, cursor;
  let paused = false, running = false, rafId = null, over = false;

  const inside = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
  const around = (c, r) => {
    const out = [];
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      if ((dc || dr) && inside(c + dc, r + dr)) out.push([c + dc, r + dr]);
    }
    return out;
  };

  const blank = (fill) => Array.from({ length: COLS }, () => new Array(ROWS).fill(fill));

  /** Mines are laid AFTER the first click, so the opening move is never fatal. */
  function layMines(sc, sr) {
    const safe = new Set([`${sc},${sr}`, ...around(sc, sr).map(([c, r]) => `${c},${r}`)]);
    let placed = 0;
    while (placed < MINES) {
      const c = (Math.random() * COLS) | 0, r = (Math.random() * ROWS) | 0;
      if (mine[c][r] || safe.has(`${c},${r}`)) continue;
      mine[c][r] = true;
      placed++;
    }
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) near[c][r] = around(c, r).filter(([x, y]) => mine[x][y]).length;
    }
    started = true;
  }

  function reveal(c, r) {
    if (!inside(c, r) || shown[c][r] || flag[c][r]) return;
    // Iterative flood fill — recursion could blow the stack on a wide open board.
    const stack = [[c, r]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (!inside(x, y) || shown[x][y] || flag[x][y]) continue;
      shown[x][y] = true;
      left--;
      score += 5;
      if (near[x][y] === 0 && !mine[x][y]) around(x, y).forEach(([a, b]) => stack.push([a, b]));
    }
  }

  function finish(won) {
    if (over) return;
    over = true; running = false;
    if (won) { score += 500 + left * 10; host.sfx.win(); }
    else host.sfx.gameover();
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (mine[c][r]) shown[c][r] = true;
    draw();
    host.onStats({ score });
    host.onGameOver(score, won);
  }

  function dig(c, r) {
    if (!running || paused || !inside(c, r) || shown[c][r]) return;
    if (flagMode) return mark(c, r);
    if (flag[c][r]) return;
    if (!started) layMines(c, r);
    if (mine[c][r]) { shown[c][r] = true; return finish(false); }
    reveal(c, r);
    host.sfx.move();
    host.onStats({ score });
    if (left <= MINES) finish(true);
    else draw();
  }

  function mark(c, r) {
    if (!running || paused || !inside(c, r) || shown[c][r]) return;
    flag[c][r] = !flag[c][r];
    host.sfx.shoot();
    host.onStats({ lives: MINES - countFlags() });
    draw();
  }

  const countFlags = () => flag.flat().filter(Boolean).length;

  function cellAt(ev) {
    const box = canvas.getBoundingClientRect();
    // The canvas is CSS-scaled to fit the cabinet, so map back to its own pixels.
    const x = (ev.clientX - box.left) * (canvas.width / box.width);
    const y = (ev.clientY - box.top) * (canvas.height / box.height);
    return [Math.floor(x / CELL), Math.floor(y / CELL)];
  }

  const onPointer = (ev) => {
    ev.preventDefault();
    const [c, r] = cellAt(ev);
    cursor = [c, r];
    if (ev.button === 2 || ev.ctrlKey) mark(c, r); else dig(c, r);
  };
  const onContext = (ev) => ev.preventDefault();

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const x = c * CELL, y = r * CELL;
        if (!shown[c][r]) {
          ctx.fillStyle = '#2B2733';
          ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
          ctx.fillStyle = 'rgba(255,255,255,0.14)';
          ctx.fillRect(x + 1, y + 1, CELL - 2, 2);
          if (flag[c][r]) {
            ctx.fillStyle = '#FF4D1F';
            ctx.fillRect(x + 12, y + 7, 2, 14);
            ctx.beginPath();
            ctx.moveTo(x + 14, y + 7); ctx.lineTo(x + 22, y + 11); ctx.lineTo(x + 14, y + 15);
            ctx.closePath(); ctx.fill();
          }
        } else {
          ctx.fillStyle = '#15131A';
          ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
          if (mine[c][r]) {
            ctx.fillStyle = '#FF4D1F';
            ctx.beginPath();
            ctx.arc(x + CELL / 2, y + CELL / 2, 6, 0, Math.PI * 2);
            ctx.fill();
          } else if (near[c][r]) {
            ctx.fillStyle = NUM_INK[near[c][r]];
            ctx.font = '600 15px ui-monospace, Consolas, monospace';
            ctx.fillText(String(near[c][r]), x + CELL / 2, y + CELL / 2 + 1);
          }
        }
      }
    }

    if (flagMode) {
      ctx.fillStyle = 'rgba(255,77,31,0.85)';
      ctx.fillRect(0, 0, canvas.width, 3);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);   // static board; the loop just keeps pause honest
  }

  return {
    start() {
      mine = blank(false); near = blank(0); shown = blank(false); flag = blank(false);
      left = COLS * ROWS;
      score = 0; started = false; flagMode = false; cursor = null;
      paused = false; running = true; over = false;

      canvas.addEventListener('pointerdown', onPointer);
      canvas.addEventListener('contextmenu', onContext);

      host.onStats({ score, level: 1, lives: MINES });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down) return;
      if (a === 'action') { flagMode = !flagMode; draw(); }
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onPointer);
      canvas.removeEventListener('contextmenu', onContext);
    },
  };
}
