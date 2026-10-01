// Fixed shooter in the 1978 mould: an 11 × 5 formation that marches faster as it
// thins, a four-note heartbeat, one shot of yours on screen at a time, crumbling
// shields and a mystery saucer. The creatures are drawn for this site — the rules
// of the genre are kept, not the art.
const SPRITES = {
  // 30 points — the top row
  a: [
    ['...##...', '.##..##.', '#..##..#', '#.####.#', '.######.', '..#..#..', '.#.##.#.', '#......#'],
    ['...##...', '.##..##.', '#..##..#', '#.####.#', '.######.', '..#..#..', '..#..#..', '.##..##.'],
  ],
  // 20 points — two middle rows
  b: [
    ['..##...##..', '...#...#...', '.#########.', '##..###..##', '###########', '.#.#.#.#.#.', '#.........#', '.#.......#.'],
    ['..##...##..', '...#...#...', '.#########.', '##..###..##', '###########', '.#.#.#.#.#.', '.#.......#.', '#.........#'],
  ],
  // 10 points — two bottom rows
  c: [
    ['...######...', '.##########.', '##.##..##.##', '############', '.##########.', '..#.#..#.#..', '.#..#..#..#.', '#...#..#...#'],
    ['...######...', '.##########.', '##.##..##.##', '############', '.##########.', '..#.#..#.#..', '..#.#..#.#..', '.#..#..#..#.'],
  ],
  saucer: [['.....######.....', '...##########...', '..############..', '.##.##.##.##.##.', '################', '..###..##..###..', '...#........#...']],
  boom: [['#...#..#...#', '.#...##...#.', '..#......#..', '##........##', '..#......#..', '.#..#..#..#.', '#...#..#...#']],
  cannon: [['......#......', '.....###.....', '.....###.....', '.###########.', '#############', '#############', '#############']],
  wreck: [['..#...#..#...', '#....#...#..#', '..#.#####..#.', '.###########.', '##.########.#', '#############']],
};
const ROW_TYPES = ['a', 'b', 'b', 'c', 'c'];
const ROW_POINTS = { a: 30, b: 20, c: 10 };
const HEARTBEAT = [98, 87.3, 77.8, 73.4];   // the descending four-note march
const SAUCER_POINTS = [50, 100, 150, 100, 300, 50, 100, 150];

export function createGame(canvas, host, opts = {}) {
  // Difficulty: how often they shoot, how fast they march, and your spare cannons.
  const D = [
    { fire: 1.6, march: 0.8, lives: 5 },
    { fire: 1, march: 1, lives: 3 },
    { fire: 0.6, march: 1.25, lives: 2 },
  ][opts.difficulty ?? 1];

  canvas.width = 480; canvas.height = 380;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const FLOOR = H - 30, PX = 2;   // every sprite pixel is 2 × 2

  let player, shot, foes, foeShots, bunkers, saucer, booms;
  let score, level, lives, foeDir, stepAcc, fireAcc, beat, frame, dead, saucerT, extraGiven, whine;
  let paused = false, running = false, rafId = null, last = 0, over = false;
  const keys = { left: false, right: false, fire: false };

  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const size = (rows) => ({ w: rows[0].length * PX, h: rows.length * PX });

  function makeBunkers() {
    bunkers = [];
    for (let b = 0; b < 4; b++) {
      const bx = 58 + b * 104, by = FLOOR - 70;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 11; c++) {
          if (r < 2 && (c < 2 - r || c > 8 + r)) continue;     // rounded top corners
          if (r > 5 && c > 2 && c < 8) continue;               // archway underneath
          bunkers.push({ x: bx + c * 4, y: by + r * 4, w: 4, h: 4 });
        }
      }
    }
  }

  function spawnWave() {
    foes = [];
    foeDir = 1; stepAcc = 0; frame = 0;
    const y0 = 52 + Math.min(level - 1, 6) * 12;   // each new wave starts a little lower
    for (let r = 0; r < 5; r++) {
      const kind = ROW_TYPES[r];
      for (let c = 0; c < 11; c++) {
        const { w, h } = size(SPRITES[kind][0]);
        foes.push({ x: 40 + c * 34 + (24 - w) / 2, y: y0 + r * 26, w, h, kind, col: c });
      }
    }
    makeBunkers();
    foeShots = []; shot = null; saucer = null; saucerT = 16000 + Math.random() * 8000;
  }

  function finish() {
    if (over) return;   // reachable from inside loops — must only ever land once
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function addScore(n) {
    score += n;
    if (!extraGiven && score >= 1500) { extraGiven = true; lives++; host.onStats({ lives }); host.sfx.pickup(); }
    host.onStats({ score });
  }

  function cannonHit() {
    lives--;
    dead = 1200;   // the cannon smokes; the formation freezes
    foeShots = [];
    host.sfx.hit();
    host.onStats({ lives });
  }

  function fire() {
    if (!running || shot || dead > 0) return;   // one shot on screen, as it always was
    shot = { x: player.x + player.w / 2 - 1, y: player.y - 8, w: 2, h: 8 };
    host.sfx.shoot();
  }

  function chipBunker(b, depth = 1) {
    for (let i = bunkers.length - 1; i >= 0; i--) {
      if (!hit(b, bunkers[i])) continue;
      const { x, y } = bunkers[i];
      // Shots bite a ragged hole, not a single neat block.
      bunkers = bunkers.filter((k) => Math.abs(k.x - x) > 4 * depth || Math.abs(k.y - y) > 4 * depth || Math.random() < 0.35);
      return true;
    }
    return false;
  }

  function update(dt) {
    booms.forEach((b) => { b.t -= dt; });
    booms = booms.filter((b) => b.t > 0);

    if (dead > 0) {
      dead -= dt;
      if (dead <= 0) {
        if (lives <= 0) return finish();
        player.x = W / 2 - player.w / 2;
      }
      return;
    }

    if (keys.left) player.x -= 2.6;
    if (keys.right) player.x += 2.6;
    player.x = Math.max(8, Math.min(W - player.w - 8, player.x));
    if (keys.fire) fire();

    if (shot) {
      shot.y -= 9;
      if (shot.y < 24 || chipBunker(shot)) {
        if (shot.y < 24) booms.push({ x: shot.x - 6, y: 24, t: 160, small: true });
        shot = null;
      }
    }

    // March: one step per beat, quicker as the formation thins — the genre's pressure curve.
    const cadence = Math.max(18, 12 + foes.length * 13) / D.march;
    stepAcc += dt;
    if (stepAcc >= cadence) {
      stepAcc = 0;
      frame ^= 1;
      const edge = foes.some((f) => (foeDir > 0 ? f.x + f.w + 6 > W - 6 : f.x - 6 < 6));
      if (edge) { foeDir *= -1; foes.forEach((f) => { f.y += 12; }); }
      else foes.forEach((f) => { f.x += foeDir * 6; });
      host.tone?.({ freq: HEARTBEAT[beat++ % 4], duration: 0.09, type: 'square', gain: 0.16 });
      // Marching through the shields erases them.
      foes.forEach((f) => { bunkers = bunkers.filter((k) => !hit(f, k)); });
    }
    if (foes.some((f) => f.y + f.h >= player.y)) { lives = 0; host.onStats({ lives }); return finish(); }

    // Fire from the lowest creature of a column — often the one above you.
    fireAcc += dt;
    if (foes.length && foeShots.length < 3 && fireAcc >= Math.max(220, (900 - level * 60) * D.fire)) {
      fireAcc = 0;
      const cols = [...new Set(foes.map((f) => f.col))];
      const above = foes.find((f) => f.x < player.x + player.w && f.x + f.w > player.x);
      const col = above && Math.random() < 0.45 ? above.col : cols[(Math.random() * cols.length) | 0];
      const s = foes.filter((f) => f.col === col).reduce((a, b) => (b.y > a.y ? b : a));
      foeShots.push({ x: s.x + s.w / 2 - 1.5, y: s.y + s.h, w: 3, h: 9, vy: 2.6 + level * 0.15, t: 0 });
    }
    foeShots.forEach((b) => { b.y += b.vy; b.t++; });
    foeShots = foeShots.filter((b) => {
      if (b.y > FLOOR + 6) { booms.push({ x: b.x - 5, y: FLOOR - 4, t: 160, small: true }); return false; }
      return !chipBunker(b, 2);
    });

    // The mystery saucer crosses the top now and then.
    saucerT -= dt;
    if (!saucer && saucerT <= 0 && foes.length > 6) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const { w, h } = size(SPRITES.saucer[0]);
      saucer = { x: dir > 0 ? -w : W, y: 28, w, h, dir };
    }
    if (saucer) {
      saucer.x += saucer.dir * 1.3;
      whine = (whine || 0) + dt;
      if (whine > 110) { whine = 0; host.tone?.({ freq: frame ? 880 : 1020, duration: 0.08, type: 'sine', gain: 0.03 }); }
      if (saucer.x > W + 4 || saucer.x < -saucer.w - 4) { saucer = null; saucerT = 18000 + Math.random() * 10000; }
    }

    // Your shot.
    if (shot) {
      if (saucer && hit(shot, saucer)) {
        const v = SAUCER_POINTS[(Math.random() * SAUCER_POINTS.length) | 0];
        addScore(v);
        booms.push({ x: saucer.x, y: saucer.y, t: 900, text: String(v) });
        saucer = null; shot = null; saucerT = 18000 + Math.random() * 10000;
        host.sfx.win();
      } else {
        const f = foes.find((e) => hit(shot, e));
        if (f) {
          addScore(ROW_POINTS[f.kind]);
          booms.push({ x: f.x + f.w / 2 - 12, y: f.y, t: 220 });
          foes.splice(foes.indexOf(f), 1);
          shot = null;
          host.tone?.({ freq: 180, duration: 0.12, type: 'sawtooth', gain: 0.12 });
        } else {
          const k = foeShots.findIndex((b) => hit(shot, b));
          if (k >= 0) { foeShots.splice(k, 1); shot = null; }   // shots can cancel each other
        }
      }
    }

    for (const b of foeShots) {
      if (hit(b, player)) { cannonHit(); break; }
    }

    if (!foes.length) {
      level++;
      host.sfx.clear();
      host.onStats({ level });
      spawnWave();
    }
  }

  function sprite(rows, x, y, ink) {
    ctx.fillStyle = ink;
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(x + c * PX, y + r * PX, PX, PX);
    });
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);

    // Cabinet colour film: red over the saucer lane, green over the shields and cannon.
    const ink = (y) => (y < 44 ? '#FF4D1F' : y > FLOOR - 80 ? '#12C98C' : '#F5F2EA');

    ctx.fillStyle = '#12C98C';
    ctx.fillRect(0, FLOOR + 10, W, 2);
    bunkers.forEach((k) => ctx.fillRect(k.x, k.y, k.w, k.h));

    foes.forEach((f) => sprite(SPRITES[f.kind][frame], f.x, f.y, ink(f.y)));
    if (saucer) sprite(SPRITES.saucer[0], saucer.x, saucer.y, '#FF4D1F');

    booms.forEach((b) => {
      if (b.text) {
        ctx.font = '700 12px ui-monospace, Consolas, monospace';
        ctx.fillStyle = '#FF4D1F';
        ctx.fillText(b.text, b.x + 4, b.y + 12);
      } else if (b.small) {
        ctx.fillStyle = ink(b.y);
        for (let i = 0; i < 6; i++) ctx.fillRect(b.x + ((i * 7) % 12), b.y + ((i * 5) % 8), 2, 2);
      } else sprite(SPRITES.boom[0], b.x, b.y, ink(b.y));
    });

    if (shot) { ctx.fillStyle = ink(shot.y); ctx.fillRect(shot.x, shot.y, shot.w, shot.h); }
    // Enemy shots wriggle down: a zigzag, not a line.
    foeShots.forEach((b) => {
      ctx.fillStyle = ink(b.y);
      for (let i = 0; i < 3; i++) ctx.fillRect(b.x + (((b.t >> 2) + i) % 2 ? 0 : 2), b.y + i * 3, 2, 3);
    });

    if (dead > 0) {
      if (Math.floor(dead / 120) % 2) sprite(SPRITES.wreck[0], player.x, player.y + 2, '#12C98C');
    } else sprite(SPRITES.cannon[0], player.x, player.y, '#12C98C');

    // Spare cannons, bottom left, like the cabinet.
    for (let i = 0; i < Math.min(lives - 1, 5); i++) {
      sprite(SPRITES.cannon[0], 8 + i * 30, FLOOR + 14, '#12C98C');
    }
  }

  // Movement is tuned per 60 Hz frame: step at a fixed rate so a 120 Hz phone doesn't play twice as fast.
  const STEP = 1000 / 60;
  let acc = 0;
  function loop(t) {
    if (!running) return;
    acc = paused ? 0 : acc + Math.min(100, last ? t - last : STEP);
    last = t;
    for (; acc >= STEP && running; acc -= STEP) update(STEP);
    if (running && !paused) draw();
    rafId = requestAnimationFrame(loop);
  }

  return {
    start() {
      const c = size(SPRITES.cannon[0]);
      player = { x: W / 2 - c.w / 2, y: FLOOR - c.h - 2, w: c.w, h: c.h };
      score = 0; level = 1; lives = D.lives; fireAcc = 0; beat = 0; dead = 0; booms = [];
      extraGiven = false;
      paused = false; running = true; over = false; last = 0;
      spawnWave();
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
      if (a === 'action') { keys.fire = down; if (down) fire(); }
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
