// Flipper. A real little pinball table: gravity, two flippers you time yourself,
// bumpers that pay, and a drain that never forgives. Portrait by nature.
const W = 340, H = 520;
const R = 7;                 // ball radius
const STEP = 1000 / 60;      // physics is tuned per 60 Hz frame

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Easy: a lazy ball, long flippers, four balls. Hard: heavy, short, three.
  const D = [
    { grav: 0.13, balls: 4, flip: 0.46, arm: 62, bounce: 0.82, mult: 1, gap: 10 },
    { grav: 0.16, balls: 3, flip: 0.42, arm: 56, bounce: 0.78, mult: 2, gap: 16 },
    { grav: 0.20, balls: 3, flip: 0.38, arm: 50, bounce: 0.74, mult: 3, gap: 22 },
  ][opts.difficulty ?? 1];

  // The drain is the difficulty: the flipper pivots are placed so the gap between the
  // two tips at rest is `gap` wide — one ball on facile, three on difficile.
  const REST = 0.46;
  const PIV = W / 2 - D.gap / 2 - D.arm * Math.cos(REST);

  // --- Table geometry ------------------------------------------------------
  // Walls are segments; the ball is pushed out of whatever it touches.
  const WALLS = [
    [[14, 60], [14, 380]], [[W - 14, 60], [W - 14, 380]],          // sides
    [[14, 60], [60, 18]], [[W - 14, 60], [W - 60, 18]],            // shoulders
    [[60, 18], [W - 60, 18]],                                      // roof
    [[14, 380], [PIV - 6, 448]], [[W - 14, 386], [W - PIV + 6, 448]],  // the funnel onto the flippers
    [[W - 32, 70], [W - 32, 386]], [[W - 32, 386], [W - 14, 386]], // the launch lane and its floor
  ];
  // The gate at the top of the lane: a flap the ball pushes open going up and
  // cannot fall back through. Without it the ball just rides the lane back down.
  const GATE = [[W - 33, 68], [W - 14, 68]];
  const BUMPERS = [
    { x: 100, y: 138, r: 20, pts: 100, lit: 0 },
    { x: 232, y: 138, r: 20, pts: 100, lit: 0 },
    { x: 166, y: 204, r: 24, pts: 150, lit: 0 },
  ];
  // Slingshots: fast rails above the flippers that throw the ball back up.
  const SLINGS = [
    { a: [40, 300], b: [86, 372], pts: 50 },
    { a: [W - 40, 300], b: [W - 86, 372], pts: 50 },
  ];
  // Drop targets: hit all five for a bonus and they stand back up.
  const mkTargets = () => [0, 1, 2, 3, 4].map((i) => ({ x: 84 + i * 36, y: 86, down: false }));

  const FLIP = {
    left:  { px: PIV, py: 452, rest: REST, up: -0.52 },
    right: { px: W - PIV, py: 452, rest: Math.PI - REST, up: Math.PI + 0.52 },
  };

  let ball, hold, lives, score, level, mult, targets, flippers, flash, idle, shake;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;

  const key = { left: false, right: false };

  function reset() {
    // The ball waits in the launch lane; a tap plunges it.
    ball = { x: W - 23, y: 360, vx: 0, vy: 0 };
    hold = true;
  }

  function pop(x, y, pts) {
    const won = pts * mult * D.mult;
    score += won;
    flash.push({ x, y, t: 32, pts: won });
    host.onStats({ score });
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  /** Push the ball out of segment ab and reflect it. `push` is added to its velocity. */
  function hitSegment(a, b, pushX = 0, pushY = 0, bounce = D.bounce) {
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((ball.x - a[0]) * abx + (ball.y - a[1]) * aby) / (abx * abx + aby * aby || 1)));
    const cx = a[0] + abx * t, cy = a[1] + aby * t;
    let dx = ball.x - cx, dy = ball.y - cy;
    let d = Math.hypot(dx, dy);
    if (d > R) return false;
    if (d < 0.001) { dx = 0; dy = -1; d = 1; }
    const nx = dx / d, ny = dy / d;
    ball.x = cx + nx * (R + 0.5);
    ball.y = cy + ny * (R + 0.5);
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      ball.vx -= (1 + bounce) * vn * nx;
      ball.vy -= (1 + bounce) * vn * ny;
    }
    ball.vx += pushX; ball.vy += pushY;
    return true;
  }

  function flipperSegment(side) {
    const f = FLIP[side], s = flippers[side];
    return [[f.px, f.py], [f.px + Math.cos(s.a) * D.arm, f.py + Math.sin(s.a) * D.arm]];
  }

  function update() {
    // Flippers chase their target angle; the speed they carry is what launches the ball.
    for (const side of ['left', 'right']) {
      const f = FLIP[side], s = flippers[side];
      const prev = s.a;
      s.a += ((key[side] ? f.up : f.rest) - s.a) * D.flip;
      s.w = s.a - prev;
    }

    if (hold) return;

    ball.vy += D.grav;
    ball.vx *= 0.9975;
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 11) { ball.vx *= 11 / sp; ball.vy *= 11 / sp; }

    // Sub-steps: a fast ball must not tunnel through a flipper.
    const sub = Math.max(1, Math.ceil(sp / 4));
    for (let i = 0; i < sub; i++) {
      ball.x += ball.vx / sub;
      ball.y += ball.vy / sub;

      for (const [a, b] of WALLS) hitSegment(a, b, 0, 0, 0.62);
      if (ball.vy > 0 && ball.x > W - 40) hitSegment(GATE[0], GATE[1], 0, 0, 0.5);

      for (const s of SLINGS) {
        if (hitSegment(s.a, s.b, 0, -1.6, 1.0)) {
          host.sfx.hit();
          pop((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, s.pts);
        }
      }

      for (const bp of BUMPERS) {
        const dx = ball.x - bp.x, dy = ball.y - bp.y;
        const d = Math.hypot(dx, dy);
        if (d >= bp.r + R) continue;
        const nx = dx / (d || 1), ny = dy / (d || 1);
        ball.x = bp.x + nx * (bp.r + R + 0.5);
        ball.y = bp.y + ny * (bp.r + R + 0.5);
        const vn = ball.vx * nx + ball.vy * ny;
        ball.vx -= 1.9 * vn * nx; ball.vy -= 1.9 * vn * ny;
        ball.vx += nx * 1.1; ball.vy += ny * 1.1;
        bp.lit = 12;
        host.sfx.score();
        pop(bp.x, bp.y, bp.pts);
      }

      for (const tg of targets) {
        if (tg.down) continue;
        if (Math.abs(ball.x - tg.x) > 16 + R || Math.abs(ball.y - tg.y) > 8 + R) continue;
        tg.down = true;
        ball.vy = Math.abs(ball.vy) + 0.8;
        host.sfx.pickup();
        pop(tg.x, tg.y, 200);
        if (targets.every((o) => o.down)) {
          // Full bank: the multiplier climbs and the bank comes back up.
          mult = Math.min(5, mult + 1);
          level = mult;
          targets = mkTargets();
          host.sfx.win();
          pop(W / 2, 110, 1000);
          host.onStats({ level });
        }
      }

      // Flippers last: they are the only moving walls.
      for (const side of ['left', 'right']) {
        const [a, b] = flipperSegment(side);
        const s = flippers[side];
        if (Math.abs(s.w) > 0.004) {
          // Tip speed along the arm's normal — a timed flip sends the ball flying.
          const push = -s.w * D.arm * 0.55;
          if (hitSegment(a, b, Math.sin(s.a) * push, -Math.cos(s.a) * push, 0.9)) host.sfx.move();
        } else hitSegment(a, b, 0, 0, 0.35);
      }
    }

    // Out of the lane, the ball is pushed into the playfield instead of hugging the wall.
    if (ball.x > W - 40 && ball.y < 76) ball.vx -= 0.8;

    if (ball.y > H + 20) {
      lives--;
      mult = 1; level = 1;
      host.onStats({ lives, level });
      host.sfx.gameover();
      if (lives <= 0) return finish();
      reset();
      flash = [];
      idle = 0;
    }
    // Nudge: a ball that has stopped moving for two seconds gets shaken free, as on
    // a real table. Without it a corner could hold a ball for ever.
    if (Math.hypot(ball.vx, ball.vy) < 0.55) idle++; else idle = 0;
    if (idle > 120) {
      idle = 0;
      shake = 12;
      ball.vx += (Math.random() - 0.5) * 4;
      ball.vy -= 2.6;
      host.sfx.hit();
    }
    if (shake > 0) shake--;

    flash = flash.filter((f) => --f.t > 0);
    BUMPERS.forEach((b) => { if (b.lit) b.lit--; });
  }

  function draw() {
    const sx = shake > 0 ? (Math.random() - 0.5) * 7 : 0;
    ctx.save();
    ctx.translate(sx, 0);
    ctx.fillStyle = '#08070A';
    ctx.fillRect(-8, 0, W + 16, H);

    // Playfield art: a lit cabinet floor, the furniture on top of it.
    const g = ctx.createRadialGradient(W / 2, 170, 20, W / 2, 300, 340);
    g.addColorStop(0, '#1A1230'); g.addColorStop(1, '#0B0A12');
    ctx.fillStyle = g;
    ctx.fillRect(14, 18, W - 28, H - 18);

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(167,123,255,0.38)';
    WALLS.forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });

    ctx.lineWidth = 5;
    ctx.strokeStyle = '#FF6E99';
    SLINGS.forEach((s) => { ctx.beginPath(); ctx.moveTo(s.a[0], s.a[1]); ctx.lineTo(s.b[0], s.b[1]); ctx.stroke(); });

    targets.forEach((t) => {
      ctx.fillStyle = t.down ? 'rgba(255,255,255,0.12)' : '#FFB020';
      ctx.fillRect(t.x - 16, t.y - 4, 32, 8);
    });

    ctx.font = '700 11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    BUMPERS.forEach((b) => {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = b.lit ? '#FFFFFF' : '#19D197';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.stroke();
      ctx.fillStyle = '#08070A';
      ctx.fillText(String(b.pts), b.x, b.y + 4);
    });

    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#55AEFF';
    ['left', 'right'].forEach((side) => {
      const [a, b] = flipperSegment(side);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    });

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, R, 0, Math.PI * 2);
    ctx.fillStyle = '#F5F2EA';
    ctx.fill();

    flash.forEach((f) => {
      ctx.globalAlpha = f.t / 32;
      ctx.fillStyle = '#FFF';
      ctx.fillText('+' + f.pts, f.x, f.y - 26 + (32 - f.t));
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = shake > 0 ? '#FFB020' : 'rgba(245,242,234,0.45)';
    ctx.fillText(shake > 0 ? 'SECOUSSE' : 'x' + mult, W / 2, H - 8);
    if (hold) {
      ctx.fillStyle = '#FFB020';
      ctx.fillText('LANCE LA BILLE', W / 2, 330);
    }
    ctx.textAlign = 'start';
    ctx.restore();
  }

  function loop(t) {
    if (!running) return;
    acc = paused ? 0 : acc + Math.min(100, last ? t - last : STEP);
    last = t;
    for (; acc >= STEP && running; acc -= STEP) update();
    if (running && !paused) draw();
    rafId = requestAnimationFrame(loop);
  }

  function plunge() {
    if (!hold || paused || !running) return;
    hold = false;
    ball.vy = -12.6;
    ball.vx = -0.4;
    host.sfx.shoot();
  }

  // Half the screen per flipper, held for as long as the finger is down — a flip you
  // can hold to trap the ball, like the real buttons. Capture keeps it pressed even if
  // the finger slides off the canvas.
  const pressed = new Map();
  const sideOf = (e) => {
    const box = canvas.getBoundingClientRect();
    return (e.clientX - box.left) / box.width < 0.5 ? 'left' : 'right';
  };
  const onDown = (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    if (hold) return plunge();
    const side = sideOf(e);
    pressed.set(e.pointerId, side);
    key[side] = true;
  };
  const onUp = (e) => {
    const side = pressed.get(e.pointerId);
    if (!side) return;
    pressed.delete(e.pointerId);
    if (![...pressed.values()].includes(side)) key[side] = false;
  };

  return {
    start() {
      score = 0; lives = D.balls; mult = 1; level = 1;
      targets = mkTargets();
      flippers = { left: { a: FLIP.left.rest, w: 0 }, right: { a: FLIP.right.rest, w: 0 } };
      flash = [];
      paused = false; running = true; over = false; last = 0; acc = 0;
      key.left = key.right = false;
      reset();
      idle = 0; shake = 0;
      pressed.clear();
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
      if (a === 'left' || a === 'right') key[a] = down;
      if (down && (a === 'action' || a === 'up')) plunge();
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    },
  };
}
