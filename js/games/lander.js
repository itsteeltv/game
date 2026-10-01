// Moon landing in the 1979 mould: a vector lander, gravity, a rotating thrust
// and a fuel tank that is the whole game. Land gently and upright on a flat pad
// — the narrower the pad, the bigger the multiplier. The game ends when the
// tank runs dry; a crash costs fuel. The instruments read like the cabinet's.
export function createGame(canvas, host, opts = {}) {
  // Difficulty: starting fuel, gravity, how gentle a landing must be.
  const D = [
    { fuel: 1600, g: 0.010, vy: 1.3, vx: 0.9 },
    { fuel: 1200, g: 0.013, vy: 1.0, vx: 0.7 },
    { fuel: 900, g: 0.016, vy: 0.8, vx: 0.55 },
  ][opts.difficulty ?? 1];

  canvas.width = 480; canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  let ground, pads, ship, fuel, score, level, keys, state, stateT, debris, rumble, msg;
  let paused = false, running = false, rafId = null, last = 0, acc = 0, over = false;

  function terrain() {
    // A jagged ridge with three flat pads cut into it: wide ×2, medium ×3, narrow ×5.
    const pts = [];
    let y = H - 70;
    for (let x = 0; x <= W; x += 12) {
      y += (Math.random() - 0.5) * 34;
      y = Math.max(H - 150, Math.min(H - 18, y));
      pts.push([x, y]);
    }
    pads = [];
    const spots = [0.18, 0.5, 0.8].sort(() => Math.random() - 0.5);
    [[56, 2], [38, 3], [26, 5]].forEach(([w, mult], i) => {
      const cx = spots[i] * W, py = pts[Math.round(cx / 12)][1];
      pads.push({ x1: cx - w / 2, x2: cx + w / 2, y: py, mult });
      pts.forEach((p) => { if (p[0] >= cx - w / 2 - 6 && p[0] <= cx + w / 2 + 6) p[1] = py; });
    });
    ground = pts;
  }

  const groundAt = (x) => {
    const i = Math.max(0, Math.min(ground.length - 2, Math.floor(x / 12)));
    const [x0, y0] = ground[i], [x1, y1] = ground[i + 1];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  };

  function newDescent() {
    terrain();
    ship = { x: 40 + Math.random() * (W - 80), y: 40, vx: (Math.random() - 0.5) * 1.6, vy: 0, a: 0, thrust: false };
    state = 'fly'; stateT = 0; debris = [];
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function landed(pad) {
    // A gentle touchdown pays the pad's multiplier, plus a little fuel back.
    const soft = Math.abs(ship.vy) < D.vy * 0.5;
    const v = (soft ? 50 : 15) * pad.mult;
    score += v;
    fuel += soft ? 50 : 0;
    msg = soft ? `PARFAIT — ${v} PTS` : `ATTERRISSAGE DUR — ${v} PTS`;
    state = 'landed'; stateT = 140;
    host.sfx.win();
    host.onStats({ score, lives: Math.round(fuel) });
  }

  function crash() {
    const lost = Math.min(fuel, 200);
    fuel -= lost;
    msg = `ÉCRASÉ — ${lost} UNITÉS DE CARBURANT PERDUES`;
    state = 'crashed'; stateT = 140;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.5 + Math.random() * 2.5;
      debris.push({ x: ship.x, y: ship.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, r: Math.random() * 6, t: 80 + Math.random() * 60 });
    }
    host.sfx.hit();
    host.onStats({ lives: Math.round(fuel) });
  }

  function update() {
    if (state !== 'fly') {
      debris.forEach((d) => { d.x += d.vx; d.y += d.vy; d.vy += D.g * 3; d.t--; if (d.y > groundAt(Math.max(0, Math.min(W, d.x)))) { d.vy *= -0.3; d.vx *= 0.6; } });
      if (--stateT <= 0) {
        if (fuel <= 0) return finish();
        if (state === 'landed') { level++; host.onStats({ level }); }
        newDescent();
      }
      return;
    }

    if (keys.left) ship.a -= 0.045;
    if (keys.right) ship.a += 0.045;
    ship.a = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, ship.a));
    ship.thrust = (keys.up || keys.fire) && fuel > 0;
    if (ship.thrust) {
      ship.vx += Math.sin(ship.a) * 0.032;
      ship.vy -= Math.cos(ship.a) * 0.032;
      fuel = Math.max(0, fuel - 0.9);
      if ((rumble = (rumble + 1) % 5) === 0) host.tone?.({ freq: 55 + Math.random() * 25, duration: 0.09, type: 'sawtooth', gain: 0.06 });
      if (Math.round(fuel) % 20 === 0) host.onStats({ lives: Math.round(fuel) });
    }
    ship.vy += D.g * (1 + (level - 1) * 0.06);
    ship.x += ship.vx; ship.y += ship.vy;
    if (ship.x < 0) ship.x += W;
    if (ship.x > W) ship.x -= W;
    if (ship.y < 10) { ship.y = 10; ship.vy = Math.max(0, ship.vy); }

    // Touchdown: both feet on a pad, slow, upright.
    const foot = ship.y + 9;
    if (foot >= groundAt(ship.x - 7) || foot >= groundAt(ship.x + 7)) {
      const pad = pads.find((p) => ship.x - 7 >= p.x1 && ship.x + 7 <= p.x2);
      if (pad && Math.abs(ship.vy) < D.vy && Math.abs(ship.vx) < D.vx && Math.abs(ship.a) < 0.22) {
        ship.y = pad.y - 9; ship.a = 0;
        landed(pad);
      } else crash();
    }
  }

  function lines(pts, close = false) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (close) ctx.closePath();
    ctx.stroke();
  }

  function drawShip() {
    const { x, y, a } = ship;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    lines([[-5, -9], [5, -9], [7, -5], [7, -1], [-7, -1], [-7, -5]], true);   // cabin
    lines([[-8, -1], [8, -1], [8, 3], [-8, 3]], true);                       // descent stage
    lines([[-6, 3], [-9, 9]]); lines([[6, 3], [9, 9]]);                      // legs
    lines([[-11, 9], [-7, 9]]); lines([[7, 9], [11, 9]]);                    // feet
    lines([[-2, 3], [-3, 6], [3, 6], [2, 3]]);                              // nozzle
    if (ship.thrust) {
      ctx.strokeStyle = '#FFB020';
      lines([[-3, 6], [0, 10 + Math.random() * 10], [3, 6]]);
    }
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1.3;
    ctx.shadowBlur = 5;
    ctx.shadowColor = 'rgba(200, 220, 255, 0.8)';
    ctx.strokeStyle = '#E8EEFF';

    lines(ground);
    ctx.font = '700 10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#E8EEFF';
    pads.forEach((p) => {
      ctx.strokeStyle = '#FFD34E';
      lines([[p.x1, p.y], [p.x2, p.y]]);
      ctx.fillStyle = '#FFD34E';
      ctx.fillText(`×${p.mult}`, (p.x1 + p.x2) / 2, p.y + 14);
    });
    ctx.strokeStyle = '#E8EEFF';

    if (state !== 'crashed') drawShip();
    debris.forEach((d) => { if (d.t > 0) lines([[d.x, d.y], [d.x + Math.cos(d.r) * 4, d.y + Math.sin(d.r) * 4]]); });

    // Instruments, top corners, in the cabinet's wording.
    ctx.textAlign = 'left';
    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#E8EEFF';
    const alt = Math.max(0, Math.round(groundAt(ship.x) - ship.y - 9));
    ctx.fillText(`SCORE     ${String(score).padStart(4, '0')}`, 12, 18);
    ctx.fillText(`CARBURANT ${String(Math.round(fuel)).padStart(4, '0')}`, 12, 32);
    ctx.textAlign = 'right';
    const arrowH = ship.vx > 0.05 ? '→' : ship.vx < -0.05 ? '←' : ' ';
    const arrowV = ship.vy > 0.05 ? '↓' : ship.vy < -0.05 ? '↑' : ' ';
    ctx.fillText(`ALTITUDE ${String(alt).padStart(4, ' ')}`, W - 12, 18);
    ctx.fillStyle = Math.abs(ship.vx) < D.vx ? '#E8EEFF' : '#FF4D1F';
    ctx.fillText(`VITESSE H ${(Math.abs(ship.vx) * 20).toFixed(0).padStart(3, ' ')} ${arrowH}`, W - 12, 32);
    ctx.fillStyle = Math.abs(ship.vy) < D.vy ? '#E8EEFF' : '#FF4D1F';
    ctx.fillText(`VITESSE V ${(Math.abs(ship.vy) * 20).toFixed(0).padStart(3, ' ')} ${arrowV}`, W - 12, 46);

    if (state !== 'fly') {
      ctx.textAlign = 'center';
      ctx.font = '700 13px ui-monospace, Consolas, monospace';
      ctx.fillStyle = state === 'landed' ? '#8BE04E' : '#FF4D1F';
      ctx.fillText(msg, W / 2, H / 2 - 40);
      if (fuel <= 0) ctx.fillText('RÉSERVOIR VIDE', W / 2, H / 2 - 20);
    } else if (fuel <= 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FF4D1F';
      ctx.fillText('PLUS DE CARBURANT', W / 2, 70);
    }
    ctx.textAlign = 'start';
    ctx.shadowBlur = 0;
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
      fuel = D.fuel; score = 0; level = 1; rumble = 0; msg = '';
      keys = { left: false, right: false, up: false, fire: false };
      paused = false; running = true; over = false; last = 0; acc = 0;
      newDescent();
      host.onStats({ score, level, lives: fuel });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'left' || a === 'right' || a === 'up') keys[a] = down;
      if (a === 'action') keys.fire = down;
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
