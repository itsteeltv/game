// Wave shooter. Original sprites drawn as blocks — no borrowed art.
// Adds destructible bunkers, a fire cooldown, drops, i-frames and a real boss.
export function createGame(canvas, host, opts = {}) {
  // Difficulty: how often they shoot, how fast they march, and your margin.
  const D = [
    { fire: 1.7, march: 0.75, lives: 5, cool: 0.8 },
    { fire: 1, march: 1, lives: 3, cool: 1 },
    { fire: 0.55, march: 1.3, lives: 2, cool: 1.25 },
  ][opts.difficulty ?? 1];

  canvas.width = 480; canvas.height = 380;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const FLOOR = H - 26;

  const ALIEN = [
    '..#.....#..', '...#...#...', '..#######..', '.##.###.##.',
    '###########', '#.#######.#', '#.#.....#.#', '...##.##...',
  ];

  let player, bullets, foes, foeShots, bunkers, drops;
  let score, level, lives, foeDir, stepAcc, fireAcc, shootAcc, invuln, powerT;
  let paused = false, running = false, rafId = null, last = 0, over = false;
  const keys = { left: false, right: false, fire: false };

  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function makeBunkers() {
    bunkers = [];
    for (let b = 0; b < 4; b++) {
      const bx = 52 + b * 108, by = FLOOR - 74;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 8; c++) {
          if (r === 3 && c > 2 && c < 5) continue;   // archway underneath
          bunkers.push({ x: bx + c * 8, y: by + r * 8, w: 8, h: 8, hp: 3 });
        }
      }
    }
  }

  function spawnWave() {
    foes = [];
    foeDir = 1; stepAcc = 0;
    if (level % 4 === 0) {
      const hp = 14 + level * 3;
      foes.push({ x: W / 2 - 34, y: 44, w: 68, h: 34, hp, max: hp, boss: true, value: 500 });
      return;
    }
    const cols = Math.min(9, 5 + Math.floor(level / 2));
    const rows = Math.min(5, 2 + Math.floor(level / 3));
    const gapX = 38, gapY = 30;
    const x0 = (W - (cols - 1) * gapX) / 2 - 12;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        foes.push({ x: x0 + c * gapX, y: 40 + r * gapY, w: 24, h: 18, hp: 1, boss: false, value: 10 * (rows - r) });
      }
    }
  }

  function reset() {
    player = { x: W / 2 - 16, y: FLOOR - 14, w: 32, h: 14 };
    bullets = []; foeShots = []; drops = [];
    score = 0; level = 1; lives = D.lives;
    fireAcc = 0; shootAcc = 999; invuln = 0; powerT = 0;
    makeBunkers();
    spawnWave();
    host.onStats({ score, level, lives });
  }

  function finish(won) {
    if (over) return;   // reachable from inside loops — must only ever land once
    over = true; running = false;
    host.onGameOver(score, won);
  }

  function hurt() {
    if (invuln > 0) return;
    lives--;
    invuln = 1500;
    powerT = 0;
    host.sfx.hit();
    host.onStats({ lives });
    if (lives <= 0) finish(false);
  }

  function shoot() {
    if (!running) return;
    if (shootAcc < (powerT > 0 ? 130 : 290) * D.cool) return;   // no spraying the screen
    shootAcc = 0;
    const mk = (x) => bullets.push({ x: x - 1.5, y: player.y - 8, w: 3, h: 9, vy: -8 });
    mk(player.x + player.w / 2);
    if (powerT > 0) { mk(player.x + 5); mk(player.x + player.w - 5); }
    host.sfx.shoot();
  }

  function damageBunker(b) {
    for (let i = bunkers.length - 1; i >= 0; i--) {
      if (hit(b, bunkers[i])) {
        if (--bunkers[i].hp <= 0) bunkers.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  function update(dt) {
    shootAcc += dt;
    if (invuln > 0) invuln -= dt;
    if (powerT > 0) powerT -= dt;

    if (keys.left) player.x -= 5.2;
    if (keys.right) player.x += 5.2;
    player.x = Math.max(0, Math.min(W - player.w, player.x));
    if (keys.fire) shoot();

    bullets.forEach((b) => { b.y += b.vy; });
    bullets = bullets.filter((b) => b.y > -12 && !damageBunker(b));

    foeShots.forEach((b) => { b.y += b.vy; });
    foeShots = foeShots.filter((b) => b.y < H + 12 && !damageBunker(b));

    drops.forEach((d) => { d.y += 1.6; });
    drops = drops.filter((d) => {
      if (!hit(d, player)) return d.y < H;
      if (d.kind === 'life') { lives++; host.onStats({ lives }); } else powerT = 8000;
      score += 50;
      host.onStats({ score });
      host.sfx.pickup();
      return false;
    });

    // March: quicker as the wave thins — the pressure curve of the genre.
    const cadence = Math.max(80, (620 - level * 40 - (40 - Math.max(1, foes.length)) * 9) / D.march);
    stepAcc += dt;
    if (stepAcc >= cadence) {
      stepAcc = 0;
      const isBoss = !!foes[0]?.boss;
      let edge = false;
      foes.forEach((f) => {
        f.x += foeDir * (isBoss ? 14 : 10);
        if (f.x < 4 || f.x + f.w > W - 4) edge = true;
      });
      if (edge) {
        foeDir *= -1;
        foes.forEach((f) => { f.y += isBoss ? 6 : 14; });
      }
      host.sfx.move();
    }

    if (foes.some((f) => f.y + f.h >= player.y)) return finish(false);

    fireAcc += dt;
    if (fireAcc >= Math.max(180, (1100 - level * 70) * D.fire) && foes.length) {
      fireAcc = 0;
      const s = foes[(Math.random() * foes.length) | 0];
      const speed = 3 + level * 0.18;
      foeShots.push({ x: s.x + s.w / 2 - 2, y: s.y + s.h, w: 4, h: 11, vy: speed });
      if (s.boss) {
        foeShots.push({ x: s.x + 6, y: s.y + s.h, w: 4, h: 11, vy: speed * 0.9 });
        foeShots.push({ x: s.x + s.w - 10, y: s.y + s.h, w: 4, h: 11, vy: speed * 0.9 });
      }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      for (let j = foes.length - 1; j >= 0; j--) {
        if (!hit(bullets[i], foes[j])) continue;
        const f = foes[j];
        bullets.splice(i, 1);
        f.hp--;
        host.sfx.hit();
        if (f.hp <= 0) {
          score += f.value;
          host.onStats({ score });
          if (Math.random() < (f.boss ? 1 : 0.07)) {
            drops.push({ x: f.x + f.w / 2 - 7, y: f.y, w: 14, h: 14, kind: Math.random() < 0.25 ? 'life' : 'rapid' });
          }
          foes.splice(j, 1);
        }
        break;
      }
    }

    for (let i = foeShots.length - 1; i >= 0; i--) {
      if (hit(foeShots[i], player)) {
        foeShots.splice(i, 1);
        hurt();
        if (!running) return;
      }
    }

    if (!foes.length) {
      level++;
      score += 100;
      host.sfx.win();
      host.onStats({ level, score });
      if (level % 4 === 1) makeBunkers();   // fresh cover each cycle
      spawnWave();
    }
  }

  function sprite(f) {
    const px = f.w / 11, py = f.h / 8;
    ctx.fillStyle = f.boss ? '#9D6BFF' : '#12C98C';
    ALIEN.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === '#') ctx.fillRect(f.x + c * px, f.y + r * py, Math.ceil(px), Math.ceil(py));
      }
    });
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#241F2C';
    ctx.fillRect(0, FLOOR + 10, W, 2);

    bunkers.forEach((c) => {
      ctx.globalAlpha = c.hp / 3;
      ctx.fillStyle = '#12C98C';
      ctx.fillRect(c.x, c.y, c.w - 1, c.h - 1);
    });
    ctx.globalAlpha = 1;

    foes.forEach(sprite);

    const boss = foes.find((f) => f.boss);
    if (boss) {
      ctx.fillStyle = '#241F2C';
      ctx.fillRect(W / 2 - 60, 20, 120, 6);
      ctx.fillStyle = '#9D6BFF';
      ctx.fillRect(W / 2 - 60, 20, 120 * (boss.hp / boss.max), 6);
    }

    drops.forEach((d) => {
      ctx.fillStyle = d.kind === 'life' ? '#FF4D1F' : '#FFB020';
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = '#08070A';
      ctx.fillRect(d.x + 6, d.y + 3, 2, 8);
      if (d.kind === 'life') ctx.fillRect(d.x + 3, d.y + 6, 8, 2);
    });

    ctx.fillStyle = '#F5F2EA';
    bullets.forEach((b) => ctx.fillRect(b.x, b.y, b.w, b.h));
    ctx.fillStyle = '#FF4D1F';
    foeShots.forEach((b) => ctx.fillRect(b.x, b.y, b.w, b.h));

    // Blink through invulnerability so the grace period is visible.
    if (invuln <= 0 || Math.floor(invuln / 110) % 2 === 0) {
      ctx.fillStyle = powerT > 0 ? '#FFB020' : '#4EA8FF';
      ctx.fillRect(player.x, player.y + 6, player.w, 8);
      ctx.fillRect(player.x + player.w / 2 - 3, player.y, 6, 8);
      ctx.fillRect(player.x + 3, player.y + 3, 5, 5);
      ctx.fillRect(player.x + player.w - 8, player.y + 3, 5, 5);
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
      paused = false; running = true; over = false; last = 0;
      reset(); draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'left') keys.left = down;
      if (a === 'right') keys.right = down;
      if (a === 'action') { keys.fire = down; if (down) shoot(); }
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
