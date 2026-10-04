// Hockey de Table. Air hockey against the machine: your mallet slides over the bottom half of the table,
// the puck skims with almost no friction and rebounds off the cushions. First to the target score wins.
// Move the mouse or drag a finger (the mallet chases it), or use the arrow keys.
export function createGame(canvas, host, opts = {}) {
  canvas.width = 360; canvas.height = 560;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const lvl = opts.difficulty ?? 1;
  const WIN = [5, 7, 9][lvl];
  const AI_SPEED = [4.4, 6.3, 8.4][lvl];
  const AI_AIM = [0.45, 0.8, 1][lvl];          // how well it reads where the puck is going
  const GOAL = 132, PR = 15, MR = 30, TOPY = 64;
  const MAX_PUCK = 17;
  const STEP = 1000 / 60;

  const puck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  const me = { x: W / 2, y: H - 90, px: W / 2, py: H - 90 };
  const ai = { x: W / 2, y: 90, px: W / 2, py: 90 };
  const keys = { left: 0, right: 0, up: 0, down: 0 };
  let aim = null, pScore = 0, aScore = 0, pause = 0, trail = [], flash = 0, idle = 0;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const label = () => `${pScore} — ${aScore}`;
  const report = () => host.onStats({ score: label(), level: 1 + pScore + aScore });

  function serve(towardPlayer) {
    puck.x = W / 2 + (Math.random() - 0.5) * 60;
    puck.y = towardPlayer ? H * 0.64 : H * 0.36;
    puck.vx = 0; puck.vy = 0;
    trail = []; idle = 0;
    pause = 70;     // a beat of stillness after a goal
  }

  /** Move a mallet toward (tx, ty), at most `speed` px, kept inside its half of the table. */
  function chase(m, tx, ty, speed, top, bottom) {
    m.px = m.x; m.py = m.y;
    const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
    if (d > 0.01) { const k = Math.min(1, speed / d); m.x += dx * k; m.y += dy * k; }
    m.x = clamp(m.x, MR, W - MR);
    m.y = clamp(m.y, top, bottom);
  }

  /** Where the puck will cross the line y = lineY, folding its path off the side cushions. */
  function predictX(lineY) {
    if (puck.vy >= -0.1) return puck.x;
    const t = (puck.y - lineY) / -puck.vy;
    let x = puck.x + puck.vx * t;
    const span = W - 2 * PR;
    x = ((x - PR) % (2 * span) + 2 * span) % (2 * span);
    return PR + (x > span ? 2 * span - x : x);
  }

  function aiThink() {
    const half = H / 2;
    const inMyHalf = puck.y < half - 4;
    const slow = Math.hypot(puck.vx, puck.vy) < 5.5;
    if (inMyHalf && (slow || puck.vy > 0)) {
      // Attack: get behind the puck on the line to the player's goal, then drive through it.
      const gx = W / 2, gy = H + 30;
      const nx = gx - puck.x, ny = gy - puck.y, nl = Math.hypot(nx, ny) || 1;
      const bx = puck.x - (nx / nl) * (MR + PR + 6), by = puck.y - (ny / nl) * (MR + PR + 6);
      const behind = Math.hypot(ai.x - bx, ai.y - by) < 26 || (ai.y < puck.y - 6 && Math.abs(ai.x - puck.x) < 40);
      if (behind) chase(ai, puck.x + (nx / nl) * 30, puck.y + (ny / nl) * 30, AI_SPEED * 1.35, MR, half - MR);
      else chase(ai, bx, by, AI_SPEED, MR, half - MR);
    } else {
      // Defend: slide along the goal mouth where the puck is heading, with a human-sized error.
      const target = predictX(TOPY + 10) * AI_AIM + puck.x * (1 - AI_AIM);
      const ex = clamp(target, W / 2 - GOAL / 2 + 6, W / 2 + GOAL / 2 - 6);
      chase(ai, ex, TOPY + 4 + (puck.y < half ? 0 : 14), AI_SPEED, MR, half - MR);
    }
  }

  function hitPuck(m) {
    const dx = puck.x - m.x, dy = puck.y - m.y, d = Math.hypot(dx, dy);
    if (d >= PR + MR || d === 0) return;
    const nx = dx / d, ny = dy / d;
    puck.x = m.x + nx * (PR + MR + 0.5); puck.y = m.y + ny * (PR + MR + 0.5);
    const mvx = m.x - m.px, mvy = m.y - m.py;
    const rel = (puck.vx - mvx) * nx + (puck.vy - mvy) * ny;
    if (rel < 0) {
      puck.vx -= 1.9 * rel * nx; puck.vy -= 1.9 * rel * ny;
      const sp = Math.hypot(puck.vx, puck.vy);
      if (sp < 5) { puck.vx = (puck.vx / (sp || 1)) * 5; puck.vy = (puck.vy / (sp || 1)) * 5; }   // never a limp tap
      host.sfx.shoot();
    }
  }

  function goal(playerScored) {
    if (playerScored) pScore++; else aScore++;
    flash = 30;
    host.sfx[playerScored ? 'score' : 'hit']();
    report();
    if (pScore >= WIN || aScore >= WIN) return finish();
    serve(!playerScored);   // the puck goes to whoever just conceded
  }

  function finish() {
    over = true; running = false;
    draw();
    host.onGameOver(pScore * 100 - aScore, pScore > aScore, label());
  }

  function update() {
    if (flash > 0) flash--;
    if (keys.left || keys.right || keys.up || keys.down) {
      aim = { x: me.x + (keys.right - keys.left) * 40, y: me.y + (keys.down - keys.up) * 40 };
    }
    const tx = aim ? aim.x : me.x, ty = aim ? aim.y : me.y;
    chase(me, tx, ty, 24, H / 2 + MR + 4, H - MR);
    if (pause > 0) { pause--; chase(ai, W / 2, 90, AI_SPEED, MR, H / 2 - MR); return; }
    aiThink();

    // Two sub-steps: the puck moves up to 17 px a frame, a mallet is 60 px across.
    for (let s = 0; s < 2; s++) {
      puck.x += puck.vx / 2; puck.y += puck.vy / 2;
      puck.vx *= 0.9975; puck.vy *= 0.9975;
      if (puck.x < PR) { puck.x = PR; puck.vx = Math.abs(puck.vx) * 0.96; host.sfx.move(); }
      else if (puck.x > W - PR) { puck.x = W - PR; puck.vx = -Math.abs(puck.vx) * 0.96; host.sfx.move(); }
      const inMouth = Math.abs(puck.x - W / 2) < GOAL / 2 - 4;
      if (puck.y < PR && !inMouth) { puck.y = PR; puck.vy = Math.abs(puck.vy) * 0.96; host.sfx.move(); }
      else if (puck.y > H - PR && !inMouth) { puck.y = H - PR; puck.vy = -Math.abs(puck.vy) * 0.96; host.sfx.move(); }
      if (puck.y < -PR * 1.4) return goal(true);
      if (puck.y > H + PR * 1.4) return goal(false);
      hitPuck(me); hitPuck(ai);
      const sp = Math.hypot(puck.vx, puck.vy);
      if (sp > MAX_PUCK) { puck.vx *= MAX_PUCK / sp; puck.vy *= MAX_PUCK / sp; }
    }
    trail.push({ x: puck.x, y: puck.y });
    if (trail.length > 9) trail.shift();

    // A puck left dead on one side is hit by that side's owner: no stalemates.
    if (Math.hypot(puck.vx, puck.vy) < 0.4) idle++; else idle = 0;
    if (idle > 150) { puck.vy += puck.y < H / 2 ? 7 : -7; puck.vx += (Math.random() - 0.5) * 4; idle = 0; }
  }

  function draw() {
    ctx.fillStyle = '#07060C';
    ctx.fillRect(0, 0, W, H);
    // The table: a dark sheet of ice with a lit rim and the markings of a real rink.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0B1A33'); g.addColorStop(0.5, '#0A2540'); g.addColorStop(1, '#0B1A33');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(158,213,255,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 56, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, 0, GOAL / 2 + 22, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H, GOAL / 2 + 22, Math.PI, Math.PI * 2); ctx.stroke();
    // Goal mouths.
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#4EA8FF'; ctx.shadowColor = '#4EA8FF'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.moveTo(W / 2 - GOAL / 2, 2); ctx.lineTo(W / 2 + GOAL / 2, 2); ctx.stroke();
    ctx.strokeStyle = '#FF4D1F'; ctx.shadowColor = '#FF4D1F';
    ctx.beginPath(); ctx.moveTo(W / 2 - GOAL / 2, H - 2); ctx.lineTo(W / 2 + GOAL / 2, H - 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(158,213,255,0.5)'; ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = '800 64px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(aScore), W - 44, H / 2 - 22);
    ctx.fillText(String(pScore), W - 44, H / 2 + 74);
    ctx.textAlign = 'start';

    for (let i = 0; i < trail.length; i++) {   // a short comet tail so speed reads
      ctx.fillStyle = `rgba(255,224,138,${(i / trail.length) * 0.28})`;
      ctx.beginPath(); ctx.arc(trail[i].x, trail[i].y, PR * (0.4 + 0.5 * (i / trail.length)), 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowColor = '#FFE08A'; ctx.shadowBlur = 12;
    ctx.fillStyle = '#FFE08A';
    ctx.beginPath(); ctx.arc(puck.x, puck.y, PR, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#FFB020';
    ctx.beginPath(); ctx.arc(puck.x, puck.y, PR * 0.55, 0, Math.PI * 2); ctx.fill();

    for (const [m, color, dark] of [[ai, '#4EA8FF', '#1B5E9E'], [me, '#FF4D1F', '#9E2D0E']]) {
      ctx.shadowColor = color; ctx.shadowBlur = 16;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(m.x, m.y, MR, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(m.x, m.y, MR * 0.62, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(m.x, m.y, MR * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath(); ctx.arc(m.x - 9, m.y - 11, 8, 0, Math.PI * 2); ctx.fill();
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash / 90})`; ctx.fillRect(0, 0, W, H); }
  }

  function loop(t) {
    if (!running) return;
    acc = paused ? 0 : acc + Math.min(100, last ? t - last : STEP);
    last = t;
    for (; acc >= STEP && running; acc -= STEP) update();
    if (running && !paused) draw();
    rafId = requestAnimationFrame(loop);
  }

  const toPt = (e) => {
    const b = canvas.getBoundingClientRect();
    return { x: (e.clientX - b.left) * (W / b.width), y: (e.clientY - b.top) * (H / b.height) };
  };
  const onMove = (e) => { if (e.pointerType === 'mouse' || e.buttons) aim = toPt(e); };
  const onDown = (e) => { e.preventDefault(); aim = toPt(e); };

  return {
    start() {
      pScore = 0; aScore = 0; flash = 0;
      me.x = me.px = W / 2; me.y = me.py = H - 90; ai.x = ai.px = W / 2; ai.y = ai.py = 90;
      aim = null; keys.left = keys.right = keys.up = keys.down = 0;
      paused = false; running = true; over = false; last = 0; acc = 0;
      serve(true);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerdown', onDown);
      report(); draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a in keys) { keys[a] = down ? 1 : 0; if (!down && !keys.left && !keys.right && !keys.up && !keys.down) aim = null; }
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
    },
  };
}
