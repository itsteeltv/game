// Brick wall in the 1976 mould: eight rows in four colours worth 1, 3, 5 and 7,
// a ball that speeds up after 4 and 12 hits and on first touching the orange and
// red rows, and a paddle that halves once you break through to the back wall.
// The paddle follows a finger or the mouse — the closest thing to the original knob.
const ROWS = [
  { ink: '#FF4D1F', pts: 7 }, { ink: '#FF4D1F', pts: 7 },
  { ink: '#FF8A3D', pts: 5 }, { ink: '#FF8A3D', pts: 5 },
  { ink: '#12C98C', pts: 3 }, { ink: '#12C98C', pts: 3 },
  { ink: '#FFD34E', pts: 1 }, { ink: '#FFD34E', pts: 1 },
];
const COLS = 14;

export function createGame(canvas, host, opts = {}) {
  // Difficulty: paddle width, base speed, and how many balls you get.
  const D = [
    { pw: 84, speed: 3.4, lives: 5 },
    { pw: 64, speed: 3.9, lives: 3 },
    { pw: 52, speed: 4.5, lives: 2 },
  ][opts.difficulty ?? 1];

  canvas.width = 480; canvas.height = 380;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const WALL = 12, TOP = 64, BW = (W - WALL * 2) / COLS, BH = 11, PAD_Y = H - 30, R = 4;

  let paddle, ball, bricks, score, level, lives, stuck, serveT;
  let hits, speedSteps, touchedOrange, touchedRed, shrunk, aim;
  let paused = false, running = false, rafId = null, last = 0, acc = 0, over = false;
  const keys = { left: false, right: false };

  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function makeBricks() {
    bricks = [];
    ROWS.forEach((row, r) => {
      for (let c = 0; c < COLS; c++) {
        bricks.push({ x: WALL + c * BW + 1, y: TOP + r * (BH + 2), w: BW - 2, h: BH, ...row, r });
      }
    });
  }

  // Four speed steps on top of the base — the whole difficulty curve of the original.
  const speed = () => (D.speed + speedSteps * 0.75) * (1 + (level - 1) * 0.08);
  function faster() {
    speedSteps++;
    const k = speed() / Math.hypot(ball.vx, ball.vy);
    ball.vx *= k; ball.vy *= k;
  }

  function resetBall() {
    stuck = true;
    serveT = 0;
    hits = 0; speedSteps = 0; touchedOrange = false; touchedRed = false;
    ball = { x: paddle.x + paddle.w / 2, y: PAD_Y - R - 2, vx: 0, vy: 0 };
  }

  function launch() {
    if (!stuck || !running) return;
    stuck = false;
    const a = (Math.random() * 0.8 - 0.4);
    ball.vx = Math.sin(a) * speed();
    ball.vy = -Math.cos(a) * speed();
    host.sfx.shoot();
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function loseBall() {
    lives--;
    host.sfx.hit();
    host.onStats({ lives });
    if (lives <= 0) return finish();
    resetBall();
  }

  function bounceOffPaddle() {
    // Where it lands on the paddle sets the angle — the whole skill of the game.
    const rel = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
    const ang = Math.max(-1, Math.min(1, rel)) * 1.05;
    const s = speed();
    ball.vx = Math.sin(ang) * s;
    ball.vy = -Math.abs(Math.cos(ang) * s);
    ball.y = PAD_Y - R - 1;
    host.tone?.({ freq: 440, duration: 0.04, type: 'square', gain: 0.1 });
  }

  function update() {
    if (aim !== null) paddle.x = aim - paddle.w / 2;
    if (keys.left) paddle.x -= 6;
    if (keys.right) paddle.x += 6;
    paddle.x = Math.max(WALL, Math.min(W - WALL - paddle.w, paddle.x));

    if (stuck) {
      ball.x = paddle.x + paddle.w / 2;
      ball.y = PAD_Y - R - 2;
      if ((serveT += 1) > 150) launch();   // serves itself after a beat, like the cabinet
      return;
    }

    // Step in slices: a fast ball must not skip a thin brick.
    const steps = Math.max(1, Math.ceil(Math.hypot(ball.vx, ball.vy) / 2.5));
    for (let s = 0; s < steps; s++) {
      ball.x += ball.vx / steps;
      ball.y += ball.vy / steps;

      if (ball.x - R < WALL) { ball.x = WALL + R; ball.vx = Math.abs(ball.vx); host.tone?.({ freq: 220, duration: 0.03, gain: 0.06 }); }
      else if (ball.x + R > W - WALL) { ball.x = W - WALL - R; ball.vx = -Math.abs(ball.vx); host.tone?.({ freq: 220, duration: 0.03, gain: 0.06 }); }
      if (ball.y - R < WALL + 14) {
        ball.y = WALL + 14 + R; ball.vy = Math.abs(ball.vy);
        // Broke through to the back wall: the paddle halves until the next wall.
        if (!shrunk) { shrunk = true; paddle.w = Math.round(paddle.w / 2); paddle.x += paddle.w / 2; }
      }

      const box = { x: ball.x - R, y: ball.y - R, w: R * 2, h: R * 2 };
      if (ball.vy > 0 && hit(box, { x: paddle.x, y: PAD_Y, w: paddle.w, h: 8 })) bounceOffPaddle();

      const k = bricks.findIndex((b) => hit(box, b));
      if (k >= 0) {
        const b = bricks[k];
        const ox = Math.min(box.x + box.w - b.x, b.x + b.w - box.x);
        const oy = Math.min(box.y + box.h - b.y, b.y + b.h - box.y);
        if (ox < oy) ball.vx = -ball.vx; else ball.vy = -ball.vy;
        bricks.splice(k, 1);
        score += b.pts;
        host.onStats({ score });
        host.tone?.({ freq: 300 + (7 - b.r) * 70, duration: 0.05, type: 'square', gain: 0.1 });
        hits++;
        if (hits === 4 || hits === 12) faster();
        if (b.pts === 5 && !touchedOrange) { touchedOrange = true; faster(); }
        if (b.pts === 7 && !touchedRed) { touchedRed = true; faster(); }
        break;
      }
    }

    if (ball.y - R > H) return loseBall();

    if (!bricks.length) {
      level++;
      host.sfx.win();
      host.onStats({ level });
      makeBricks();
      paddle.w = D.pw; shrunk = false;
      resetBall();
    }
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);

    // Grey walls on three sides, as on the cabinet.
    ctx.fillStyle = '#8E8A98';
    ctx.fillRect(0, 14, WALL, H);
    ctx.fillRect(W - WALL, 14, WALL, H);
    ctx.fillRect(0, 14, W, WALL);

    bricks.forEach((b) => {
      ctx.fillStyle = b.ink;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    });

    // The paddle carries the colour film of the bottom of the screen.
    ctx.fillStyle = '#4EA8FF';
    ctx.fillRect(paddle.x, PAD_Y, paddle.w, 8);

    ctx.fillStyle = '#F5F2EA';
    ctx.fillRect(ball.x - R, ball.y - R, R * 2, R * 2);

    ctx.font = '700 12px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#8E8A98';
    ctx.fillText(`BALLES ${lives}`, WALL, 11);
    ctx.textAlign = 'right';
    ctx.fillText(String(score).padStart(3, '0'), W - WALL, 11);
    ctx.textAlign = 'start';
  }

  // Finger or mouse: the paddle sits under the pointer.
  const toX = (e) => {
    const b = canvas.getBoundingClientRect();
    return (e.clientX - b.left) * (W / b.width);
  };
  const onMove = (e) => { if (e.pointerType === 'mouse' || e.buttons) aim = toX(e); };
  const onDown = (e) => { e.preventDefault(); aim = toX(e); launch(); };
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
      paddle = { x: W / 2 - D.pw / 2, w: D.pw };
      score = 0; level = 1; lives = D.lives; shrunk = false; aim = null;
      paused = false; running = true; over = false; last = 0;
      makeBricks();
      resetBall();
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      host.onStats({ score, level, lives });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'left') { keys.left = down; if (down) aim = null; }
      if (a === 'right') { keys.right = down; if (down) aim = null; }
      if ((a === 'action' || a === 'up') && down) launch();
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
