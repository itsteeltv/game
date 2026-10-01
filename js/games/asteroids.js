// Vector shooter in the 1979 mould: a ship that turns and thrusts with inertia on
// a wrap-around screen, rocks that split in three sizes, a saucer that shoots
// back, hyperspace as a last resort and a two-note heartbeat that quickens as
// the field thins. Drawn as glowing lines, the way a vector monitor drew them.
export function createGame(canvas, host, opts = {}) {
  // Difficulty: spare ships, rock speed, how often (and how well) the saucer fires.
  const D = [
    { lives: 5, rock: 0.75, ufoFire: 1500, aim: 0.25 },
    { lives: 3, rock: 1, ufoFire: 1100, aim: 0.5 },
    { lives: 2, rock: 1.3, ufoFire: 800, aim: 0.8 },
  ][opts.difficulty ?? 1];

  canvas.width = 480; canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const SIZES = [0, 9, 18, 34];          // radius by size class 1..3
  const POINTS = [0, 100, 50, 20];       // small rocks are worth the most

  let ship, bullets, rocks, ufo, ufoShots, debris, score, level, lives, extraNext;
  let beatT, beatHi, waveT, ufoT, keys, respawn;
  let paused = false, running = false, rafId = null, last = 0, over = false;

  const wrapX = (x) => (x + W) % W, wrapY = (y) => (y + H) % H;
  const dist2 = (a, b) => {
    const dx = Math.min(Math.abs(a.x - b.x), W - Math.abs(a.x - b.x));
    const dy = Math.min(Math.abs(a.y - b.y), H - Math.abs(a.y - b.y));
    return dx * dx + dy * dy;
  };

  function rock(x, y, size) {
    const a = Math.random() * Math.PI * 2, sp = (0.5 + Math.random() * (1.4 - size * 0.25)) * D.rock * (1 + level * 0.05);
    const n = 9 + ((Math.random() * 3) | 0);
    return {
      x, y, size, r: SIZES[size], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.03,
      shape: Array.from({ length: n }, (_, i) => ({ a: (i / n) * Math.PI * 2, k: 0.72 + Math.random() * 0.32 })),
    };
  }

  function newWave() {
    rocks = [];
    const n = Math.min(11, 3 + level);
    for (let i = 0; i < n; i++) {
      // Spawn on the edges, never on top of the ship.
      const edge = Math.random() < 0.5;
      rocks.push(rock(edge ? Math.random() * W : (Math.random() < 0.5 ? 0 : W - 1), edge ? (Math.random() < 0.5 ? 0 : H - 1) : Math.random() * H, 3));
    }
    waveT = 0;
  }

  function newShip() {
    ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, inv: 120, thrust: false, hyper: 0 };
  }

  function addScore(n) {
    score += n;
    if (score >= extraNext) { extraNext += 10000; lives++; host.onStats({ lives }); host.sfx.pickup(); }
    host.onStats({ score });
  }

  function burst(x, y, n, ink = '#F5F2EA') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 2.2;
      debris.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 30 + Math.random() * 30, ink });
    }
  }

  function splitRock(i) {
    const r = rocks[i];
    rocks.splice(i, 1);
    burst(r.x, r.y, 6 + r.size * 3);
    host.tone?.({ freq: [0, 140, 90, 60][r.size], duration: 0.18, type: 'sawtooth', gain: 0.14 });
    if (r.size > 1) for (let k = 0; k < 2; k++) {
      const c = rock(r.x, r.y, r.size - 1);
      rocks.push(c);
    }
  }

  function killShip() {
    burst(ship.x, ship.y, 22, '#9FB0C9');
    host.sfx.hit();
    lives--;
    host.onStats({ lives });
    ship = null;
    if (lives <= 0) { respawn = 90; return; }
    respawn = 120;
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function fire() {
    if (!ship || ship.hyper > 0 || bullets.length >= 4) return;
    const c = Math.cos(ship.a), s = Math.sin(ship.a);
    bullets.push({ x: ship.x + c * 12, y: ship.y + s * 12, vx: c * 7 + ship.vx, vy: s * 7 + ship.vy, t: 52 });
    host.tone?.({ freq: 880, duration: 0.05, type: 'square', gain: 0.07 });
  }

  function hyperspace() {
    if (!ship || ship.hyper > 0) return;
    ship.hyper = 40;   // gone for a moment, back somewhere random — maybe somewhere worse
    ship.vx = ship.vy = 0;
    host.sfx.move();
  }

  function update() {
    debris.forEach((d) => { d.x += d.vx; d.y += d.vy; d.t--; });
    debris = debris.filter((d) => d.t > 0);

    if (!ship) {
      if (--respawn <= 0) {
        if (lives <= 0) return finish();
        // Wait for a clear centre before bringing the ship back.
        const centre = { x: W / 2, y: H / 2 };
        if (!rocks.some((r) => dist2(r, centre) < (r.r + 60) ** 2)) newShip(); else respawn = 10;
      }
    } else if (ship.hyper > 0) {
      if (--ship.hyper === 0) {
        ship.x = Math.random() * W; ship.y = Math.random() * H;
        if (Math.random() < 0.08 + rocks.length * 0.006) { killShip(); return; }
      }
    } else {
      if (keys.left) ship.a -= 0.075;
      if (keys.right) ship.a += 0.075;
      ship.thrust = keys.up;
      if (keys.up) {
        ship.vx += Math.cos(ship.a) * 0.11;
        ship.vy += Math.sin(ship.a) * 0.11;
        const sp = Math.hypot(ship.vx, ship.vy);
        if (sp > 5.5) { ship.vx *= 5.5 / sp; ship.vy *= 5.5 / sp; }
      }
      ship.vx *= 0.991; ship.vy *= 0.991;   // a little drag, or nobody could ever stop
      ship.x = wrapX(ship.x + ship.vx); ship.y = wrapY(ship.y + ship.vy);
      if (ship.inv > 0) ship.inv--;
    }

    bullets.forEach((b) => { b.x = wrapX(b.x + b.vx); b.y = wrapY(b.y + b.vy); b.t--; });
    bullets = bullets.filter((b) => b.t > 0);
    rocks.forEach((r) => { r.x = wrapX(r.x + r.vx); r.y = wrapY(r.y + r.vy); r.rot += r.spin; });

    // Bullets against rocks and saucer.
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const k = rocks.findIndex((r) => dist2(r, b) < r.r * r.r);
      if (k >= 0) { addScore(POINTS[rocks[k].size]); splitRock(k); bullets.splice(i, 1); continue; }
      if (ufo && dist2(ufo, b) < 12 * 12) {
        addScore(ufo.small ? 1000 : 200);
        burst(ufo.x, ufo.y, 18, '#FF4D1F');
        host.sfx.win();
        ufo = null; bullets.splice(i, 1);
      }
    }

    // The ship against rocks, saucer and its shots.
    if (ship && ship.hyper === 0 && ship.inv <= 0) {
      const k = rocks.findIndex((r) => dist2(r, ship) < (r.r + 7) ** 2);
      if (k >= 0) { addScore(POINTS[rocks[k].size]); splitRock(k); killShip(); }
      else if (ufo && dist2(ufo, ship) < 18 * 18) { burst(ufo.x, ufo.y, 18, '#FF4D1F'); ufo = null; killShip(); }
      else if (ufoShots.some((s) => dist2(s, ship) < 8 * 8)) { ufoShots = []; killShip(); }
    }

    // Saucer: crosses with a zigzag, shoots — the small one aims.
    ufoT--;
    if (!ufo && ufoT <= 0) {
      const small = score > 4000 && Math.random() < 0.5 + level * 0.05;
      const dir = Math.random() < 0.5 ? 1 : -1;
      ufo = { x: dir > 0 ? 0 : W, y: 40 + Math.random() * (H - 80), dir, small, fire: D.ufoFire, zig: 0 };
      ufoT = Math.max(500, 1100 + Math.random() * 600 - level * 40);   // next one counts from this one
    }
    if (ufo) {
      ufo.x += ufo.dir * (ufo.small ? 1.9 : 1.3);
      if ((ufo.zig += 1) % 90 === 0) ufo.vy = (Math.random() - 0.5) * 2.4;
      ufo.y = wrapY(ufo.y + (ufo.vy || 0));
      if (Math.floor(ufo.zig / 9) % 2) host.tone?.({ freq: ufo.small ? 1200 : 700, duration: 0.03, type: 'square', gain: 0.025 });
      if ((ufo.fire -= 16) <= 0) {
        ufo.fire = D.ufoFire;
        let a = Math.random() * Math.PI * 2;
        if (ship && (ufo.small || Math.random() < D.aim)) a = Math.atan2(ship.y - ufo.y, ship.x - ufo.x) + (Math.random() - 0.5) * (ufo.small ? 0.2 : 0.7);
        ufoShots.push({ x: ufo.x, y: ufo.y, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, t: 70 });
      }
      if (ufo.x < -20 || ufo.x > W + 20) { ufo = null; }
    }
    ufoShots.forEach((s) => { s.x = wrapX(s.x + s.vx); s.y = wrapY(s.y + s.vy); s.t--; });
    ufoShots = ufoShots.filter((s) => s.t > 0 && !rocks.some((r) => dist2(r, s) < r.r * r.r));

    // The heartbeat: two low notes, closer together as fewer rocks remain.
    beatT--;
    if (beatT <= 0 && (ship || lives > 0)) {
      beatT = Math.max(14, 60 - Math.max(0, 26 - rocks.length) * 2 - (waveT / 600) * 10);
      beatHi = !beatHi;
      host.tone?.({ freq: beatHi ? 62 : 55, duration: 0.11, type: 'square', gain: 0.18 });
    }
    waveT++;

    if (!rocks.length && !ufo) {
      level++;
      host.sfx.clear();
      host.onStats({ level });
      newWave();
    }
  }

  /* --- Vector drawing ----------------------------------------------------- */

  function lines(points, close = true) {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (close) ctx.closePath();
    ctx.stroke();
  }

  // Draw a shape at x,y and again across the edges it straddles, so wrapping is seamless.
  function wrapped(x, y, r, fn) {
    const xs = [0], ys = [0];
    if (x < r) xs.push(W); else if (x > W - r) xs.push(-W);
    if (y < r) ys.push(H); else if (y > H - r) ys.push(-H);
    for (const ox of xs) for (const oy of ys) fn(x + ox, y + oy);
  }

  function drawShip(x, y, a, flame) {
    const pt = (d, ang) => [x + Math.cos(a + ang) * d, y + Math.sin(a + ang) * d];
    lines([pt(13, 0), pt(10, 2.5), pt(5, Math.PI), pt(10, -2.5)]);
    if (flame) lines([pt(7, 2.8), pt(14 + Math.random() * 4, Math.PI), pt(7, -2.8)], false);
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 6;                       // phosphor bloom
    ctx.shadowColor = 'rgba(200, 220, 255, 0.8)';
    ctx.strokeStyle = '#E8EEFF';

    rocks.forEach((r) => wrapped(r.x, r.y, r.r, (x, y) => {
      lines(r.shape.map((p) => [x + Math.cos(p.a + r.rot) * r.r * p.k, y + Math.sin(p.a + r.rot) * r.r * p.k]));
    }));

    if (ship && ship.hyper === 0 && (ship.inv <= 0 || Math.floor(ship.inv / 6) % 2 === 0)) {
      wrapped(ship.x, ship.y, 14, (x, y) => drawShip(x, y, ship.a, ship.thrust && Math.random() < 0.8));
    }

    if (ufo) {
      ctx.strokeStyle = '#FF8A6E';
      ctx.shadowColor = 'rgba(255, 90, 60, 0.8)';
      const k = ufo.small ? 0.6 : 1, { x, y } = ufo;
      lines([[x - 16 * k, y], [x - 7 * k, y - 5 * k], [x + 7 * k, y - 5 * k], [x + 16 * k, y], [x + 7 * k, y + 5 * k], [x - 7 * k, y + 5 * k]]);
      lines([[x - 16 * k, y], [x + 16 * k, y]], false);
      lines([[x - 5 * k, y - 5 * k], [x - 3 * k, y - 10 * k], [x + 3 * k, y - 10 * k], [x + 5 * k, y - 5 * k]], false);
    }

    ctx.fillStyle = '#FFFFFF';
    bullets.forEach((b) => ctx.fillRect(b.x - 1.2, b.y - 1.2, 2.4, 2.4));
    ctx.fillStyle = '#FF8A6E';
    ufoShots.forEach((s) => ctx.fillRect(s.x - 1.2, s.y - 1.2, 2.4, 2.4));
    debris.forEach((d) => {
      ctx.globalAlpha = Math.min(1, d.t / 30);
      ctx.fillStyle = d.ink;
      ctx.fillRect(d.x, d.y, 1.6, 1.6);
    });
    ctx.globalAlpha = 1;

    // Score and spare ships, top left, in the same thin line.
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(200, 220, 255, 0.8)';
    ctx.strokeStyle = '#E8EEFF';
    ctx.font = '500 18px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#E8EEFF';
    ctx.fillText(String(score).padStart(2, '0'), 14, 26);
    for (let i = 0; i < Math.min(lives - (ship ? 1 : 0), 8); i++) drawShip(20 + i * 14, 42, -Math.PI / 2, false);
    ctx.shadowBlur = 0;
  }

  // Physics is tuned per 60 Hz frame: step at a fixed rate so a 120 Hz phone doesn't play twice as fast.
  const STEP = 1000 / 60;
  let acc = 0;
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
      score = 0; level = 1; lives = D.lives; extraNext = 10000;
      bullets = []; ufoShots = []; debris = []; ufo = null; ufoT = 1200; beatT = 30; beatHi = false; respawn = 0;
      keys = { left: false, right: false, up: false };
      paused = false; running = true; over = false; last = 0; acc = 0;
      newShip();
      newWave();
      host.onStats({ score, level, lives });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'left' || a === 'right' || a === 'up') keys[a] = down;
      if (a === 'action' && down) fire();
      if ((a === 'down' || a === 'hold') && down) hyperspace();
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
