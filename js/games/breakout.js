// Breakout. Paddle angle control, multi-hit bricks, falling power-ups, multi-ball.
const INKS = ['#FF4D1F', '#FFB020', '#12C98C', '#4EA8FF', '#9D6BFF'];

export function createGame(canvas, host, opts = {}) {
  // Difficulty: paddle width, serve speed, and how many balls you get.
  const D = [
    { pw: 104, speed: 3.9, lives: 5 },
    { pw: 76, speed: 4.4, lives: 3 },
    { pw: 58, speed: 5.2, lives: 2 },
  ][opts.difficulty ?? 1];

  canvas.width = 480; canvas.height = 380;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const BW = 44, BH = 16, COLS = 10, TOP = 46, PAD_Y = H - 26;
  const R = 5;

  let paddle, balls, bricks, drops, score, level, lives, stuck;
  let paused = false, running = false, rafId = null, last = 0, acc = 0, over = false;
  const keys = { left: false, right: false };

  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function newBall(x, y, vx, vy) {
    return { x, y, vx, vy, r: R };
  }

  function makeBricks() {
    bricks = [];
    const rows = Math.min(6, 3 + Math.floor(level / 2));
    const x0 = (W - COLS * BW) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        // Sturdier bricks toward the top, so clearing works downward.
        if (level > 2 && (r + c) % 7 === 0 && r < 2) continue;
        const hp = r === 0 && level > 1 ? 3 : r < 2 ? 2 : 1;
        bricks.push({ x: x0 + c * BW, y: TOP + r * BH, w: BW - 3, h: BH - 3, hp, ink: INKS[r % INKS.length] });
      }
    }
  }

  function resetBall() {
    stuck = true;
    balls = [newBall(paddle.x + paddle.w / 2, PAD_Y - R - 2, 0, 0)];
  }

  function launch() {
    if (!stuck) return;
    stuck = false;
    balls[0].vx = (Math.random() < 0.5 ? -1 : 1) * (D.speed * 0.6);
    balls[0].vy = -D.speed;
    host.sfx.shoot();
  }

  function finish(won) {
    if (over) return;
    over = true; running = false;
    host.sfx[won ? 'win' : 'gameover']();
    host.onGameOver(score, won);
  }

  function loseLife() {
    lives--;
    host.sfx.hit();
    host.onStats({ lives });
    if (lives <= 0) return finish(false);
    paddle.w = D.pw;
    resetBall();
  }

  function nextLevel() {
    level++;
    score += 200;
    host.sfx.win();
    host.onStats({ score, level });
    makeBricks();
    drops = [];
    resetBall();
  }

  function bounceOffPaddle(b) {
    // Where it lands on the paddle sets the angle — the whole skill of the game.
    const rel = (b.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
    const speed = Math.min(Math.hypot(b.vx, b.vy) * 1.02, 8.5);
    const ang = Math.max(-1, Math.min(1, rel)) * 1.05;
    b.vx = Math.sin(ang) * speed;
    b.vy = -Math.abs(Math.cos(ang) * speed);
    b.y = PAD_Y - b.r - 1;
    host.sfx.move();
  }

  function update() {
    if (keys.left) paddle.x -= 7;
    if (keys.right) paddle.x += 7;
    paddle.x = Math.max(0, Math.min(W - paddle.w, paddle.x));

    if (stuck) {
      balls[0].x = paddle.x + paddle.w / 2;
      balls[0].y = PAD_Y - R - 2;
    }

    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      // Step in slices: at 8px/frame a 16px brick can be skipped entirely.
      const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) / 3));
      for (let s = 0; s < steps; s++) {
        b.x += b.vx / steps;
        b.y += b.vy / steps;

        if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx); }
        else if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx); }
        if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy); }

        const box = { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 };
        if (b.vy > 0 && hit(box, { x: paddle.x, y: PAD_Y, w: paddle.w, h: 10 })) bounceOffPaddle(b);

        for (let j = bricks.length - 1; j >= 0; j--) {
          const k = bricks[j];
          if (!hit(box, k)) continue;
          // Resolve on the shallower overlap so corners don't flip the wrong axis.
          const ox = Math.min(box.x + box.w - k.x, k.x + k.w - box.x);
          const oy = Math.min(box.y + box.h - k.y, k.y + k.h - box.y);
          if (ox < oy) b.vx = -b.vx; else b.vy = -b.vy;
          k.hp--;
          score += 10;
          host.sfx.hit();
          if (k.hp <= 0) {
            score += 15;
            if (Math.random() < 0.12) {
              drops.push({ x: k.x + k.w / 2 - 8, y: k.y, w: 16, h: 10, kind: ['wide', 'multi', 'life'][(Math.random() * 3) | 0] });
            }
            bricks.splice(j, 1);
          }
          host.onStats({ score });
          break;
        }
      }

      if (b.y - b.r > H) {
        balls.splice(i, 1);
        if (!balls.length) { loseLife(); return; }
      }
    }

    drops.forEach((d) => { d.y += 2.2; });
    drops = drops.filter((d) => {
      if (hit(d, { x: paddle.x, y: PAD_Y, w: paddle.w, h: 10 })) {
        if (d.kind === 'wide') paddle.w = Math.min(130, paddle.w + 26);
        else if (d.kind === 'life') { lives++; host.onStats({ lives }); }
        else {
          const src = balls[0];
          balls.push(newBall(src.x, src.y, -src.vy * 0.6, -Math.abs(src.vy)));
          balls.push(newBall(src.x, src.y, src.vy * 0.6, -Math.abs(src.vy)));
        }
        score += 40;
        host.onStats({ score });
        host.sfx.pickup();
        return false;
      }
      return d.y < H;
    });

    if (!bricks.length) nextLevel();
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);

    bricks.forEach((k) => {
      ctx.globalAlpha = k.hp === 1 ? 0.62 : k.hp === 2 ? 0.82 : 1;
      ctx.fillStyle = k.ink;
      ctx.fillRect(k.x, k.y, k.w, k.h);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(k.x, k.y, k.w, 2);
      ctx.globalAlpha = 1;
    });

    drops.forEach((d) => {
      ctx.fillStyle = d.kind === 'life' ? '#FF4D1F' : d.kind === 'wide' ? '#4EA8FF' : '#FFB020';
      ctx.fillRect(d.x, d.y, d.w, d.h);
    });

    ctx.fillStyle = '#4EA8FF';
    ctx.fillRect(paddle.x, PAD_Y, paddle.w, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(paddle.x, PAD_Y, paddle.w, 2);

    ctx.fillStyle = '#F5F2EA';
    balls.forEach((b) => ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2));

    if (stuck) {
      ctx.font = '600 11px ui-monospace, Consolas, monospace';
      ctx.fillStyle = '#8E8A98';
      ctx.textAlign = 'center';
      ctx.fillText('ESPACE POUR LANCER', W / 2, PAD_Y - 34);
      ctx.textAlign = 'start';
    }
  }

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
      score = 0; level = 1; lives = D.lives; drops = [];
      paused = false; running = true; over = false; last = 0;
      makeBricks();
      resetBall();
      host.onStats({ score, level, lives });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'left') keys.left = down;
      if (a === 'right') keys.right = down;
      if ((a === 'action' || a === 'up') && down) launch();
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
