// Saute-Nuages. The little spirit bounces by itself: you only steer. Climb from cloud to cloud, ride the
// springs, trust the moving ones, and don't linger on a storm cloud — it crumbles under you.
// Portrait playfield; drag a finger (or use ← →) and the spirit slides toward it. The screen wraps at the sides.
export function createGame(canvas, host, opts = {}) {
  canvas.width = 360; canvas.height = 560;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // Platform width, the vertical gap between clouds (grows with height up to gmax), and the mix of special clouds.
  const D = [
    { pw: 76, gap: 52, gmax: 108, moving: 0, crumble: 0, spring: 0.12 },
    { pw: 64, gap: 58, gmax: 124, moving: 0.18, crumble: 0.12, spring: 0.08 },
    { pw: 54, gap: 64, gmax: 138, moving: 0.28, crumble: 0.22, spring: 0.06 },
  ][opts.difficulty ?? 1];

  const G = 0.42, BOUNCE = 11.6, SPRING = 19.2, R = 16;
  const STEP = 1000 / 60;

  const p = { x: W / 2, y: H - 120, vx: 0, vy: -BOUNCE, squash: 0, look: 1 };
  let plats, height, topY, stars, keys, aim;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;

  const rand = (a, b) => a + Math.random() * (b - a);

  function addPlatform(y, forceNormal = false) {
    const roll = Math.random();
    let type = 'n';
    if (!forceNormal) {
      if (roll < D.moving) type = 'm';
      else if (roll < D.moving + D.crumble) type = 'c';
      else if (roll < D.moving + D.crumble + D.spring) type = 's';
    }
    const w = D.pw;
    plats.push({
      x: rand(6, W - w - 6), y, w, type,
      vx: type === 'm' ? (Math.random() < 0.5 ? -1 : 1) * rand(0.9, 1.9 + height / 6000) : 0,
      t: 0,            // crumbling: ms since someone stood on it
    });
    topY = Math.min(topY, y);
  }

  function fill() {
    // Keep clouds coming until there's a screenful above the top edge.
    while (topY > -60) {
      const gap = Math.min(D.gmax, D.gap + height / 90) * rand(0.78, 1);
      addPlatform(topY - gap);
    }
  }

  function update() {
    // Steering: keys accelerate, a finger pulls the spirit toward it.
    if (keys.left || keys.right) {
      p.vx += (keys.right - keys.left) * 0.9;
      p.vx = Math.max(-5.6, Math.min(5.6, p.vx));
      aim = null;
    } else if (aim !== null) {
      p.vx = Math.max(-7, Math.min(7, (aim - p.x) * 0.2));
    } else p.vx *= 0.86;
    if (Math.abs(p.vx) > 0.4) p.look = Math.sign(p.vx);
    p.x += p.vx;
    if (p.x < -R) p.x = W + R; else if (p.x > W + R) p.x = -R;   // the screen wraps

    const prevBottom = p.y + R;
    p.vy += G;
    p.y += p.vy;
    p.squash = Math.max(0, p.squash - 0.06);

    for (const pl of plats) {
      if (pl.type === 'm') {
        pl.x += pl.vx;
        if (pl.x < 0 || pl.x + pl.w > W) pl.vx *= -1;
      }
      if (pl.t > 0) { pl.t += STEP; pl.y += (pl.t / 1000) * 3; }   // a crumbling cloud drops away
      if (pl.t > 900) continue;
      // Land only while falling, and only if the feet crossed the cloud's top this step.
      if (p.vy > 0 && prevBottom <= pl.y + 4 && p.y + R >= pl.y && p.x + R * 0.55 > pl.x && p.x - R * 0.55 < pl.x + pl.w) {
        p.y = pl.y - R;
        p.squash = 1;
        if (pl.type === 's') { p.vy = -SPRING; host.sfx.pickup(); }
        else { p.vy = -BOUNCE; host.sfx.move(); }
        if (pl.type === 'c' && pl.t === 0) { pl.t = 1; host.sfx.hit(); }
      }
    }

    // The camera follows the climb: whatever the spirit gains above the middle scrolls the world down.
    if (p.y < H * 0.42) {
      const dy = H * 0.42 - p.y;
      p.y += dy; height += dy; topY += dy;
      for (const pl of plats) pl.y += dy;
      for (const s of stars) { s.y += dy * s.z; if (s.y > H) { s.y -= H; s.x = Math.random() * W; } }
      const score = Math.floor(height / 10);
      host.onStats({ score, level: 1 + Math.floor(score / 400) });
    }
    plats = plats.filter((pl) => pl.y < H + 40 && pl.t < 1400);
    fill();

    if (p.y - R > H) finish();
  }

  function finish() {
    over = true; running = false;
    draw();
    host.onGameOver(Math.floor(height / 10), false);
  }

  function cloud(x, y, w, tint, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = tint;
    const h = 14;
    ctx.beginPath();
    ctx.moveTo(x + 7, y);
    ctx.arcTo(x + w, y, x + w, y + h, 7);
    ctx.arcTo(x + w, y + h, x, y + h, 7);
    ctx.arcTo(x, y + h, x, y, 7);
    ctx.arcTo(x, y, x + w, y, 7);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + w * 0.3, y + 1, 9, 0, Math.PI * 2);
    ctx.arc(x + w * 0.55, y - 3, 11, 0, Math.PI * 2);
    ctx.arc(x + w * 0.76, y + 1, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.save();
    // The sky darkens toward space as you climb.
    const k = Math.min(1, height / 9000);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgb(${Math.round(24 - 14 * k)},${Math.round(26 - 16 * k)},${Math.round(64 - 30 * k)})`);
    g.addColorStop(1, `rgb(${Math.round(70 - 30 * k)},${Math.round(48 - 20 * k)},${Math.round(110 - 40 * k)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.5 * s.z})`;
      ctx.fillRect(s.x, s.y, s.z * 2 + 1, s.z * 2 + 1);
    }

    for (const pl of plats) {
      if (pl.type === 'c') {
        cloud(pl.x, pl.y, pl.w, '#7A6F8F', pl.t ? Math.max(0, 1 - pl.t / 900) : 1);
        ctx.strokeStyle = '#4A4060'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(pl.x + pl.w * 0.4, pl.y + 2); ctx.lineTo(pl.x + pl.w * 0.47, pl.y + 9); ctx.lineTo(pl.x + pl.w * 0.42, pl.y + 14); ctx.stroke();
      } else if (pl.type === 'm') cloud(pl.x, pl.y, pl.w, '#9FD3FF');
      else cloud(pl.x, pl.y, pl.w, '#F5F5F7');
      if (pl.type === 's') {   // a coil spring standing on the cloud
        ctx.strokeStyle = '#FF4D1F'; ctx.lineWidth = 3;
        const cx = pl.x + pl.w / 2;
        ctx.beginPath();
        ctx.moveTo(cx - 7, pl.y); ctx.lineTo(cx + 7, pl.y - 4); ctx.lineTo(cx - 7, pl.y - 8); ctx.lineTo(cx + 7, pl.y - 12);
        ctx.stroke();
        ctx.fillStyle = '#FF4D1F'; ctx.fillRect(cx - 9, pl.y - 16, 18, 4);
      }
    }

    // The spirit: a round jade body that squashes on landing and stretches as it rises.
    const sx = 1 + p.squash * 0.18 - Math.min(0.12, Math.max(0, -p.vy) / 120);
    const sy = 1 / sx;
    ctx.translate(p.x, p.y);
    ctx.scale(sx, sy);
    ctx.fillStyle = '#12C98C';
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath(); ctx.arc(-5, -6, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#F5F5F7';
    for (const dx of [-5, 6]) { ctx.beginPath(); ctx.arc(dx + p.look * 2, -3, 4.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#0A0A0C';
    for (const dx of [-5, 6]) { ctx.beginPath(); ctx.arc(dx + p.look * 3.4, -3, 2.2, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#0B7A55';
    ctx.fillRect(-9, R - 3, 6, 5); ctx.fillRect(3, R - 3, 6, 5);   // feet
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '700 15px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(`${Math.floor(height / 10)} m`, 12, 10);
    ctx.textBaseline = 'alphabetic';
  }

  function loop(t) {
    if (!running) return;
    acc = paused ? 0 : acc + Math.min(100, last ? t - last : STEP);
    last = t;
    for (; acc >= STEP && running; acc -= STEP) update();
    if (running && !paused) draw();
    rafId = requestAnimationFrame(loop);
  }

  const toX = (e) => { const b = canvas.getBoundingClientRect(); return (e.clientX - b.left) * (W / b.width); };
  const onMove = (e) => { if (e.pointerType === 'mouse' || e.buttons) aim = toX(e); };   // a mouse just hovers; a finger must be down
  const onDown = (e) => { e.preventDefault(); aim = toX(e); };
  const onUp = (e) => { if (e.pointerType !== 'mouse') aim = null; };

  return {
    start() {
      plats = []; height = 0; topY = H - 30;
      stars = Array.from({ length: 46 }, () => ({ x: Math.random() * W, y: Math.random() * H, z: Math.random() }));
      keys = { left: 0, right: 0 }; aim = null;
      p.x = W / 2; p.y = H - 120; p.vx = 0; p.vy = -BOUNCE; p.squash = 0; p.look = 1;
      addPlatform(H - 70, true);
      plats[0].x = W / 2 - plats[0].w / 2;
      fill();
      paused = false; running = true; over = false; last = 0; acc = 0;
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      host.onStats({ score: 0, level: 1 });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'left') keys.left = down ? 1 : 0;
      if (a === 'right') keys.right = down ? 1 : 0;
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
