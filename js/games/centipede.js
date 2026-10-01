// Mushroom-field shooter in the 1981 mould: a centipede snakes down through the
// mushrooms, turning at every obstacle; shoot a segment and it becomes a
// mushroom and the creature splits in two. A spider bounces through your corner.
// Your gun moves freely in the bottom rows. Sprites are original to this site.
const COLS = 20, ROWS = 26, C = 16;
const ZONE = ROWS - 6;   // the player's area starts here
const PALETTES = [
  { body: '#8BE04E', head: '#FF4D1F', mush: '#FF8A3D', edge: '#12C98C' },
  { body: '#4EA8FF', head: '#FFB020', mush: '#FF5C8A', edge: '#9D6BFF' },
  { body: '#FF5C8A', head: '#F5F2EA', mush: '#12C98C', edge: '#FFB020' },
  { body: '#FFB020', head: '#9D6BFF', mush: '#4EA8FF', edge: '#FF4D1F' },
];

export function createGame(canvas, host, opts = {}) {
  // Difficulty: spare guns, centipede pace, how aggressive the spider is.
  const D = [
    { lives: 5, step: 120, spider: 0.7 },
    { lives: 3, step: 95, spider: 1 },
    { lives: 2, step: 75, spider: 1.35 },
  ][opts.difficulty ?? 1];

  canvas.width = COLS * C; canvas.height = ROWS * C;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  let mush, chains, gun, shot, spider, flea, score, level, lives, stepAcc, stepFrac, dead, frame, extraNext, booms;
  let paused = false, running = false, rafId = null, last = 0, acc = 0, over = false;
  const keys = { left: false, right: false, up: false, down: false, fire: false };

  const key = (c, r) => r * COLS + c;
  const pal = () => PALETTES[(level - 1) % PALETTES.length];

  function seedMushrooms() {
    mush = new Map();
    for (let i = 0; i < 46; i++) {
      const c = (Math.random() * COLS) | 0, r = 1 + ((Math.random() * (ROWS - 3)) | 0);
      mush.set(key(c, r), 4);
    }
  }

  function newCentipede() {
    const n = 12;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const startC = dir > 0 ? 0 : COLS - 1;
    // One long chain; from wave 2 a few lone heads drop in too.
    chains = [Array.from({ length: n - Math.min(level - 1, 4) }, (_, i) => ({ c: startC - dir * i, r: 0, pc: startC - dir * i, pr: 0 }))];
    chains[0].dir = dir; chains[0].dy = 1;
    for (let k = 0; k < Math.min(level - 1, 4); k++) {
      const c = (Math.random() * COLS) | 0;
      const ch = [{ c, r: 0, pc: c, pr: 0 }];
      ch.dir = Math.random() < 0.5 ? 1 : -1; ch.dy = 1;
      chains.push(ch);
    }
    stepAcc = 0; stepFrac = 0;
  }

  const blocked = (c, r) => c < 0 || c >= COLS || mush.has(key(c, r));

  // One grid step for every chain: the head decides, the body follows in its tracks.
  function stepChains() {
    for (const ch of chains) {
      ch.forEach((s) => { s.pc = s.c; s.pr = s.r; });
      const h = ch[0];
      const nc = h.c + ch.dir;
      if (blocked(nc, h.r)) {   // a wall or a mushroom: drop a row and turn back
        let nr = h.r + ch.dy;
        if (nr >= ROWS) { ch.dy = -1; nr = h.r - 1; }
        if (nr < ZONE && ch.dy < 0) { ch.dy = 1; nr = h.r + 1; }   // in your zone it bounces, never leaves
        h.r = nr;
        ch.dir *= -1;
      } else h.c = nc;
      for (let i = 1; i < ch.length; i++) { ch[i].c = ch[i - 1].pc; ch[i].r = ch[i - 1].pr; }
    }
  }

  function addScore(n) {
    score += n;
    if (score >= extraNext) { extraNext += 12000; lives++; host.onStats({ lives }); host.sfx.pickup(); }
    host.onStats({ score });
  }

  function hitSegment(ci, si) {
    const ch = chains[ci];
    const s = ch[si];
    addScore(si === 0 ? 100 : 10);
    mush.set(key(s.c, s.r), 4);   // every segment you shoot leaves a mushroom behind
    booms.push({ x: s.c * C + C / 2, y: s.r * C + C / 2, t: 12 });
    const tail = ch.slice(si + 1);
    ch.length = si;
    if (tail.length) { tail.dir = ch.dir; tail.dy = ch.dy; chains.push(tail); }
    chains = chains.filter((c) => c.length);
    host.tone?.({ freq: 300 + Math.random() * 200, duration: 0.06, type: 'square', gain: 0.1 });
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function die() {
    dead = 90;
    lives--;
    host.sfx.hit();
    host.onStats({ lives });
    spider = null; flea = null; shot = null;
  }

  function respawn() {
    // As on the cabinet: damaged mushrooms are restored, 5 points each.
    for (const [k, hp] of mush) if (hp < 4) { mush.set(k, 4); addScore(5); }
    gun = { x: W / 2 - 6, y: H - C - 4 };
    newCentipede();
  }

  function update(dt) {
    frame++;
    booms.forEach((b) => b.t--);
    booms = booms.filter((b) => b.t > 0);

    if (dead > 0) {
      if (--dead === 0) { if (lives <= 0) return finish(); respawn(); }
      return;
    }

    // Free movement inside the bottom zone; mushrooms are solid.
    const sp = 2.6;
    const tryMove = (dx, dy) => {
      const nx = Math.max(0, Math.min(W - 12, gun.x + dx)), ny = Math.max(ZONE * C, Math.min(H - 12, gun.y + dy));
      const cells = [[nx, ny], [nx + 11, ny], [nx, ny + 11], [nx + 11, ny + 11]];
      if (!cells.some(([x, y]) => mush.has(key((x / C) | 0, (y / C) | 0)))) { gun.x = nx; gun.y = ny; }
    };
    if (keys.left) tryMove(-sp, 0);
    if (keys.right) tryMove(sp, 0);
    if (keys.up) tryMove(0, -sp);
    if (keys.down) tryMove(0, sp);
    if (keys.fire && !shot) fire();

    if (shot) {
      shot.y -= 11;
      const c = (shot.x / C) | 0, r = (shot.y / C) | 0;
      if (shot.y < 0) shot = null;
      else if (mush.has(key(c, r))) {
        const hp = mush.get(key(c, r)) - 1;
        if (hp <= 0) { mush.delete(key(c, r)); addScore(1); } else mush.set(key(c, r), hp);
        shot = null;
      }
    }

    // Centipede steps on a clock that tightens every wave.
    const step = Math.max(38, D.step - (level - 1) * 7);
    stepAcc += dt;
    while (stepAcc >= step) { stepAcc -= step; stepChains(); }
    stepFrac = stepAcc / step;

    const segPos = (s) => ({ x: (s.pc + (s.c - s.pc) * stepFrac) * C, y: (s.pr + (s.r - s.pr) * stepFrac) * C });
    if (shot) {
      outer: for (let ci = 0; ci < chains.length; ci++) {
        for (let si = 0; si < chains[ci].length; si++) {
          const p = segPos(chains[ci][si]);
          if (shot.x > p.x && shot.x < p.x + C && shot.y > p.y && shot.y < p.y + C) { hitSegment(ci, si); shot = null; break outer; }
        }
      }
    }

    // The spider zigzags through your zone, eating mushrooms; closer kills pay more.
    if (!spider && Math.random() < 0.004 * D.spider) {
      const from = Math.random() < 0.5 ? -1 : 1;
      spider = { x: from < 0 ? -20 : W + 4, y: ZONE * C + 10, vx: -from * (1.1 + level * 0.1) * D.spider, vy: 2 };
    }
    if (spider) {
      spider.x += spider.vx; spider.y += spider.vy;
      if (spider.y < ZONE * C - 20 || spider.y > H - 16) spider.vy *= -1;
      if (Math.random() < 0.03) spider.vy = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 2);
      mush.delete(key(((spider.x + 9) / C) | 0, ((spider.y + 5) / C) | 0));
      if (spider.x < -24 || spider.x > W + 24) spider = null;
      else if (shot && shot.x > spider.x && shot.x < spider.x + 18 && shot.y > spider.y && shot.y < spider.y + 12) {
        const d = Math.abs(spider.y - gun.y);
        const v = d < 30 ? 900 : d < 70 ? 600 : 300;
        addScore(v);
        booms.push({ x: spider.x + 9, y: spider.y, t: 40, text: String(v) });
        spider = null; shot = null;
        host.sfx.score();
      } else if (Math.abs(spider.x + 9 - (gun.x + 6)) < 14 && Math.abs(spider.y + 6 - (gun.y + 6)) < 12) return die();
    }

    // The flea drops straight down when your zone runs short of mushrooms, sowing new ones.
    const inZone = [...mush.keys()].filter((k) => Math.floor(k / COLS) >= ZONE).length;
    if (!flea && level > 1 && inZone < 4 && Math.random() < 0.01) flea = { c: (Math.random() * COLS) | 0, y: -C, hp: 2 };
    if (flea) {
      flea.y += flea.hp === 2 ? 3 : 6;
      const r = (flea.y / C) | 0;
      if (r > 0 && r < ROWS - 1 && Math.random() < 0.08) mush.set(key(flea.c, r), 4);
      if (flea.y > H) flea = null;
      else if (shot && Math.abs(shot.x - (flea.c * C + C / 2)) < 9 && Math.abs(shot.y - flea.y) < 14) {
        shot = null;
        if (--flea.hp === 0) { addScore(200); booms.push({ x: flea.c * C + 8, y: flea.y, t: 12 }); flea = null; }
      } else if (Math.abs(flea.c * C + 8 - (gun.x + 6)) < 12 && Math.abs(flea.y - gun.y) < 12) return die();
    }

    for (const ch of chains) for (const s of ch) {
      const p = segPos(s);
      if (Math.abs(p.x + C / 2 - (gun.x + 6)) < 12 && Math.abs(p.y + C / 2 - (gun.y + 6)) < 12) return die();
    }

    if (!chains.length) {
      level++;
      host.sfx.clear();
      host.onStats({ level });
      newCentipede();
    }
  }

  function fire() {
    if (!running || paused || shot || dead > 0) return;
    shot = { x: gun.x + 6, y: gun.y };
    host.tone?.({ freq: 1200, duration: 0.03, type: 'square', gain: 0.05 });
  }

  function draw() {
    const p = pal();
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);

    // Mushrooms: a cap and a stem, shrinking as they take hits.
    for (const [k, hp] of mush) {
      const x = (k % COLS) * C, y = Math.floor(k / COLS) * C;
      const s = hp / 4;
      ctx.fillStyle = p.mush;
      ctx.fillRect(x + 2, y + 2 + (1 - s) * 6, 12, 6 * s + 1);
      ctx.fillStyle = p.edge;
      ctx.fillRect(x + 5, y + 9, 6, 5);
    }

    const segPos = (s) => ({ x: (s.pc + (s.c - s.pc) * stepFrac) * C, y: (s.pr + (s.r - s.pr) * stepFrac) * C });
    chains.forEach((ch) => ch.forEach((s, i) => {
      const { x, y } = segPos(s);
      ctx.fillStyle = i === 0 ? p.head : p.body;
      ctx.beginPath(); ctx.arc(x + C / 2, y + C / 2, C / 2 - 1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#08070A';
      const legs = (frame >> 2) & 1;
      ctx.fillRect(x + 2, y + (legs ? 12 : 13), 3, 3); ctx.fillRect(x + 11, y + (legs ? 13 : 12), 3, 3);
      if (i === 0) { ctx.fillRect(x + 4, y + 5, 2, 2); ctx.fillRect(x + 10, y + 5, 2, 2); }
    }));

    if (spider) {
      ctx.fillStyle = '#F5F2EA';
      ctx.fillRect(spider.x + 5, spider.y + 2, 8, 8);
      ctx.fillStyle = '#FF5C8A';
      const l = (frame >> 2) & 1 ? 2 : 0;
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(spider.x + i * 2, spider.y + 2 + i * 2 - l, 3, 2);
        ctx.fillRect(spider.x + 13 + (3 - i) * 2 - 2, spider.y + 2 + i * 2 - l, 3, 2);
      }
    }
    if (flea) {
      ctx.fillStyle = '#FFD34E';
      ctx.fillRect(flea.c * C + 4, flea.y - 6, 8, 10);
      ctx.fillRect(flea.c * C + 2, flea.y + 2, 2, 4); ctx.fillRect(flea.c * C + 12, flea.y + 2, 2, 4);
    }

    if (shot) { ctx.fillStyle = '#F5F2EA'; ctx.fillRect(shot.x - 1, shot.y - 8, 2, 8); }

    if (dead > 0) {
      ctx.fillStyle = frame % 6 < 3 ? '#FF4D1F' : '#FFB020';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2, r = (90 - dead) * 0.6;
        ctx.fillRect(gun.x + 6 + Math.cos(a) * r, gun.y + 6 + Math.sin(a) * r, 3, 3);
      }
    } else {
      ctx.fillStyle = '#F5F2EA';
      ctx.fillRect(gun.x + 4, gun.y, 4, 4);
      ctx.fillRect(gun.x + 2, gun.y + 4, 8, 6);
      ctx.fillStyle = p.head;
      ctx.fillRect(gun.x, gun.y + 8, 12, 4);
    }

    booms.forEach((b) => {
      if (b.text) {
        ctx.font = '700 10px ui-monospace, Consolas, monospace';
        ctx.fillStyle = '#F5F2EA';
        ctx.fillText(b.text, b.x - 10, b.y);
      } else {
        ctx.fillStyle = '#F5F2EA';
        const r = (12 - b.t) * 1.2;
        ctx.fillRect(b.x - r, b.y - 1, r * 2, 2); ctx.fillRect(b.x - 1, b.y - r, 2, r * 2);
      }
    });

    ctx.fillStyle = 'rgba(245,242,234,0.08)';
    ctx.fillRect(0, ZONE * C, W, 1);
  }

  // Movement is tuned per 60 Hz frame: step at a fixed rate so a 120 Hz phone doesn't play twice as fast.
  const STEP = 1000 / 60;
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
      score = 0; level = 1; lives = D.lives; dead = 0; frame = 0; extraNext = 12000;
      shot = null; spider = null; flea = null; booms = [];
      gun = { x: W / 2 - 6, y: H - C - 4 };
      seedMushrooms();
      newCentipede();
      paused = false; running = true; over = false; last = 0; acc = 0;
      host.onStats({ score, level, lives });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a in keys && a !== 'fire') keys[a] = down;
      if (a === 'action') { keys.fire = down; if (down) fire(); }
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
