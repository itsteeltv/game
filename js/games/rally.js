// Rallye. Four lanes, no brakes worth the name, and traffic that gets denser the
// faster you go. Distance is the score; the bidons refill the tank.
const W = 320, H = 480;
const LANES = 4;
const LANE_W = 62;
const ROAD_X = (W - LANES * LANE_W) / 2;
const CAR_W = 34, CAR_H = 56;
const STEP = 1000 / 60;

const TRAFFIC = ['#55AEFF', '#FFB020', '#A77BFF', '#19D197', '#FF6E99'];

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Easy: three lives, a slow build-up, generous fuel. Hard: one mistake costs a lot.
  const D = [
    { lives: 4, v0: 3.2, vmax: 7.5, ramp: 0.00035, gap: 150, fuel: 0.016 },
    { lives: 3, v0: 4.0, vmax: 9.5, ramp: 0.00055, gap: 125, fuel: 0.022 },
    { lives: 3, v0: 4.8, vmax: 12, ramp: 0.00080, gap: 105, fuel: 0.030 },
  ][opts.difficulty ?? 1];

  const laneX = (l) => ROAD_X + l * LANE_W + LANE_W / 2;

  let car, cars, cans, dist, score, bonus, level, lives, speed, fuel, spawn, stripe, inv, shake;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;
  const key = { left: false, right: false, up: false, down: false };

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function crash() {
    if (inv > 0) return;
    lives--;
    inv = 110;
    shake = 14;
    speed = D.v0;
    host.sfx.hit();
    host.onStats({ lives });
    navigator.vibrate?.(60);
    if (lives <= 0) finish();
  }

  function spawnRow() {
    // Never fill every lane: there is always a line through.
    const blocked = 1 + ((Math.random() * (LANES - 1)) | 0);
    const lanes = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, blocked);
    lanes.forEach((l) => cars.push({
      l, y: -CAR_H - Math.random() * 40,
      v: 1.1 + Math.random() * 1.2,
      c: TRAFFIC[(Math.random() * TRAFFIC.length) | 0],
      passed: false,
    }));
    if (Math.random() < 0.45) {
      const free = [0, 1, 2, 3].filter((l) => !lanes.includes(l));
      cans.push({ l: free[(Math.random() * free.length) | 0], y: -30 });
    }
  }

  function update() {
    // Steering is continuous, not lane-snapped: threading a gap is a real input.
    const steer = (key.right ? 1 : 0) - (key.left ? 1 : 0);
    car.x += steer * 4.4;
    car.x = Math.max(ROAD_X + CAR_W / 2, Math.min(ROAD_X + LANES * LANE_W - CAR_W / 2, car.x));
    car.tilt += (steer * 0.12 - car.tilt) * 0.2;

    // The throttle only trims the speed the game is already pushing you to.
    const target = Math.min(D.vmax, D.v0 + dist * D.ramp) * (key.up ? 1.25 : key.down ? 0.7 : 1);
    speed += (target - speed) * 0.04;

    dist += speed;
    stripe = (stripe + speed) % 48;
    // Distance is the score, but the readout is only written when a number changes.
    const sc = Math.floor(dist / 10) + bonus;
    const lv = 1 + Math.floor(dist / 4000);
    if (lv !== level) { level = lv; host.sfx.score(); host.onStats({ level }); }
    if (sc !== score) { score = sc; host.onStats({ score }); }

    fuel -= D.fuel * (speed / D.vmax) * 0.2;
    if (fuel <= 0) { fuel = 0; host.sfx.gameover(); return finish(); }

    if (inv > 0) inv--;
    if (shake > 0) shake--;

    spawn -= speed;
    if (spawn <= 0) { spawnRow(); spawn = D.gap + Math.random() * 60; }

    for (const c of cars) {
      c.y += speed - c.v;
      if (!c.passed && c.y > car.y + CAR_H) { c.passed = true; bonus += 25; }
      if (Math.abs(laneX(c.l) - car.x) < (CAR_W + CAR_W) / 2 - 6 &&
          c.y + CAR_H > car.y && c.y < car.y + CAR_H) crash();
    }
    cars = cars.filter((c) => c.y < H + 80);

    for (const k of cans) {
      k.y += speed;
      if (k.got) continue;
      if (Math.abs(laneX(k.l) - car.x) < 26 && k.y + 24 > car.y && k.y < car.y + CAR_H) {
        k.got = true;
        fuel = Math.min(1, fuel + 0.34);
        bonus += 150;
        host.sfx.pickup();
      }
    }
    cans = cans.filter((k) => !k.got && k.y < H + 40);
  }

  function carShape(x, y, colour, tilt = 0) {
    ctx.save();
    ctx.translate(x, y + CAR_H / 2);
    ctx.rotate(tilt);
    ctx.fillStyle = colour;
    ctx.fillRect(-CAR_W / 2, -CAR_H / 2, CAR_W, CAR_H);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(-CAR_W / 2 + 4, -CAR_H / 2 + 10, CAR_W - 8, 14);   // windscreen
    ctx.fillRect(-CAR_W / 2 + 4, CAR_H / 2 - 20, CAR_W - 8, 10);
    ctx.fillStyle = '#0B0A12';
    ctx.fillRect(-CAR_W / 2 - 3, -CAR_H / 2 + 6, 5, 14);
    ctx.fillRect(CAR_W / 2 - 2, -CAR_H / 2 + 6, 5, 14);
    ctx.fillRect(-CAR_W / 2 - 3, CAR_H / 2 - 20, 5, 14);
    ctx.fillRect(CAR_W / 2 - 2, CAR_H / 2 - 20, 5, 14);
    ctx.restore();
  }

  function draw() {
    const sx = shake > 0 ? (Math.random() - 0.5) * 6 : 0;
    ctx.save();
    ctx.translate(sx, 0);

    ctx.fillStyle = '#08070A';
    ctx.fillRect(-8, 0, W + 16, H);

    // Verges, scrolling so the speed reads even on an empty road.
    ctx.fillStyle = '#121019';
    ctx.fillRect(0, 0, ROAD_X, H);
    ctx.fillRect(ROAD_X + LANES * LANE_W, 0, ROAD_X, H);
    ctx.fillStyle = '#1F2430';
    ctx.fillRect(ROAD_X, 0, LANES * LANE_W, H);
    ctx.fillStyle = 'rgba(255,90,43,0.75)';
    for (let y = -48 + stripe; y < H; y += 96) {
      ctx.fillRect(ROAD_X - 7, y, 7, 48);
      ctx.fillRect(ROAD_X + LANES * LANE_W, y, 7, 48);
    }

    ctx.fillStyle = 'rgba(245,242,234,0.3)';
    for (let l = 1; l < LANES; l++) {
      for (let y = -48 + stripe; y < H; y += 48) ctx.fillRect(ROAD_X + l * LANE_W - 2, y, 4, 24);
    }

    cans.forEach((k) => {
      ctx.fillStyle = '#19D197';
      ctx.fillRect(laneX(k.l) - 11, k.y, 22, 26);
      ctx.fillStyle = '#08070A';
      ctx.font = '700 13px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('E', laneX(k.l), k.y + 19);
      ctx.textAlign = 'start';
    });

    cars.forEach((c) => carShape(laneX(c.l), c.y, c.c));

    if (inv === 0 || Math.floor(inv / 6) % 2 === 0) carShape(car.x, car.y, '#F5F2EA', car.tilt);

    // Fuel gauge down the left edge.
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(6, 60, 8, H - 120);
    ctx.fillStyle = fuel < 0.25 ? '#FF5A52' : '#19D197';
    const gh = (H - 120) * fuel;
    ctx.fillRect(6, 60 + (H - 120 - gh), 8, gh);
    ctx.font = '600 10px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(245,242,234,0.45)';
    ctx.fillText('E', 6, 54);

    ctx.textAlign = 'right';
    ctx.font = '700 13px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(245,242,234,0.5)';
    ctx.fillText(Math.round(speed * 24) + ' KM/H', W - 10, 26);
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

  // Dragging a finger steers directly — the pad is for players who prefer buttons.
  let drag = null;
  const onDown = (e) => { e.preventDefault(); drag = e.pointerId; steerTo(e); };
  const onMove = (e) => { if (drag === e.pointerId) steerTo(e); };
  const onUp = (e) => { if (drag === e.pointerId) drag = null; };
  function steerTo(e) {
    const box = canvas.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width * W;
    car.x = Math.max(ROAD_X + CAR_W / 2, Math.min(ROAD_X + LANES * LANE_W - CAR_W / 2, x));
  }

  return {
    start() {
      car = { x: laneX(1), y: H - CAR_H - 28, tilt: 0 };
      cars = []; cans = [];
      dist = 0; score = 0; bonus = 0; level = 1; lives = D.lives; speed = D.v0;
      fuel = 1; spawn = 80; stripe = 0; inv = 60; shake = 0;
      paused = false; running = true; over = false; last = 0; acc = 0;
      key.left = key.right = key.up = key.down = false;
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
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
      if (a in key) key[a] = down;
      if (down && a === 'action') key.up = true;
      if (!down && a === 'action') key.up = false;
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
