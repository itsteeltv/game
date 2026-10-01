// Pong — player (right paddle) vs AI (left). First to 7.
// `{ autoplay: true }` drives both paddles by AI for the home page's attract mode.
export function createGame(canvas, host = {}, opts = {}) {
  canvas.width = 480; canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // Difficulty moves the AI's reach, the serve speed and the target score.
  const D = [
    { ai: 2.6, slack: 20, speed: 3.6, win: 5, ph: 78 },
    { ai: 3.0, slack: 12, speed: 4.2, win: 7, ph: 64 },
    { ai: 3.7, slack: 6, speed: 5.0, win: 11, ph: 52 },
  ][opts.difficulty ?? 1];

  const PW = 10, PH = D.ph, R = 5, WIN = D.win;
  const SPEED0 = D.speed;
  // Cap below paddle width: a ball faster than the paddle is thick can cross it
  // entirely between two frames and tunnel through without ever colliding.
  const VX_MAX = PW - 2;
  const VY_MAX = 6;
  const autoplay = !!opts.autoplay;

  const player = { y: H / 2 - PH / 2 };
  const ai = { y: H / 2 - PH / 2 };
  const ball = { x: W / 2, y: H / 2, vx: SPEED0, vy: 1.6 };
  const keys = { up: false, down: false };

  let pScore = 0, aScore = 0, rally = 0, serveWait = 0;
  let paused = false, running = false, rafId = null, last = 0, acc = 0;

  // The three tones of the 1972 cabinet: paddle, wall, point.
  const TONES = { hit: [459, 0.04], move: [226, 0.02], score: [490, 0.25] };
  const beep = (n) => { if (!autoplay) host.tone?.({ freq: TONES[n][0], duration: TONES[n][1], type: 'square', gain: 0.14 }); };
  let aim = null;   // finger or mouse y: the paddle follows it, like the original knob
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function serve(dir) {
    ball.x = W / 2; ball.y = H / 2;
    ball.vx = SPEED0 * dir;
    ball.vy = (Math.random() * 2 - 1) * 2;
    rally = 0;
    serveWait = autoplay ? 30 : 45;   // a beat before the ball leaves centre
  }

  const label = () => `${pScore} — ${aScore}`;
  const report = () => { if (!autoplay) host.onStats?.({ score: label(), level: Math.min(9, 1 + Math.floor(rally / 4)) }); };

  /** Deflection angle depends on WHERE the paddle was hit — the core of Pong's skill. */
  function bounce(paddle, dirX) {
    const rel = (ball.y - (paddle.y + PH / 2)) / (PH / 2);      // -1 top .. +1 bottom
    const speed = Math.min(Math.hypot(ball.vx, ball.vy) * 1.045, VX_MAX + 2);
    const angle = clamp(rel, -1, 1) * 0.9;                      // up to ~52°
    ball.vx = dirX * Math.abs(Math.cos(angle) * speed);
    ball.vy = clamp(Math.sin(angle) * speed, -VY_MAX, VY_MAX);
    ball.vx = clamp(ball.vx, -VX_MAX, VX_MAX);
    rally++;
    beep('hit');
  }

  function aiTrack(paddle, speed, slack) {
    const c = paddle.y + PH / 2;
    if (c < ball.y - slack) paddle.y += speed;
    else if (c > ball.y + slack) paddle.y -= speed;
    paddle.y = clamp(paddle.y, 0, H - PH);
  }

  function update() {
    if (autoplay) {
      aiTrack(player, 3.2, 12);
      aiTrack(ai, 3.0, 15);
    } else {
      if (aim !== null) player.y = aim - PH / 2;
      if (keys.up) player.y -= 6.5;
      if (keys.down) player.y += 6.5;
      player.y = clamp(player.y, 0, H - PH);
      // The AI sharpens as the player pulls ahead, so a lead still has to be defended.
      aiTrack(ai, D.ai + Math.max(0, pScore - aScore) * 0.22, D.slack);
    }

    if (serveWait > 0) { serveWait--; return; }

    ball.x += ball.vx;
    ball.y += ball.vy;

    if (ball.y - R < 0) { ball.y = R; ball.vy = Math.abs(ball.vy); beep('move'); }
    else if (ball.y + R > H) { ball.y = H - R; ball.vy = -Math.abs(ball.vy); beep('move'); }

    // Snap the ball clear of the paddle on contact, otherwise it can register a
    // second hit on the next frame and stick to the face.
    if (ball.vx < 0 && ball.x - R <= PW && ball.x > 0 && ball.y >= ai.y && ball.y <= ai.y + PH) {
      ball.x = PW + R; bounce(ai, 1);
    }
    if (ball.vx > 0 && ball.x + R >= W - PW && ball.x < W && ball.y >= player.y && ball.y <= player.y + PH) {
      ball.x = W - PW - R; bounce(player, -1);
    }

    if (ball.x < -R) {
      aScore++; beep('score'); report(); serve(1);
      if (aScore >= WIN) return autoplay ? (aScore = pScore = 0) : end(false);
    } else if (ball.x > W + R) {
      pScore++; beep('score'); report(); serve(-1);
      if (pScore >= WIN) return autoplay ? (aScore = pScore = 0) : end(true);
    }
  }

  function end(won) {
    running = false;
    // Numeric score keeps the high-score table sortable; the label is what's read.
    host.onGameOver?.(pScore * 100 - aScore, won, label());
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);

    // Everything in one white, as the 1972 screen had nothing else to give.
    ctx.fillStyle = '#F5F2EA';
    for (let y = 4; y < H; y += 16) ctx.fillRect(W / 2 - 2, y, 4, 8);
    ctx.fillRect(0, ai.y, PW, PH);
    ctx.fillRect(W - PW, player.y, PW, PH);

    if (serveWait <= 0 || Math.floor(serveWait / 6) % 2 === 0) {
      ctx.fillStyle = '#F5F2EA';
      ctx.fillRect(ball.x - R, ball.y - R, R * 2, R * 2);
    }

    number(aScore, W / 2 - 40, 'right');
    number(pScore, W / 2 + 40, 'left');
  }

  // Chunky block digits, 3 × 5 cells of 7 px.
  const DIGITS = ['111101101101111', '001001001001001', '111001111100111', '111001111001111', '101101111001001',
    '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
  function number(n, x, align) {
    const s = String(n), cell = 7, w = cell * 3, gap = 8;
    const total = s.length * w + (s.length - 1) * gap;
    let x0 = align === 'right' ? x - total : x;
    for (const ch of s) {
      [...DIGITS[ch]].forEach((bit, i) => {
        if (bit === '1') ctx.fillRect(x0 + (i % 3) * cell, 18 + Math.floor(i / 3) * cell, cell, cell);
      });
      x0 += w + gap;
    }
  }

  const toY = (e) => {
    const b = canvas.getBoundingClientRect();
    return (e.clientY - b.top) * (H / b.height);
  };
  const onMove = (e) => { if (e.pointerType === 'mouse' || e.buttons) aim = toY(e); };
  const onDown = (e) => { e.preventDefault(); aim = toY(e); };
  const onUp = (e) => { if (e.pointerType !== 'mouse') aim = null; };

  // Physics is tuned per 60 Hz frame: step at a fixed rate so a 120 Hz phone doesn't play twice as fast.
  const STEP = 1000 / 60;
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
      pScore = aScore = 0; paused = false; running = true; aim = null;
      if (!autoplay) {
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointerup', onUp);
        canvas.addEventListener('pointercancel', onUp);
      }
      player.y = ai.y = H / 2 - PH / 2;
      serve(autoplay && Math.random() < 0.5 ? -1 : 1);
      report(); draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'up') keys.up = down;
      if (a === 'down') keys.down = down;
      if (down) aim = null;   // a key press takes the paddle back from the mouse
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    },
  };
}
