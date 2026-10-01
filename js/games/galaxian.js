// Formation shooter in the 1979 mould: a swaying fleet over a scrolling star
// field, raiders that peel off and swoop down at you, flagships that dive with
// an escort, one shot of yours at a time. Sprites are original to this site.
const SPR = {
  drone: [
    ['..#....#..', '...####...', '.##.##.##.', '##########', '#.######.#', '#.#....#.#', '..#....#..'],
    ['..#....#..', '...####...', '.##.##.##.', '##########', '.########.', '#..#..#..#', '.#......#.'],
  ],
  escort: [
    ['#...##...#', '##.####.##', '.########.', '..#.##.#..', '.########.', '#..####..#', '#........#'],
    ['#...##...#', '##.####.##', '.########.', '..#.##.#..', '.########.', '.#.####.#.', '..#....#..'],
  ],
  flag: [
    ['....##....', '...####...', '.#.####.#.', '##########', '#.##..##.#', '..######..', '.##....##.', '##......##'],
    ['....##....', '...####...', '.#.####.#.', '##########', '#.##..##.#', '..######..', '..##..##..', '.##....##.'],
  ],
  ship: [['.....#.....', '.....#.....', '....###....', '.#..###..#.', '.#.#####.#.', '###########', '##.#####.##', '#...###...#']],
};
const INK = { drone: '#9D6BFF', escort: '#FF4D1F', flag: '#FFB020', ship: '#F5F2EA' };
const POINTS = { drone: [30, 60], escort: [50, 100], flag: [60, 150] };

export function createGame(canvas, host, opts = {}) {
  // Difficulty: spare ships, how often they dive, and how often divers shoot.
  const D = [
    { lives: 5, dive: 1.5, shoot: 0.6 },
    { lives: 3, dive: 1, shoot: 1 },
    { lives: 2, dive: 0.7, shoot: 1.4 },
  ][opts.difficulty ?? 1];

  canvas.width = 360; canvas.height = 460;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, PX = 2;

  let ship, shot, foes, shots, booms, stars, score, level, lives, sway, swayDir, frame, diveT, dead, extraGiven, march;
  let paused = false, running = false, rafId = null, last = 0, acc = 0, over = false;
  const keys = { left: false, right: false, fire: false };

  const size = (k) => ({ w: SPR[k][0][0].length * PX, h: SPR[k][0].length * PX });

  function spawnWave() {
    foes = [];
    const rows = [
      { kind: 'flag', cols: [3, 6] },
      { kind: 'escort', cols: [2, 3, 4, 5, 6, 7] },
      { kind: 'drone', cols: [1, 2, 3, 4, 5, 6, 7, 8] },
      { kind: 'drone', cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { kind: 'drone', cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
    ];
    rows.forEach((row, r) => row.cols.forEach((c) => {
      const { w, h } = size(row.kind);
      foes.push({ kind: row.kind, sx: 22 + c * 31 + (22 - w) / 2, sy: 56 + r * 24, x: 0, y: 0, w, h, state: 'home', vx: 0, vy: 0 });
    }));
    sway = 0; swayDir = 1; diveT = 120;
    foes.forEach(place);
  }

  function place(f) { f.x = f.sx + sway; f.y = f.sy; }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function addScore(n) {
    score += n;
    if (!extraGiven && score >= 7000) { extraGiven = true; lives++; host.onStats({ lives }); host.sfx.pickup(); }
    host.onStats({ score });
  }

  function launchDive() {
    const home = foes.filter((f) => f.state === 'home');
    if (!home.length) return;
    // Flagships take escorts down with them — worth the most if you get them all.
    const flag = home.find((f) => f.kind === 'flag');
    let group;
    if (flag && Math.random() < 0.35) {
      const esc = home.filter((f) => f.kind === 'escort').sort((a, b) => Math.abs(a.sx - flag.sx) - Math.abs(b.sx - flag.sx)).slice(0, 2);
      group = [flag, ...esc];
    } else {
      // Raiders leave from the edges of the formation, as they did.
      const edge = home.filter((f) => f.kind === 'drone').sort((a, b) => Math.abs(b.sx - W / 2) - Math.abs(a.sx - W / 2));
      group = [edge[(Math.random() * Math.min(4, edge.length)) | 0] || home[0]];
    }
    const side = group[0].sx < W / 2 ? -1 : 1;
    group.forEach((f, i) => {
      f.state = 'dive';
      f.vx = side * 1.6; f.vy = -2.2;
      f.lag = i * 10;
      f.fire = 30 + Math.random() * 60;
      f.escorted = group.length;
    });
    host.tone?.({ freq: 900, duration: 0.25, type: 'sawtooth', gain: 0.05 });
  }

  function killShip() {
    dead = 110;
    booms.push({ x: ship.x + ship.w / 2, y: ship.y + ship.h / 2, t: 50, big: true });
    lives--;
    host.sfx.hit();
    host.onStats({ lives });
  }

  function update() {
    frame++;
    stars.forEach((s) => { s.y += s.v; if (s.y > H) { s.y = 0; s.x = Math.random() * W; } });
    booms.forEach((b) => b.t--);
    booms = booms.filter((b) => b.t > 0);

    // The fleet sways side to side as one.
    sway += swayDir * 0.35;
    if (Math.abs(sway) > 18) swayDir *= -1;
    if (frame % 22 === 0) march ^= 1;

    if (dead > 0) {
      if (--dead === 0) {
        if (lives <= 0) return finish();
        ship.x = W / 2 - ship.w / 2;
        shots = [];
      }
    } else {
      if (keys.left) ship.x -= 3;
      if (keys.right) ship.x += 3;
      ship.x = Math.max(4, Math.min(W - ship.w - 4, ship.x));
      if (keys.fire) fire();
    }

    if (shot) {
      shot.y -= 8;
      if (shot.y < -10) shot = null;
    }

    if (--diveT <= 0 && dead === 0) {
      launchDive();
      diveT = Math.max(40, (190 - level * 12) * D.dive * (0.6 + Math.random() * 0.8));
    }

    for (const f of foes) {
      if (f.state === 'home') { place(f); continue; }
      if (f.state === 'dive') {
        if (f.lag > 0) { f.lag--; continue; }
        // Swoop: up and out, then steer at the ship while falling faster.
        const tx = ship.x + ship.w / 2 - f.w / 2;
        f.vx += Math.sign(tx - f.x) * 0.07;
        f.vx = Math.max(-2.6, Math.min(2.6, f.vx));
        f.vy = Math.min(3 + level * 0.15, f.vy + 0.07);
        f.x += f.vx; f.y += f.vy;
        if (f.y > 110 && f.y < ship.y - 60 && --f.fire <= 0) {
          f.fire = (70 + Math.random() * 90) / D.shoot;
          const a = Math.atan2(ship.y - f.y, ship.x - f.x);
          shots.push({ x: f.x + f.w / 2, y: f.y + f.h, vx: Math.cos(a) * 1.2, vy: 3.2 });
        }
        if (f.y > H + 10) { f.y = -20; f.x = f.sx + sway; f.state = 'return'; }
      } else if (f.state === 'return') {
        const tx = f.sx + sway, ty = f.sy;
        f.x += (tx - f.x) * 0.08;
        f.y += Math.min(2.4, ty - f.y);
        if (Math.abs(ty - f.y) < 1) { f.state = 'home'; place(f); }
      }
      if (dead === 0 && f.state === 'dive' && hit(f, ship)) {
        boomFoe(f, false);
        killShip();
      }
    }

    if (shot) {
      const f = foes.find((e) => hit(shot, e));
      if (f) { boomFoe(f, true); shot = null; }
    }

    shots.forEach((s) => { s.x += s.vx; s.y += s.vy; });
    shots = shots.filter((s) => s.y < H + 8);
    if (dead === 0 && shots.some((s) => s.x > ship.x + 3 && s.x < ship.x + ship.w - 3 && s.y > ship.y + 4 && s.y < ship.y + ship.h)) killShip();

    if (!foes.length) {
      level++;
      host.sfx.clear();
      host.onStats({ level });
      spawnWave();
    }
  }

  const hit = (a, b) => a.x < b.x + b.w && a.x + (a.w || 2) > b.x && a.y < b.y + b.h && a.y + (a.h || 8) > b.y;

  function boomFoe(f, byShot) {
    const diving = f.state !== 'home';
    let pts = POINTS[f.kind][diving ? 1 : 0];
    // A diving flagship pays more for each escort already gone.
    if (f.kind === 'flag' && diving) {
      const escortsLeft = foes.filter((e) => e.kind === 'escort' && e.state === 'dive').length;
      pts = [800, 300, 150][Math.min(2, escortsLeft)];
    }
    if (byShot) {
      addScore(pts);
      if (pts >= 150) booms.push({ x: f.x + f.w / 2, y: f.y, t: 50, text: String(pts) });
    }
    booms.push({ x: f.x + f.w / 2, y: f.y + f.h / 2, t: 18 });
    foes.splice(foes.indexOf(f), 1);
    host.tone?.({ freq: 220, duration: 0.12, type: 'square', gain: 0.1 });
  }

  function fire() {
    if (!running || paused || shot || dead > 0) return;
    shot = { x: ship.x + ship.w / 2 - 1, y: ship.y - 6, w: 2, h: 8 };
    host.sfx.shoot();
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
    stars.forEach((s) => {
      if ((frame + s.blink) % 50 < 38) { ctx.fillStyle = s.ink; ctx.fillRect(s.x, s.y, 1.5, 1.5); }
    });

    foes.forEach((f) => {
      const k = f.state === 'dive' ? (frame >> 3) & 1 : march;
      sprite(SPR[f.kind][k], f.x, f.y, INK[f.kind]);
    });

    // The player's shot sits loaded on the ship until it's fired — a 1979 detail.
    ctx.fillStyle = '#FFD34E';
    if (shot) ctx.fillRect(shot.x, shot.y, 2, 8);
    else if (dead === 0) ctx.fillRect(ship.x + ship.w / 2 - 1, ship.y - 6, 2, 6);
    ctx.fillStyle = '#F5F2EA';
    shots.forEach((s) => ctx.fillRect(s.x - 1, s.y, 2, 6));

    if (dead === 0) sprite(SPR.ship[0], ship.x, ship.y, INK.ship);

    booms.forEach((b) => {
      if (b.text) {
        ctx.font = '700 11px ui-monospace, Consolas, monospace';
        ctx.fillStyle = '#FFB020';
        ctx.textAlign = 'center';
        ctx.fillText(b.text, b.x, b.y);
        ctx.textAlign = 'start';
        return;
      }
      const r = (b.big ? 22 : 10) * (1 - b.t / (b.big ? 50 : 18)) + 2;
      ctx.fillStyle = b.t % 6 < 3 ? '#FFB020' : '#FF4D1F';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.fillRect(b.x + Math.cos(a) * r - 1.5, b.y + Math.sin(a) * r - 1.5, 3, 3);
      }
    });

    // Spare ships and wave flags, like the bottom row of the cabinet.
    for (let i = 0; i < Math.min(lives - (dead > 0 ? 0 : 1), 5); i++) sprite(SPR.ship[0], 6 + i * 26, H - 18, '#8E8A98');
    for (let i = 0; i < Math.min(level, 10); i++) {
      ctx.fillStyle = '#FF4D1F'; ctx.fillRect(W - 12 - i * 9, H - 16, 5, 4);
      ctx.fillStyle = '#F5F2EA'; ctx.fillRect(W - 13 - i * 9, H - 16, 1, 10);
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
      const s = size('ship');
      ship = { x: W / 2 - s.w / 2, y: H - 48, w: s.w, h: s.h };
      shot = null; shots = []; booms = []; dead = 0; frame = 0; march = 0;
      score = 0; level = 1; lives = D.lives; extraGiven = false;
      stars = Array.from({ length: 70 }, () => ({
        x: Math.random() * W, y: Math.random() * H, v: 0.3 + Math.random() * 0.9,
        ink: ['#F5F2EA', '#4EA8FF', '#FF5C8A', '#FFD34E', '#8BE04E'][(Math.random() * 5) | 0], blink: (Math.random() * 50) | 0,
      }));
      paused = false; running = true; over = false; last = 0; acc = 0;
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
