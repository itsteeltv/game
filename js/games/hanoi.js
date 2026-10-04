// Tour de Hanoï. Move the whole stack from the left pole to the right one, one disc at a time,
// never a big disc on a small one. 3, 5 or 7 discs; the best possible run takes 2ⁿ − 1 moves.
export function createGame(canvas, host, opts = {}) {
  canvas.width = 480; canvas.height = 340;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;

  const lvl = opts.difficulty ?? 1;
  const N = [3, 5, 7][lvl];
  const PAR = 2 ** N - 1;
  const BASE_Y = 296, DISC_H = 22, POLE_H = 200, TOP = 36;
  const MIN_W = 44, MAX_W = 140;
  const widthOf = (d) => MIN_W + ((MAX_W - MIN_W) * (d - 1)) / Math.max(1, N - 1);
  const poleX = (t) => (W / 6) * (1 + 2 * t);

  let towers, discs, held, cursor, showCursor, moves, elapsed, shake;
  let paused = false, running = false, over = false, rafId = null, last = 0;

  // Each disc carries its drawn position; it eases toward wherever the rules put it.
  function targetOf(d) {
    for (let t = 0; t < 3; t++) {
      const k = towers[t].indexOf(d);
      if (k >= 0) return { x: poleX(t), y: BASE_Y - DISC_H * (k + 1) + DISC_H / 2 };
    }
    return { x: poleX(held.over), y: TOP - 4 };   // lifted: hovers over the pole it's above
  }

  function deal() {
    towers = [Array.from({ length: N }, (_, i) => N - i), [], []];
    held = null; cursor = 0; showCursor = false; moves = 0; elapsed = 0; shake = 0;
    discs = {};
    for (let d = 1; d <= N; d++) { const t = targetOf(d); discs[d] = { x: t.x, y: t.y }; }
  }

  function pick(t) {
    if (held || !towers[t].length) return;
    held = { d: towers[t][towers[t].length - 1], from: t, over: t };
    towers[t].pop();
    host.sfx.shoot();
  }

  function drop(t) {
    const top = towers[t][towers[t].length - 1];
    if (top !== undefined && top < held.d) { shake = 220; host.sfx.hit(); return; }   // a big disc never rests on a small one
    towers[t].push(held.d);
    if (t !== held.from) { moves++; host.onStats({ score: 0, level: N, lives: moves }); }
    held = null;
    host.sfx.move();
    if (towers[2].length === N) finish();
  }

  function tap(t) {
    if (!running || paused || over) return;
    cursor = t;
    if (!held) pick(t);
    else { held.over = t; drop(t); }
  }

  function finish() {
    over = true; running = false;
    for (let d = 1; d <= N; d++) Object.assign(discs[d], targetOf(d));
    draw();
    const secs = Math.floor(elapsed / 1000);
    const score = 300 * N + Math.max(0, PAR * 3 - moves) * 20 + Math.max(0, 40 * N - secs) * 4;
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
    ctx.fillRect(0, 0, W, canvas.height);

    ctx.font = '600 13px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8E8A98';
    ctx.textAlign = 'left';
    ctx.fillText(`COUPS ${moves} / ${PAR}`, 10, 16);
    const secs = Math.floor(elapsed / 1000);
    ctx.textAlign = 'right';
    ctx.fillText(`TEMPS ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, W - 10, 16);

    // Base and poles. The goal pole is marked: it's the only one that wins.
    ctx.fillStyle = '#2A2833';
    roundRect(20, BASE_Y, W - 40, 12, 6);
    ctx.fill();
    for (let t = 0; t < 3; t++) {
      const x = poleX(t);
      ctx.fillStyle = t === 2 ? '#12C98C' : '#4A4757';
      roundRect(x - 4, BASE_Y - POLE_H, 8, POLE_H, 4);
      ctx.fill();
      if (showCursor && cursor === t) {
        ctx.strokeStyle = '#F5F5F7';
        ctx.lineWidth = 3;
        roundRect(x - MAX_W / 2 - 6, BASE_Y - POLE_H - 10, MAX_W + 12, POLE_H + 34, 12);
        ctx.stroke();
      }
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#12C98C';
    ctx.font = '700 12px ui-monospace, Consolas, monospace';
    ctx.fillText('ARRIVÉE', poleX(2), BASE_Y + 28);
    ctx.fillStyle = '#8E8A98';
    ctx.fillText('DÉPART', poleX(0), BASE_Y + 28);

    for (let d = N; d >= 1; d--) {
      const p = discs[d], w = widthOf(d);
      const wobble = held && held.d === d && shake > 0 ? Math.sin(shake / 18) * 6 : 0;
      const hue = Math.round(((d - 1) / Math.max(1, N - 1)) * 280);
      ctx.fillStyle = `hsl(${hue} 78% 56%)`;
      roundRect(p.x - w / 2 + wobble, p.y - DISC_H / 2 + 1, w, DISC_H - 3, 8);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      roundRect(p.x - w / 2 + wobble, p.y - DISC_H / 2 + 1, w, (DISC_H - 3) * 0.45, 8);
      ctx.fill();
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
      if (shake > 0) shake -= dt;
      const k = Math.min(1, dt / 70);
      for (let d = 1; d <= N; d++) {
        const tg = targetOf(d), p = discs[d];
        p.x += (tg.x - p.x) * k; p.y += (tg.y - p.y) * k;
      }
      draw();
    }
    rafId = requestAnimationFrame(loop);
  }

  const onDown = (e) => {
    e.preventDefault();
    const b = canvas.getBoundingClientRect();
    const x = (e.clientX - b.left) * (W / b.width);
    showCursor = false;
    tap(Math.max(0, Math.min(2, Math.floor((x / W) * 3))));   // each pole owns a third of the width
  };

  return {
    start() {
      deal();
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
      if (!down || !running || paused) return;
      showCursor = true;
      if (a === 'left') cursor = Math.max(0, cursor - 1);
      else if (a === 'right') cursor = Math.min(2, cursor + 1);
      else if (a === 'up' && !held) pick(cursor);
      else if (a === 'down' && held) { held.over = cursor; drop(cursor); }
      else if (a === 'action') tap(cursor);
      if (held) held.over = cursor;   // the lifted disc follows the cursor
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
    },
  };
}
