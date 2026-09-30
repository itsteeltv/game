// Memory. Flip two, keep the pair. Fewer moves and less time scores higher.
const SYMBOLS = [
  { ink: '#FF4D1F', d: 'M4 4h16v16H4z' },
  { ink: '#FFB020', d: 'M12 3 21 20H3z' },
  { ink: '#12C98C', d: 'M12 3a9 9 0 1 0 .01 18A9 9 0 0 0 12 3z' },
  { ink: '#4EA8FF', d: 'M12 2 15 9l7 .6-5.3 4.6L18.3 21 12 17.3 5.7 21l1.6-6.8L2 9.6 9 9z' },
  { ink: '#9D6BFF', d: 'M12 21 3 12l4-5 5 3 5-3 4 5z' },
  { ink: '#8BE04E', d: 'M3 12h7V3h4v9h7v4h-7v5h-4v-5H3z' },
  { ink: '#FF5C8A', d: 'M12 20 4 12.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 5.5z' },
  { ink: '#F5F2EA', d: 'M5 5h14v4H5zM5 11h14v4H5zM5 17h14v3H5z' },
  { ink: '#9FB0C9', d: 'M12 2l9 9-9 11-9-11z' },
  { ink: '#FF8A3D', d: 'M4 8h16v3H4zM7 13h10v7H7z' },
  { ink: '#6E9BFF', d: 'M2 12a10 10 0 0 0 20 0 10 10 0 0 0-20 0zm5 0h10' },
  { ink: '#FFD34E', d: 'M6 2h12v8l-6 12L6 10z' },
];

export function createGame(canvas, host, opts = {}) {
  // The grid itself is the difficulty: more pairs to hold in your head.
  const D = [
    { cols: 4, rows: 3, peek: 900 },
    { cols: 4, rows: 4, peek: 700 },
    { cols: 6, rows: 4, peek: 520 },
  ][opts.difficulty ?? 1];

  const CELL = 78, GAP = 8;
  canvas.width = D.cols * CELL + (D.cols + 1) * GAP;
  canvas.height = D.rows * CELL + (D.rows + 1) * GAP + 26;
  const ctx = canvas.getContext('2d');
  const TOP = 26;

  let cards, first, second, lockT, matched, moves, score, elapsed;
  let paused = false, running = false, rafId = null, last = 0, over = false;

  function deal() {
    const pairs = (D.cols * D.rows) / 2;
    const ids = [];
    for (let i = 0; i < pairs; i++) { ids.push(i, i); }
    for (let i = ids.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    cards = ids.map((sym, i) => ({
      sym,
      c: i % D.cols,
      r: (i / D.cols) | 0,
      up: false,
      done: false,
      flip: 0,
    }));
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    // Reward speed and precision, never let the bonus go negative.
    const perfect = cards.length / 2;
    score = 1000 + Math.max(0, (perfect * 3 - moves)) * 40 + Math.max(0, 120 - (elapsed / 1000 | 0)) * 8;
    host.sfx.win();
    host.onStats({ score });
    host.onGameOver(score, true);
  }

  function pick(i) {
    if (!running || paused || lockT > 0) return;
    const card = cards[i];
    if (!card || card.done || card.up) return;

    card.up = true;
    host.sfx.move();

    if (first === null) { first = i; return; }
    second = i;
    moves++;
    host.onStats({ lives: moves });

    if (cards[first].sym === cards[second].sym) {
      cards[first].done = cards[second].done = true;
      matched++;
      host.sfx.pickup();
      first = second = null;
      if (matched === cards.length / 2) finish();
    } else {
      lockT = D.peek;          // both stay face-up briefly so you can memorise them
    }
  }

  function update(dt) {
    elapsed += dt;
    cards.forEach((c) => {
      const target = c.up || c.done ? 1 : 0;
      c.flip += Math.sign(target - c.flip) * Math.min(Math.abs(target - c.flip), dt / 140);
    });
    if (lockT > 0) {
      lockT -= dt;
      if (lockT <= 0) {
        if (first !== null) cards[first].up = false;
        if (second !== null) cards[second].up = false;
        first = second = null;
        host.sfx.hit();
      }
    }
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#8E8A98';
    ctx.textBaseline = 'middle';
    ctx.fillText(`COUPS ${moves}`, 8, 13);
    ctx.textAlign = 'right';
    ctx.fillText(`${matched}/${cards.length / 2} PAIRES · ${(elapsed / 1000) | 0}s`, canvas.width - 8, 13);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';

    cards.forEach((card) => {
      const x = GAP + card.c * (CELL + GAP);
      const y = TOP + GAP + card.r * (CELL + GAP);
      // Flip read as a horizontal squash — cheap, and it sells the turn.
      const t = card.flip;
      const w = Math.abs(Math.cos(t * Math.PI)) * CELL;
      const cx = x + CELL / 2;

      ctx.globalAlpha = card.done ? 0.45 : 1;
      if (t < 0.5) {
        ctx.fillStyle = '#2B2733';
        ctx.fillRect(cx - w / 2, y, w, CELL);
        if (w > 12) {
          ctx.fillStyle = 'rgba(245,242,234,0.10)';
          ctx.fillRect(cx - w / 2 + 6, y + 6, w - 12, CELL - 12);
        }
      } else {
        const s = SYMBOLS[card.sym % SYMBOLS.length];
        ctx.fillStyle = '#15131A';
        ctx.fillRect(cx - w / 2, y, w, CELL);
        if (w > 20) {
          ctx.save();
          ctx.translate(cx - w / 2, y);
          ctx.scale(w / CELL, 1);
          ctx.translate(CELL / 2 - 20, CELL / 2 - 20);
          ctx.scale(40 / 24, 40 / 24);
          ctx.fillStyle = s.ink;
          ctx.fill(new Path2D(s.d));
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    });
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(48, last ? t - last : 16);
    last = t;
    if (!paused) { update(dt); if (running) draw(); }
    rafId = requestAnimationFrame(loop);
  }

  function onPointer(ev) {
    ev.preventDefault();
    const b = canvas.getBoundingClientRect();
    const x = (ev.clientX - b.left) * (canvas.width / b.width);
    const y = (ev.clientY - b.top) * (canvas.height / b.height) - TOP;
    const c = Math.floor((x - GAP) / (CELL + GAP));
    const r = Math.floor((y - GAP) / (CELL + GAP));
    if (c < 0 || c >= D.cols || r < 0 || r >= D.rows) return;
    pick(r * D.cols + c);
  }

  return {
    start() {
      deal();
      first = second = null;
      lockT = 0; matched = 0; moves = 0; score = 0; elapsed = 0;
      paused = false; running = true; over = false; last = 0;
      canvas.addEventListener('pointerdown', onPointer);
      host.onStats({ score: 0, level: D.cols * D.rows / 2, lives: 0 });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input() { /* pointer-driven */ },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onPointer);
    },
  };
}
