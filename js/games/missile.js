// City defence in the 1980 mould: missiles rain on six cities; tap (or aim with
// the arrows) to send a counter-missile from the nearest of three silos and
// catch them in its blast — blasts chain. Ammo is short, some warheads split,
// and the colours change every wave. Layout and art are original.
const PALETTES = [
  { ground: '#FFB020', city: '#4EA8FF', foe: '#FF4D1F', mine: '#8BE04E' },
  { ground: '#12C98C', city: '#FFD34E', foe: '#FF5C8A', mine: '#4EA8FF' },
  { ground: '#9D6BFF', city: '#8BE04E', foe: '#FFB020', mine: '#F5F2EA' },
  { ground: '#FF4D1F', city: '#F5F2EA', foe: '#4EA8FF', mine: '#FFD34E' },
];

export function createGame(canvas, host, opts = {}) {
  // Difficulty: how fast they fall, how many come, how much ammo you get.
  const D = [
    { speed: 0.75, count: 0.75, ammo: 12 },
    { speed: 1, count: 1, ammo: 10 },
    { speed: 1.3, count: 1.25, ammo: 8 },
  ][opts.difficulty ?? 1];

  canvas.width = 480; canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, GROUND = H - 28;

  const SILOS = [{ x: 34 }, { x: 240 }, { x: 446 }];
  const CITY_X = [94, 138, 182, 298, 342, 386];

  let cities, silos, foes, mine, blasts, crosshair, keys;
  let score, level, toLaunch, launchT, tally, bonusNext, lost;
  let paused = false, running = false, rafId = null, last = 0, over = false;

  const pal = () => PALETTES[(level - 1) % PALETTES.length];
  const mult = () => Math.min(6, 1 + Math.floor((level - 1) / 2));   // later waves pay more

  function newWave() {
    silos = SILOS.map((s) => ({ x: s.x, ammo: D.ammo, alive: true }));   // silos rebuild every wave
    foes = []; mine = []; blasts = [];
    toLaunch = Math.round((8 + level * 2) * D.count);
    launchT = 60;
    tally = null;
    host.sfx.pickup();
  }

  function targets() {
    return [
      ...cities.map((c, i) => (c ? { x: CITY_X[i], kind: 'city', i } : null)),
      ...silos.map((s, i) => (s.alive ? { x: s.x, kind: 'silo', i } : null)),
    ].filter(Boolean);
  }

  function launch(from = null) {
    const t = targets();
    if (!t.length) return;
    const goal = t[(Math.random() * t.length) | 0];
    const sx = from ? from.x : Math.random() * W, sy = from ? from.y : 0;
    const sp = (0.35 + level * 0.06) * D.speed;
    const d = Math.hypot(goal.x - sx, GROUND - sy);
    foes.push({
      sx, sy, x: sx, y: sy, tx: goal.x, goal,
      vx: ((goal.x - sx) / d) * sp, vy: ((GROUND - sy) / d) * sp,
      // From wave 3, some warheads split partway down.
      split: !from && level >= 3 && Math.random() < 0.15 + level * 0.02 ? 90 + Math.random() * 90 : 0,
    });
  }

  function fire(tx, ty) {
    if (!running || paused || tally) return;
    ty = Math.min(ty, GROUND - 24);
    // The nearest silo that still has ammo answers; the centre one is fastest.
    const ready = silos.map((s, i) => ({ s, i })).filter(({ s }) => s.alive && s.ammo > 0);
    if (!ready.length) { host.tone?.({ freq: 110, duration: 0.08, gain: 0.08 }); return; }
    const { s, i } = ready.reduce((a, b) => (Math.abs(b.s.x - tx) < Math.abs(a.s.x - tx) ? b : a));
    s.ammo--;
    const sy = GROUND - 14, sp = i === 1 ? 8 : 5.5;
    const d = Math.hypot(tx - s.x, ty - sy);
    mine.push({ sx: s.x, sy, x: s.x, y: sy, tx, ty, vx: ((tx - s.x) / d) * sp, vy: ((ty - sy) / d) * sp });
    host.tone?.({ freq: 520, duration: 0.07, type: 'triangle', gain: 0.08 });
  }

  function blast(x, y, max = 30) {
    blasts.push({ x, y, r: 1, max, t: 0 });
    host.tone?.({ freq: 70 + Math.random() * 40, duration: 0.25, type: 'sawtooth', gain: 0.12 });
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function addScore(n) {
    score += n;
    if (score >= bonusNext) {
      // A bonus city every 10 000, rebuilt where one fell.
      bonusNext += 10000;
      const k = cities.indexOf(false);
      if (k >= 0) { cities[k] = true; host.sfx.pickup(); host.onStats({ lives: cities.filter(Boolean).length }); }
    }
    host.onStats({ score });
  }

  function update() {
    if (tally) {
      // Wave tally: count leftover ammo and surviving cities, then go again.
      if (--tally.t <= 0) {
        if (!cities.some(Boolean)) return finish();
        level++;
        host.onStats({ level });
        newWave();
      }
      return;
    }

    if (keys.left) crosshair.x -= 4;
    if (keys.right) crosshair.x += 4;
    if (keys.up) crosshair.y -= 4;
    if (keys.down) crosshair.y += 4;
    crosshair.x = Math.max(4, Math.min(W - 4, crosshair.x));
    crosshair.y = Math.max(4, Math.min(GROUND - 24, crosshair.y));

    if (toLaunch > 0 && --launchT <= 0) {
      const n = Math.min(toLaunch, 1 + ((Math.random() * Math.min(4, 1 + level / 2)) | 0));
      for (let i = 0; i < n; i++) launch();
      toLaunch -= n;
      launchT = Math.max(50, 170 - level * 10) / D.count;
    }

    for (const f of foes) {
      f.x += f.vx; f.y += f.vy;
      if (f.split && f.y > f.split) {
        f.split = 0;
        for (let k = 0; k < 2; k++) launch(f);
      }
    }
    // Hits on the ground: the city or silo underneath is gone.
    foes = foes.filter((f) => {
      if (f.y < GROUND) return true;
      blast(f.x, GROUND - 4, 22);
      const g = f.goal;
      if (g.kind === 'city' && cities[g.i]) { cities[g.i] = false; host.sfx.hit(); host.onStats({ lives: cities.filter(Boolean).length }); }
      if (g.kind === 'silo') { silos[g.i].alive = false; silos[g.i].ammo = 0; host.sfx.hit(); }
      return false;
    });

    mine = mine.filter((m) => {
      m.x += m.vx; m.y += m.vy;
      if ((m.tx - m.x) * m.vx + (m.ty - m.y) * m.vy > 0) return true;
      blast(m.tx, m.ty);
      return false;
    });

    for (const b of blasts) {
      b.t++;
      b.r = b.t < 30 ? b.max * (b.t / 30) : b.t < 50 ? b.max : b.max * (1 - (b.t - 50) / 25);
    }
    blasts = blasts.filter((b) => b.t < 75);

    // Anything inside a blast goes up too — chains are the whole game.
    foes = foes.filter((f) => {
      if (!blasts.some((b) => (f.x - b.x) ** 2 + (f.y - b.y) ** 2 < b.r * b.r)) return true;
      addScore(25 * mult());
      blast(f.x, f.y, 20);
      return false;
    });

    if (!toLaunch && !foes.length && !blasts.length && !mine.length) {
      const ammo = silos.reduce((n, s) => n + s.ammo, 0);
      const alive = cities.filter(Boolean).length;
      addScore((ammo * 5 + alive * 100) * mult());
      tally = { t: 150, ammo, alive };
      if (alive) host.sfx.win();
    }
    if (!lost && !cities.some(Boolean)) { lost = true; toLaunch = 0; }
  }

  function trail(o, ink) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(o.x, o.y); ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(o.x - 1.5, o.y - 1.5, 3, 3);
  }

  function draw() {
    const p = pal();
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);

    // Ground with three hills for the silos.
    ctx.fillStyle = p.ground;
    ctx.fillRect(0, GROUND, W, H - GROUND);
    silos.forEach((s) => {
      ctx.beginPath();
      ctx.moveTo(s.x - 26, GROUND); ctx.lineTo(s.x - 14, GROUND - 14); ctx.lineTo(s.x + 14, GROUND - 14); ctx.lineTo(s.x + 26, GROUND);
      ctx.fill();
    });
    // Ammo left, stacked on each hill.
    ctx.fillStyle = p.city;
    silos.forEach((s) => {
      for (let k = 0; k < s.ammo; k++) {
        const row = Math.floor(k / 4), col = k % 4;
        ctx.fillRect(s.x - 9 + col * 5 - row * 0, GROUND - 22 - row * 5, 3, 4);
      }
    });

    cities.forEach((alive, i) => {
      const x = CITY_X[i];
      if (alive) {
        ctx.fillStyle = p.city;
        [[-12, 8], [-8, 14], [-3, 10], [1, 16], [6, 9], [10, 12]].forEach(([dx, h]) => ctx.fillRect(x + dx, GROUND - h, 4, h));
        ctx.fillStyle = '#08070A';
        ctx.fillRect(x - 7, GROUND - 11, 1, 1); ctx.fillRect(x + 2, GROUND - 13, 1, 1); ctx.fillRect(x + 11, GROUND - 9, 1, 1);
      } else {
        ctx.fillStyle = '#3A3346';
        ctx.fillRect(x - 12, GROUND - 3, 26, 3);
      }
    });

    foes.forEach((f) => trail(f, p.foe));
    mine.forEach((m) => {
      trail(m, p.mine);
      ctx.strokeStyle = p.mine;   // the X where it will burst
      ctx.beginPath(); ctx.moveTo(m.tx - 3, m.ty - 3); ctx.lineTo(m.tx + 3, m.ty + 3); ctx.moveTo(m.tx + 3, m.ty - 3); ctx.lineTo(m.tx - 3, m.ty + 3); ctx.stroke();
    });

    // Blasts flash through the palette, as the phosphor did.
    blasts.forEach((b, i) => {
      const inks = [p.foe, p.mine, p.city, '#FFFFFF'];
      ctx.fillStyle = inks[(Math.floor(b.t / 3) + i) % inks.length];
      ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(0, b.r), 0, Math.PI * 2); ctx.fill();
    });

    // Crosshair (keyboard aim).
    ctx.strokeStyle = '#F5F2EA';
    ctx.lineWidth = 1;
    const { x, y } = crosshair;
    ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x - 2, y); ctx.moveTo(x + 2, y); ctx.lineTo(x + 7, y);
    ctx.moveTo(x, y - 7); ctx.lineTo(x, y - 2); ctx.moveTo(x, y + 2); ctx.lineTo(x, y + 7); ctx.stroke();

    ctx.font = '700 12px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    if (tally) {
      ctx.fillStyle = p.city;
      ctx.font = '700 15px ui-monospace, Consolas, monospace';
      ctx.fillText(`VAGUE ${level} — BONUS ×${mult()}`, W / 2, 120);
      ctx.fillText(`MUNITIONS ${tally.ammo} × 5`, W / 2, 150);
      ctx.fillText(`VILLES ${tally.alive} × 100`, W / 2, 174);
    } else if (launchT > 0 && foes.length === 0 && toLaunch > 0 && score === 0) {
      ctx.fillStyle = p.city;
      ctx.fillText('DÉFENDS LES VILLES', W / 2, 140);
    }
    ctx.fillStyle = p.foe;
    ctx.fillText(`×${mult()}`, W / 2, 16);
    ctx.textAlign = 'start';
  }

  const onPointer = (e) => {
    e.preventDefault();
    const b = canvas.getBoundingClientRect();
    const x = (e.clientX - b.left) * (W / b.width), y = (e.clientY - b.top) * (H / b.height);
    crosshair = { x, y };
    fire(x, y);
  };

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
      score = 0; level = 1; bonusNext = 10000; lost = false;
      cities = CITY_X.map(() => true);
      crosshair = { x: W / 2, y: H / 2 };
      keys = { left: false, right: false, up: false, down: false };
      paused = false; running = true; over = false; last = 0; acc = 0;
      newWave();
      canvas.addEventListener('pointerdown', onPointer);
      host.onStats({ score, level, lives: cities.length });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a in keys) keys[a] = down;
      if (a === 'action' && down) fire(crosshair.x, crosshair.y);
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onPointer);
    },
  };
}
