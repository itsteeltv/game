// One-button flyer. Tap to flap, thread the gaps, don't touch anything.
export function createGame(canvas, host, opts = {}) {
  canvas.width = 480; canvas.height = 380;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const GROUND = H - 22;

  // Easy: a wide gap and a gentle fall. Hard: narrow, fast, and it keeps tightening.
  const D = [
    { gap: 132, speed: 1.9, grav: 0.34, flap: -6.0, every: 250, tighten: 1.1 },
    { gap: 108, speed: 2.4, grav: 0.42, flap: -6.6, every: 215, tighten: 1.7 },
    { gap: 90, speed: 3.0, grav: 0.50, flap: -7.2, every: 185, tighten: 2.3 },
  ][opts.difficulty ?? 1];

  let bird, pipes, score, level, best, spawnX, started;
  let paused = false, running = false, rafId = null, over = false, shake;

  function addPipe() {
    const gap = Math.max(66, D.gap - score * D.tighten * 0.35);
    const margin = 44;
    const top = margin + Math.random() * (GROUND - gap - margin * 2);
    pipes.push({ x: W + 30, w: 46, top, bottom: top + gap, passed: false });
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function flap() {
    if (!running || paused) return;
    started = true;
    bird.vy = D.flap;
    bird.rot = -0.5;
    host.sfx.shoot();
  }

  function update() {
    if (!started) return;     // hovers until the first flap, so nobody dies on load

    bird.vy += D.grav;
    bird.y += bird.vy;
    bird.rot = Math.max(-0.6, Math.min(1.2, bird.rot + 0.045));
    if (shake > 0) shake--;

    spawnX -= D.speed;
    if (spawnX <= 0) { addPipe(); spawnX = D.every; }

    pipes.forEach((p) => { p.x -= D.speed; });
    pipes = pipes.filter((p) => p.x + p.w > -10);

    if (bird.y + bird.r > GROUND) { bird.y = GROUND - bird.r; host.sfx.hit(); return finish(); }
    if (bird.y - bird.r < 0) { bird.y = bird.r; bird.vy = 0; }

    for (const p of pipes) {
      const inX = bird.x + bird.r > p.x && bird.x - bird.r < p.x + p.w;
      if (inX && (bird.y - bird.r < p.top || bird.y + bird.r > p.bottom)) {
        shake = 10;
        host.sfx.hit();
        return finish();
      }
      if (!p.passed && p.x + p.w < bird.x - bird.r) {
        p.passed = true;
        score++;
        level = 1 + Math.floor(score / 5);
        host.sfx.score();
        host.onStats({ score, level });
      }
    }
  }

  function draw() {
    const sx = shake > 0 ? (Math.random() - 0.5) * 5 : 0;
    ctx.save();
    ctx.translate(sx, 0);

    ctx.fillStyle = '#08070A';
    ctx.fillRect(-6, 0, W + 12, H);

    // Parallax ticks so the speed is readable even between pipes.
    ctx.fillStyle = '#17151C';
    for (let i = 0; i < 18; i++) {
      const x = ((i * 53 - (performance.now() * D.speed * 0.02)) % (W + 60) + W + 60) % (W + 60) - 30;
      ctx.fillRect(x, 40 + (i % 5) * 58, 18, 3);
    }

    pipes.forEach((p) => {
      ctx.fillStyle = '#12C98C';
      ctx.fillRect(p.x, 0, p.w, p.top);
      ctx.fillRect(p.x, p.bottom, p.w, GROUND - p.bottom);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(p.x, p.top - 10, p.w, 3);
      ctx.fillRect(p.x, p.bottom + 7, p.w, 3);
    });

    ctx.fillStyle = '#241F2C';
    ctx.fillRect(0, GROUND, W, H - GROUND);

    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);
    ctx.fillStyle = '#FFB020';
    ctx.fillRect(-bird.r, -bird.r, bird.r * 2, bird.r * 2);
    ctx.fillStyle = '#08070A';
    ctx.fillRect(2, -5, 4, 4);
    ctx.fillStyle = '#FF8A3D';
    ctx.fillRect(-bird.r - 4, -1, 5, 6);
    ctx.restore();

    ctx.font = '600 34px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(245,242,234,0.26)';
    ctx.fillText(String(score), W / 2, 56);

    if (!started) {
      ctx.font = '600 11px ui-monospace, Consolas, monospace';
      ctx.fillStyle = '#8E8A98';
      ctx.fillText('ESPACE POUR BATTRE DES AILES', W / 2, H / 2 + 60);
    }
    ctx.textAlign = 'start';
    ctx.restore();
  }

  function loop() {
    if (!running) return;
    if (!paused) { update(); if (running) draw(); }
    rafId = requestAnimationFrame(loop);
  }

  const onPointer = (e) => { e.preventDefault(); flap(); };

  return {
    start() {
      bird = { x: 130, y: H / 2, vy: 0, r: 9, rot: 0 };
      pipes = []; score = 0; level = 1; spawnX = 120; started = false; shake = 0;
      paused = false; running = true; over = false;
      canvas.addEventListener('pointerdown', onPointer);
      host.onStats({ score, level });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (down && (a === 'action' || a === 'up')) flap();
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onPointer);
    },
  };
}
