// Éteins-Tout. A board of lights: pressing a cell flips it and its four neighbours.
// Switch every light off. The board is scrambled by real presses, so it always has a solution;
// that solution doubles as the hint (a press made twice cancels out).
const INK_ON = '#FFB020', INK_HI = '#FFE08A', OFF = '#1B1A21';

export function createGame(canvas, host, opts = {}) {
  const lvl = opts.difficulty ?? 1;
  const N = [4, 5, 6][lvl];
  const SCRAMBLE = [5, 9, 15][lvl];
  const GAP = 8, TOP = 34;
  const CELL = Math.floor((340 - GAP * (N + 1)) / N);
  const SIZE = CELL * N + GAP * (N + 1);
  canvas.width = SIZE; canvas.height = SIZE + TOP;
  const ctx = canvas.getContext('2d');

  let lit, glow, solution, moves, hints, elapsed, cursor, showCursor, hintCell, hintT;
  let paused = false, running = false, over = false, rafId = null, last = 0, shownSec = -1;

  const idx = (r, c) => r * N + c;
  const cells = () => Array.from({ length: N * N }, (_, i) => i);

  function flip(i) {
    const r = Math.floor(i / N), c = i % N;
    for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N) lit[idx(rr, cc)] ^= 1;
    }
  }

  function deal() {
    lit = new Array(N * N).fill(0);
    glow = new Array(N * N).fill(0);
    solution = new Set();
    const pool = cells();
    for (let k = 0; k < SCRAMBLE; k++) {
      const i = pool.splice((Math.random() * pool.length) | 0, 1)[0];
      solution.add(i);
      flip(i);
    }
    // Never hand out a board that is already dark.
    if (!lit.some(Boolean)) { const i = (Math.random() * N * N) | 0; solution.add(i); flip(i); }
    glow = lit.map(Number);
  }

  function press(i) {
    if (!running || paused || over) return;
    flip(i);
    if (solution.has(i)) solution.delete(i); else solution.add(i);   // pressed twice = never pressed
    moves++;
    hintCell = -1;
    host.sfx.move();
    host.onStats({ score: 0, level: N, lives: moves });
    if (!lit.some(Boolean)) finish();
  }

  function hint() {
    if (!running || paused || over || !solution.size) return;
    hintCell = [...solution][(Math.random() * solution.size) | 0];
    hintT = 0;
    hints++;
    host.sfx.pickup();
  }

  function finish() {
    over = true; running = false;
    glow.fill(0); draw();
    const secs = Math.floor(elapsed / 1000);
    const score = Math.max(100, 1000 + Math.max(0, SCRAMBLE * 3 - moves) * 40 + Math.max(0, 90 - secs) * 8 - hints * 150);
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

  const mix = (a, b, t) => {
    const pa = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16));
    const pb = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16));
    return `rgb(${pa.map((v, k) => Math.round(v + (pb[k] - v) * t)).join(',')})`;
  };

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

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = idx(r, c), g = glow[i];
        const x = GAP + c * (CELL + GAP), y = TOP + GAP + r * (CELL + GAP);
        ctx.save();
        if (g > 0.02) { ctx.shadowColor = INK_ON; ctx.shadowBlur = 20 * g; }
        ctx.fillStyle = mix(OFF, INK_ON, g);
        roundRect(x, y, CELL, CELL, 10);
        ctx.fill();
        ctx.restore();
        if (g > 0.02) {   // a bright core, so a lit cell reads as a lamp, not a flat colour
          const grad = ctx.createRadialGradient(x + CELL / 2, y + CELL * 0.4, 2, x + CELL / 2, y + CELL / 2, CELL * 0.7);
          grad.addColorStop(0, `rgba(255,224,138,${0.85 * g})`);
          grad.addColorStop(1, 'rgba(255,176,32,0)');
          ctx.fillStyle = grad;
          roundRect(x, y, CELL, CELL, 10);
          ctx.fill();
        }
        if (hintCell === i) {
          ctx.strokeStyle = `rgba(78,168,255,${0.5 + 0.5 * Math.sin(hintT / 120)})`;
          ctx.lineWidth = 4;
          roundRect(x - 2, y - 2, CELL + 4, CELL + 4, 12);
          ctx.stroke();
        }
        if (showCursor && cursor === i) {
          ctx.strokeStyle = '#F5F5F7';
          ctx.lineWidth = 3;
          roundRect(x - 1, y - 1, CELL + 2, CELL + 2, 11);
          ctx.stroke();
        }
      }
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
      hintT += dt;
      if (hintCell >= 0 && hintT > 2200) hintCell = -1;
      for (let i = 0; i < glow.length; i++) {
        const target = lit[i];
        glow[i] += Math.sign(target - glow[i]) * Math.min(Math.abs(target - glow[i]), dt / 140);
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
    // The gaps belong to the nearest cell, so there are no dead zones under a thumb.
    const c = Math.floor((x - GAP / 2) / (CELL + GAP)), r = Math.floor((y - GAP / 2) / (CELL + GAP));
    if (c < 0 || c >= N || r < 0 || r >= N) return;
    cursor = idx(r, c);
    showCursor = false;
    press(cursor);
  };

  return {
    start() {
      deal();
      moves = 0; hints = 0; elapsed = 0; hintCell = -1; hintT = 0; cursor = idx(N >> 1, N >> 1); showCursor = false;
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
      if (!down || !running) return;
      showCursor = true;
      const r = Math.floor(cursor / N), c = cursor % N;
      if (a === 'left') cursor = idx(r, (c + N - 1) % N);
      else if (a === 'right') cursor = idx(r, (c + 1) % N);
      else if (a === 'up') cursor = idx((r + N - 1) % N, c);
      else if (a === 'down') cursor = idx((r + 1) % N, c);
      else if (a === 'action') press(cursor);
      else if (a === 'hold') hint();
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
    },
  };
}
