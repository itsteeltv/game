// Road-and-river crossing in the 1981 mould: hop through five lanes of traffic,
// ride logs and turtles (some dive) across the river, and land in each of the
// five bays before the timer runs dry. Sprites and lane layout are original.
const COLS = 15, CELL = 28, ROWS = 14;   // row 13 is the timer strip
const BAYS = [1, 4, 7, 10, 13];
const RIVER = [1, 2, 3, 4, 5], ROAD = [7, 8, 9, 10, 11], START = 12;

// One lane per row: what rides it, which way, how fast, how long, how far apart.
const LANES = {
  1: { kind: 'log', dir: 1, speed: 0.9, len: 4, gap: 4 },
  2: { kind: 'turtle', dir: -1, speed: 1.15, len: 2, gap: 2, dive: 3 },
  3: { kind: 'log', dir: 1, speed: 1.6, len: 6, gap: 4 },
  4: { kind: 'log', dir: 1, speed: 0.7, len: 3, gap: 3 },
  5: { kind: 'turtle', dir: -1, speed: 1.0, len: 3, gap: 2, dive: 4 },
  7: { kind: 'truck', dir: -1, speed: 1.0, len: 2, gap: 4, ink: '#F5F2EA' },
  8: { kind: 'car', dir: 1, speed: 1.9, len: 1, gap: 6, ink: '#FF5C8A' },
  9: { kind: 'car', dir: -1, speed: 1.05, len: 1, gap: 3, ink: '#4EA8FF' },
  10: { kind: 'car', dir: 1, speed: 0.8, len: 1, gap: 4, ink: '#8BE04E' },
  11: { kind: 'car', dir: -1, speed: 1.25, len: 1, gap: 4, ink: '#FFB020' },
};

export function createGame(canvas, host, opts = {}) {
  // Difficulty: spare frogs, traffic speed, seconds per frog.
  const D = [
    { lives: 5, speed: 0.8, time: 40 },
    { lives: 3, speed: 1, time: 30 },
    { lives: 2, speed: 1.25, time: 24 },
  ][opts.difficulty ?? 1];

  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;

  let frog, offsets, homes, fly, score, level, lives, timeLeft, best, dying, clock;
  let paused = false, running = false, rafId = null, last = 0, over = false;

  const mod = (a, n) => ((a % n) + n) % n;
  const laneSpeed = (row) => LANES[row].speed * LANES[row].dir * D.speed * (1 + (level - 1) * 0.15);

  /** Everything riding a lane right now, as pixel spans. */
  function items(row) {
    const L = LANES[row];
    const period = (L.len + L.gap) * CELL;
    const n = Math.ceil(W / period) + 2;
    return Array.from({ length: n }, (_, i) => {
      const x = mod(offsets[row] + i * period, n * period) - period;
      // Every `dive`-th turtle group sinks for a while: visible, sinking, under, rising.
      let under = false, sinking = false;
      if (L.dive && i % L.dive === 0) {
        const ph = mod(clock + row * 700, 5200);
        sinking = ph > 3200;
        under = ph > 3700 && ph < 4700;
      }
      return { x, w: L.len * CELL, under, sinking };
    });
  }

  function resetFrog() {
    frog = { x: 7 * CELL, row: START, face: 0, hop: 0 };
    best = START;
    timeLeft = D.time * 1000;
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function die() {
    if (dying > 0) return;
    dying = 900;
    host.sfx.hit();
  }

  function addScore(n) { score += n; host.onStats({ score }); }

  function hop(dir) {
    if (dying > 0 || !running || paused) return;
    const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    const row = frog.row + dy;
    if (row < 0 || row > START) return;
    frog.row = row;
    frog.x = Math.max(0, Math.min(W - CELL, frog.x + dx * CELL));
    frog.face = { up: 0, right: 1, down: 2, left: 3 }[dir];
    frog.hop = 90;
    host.tone?.({ freq: 600 + (START - row) * 18, duration: 0.03, type: 'square', gain: 0.07 });
    if (row < best) { best = row; addScore(10); }   // points for new ground only
    if (row === 0) landHome();
  }

  function landHome() {
    const centre = frog.x + CELL / 2;
    const bay = BAYS.findIndex((c) => Math.abs((c + 0.5) * CELL - centre) < CELL * 0.55);
    if (bay < 0 || homes[bay]) return die();   // the hedge, or a bay already taken
    homes[bay] = true;
    addScore(50 + Math.floor(timeLeft / 500) * 10);
    if (fly && fly.bay === bay) { addScore(200); fly = null; }
    host.sfx.score();
    if (homes.every(Boolean)) {
      addScore(1000);
      level++;
      host.sfx.win();
      host.onStats({ level });
      homes = homes.map(() => false);
    }
    resetFrog();
  }

  function update(dt) {
    clock += dt;
    Object.keys(LANES).forEach((r) => { offsets[r] += laneSpeed(r) * (dt / 16.67); });
    if (frog.hop > 0) frog.hop -= dt;

    // A fly visits an empty bay now and then: land on it for a bonus.
    if (fly && (fly.t -= dt) <= 0) fly = null;
    if (!fly && Math.random() < dt / 7000) {
      const free = BAYS.map((_, i) => i).filter((i) => !homes[i]);
      if (free.length) fly = { bay: free[(Math.random() * free.length) | 0], t: 4500 };
    }

    if (dying > 0) {
      dying -= dt;
      if (dying <= 0) {
        lives--;
        host.onStats({ lives });
        if (lives <= 0) return finish();
        resetFrog();
      }
      return;
    }

    timeLeft -= dt;
    if (timeLeft <= 0) return die();

    const left = frog.x + 5, right = frog.x + CELL - 5;
    if (ROAD.includes(frog.row)) {
      if (items(frog.row).some((it) => it.x < right && it.x + it.w > left)) die();
    } else if (RIVER.includes(frog.row)) {
      const centre = frog.x + CELL / 2;
      const ride = items(frog.row).find((it) => !it.under && it.x < centre && it.x + it.w > centre);
      if (!ride) return die();   // into the water
      frog.x += laneSpeed(frog.row) * (dt / 16.67);
      if (frog.x < -CELL / 3 || frog.x > W - CELL * 2 / 3) die();   // carried off the edge
    }
  }

  /* --- Drawing ----------------------------------------------------------- */

  function drawFrog(x, y, face, squat = false) {
    ctx.save();
    ctx.translate(x + CELL / 2, y + CELL / 2);
    ctx.rotate((face * Math.PI) / 2);
    const s = squat ? 0.8 : 1;
    ctx.fillStyle = '#8BE04E';
    ctx.fillRect(-7 * s, -8 * s, 14 * s, 16 * s);          // body
    ctx.fillRect(-11 * s, -10 * s, 4 * s, 7 * s);          // front legs
    ctx.fillRect(7 * s, -10 * s, 4 * s, 7 * s);
    ctx.fillRect(-12 * s, 3 * s, 5 * s, 8 * s);            // back legs
    ctx.fillRect(7 * s, 3 * s, 5 * s, 8 * s);
    ctx.fillStyle = '#12C98C';
    ctx.fillRect(-4 * s, -3 * s, 8 * s, 8 * s);            // back pattern
    ctx.fillStyle = '#FFD34E';
    ctx.fillRect(-6 * s, -9 * s, 4 * s, 4 * s);            // eyes
    ctx.fillRect(2 * s, -9 * s, 4 * s, 4 * s);
    ctx.restore();
  }

  function draw() {
    // Ground: hedge and bays, river, median, road, start bank.
    ctx.fillStyle = '#0A1B45';
    ctx.fillRect(0, 0, W, 6 * CELL);
    ctx.fillStyle = '#0E5A2E';
    ctx.fillRect(0, 0, W, CELL);
    BAYS.forEach((c, i) => {
      ctx.fillStyle = '#0A1B45';
      ctx.fillRect(c * CELL - 2, 4, CELL + 4, CELL - 4);
      if (homes[i]) drawFrog(c * CELL, 2, 2);
      else if (fly?.bay === i) {
        ctx.fillStyle = '#F5F2EA';
        ctx.fillRect(c * CELL + 11, 10, 6, 8);
        ctx.fillStyle = 'rgba(245,242,234,0.5)';
        ctx.fillRect(c * CELL + 6 + (clock % 200 < 100 ? 0 : 1), 9, 5, 4);
        ctx.fillRect(c * CELL + 17, 9, 5, 4);
      }
    });
    ctx.fillStyle = '#3A2A6E';
    ctx.fillRect(0, 6 * CELL, W, CELL);
    ctx.fillRect(0, START * CELL, W, CELL);
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 7 * CELL, W, 5 * CELL);
    ctx.fillStyle = 'rgba(245,242,234,0.12)';
    for (let r = 8; r <= 11; r++) for (let x = 6; x < W; x += 28) ctx.fillRect(x, r * CELL - 1, 14, 2);   // lane markings

    for (const r of [...RIVER, ...ROAD]) {
      const L = LANES[r], y = r * CELL;
      for (const it of items(r)) {
        if (L.kind === 'log') {
          ctx.fillStyle = '#8A5A2B';
          ctx.fillRect(it.x + 2, y + 5, it.w - 4, CELL - 10);
          ctx.fillStyle = '#B07A42';
          for (let k = 10; k < it.w - 8; k += 16) ctx.fillRect(it.x + k, y + 9, 8, 2);
          ctx.fillRect(it.x + it.w - 8, y + 7, 4, CELL - 14);
        } else if (L.kind === 'turtle') {
          if (it.under) continue;
          for (let k = 0; k < L.len; k++) {
            const cx = it.x + k * CELL + CELL / 2, cy = y + CELL / 2;
            ctx.fillStyle = it.sinking && clock % 300 < 150 ? '#7A2E24' : '#E5533D';
            ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#8BE04E';
            ctx.fillRect(cx + L.dir * 9 - 2, cy - 2, 4, 4);   // head points the way it swims
          }
        } else {
          const len = it.w - 6;
          ctx.fillStyle = L.ink;
          ctx.fillRect(it.x + 3, y + 6, len, CELL - 12);
          ctx.fillStyle = '#08070A';
          const front = L.dir > 0 ? it.x + 3 + len - 7 : it.x + 3 + 2;
          ctx.fillRect(front, y + 9, 5, CELL - 18);               // windscreen
          ctx.fillStyle = '#9FB0C9';
          ctx.fillRect(it.x + 5, y + 3, 6, 3); ctx.fillRect(it.x + len - 5, y + 3, 6, 3);   // wheels
          ctx.fillRect(it.x + 5, y + CELL - 6, 6, 3); ctx.fillRect(it.x + len - 5, y + CELL - 6, 6, 3);
        }
      }
    }

    if (dying > 0) {
      // Splat: a burst of the frog's colours, flickering out.
      ctx.fillStyle = Math.floor(dying / 100) % 2 ? '#FF4D1F' : '#F5F2EA';
      const cx = frog.x + CELL / 2, cy = frog.row * CELL + CELL / 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.fillRect(cx + Math.cos(a) * 9 - 2, cy + Math.sin(a) * 9 - 2, 4, 4);
      }
      ctx.fillRect(cx - 4, cy - 4, 8, 8);
    } else {
      drawFrog(frog.x, frog.row * CELL, frog.face, frog.hop > 0);
    }

    // Timer strip and spare frogs.
    const ty = START * CELL + CELL;
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, ty, W, CELL);
    const frac = Math.max(0, timeLeft / (D.time * 1000));
    ctx.fillStyle = frac < 0.25 ? '#FF4D1F' : '#8BE04E';
    ctx.fillRect(W - 8 - frac * 200, ty + 9, frac * 200, 10);
    ctx.font = '700 11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#FFD34E';
    ctx.fillText('TEMPS', W - 260, ty + 18);
    for (let i = 0; i < Math.min(lives - 1, 6); i++) {
      ctx.fillStyle = '#8BE04E';
      ctx.fillRect(8 + i * 16, ty + 9, 10, 10);
    }
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
      score = 0; level = 1; lives = D.lives; dying = 0; clock = 0; fly = null;
      offsets = {};
      Object.keys(LANES).forEach((r) => { offsets[r] = Math.random() * 200; });
      homes = BAYS.map(() => false);
      resetFrog();
      paused = false; running = true; over = false; last = 0;
      host.onStats({ score, level, lives });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (down && ['up', 'down', 'left', 'right'].includes(a)) hop(a);
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
