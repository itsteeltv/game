// Gemmes. Swap two neighbouring gems to line up three or more of a kind; they burst, the rest fall,
// and chains of luck multiply the score. Line up four for a striped gem (it clears a whole row or column
// when it bursts), five for a rainbow gem (swap it with any gem: every gem of that kind goes).
// Every kind has its own shape as well as its own colour, so the board never relies on colour alone.
// Move the finger from a gem toward its neighbour, or tap one gem and then the other. You have a fixed number of moves.
const N = 8, CELL = 42, X0 = 12, Y0 = 52;
const COLORS = ['#FF5C8A', '#4EA8FF', '#12C98C', '#FFB020', '#9D6BFF', '#8BE04E'];

export function createGame(canvas, host, opts = {}) {
  canvas.width = 360; canvas.height = 404;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;

  const lvl = opts.difficulty ?? 1;
  const KINDS = [5, 6, 6][lvl];
  const MOVES = [34, 28, 22][lvl];
  const TARGET = [1600, 2300, 3000][lvl];

  let grid, moves, score, cascade, phase, phaseT, sel, drag, cursor, showCursor, hintPair, hintT, parts, pending;
  let paused = false, running = false, over = false, rafId = null, last = 0, now = 0;

  const rand = (n) => (Math.random() * n) | 0;
  const cx = (c) => X0 + c * CELL + CELL / 2;
  const cy = (r) => Y0 + r * CELL + CELL / 2;
  const at = (r, c) => (r >= 0 && r < N && c >= 0 && c < N ? grid[r * N + c] : null);
  const mkGem = (t, r, c, fromAbove = 0) => ({ t, sp: 0, x: cx(c), y: cy(r) - fromAbove, vy: 0, pop: 0, spawn: 0 });

  /** Runs of 3+ equal kinds, horizontal and vertical, as { cells: [indices], dir }. */
  function findRuns() {
    const runs = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N;) {
        const g = at(r, c);
        let e = c + 1;
        while (g && e < N && at(r, e) && at(r, e).t === g.t && at(r, e).sp !== 3 && g.sp !== 3) e++;
        if (g && g.sp !== 3 && e - c >= 3) runs.push({ cells: Array.from({ length: e - c }, (_, k) => r * N + c + k), dir: 'h' });
        c = Math.max(e, c + 1);
      }
    }
    for (let c = 0; c < N; c++) {
      for (let r = 0; r < N;) {
        const g = at(r, c);
        let e = r + 1;
        while (g && e < N && at(e, c) && at(e, c).t === g.t && at(e, c).sp !== 3 && g.sp !== 3) e++;
        if (g && g.sp !== 3 && e - r >= 3) runs.push({ cells: Array.from({ length: e - r }, (_, k) => (r + k) * N + c), dir: 'v' });
        r = Math.max(e, r + 1);
      }
    }
    return runs;
  }

  function fillBoard() {
    grid = new Array(N * N).fill(null);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        let t;
        do t = rand(KINDS);
        while ((c >= 2 && at(r, c - 1)?.t === t && at(r, c - 2)?.t === t) || (r >= 2 && at(r - 1, c)?.t === t && at(r - 2, c)?.t === t));
        grid[r * N + c] = mkGem(t, r, c);
      }
    }
  }

  /** Would swapping these two squares do anything? (A match, or a rainbow gem in play.) */
  function swapWorks(a, b) {
    const ga = grid[a], gb = grid[b];
    if (!ga || !gb) return false;
    if (ga.sp === 3 || gb.sp === 3) return true;
    grid[a] = gb; grid[b] = ga;
    const ok = findRuns().length > 0;
    grid[a] = ga; grid[b] = gb;
    return ok;
  }

  function findMove() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        if (c + 1 < N && swapWorks(i, i + 1)) return [i, i + 1];
        if (r + 1 < N && swapWorks(i, i + N)) return [i, i + N];
      }
    }
    return null;
  }

  function reshuffle() {
    do {
      const kinds = grid.map((g) => g.t);
      for (let i = kinds.length - 1; i > 0; i--) { const j = rand(i + 1); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
      grid.forEach((g, i) => { g.t = kinds[i]; g.sp = 0; });
    } while (findRuns().length || !findMove());
  }

  function trySwap(a, b) {
    if (phase !== 'idle' || over || paused) return;
    const ok = swapWorks(a, b);
    pending = { a, b, ok };
    [grid[a], grid[b]] = [grid[b], grid[a]];
    phase = 'swap'; phaseT = 0;
    sel = -1; hintPair = null;
    host.sfx.move();
  }

  /** Clear everything the current runs (and any special gems among them) take with them. */
  function resolve(swapped) {
    const runs = findRuns();
    const clear = new Set();
    const make = [];   // special gems born from this match: { i, sp, t }
    for (const run of runs) {
      run.cells.forEach((i) => clear.add(i));
      if (run.cells.length >= 4) {
        const i = swapped && run.cells.includes(swapped[0]) ? swapped[0] : swapped && run.cells.includes(swapped[1]) ? swapped[1] : run.cells[run.cells.length >> 1];
        make.push({ i, sp: run.cells.length >= 5 ? 3 : run.dir === 'h' ? 1 : 2, t: grid[i].t });
      }
    }
    return { clear, make };
  }

  function expand(clear) {
    // Striped gems take their whole line with them; a chain can set off another.
    let grew = true;
    while (grew) {
      grew = false;
      for (const i of [...clear]) {
        const g = grid[i];
        if (!g || g.sp === 0 || g.sp === 3) continue;
        const r = (i / N) | 0, c = i % N;
        for (let k = 0; k < N; k++) {
          const j = g.sp === 1 ? r * N + k : k * N + c;
          if (!clear.has(j)) { clear.add(j); grew = true; }
        }
      }
    }
  }

  function burst(clear, make) {
    const keep = new Map(make.map((m) => [m.i, m]));
    let n = 0;
    for (const i of clear) {
      if (keep.has(i)) continue;
      const g = grid[i];
      if (!g) continue;
      n++;
      g.pop = 0.001;
      for (let k = 0; k < 5; k++) parts.push({ x: g.x, y: g.y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.7) * 6, t: 0, color: COLORS[g.t] });
    }
    for (const m of make) { const g = grid[m.i]; g.sp = m.sp; g.pulse = 1; host.sfx.pickup(); }
    const gain = (n * 10 + make.length * 40) * (1 + 0.5 * cascade);
    score += Math.round(gain);
    cascade++;
    host.sfx[cascade > 1 ? 'clear' : 'score']();
    host.onStats({ score, level: 1 + Math.floor(score / 700), lives: moves });
    phase = 'burst'; phaseT = 0;
    pending = { clear: [...clear].filter((i) => !keep.has(i)) };
  }

  function gravity() {
    for (let c = 0; c < N; c++) {
      let w = N - 1;
      for (let r = N - 1; r >= 0; r--) {
        const g = grid[r * N + c];
        if (g) { grid[w * N + c] = g; if (w !== r) grid[r * N + c] = null; w--; }
      }
      let drop = 0;
      for (let r = w; r >= 0; r--) grid[r * N + c] = mkGem(rand(KINDS), r, c, (N + 1 + ++drop) * CELL);   // new gems queue up above the board
    }
    phase = 'fall'; phaseT = 0;
  }

  function settled() {
    return grid.every((g, i) => !g || (Math.abs(g.x - cx(i % N)) < 0.6 && Math.abs(g.y - cy((i / N) | 0)) < 0.6 && g.pop === 0));
  }

  function afterSettle() {
    const { clear, make } = resolve(pending?.swapped);
    if (clear.size) { expand(clear); burst(clear, make); return; }
    cascade = 0;
    phase = 'idle'; pending = null;
    if (moves <= 0) return finish();
    if (!findMove()) { reshuffle(); }
  }

  function finish() {
    over = true; running = false;
    draw();
    host.onGameOver(score, score >= TARGET);
  }

  function hint() {
    if (phase !== 'idle' || over || paused) return;
    const m = findMove();
    if (m) { hintPair = m; hintT = 0; host.sfx.pickup(); }
  }

  /* --- drawing ------------------------------------------------------------ */
  function gemShape(t, h) {
    ctx.beginPath();
    if (t === 0) ctx.arc(0, 0, h, 0, Math.PI * 2);
    else if (t === 1) { ctx.moveTo(0, -h * 1.15); ctx.lineTo(h * 1.05, 0); ctx.lineTo(0, h * 1.15); ctx.lineTo(-h * 1.05, 0); ctx.closePath(); }
    else if (t === 2) { const s = h * 0.92; ctx.moveTo(-s + 5, -s); ctx.arcTo(s, -s, s, s, 5); ctx.arcTo(s, s, -s, s, 5); ctx.arcTo(-s, s, -s, -s, 5); ctx.arcTo(-s, -s, s, -s, 5); ctx.closePath(); }
    else if (t === 3) { ctx.moveTo(0, -h * 1.1); ctx.lineTo(h * 1.1, h * 0.85); ctx.lineTo(-h * 1.1, h * 0.85); ctx.closePath(); }
    else if (t === 4) { for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; ctx.lineTo(Math.cos(a) * h * 1.08, Math.sin(a) * h * 1.08); } ctx.closePath(); }
    else { for (let k = 0; k < 10; k++) { const a = (k * Math.PI) / 5 - Math.PI / 2, rr = k % 2 ? h * 0.52 : h * 1.15; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); }
  }

  function drawGem(g, extraScale = 1) {
    const h = CELL * 0.34;
    ctx.save();
    ctx.translate(g.x, g.y);
    const s = (g.pop > 0 ? 1 - g.pop : 1) * extraScale * (g.pulse > 0 ? 1 + g.pulse * 0.25 : 1);
    ctx.scale(s, s);
    if (g.sp === 3) {   // rainbow: a ring of every colour
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = COLORS[k];
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, h * 1.2, (k * Math.PI) / 3 + now / 900, ((k + 1) * Math.PI) / 3 + now / 900); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#F5F5F7'; ctx.beginPath(); ctx.arc(0, 0, h * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    gemShape(g.t, h);
    ctx.fillStyle = COLORS[g.t];
    ctx.shadowColor = COLORS[g.t]; ctx.shadowBlur = g.sp ? 14 : 6;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.save(); ctx.translate(-h * 0.22, -h * 0.26); ctx.scale(0.45, 0.4); gemShape(g.t, h); ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5; gemShape(g.t, h); ctx.stroke();
    if (g.sp) {   // stripes show which way a striped gem will clear
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.4;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        if (g.sp === 1) { ctx.moveTo(-h * 0.9, k * h * 0.42); ctx.lineTo(h * 0.9, k * h * 0.42); }
        else { ctx.moveTo(k * h * 0.42, -h * 0.9); ctx.lineTo(k * h * 0.42, h * 0.9); }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, canvas.height);
    ctx.font = '600 13px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; ctx.fillStyle = '#8E8A98';
    ctx.fillText(`COUPS ${moves}`, 12, 22);
    ctx.textAlign = 'right';
    ctx.fillText(`OBJECTIF ${TARGET}`, W - 12, 22);
    // progress toward the target
    ctx.fillStyle = '#1B1A21'; ctx.fillRect(12, 34, W - 24, 6);
    ctx.fillStyle = score >= TARGET ? '#8BE04E' : '#FFB020'; ctx.fillRect(12, 34, (W - 24) * Math.min(1, score / TARGET), 6);

    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#14131A' : '#100F15';
      ctx.fillRect(X0 + c * CELL, Y0 + r * CELL, CELL, CELL);
    }
    for (const g of grid) if (g) drawGem(g);

    if (hintPair) {
      for (const i of hintPair) {
        ctx.strokeStyle = `rgba(78,168,255,${0.4 + 0.6 * Math.abs(Math.sin(hintT / 150))})`; ctx.lineWidth = 3;
        ctx.strokeRect(X0 + (i % N) * CELL + 2, Y0 + ((i / N) | 0) * CELL + 2, CELL - 4, CELL - 4);
      }
    }
    if (sel >= 0) {
      ctx.strokeStyle = '#F5F5F7'; ctx.lineWidth = 3;
      ctx.strokeRect(X0 + (sel % N) * CELL + 2, Y0 + ((sel / N) | 0) * CELL + 2, CELL - 4, CELL - 4);
    }
    if (showCursor) {
      ctx.strokeStyle = 'rgba(245,245,247,0.55)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 2;
      ctx.strokeRect(X0 + (cursor % N) * CELL + 3, Y0 + ((cursor / N) | 0) * CELL + 3, CELL - 6, CELL - 6);
      ctx.setLineDash([]);
    }
    for (const p of parts) { ctx.globalAlpha = Math.max(0, 1 - p.t / 450); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 5, 5); }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  /* --- simulation ----------------------------------------------------------- */
  function update(dt) {
    phaseT += dt;
    if (hintPair) { hintT += dt; if (hintT > 2600) hintPair = null; }
    for (const p of parts) { p.t += dt; p.x += p.vx; p.y += p.vy; p.vy += 0.25; }
    parts = parts.filter((p) => p.t < 450);

    const k = Math.min(1, dt / 70);
    for (let i = 0; i < grid.length; i++) {
      const g = grid[i];
      if (!g) continue;
      const tx = cx(i % N), ty = cy((i / N) | 0);
      if (phase === 'fall' || g.y < ty - 1) {         // falling gems accelerate, then settle
        g.vy += 0.9; g.y += g.vy;
        if (g.y >= ty) { g.y = ty; g.vy = 0; }
      } else g.y += (ty - g.y) * k;
      g.x += (tx - g.x) * k;
      if (g.pop > 0) g.pop = Math.min(1, g.pop + dt / 180);
      if (g.pulse > 0) g.pulse = Math.max(0, g.pulse - dt / 220);
    }

    if (phase === 'swap' && phaseT > 160 && settled()) {
      if (pending.ok) {
        moves--;
        host.onStats({ score, level: 1 + Math.floor(score / 700), lives: moves });
        // A rainbow gem swapped with a gem of another kind takes every gem of that kind with it.
        const ga = grid[pending.a], gb = grid[pending.b];
        const rb = ga.sp === 3 ? [ga, pending.a, gb] : gb.sp === 3 ? [gb, pending.b, ga] : null;
        if (rb) {
          const clear = new Set([pending.a, pending.b]);
          grid.forEach((g, i) => { if (g.t === rb[2].t) clear.add(i); });
          expand(clear);
          burst(clear, []);
          pending.swapped = null;
          return;
        }
        pending.swapped = [pending.a, pending.b];
        afterSettle();
      } else {   // no match: the gems slide back
        [grid[pending.a], grid[pending.b]] = [grid[pending.b], grid[pending.a]];
        host.sfx.hit();
        phase = 'back'; phaseT = 0;
      }
    } else if (phase === 'back' && phaseT > 160 && settled()) { phase = 'idle'; pending = null; }
    else if (phase === 'burst' && phaseT > 190) {
      for (const i of pending.clear) grid[i] = null;
      gravity();
    } else if (phase === 'fall' && phaseT > 120 && settled()) { pending = { swapped: null }; afterSettle(); }
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(64, last ? t - last : 16);
    last = t; now = t;
    if (!paused) { update(dt); if (running) draw(); }
    rafId = requestAnimationFrame(loop);
  }

  /* --- input ---------------------------------------------------------------- */
  const cellAt = (e) => {
    const b = canvas.getBoundingClientRect();
    const x = (e.clientX - b.left) * (W / b.width) - X0, y = (e.clientY - b.top) * (canvas.height / b.height) - Y0;
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    return c >= 0 && c < N && r >= 0 && r < N ? { r, c, x: e.clientX, y: e.clientY } : null;
  };
  const onDown = (e) => {
    e.preventDefault();
    if (phase !== 'idle' || over || paused) return;
    const cl = cellAt(e);
    if (!cl) return;
    showCursor = false;
    const i = cl.r * N + cl.c;
    cursor = i;
    if (sel >= 0 && sel !== i) {
      const dr = Math.abs((sel / N | 0) - cl.r), dc = Math.abs(sel % N - cl.c);
      if (dr + dc === 1) { trySwap(sel, i); drag = null; return; }
    }
    sel = sel === i ? -1 : i;
    drag = { i, x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id || phase !== 'idle') return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
    const i = drag.i, r = (i / N) | 0, c = i % N;
    const nr = r + (Math.abs(dy) > Math.abs(dx) ? Math.sign(dy) : 0), nc = c + (Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0);
    drag = null;
    if (nr >= 0 && nr < N && nc >= 0 && nc < N) trySwap(i, nr * N + nc);
  };
  const onUp = () => { drag = null; };

  return {
    start() {
      fillBoard();
      if (!findMove()) reshuffle();
      moves = MOVES; score = 0; cascade = 0; phase = 'idle'; phaseT = 0; sel = -1; drag = null; cursor = 27; showCursor = false;
      hintPair = null; hintT = 0; parts = []; pending = null;
      paused = false; running = true; over = false; last = 0;
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      host.onStats({ score: 0, level: 1, lives: moves });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down || !running || paused) return;
      showCursor = true;
      const r = (cursor / N) | 0, c = cursor % N;
      const dir = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] }[a];
      if (dir) {
        const nr = r + dir[0], nc = c + dir[1];
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) return;
        if (sel >= 0 && phase === 'idle') { trySwap(sel, nr * N + nc); cursor = nr * N + nc; }   // a gem is picked up: the arrow moves it
        else cursor = nr * N + nc;
      } else if (a === 'action') sel = sel === cursor ? -1 : cursor;
      else if (a === 'hold') hint();
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    },
  };
}
