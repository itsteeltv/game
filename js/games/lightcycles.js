// Light-cycle duel in the 1982 mould: every cycle leaves a wall of light behind
// it; touch any wall and you're out. Outlast the rival cycles to win the round —
// each round adds a rival and a little speed. Original art, neon on black.
const COLS = 60, ROWS = 46, C = 8;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const RIVALS = ['#FF4D1F', '#FFB020', '#9D6BFF'];

export function createGame(canvas, host, opts = {}) {
  // Difficulty: spare cycles, base speed, how far ahead the rivals think.
  const D = [
    { lives: 5, tick: 85, smart: 0.6 },
    { lives: 3, tick: 70, smart: 0.85 },
    { lives: 2, tick: 58, smart: 1 },
  ][opts.difficulty ?? 1];

  canvas.width = COLS * C; canvas.height = ROWS * C;
  const ctx = canvas.getContext('2d');

  let grid, cycles, player, score, level, lives, tickAcc, roundT, flash, queued;
  let paused = false, running = false, rafId = null, last = 0, over = false;

  const free = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS && !grid[r * COLS + c];

  function newRound() {
    grid = new Uint8Array(COLS * ROWS);
    const n = Math.min(3, level);   // round 1: one rival, then two, then three
    player = { c: 10, r: ROWS / 2, dir: 'right', ink: '#4EA8FF', id: 1, alive: true };
    cycles = [player];
    const spots = [
      { c: COLS - 11, r: ROWS / 2, dir: 'left' },
      { c: COLS / 2, r: 6, dir: 'down' },
      { c: COLS / 2, r: ROWS - 7, dir: 'up' },
    ];
    for (let i = 0; i < n; i++) cycles.push({ ...spots[i], ink: RIVALS[i], id: i + 2, alive: true, ai: true });
    cycles.forEach((cy) => { grid[cy.r * COLS + cy.c] = cy.id; });
    tickAcc = 0; roundT = 1200; queued = [];
  }

  // Room to breathe in a direction: flood-fill the free area beyond the next cell (capped).
  function room(c, r, cap = 160) {
    if (!free(c, r)) return 0;
    const seen = new Set([r * COLS + c]), q = [[c, r]];
    while (q.length && seen.size < cap) {
      const [x, y] = q.shift();
      for (const [dx, dy] of Object.values(DIRS)) {
        const k = (y + dy) * COLS + x + dx;
        if (free(x + dx, y + dy) && !seen.has(k)) { seen.add(k); q.push([x + dx, y + dy]); }
      }
    }
    return seen.size;
  }

  function steer(cy) {
    const back = { up: 'down', down: 'up', left: 'right', right: 'left' }[cy.dir];
    const opts = Object.keys(DIRS).filter((d) => d !== back);
    const ahead = DIRS[cy.dir];
    const blockedSoon = !free(cy.c + ahead[0], cy.r + ahead[1]) || !free(cy.c + ahead[0] * 2, cy.r + ahead[1] * 2);
    // Mostly straight; turn when a wall is close, now and then to cut you off.
    if (!blockedSoon && Math.random() > 0.06) return;
    const score = (d) => {
      const [dx, dy] = DIRS[d];
      let s = room(cy.c + dx, cy.r + dy);
      // Smarter rivals like heading towards you, to box you in.
      const toward = Math.sign(player.c - cy.c) === dx || Math.sign(player.r - cy.r) === dy;
      if (toward && s > 60) s += 25 * D.smart;
      return s + Math.random() * 10 * (1.2 - D.smart);
    };
    cy.dir = opts.reduce((a, b) => (score(b) > score(a) ? b : a));
  }

  function crash(cy) {
    cy.alive = false;
    flash = { c: cy.c, r: cy.r, t: 30, ink: cy.ink };
    host.tone?.({ freq: 90, duration: 0.3, type: 'sawtooth', gain: 0.15 });
  }

  function tick() {
    if (queued.length) {
      const d = queued.shift();
      const back = { up: 'down', down: 'up', left: 'right', right: 'left' }[player.dir];
      if (d !== back) player.dir = d;
    }
    cycles.filter((cy) => cy.alive && cy.ai).forEach(steer);

    // Everyone moves at once; two cycles entering the same cell both crash.
    const moves = cycles.filter((cy) => cy.alive).map((cy) => {
      const [dx, dy] = DIRS[cy.dir];
      return { cy, c: cy.c + dx, r: cy.r + dy };
    });
    moves.forEach((m) => {
      const clash = moves.some((o) => o !== m && o.c === m.c && o.r === m.r);
      if (!free(m.c, m.r) || clash) crash(m.cy);
    });
    moves.forEach((m) => {
      if (!m.cy.alive) return;
      m.cy.c = m.c; m.cy.r = m.r;
      grid[m.r * COLS + m.c] = m.cy.id;
    });
    if (player.alive) score += 1;   // a point for every cell survived

    const rivals = cycles.filter((cy) => cy.ai && cy.alive).length;
    if (!player.alive) {
      lives--;
      host.sfx.hit();
      host.onStats({ lives, score });
      roundT = -1400;   // a beat to see what happened
    } else if (!rivals) {
      score += 250 * level;
      level++;
      host.sfx.win();
      host.onStats({ score, level });
      roundT = -1400;
    } else if (score % 10 === 0) host.onStats({ score });
  }

  function update(dt) {
    if (flash) flash.t--;
    if (roundT > 0) { roundT = Math.max(0, roundT - dt); return; }   // "PRÊT" countdown, lands on 0 = play
    if (roundT < 0) {                                 // round over, pause then next
      roundT += dt;
      if (roundT >= 0) {
        if (lives <= 0) return finish();
        newRound();
      }
      return;
    }
    tickAcc += dt;
    const t = Math.max(32, D.tick - (level - 1) * 5);
    while (tickAcc >= t && roundT === 0) { tickAcc -= t; tick(); }
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // The arena grid, faint.
    ctx.fillStyle = 'rgba(78, 168, 255, 0.08)';
    for (let x = 0; x <= COLS; x += 4) ctx.fillRect(x * C, 0, 1, canvas.height);
    for (let y = 0; y <= ROWS; y += 4) ctx.fillRect(0, y * C, canvas.width, 1);

    // Walls of light: a soft glow under a bright core.
    const inkOf = Object.fromEntries(cycles.map((cy) => [cy.id, cy.ink]));
    ctx.shadowBlur = 8;
    for (let i = 0; i < grid.length; i++) {
      const id = grid[i];
      if (!id) continue;
      ctx.fillStyle = inkOf[id];
      ctx.shadowColor = inkOf[id];
      ctx.fillRect((i % COLS) * C + 1, Math.floor(i / COLS) * C + 1, C - 2, C - 2);
    }
    ctx.shadowBlur = 0;
    cycles.forEach((cy) => {
      if (!cy.alive) return;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(cy.c * C, cy.r * C, C, C);   // the cycle itself burns white-hot
    });

    if (flash && flash.t > 0) {
      ctx.strokeStyle = flash.ink;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(flash.c * C + C / 2, flash.r * C + C / 2, (30 - flash.t) * 1.2, 0, Math.PI * 2); ctx.stroke();
    }

    ctx.font = '700 16px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    if (roundT > 0) {
      ctx.fillStyle = '#4EA8FF';
      ctx.fillText(`MANCHE ${level} — PRÊT`, canvas.width / 2, canvas.height / 2 - 30);
    } else if (roundT < 0) {
      ctx.fillStyle = player.alive ? '#8BE04E' : '#FF4D1F';
      ctx.fillText(player.alive ? 'MANCHE GAGNÉE' : 'MOTO DÉTRUITE', canvas.width / 2, canvas.height / 2 - 30);
    }
    ctx.textAlign = 'start';
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
      score = 0; level = 1; lives = D.lives; flash = null;
      paused = false; running = true; over = false; last = 0;
      newRound();
      host.onStats({ score, level, lives });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      // Turns are queued so two quick presses between ticks both count.
      if (down && DIRS[a] && queued.length < 3) queued.push(a);
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
