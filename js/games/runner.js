// Cosmo-Course. An astronaut runs by itself across a neon planet; you only decide when to jump.
// Hold the button for a higher jump. Rocks must be cleared — but a drone cruising at head height is
// only dangerous if you jump into it, so sometimes the right move is to stay on the ground.
// Stars floating over the rocks are worth 50 each.
export function createGame(canvas, host, opts = {}) {
  canvas.width = 480; canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, GY = 292;

  const lvl = opts.difficulty ?? 1;
  const [V0, VMAX] = [[4.6, 8.2], [5.3, 9.6], [6.1, 11.2]][lvl];   // px per 60 Hz frame: start, top speed
  const GRAV = 0.78, GRAV_HOLD = 0.42, JUMP = -11.2;                  // lighter gravity while the button is held and rising
  const PX = 96, PW = 22, PH = 40;
  const STEP = 1000 / 60;

  const me = { y: GY - PH, vy: 0, ground: true, held: false, buffer: 0, coyote: 0 };
  let obs, coins, dist, nextAt, speed, frame, stars, taken, dust;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;

  const rand = (a, b) => a + Math.random() * (b - a);

  function jump() {
    me.vy = JUMP; me.ground = false; me.coyote = 0; me.buffer = 0;
    host.sfx.move();
  }

  function spawn() {
    const score = Math.floor(dist / 10);
    const roll = Math.random();
    let o;
    if (score > 120 && roll < 0.2) o = { kind: 'drone', w: 42, h: 20, y: GY - 96 - rand(0, 10), bob: Math.random() * 6 };
    else if (roll < 0.5) o = { kind: 'rock', w: 22, h: 28 };
    else if (roll < 0.74) o = { kind: 'rock', w: 30, h: 42 };
    else if (roll < 0.88) o = { kind: 'rock', w: 42, h: 56 };
    else o = { kind: 'twin', w: 52, h: 30 };
    o.x = W + 30;
    if (o.kind !== 'drone') o.y = GY - o.h;
    obs.push(o);
    // A little arc of stars over a rock: the reward for a well-timed jump.
    if (o.kind !== 'drone' && Math.random() < 0.55) {
      for (let k = -1; k <= 1; k++) coins.push({ x: o.x + o.w / 2 + k * 26, y: o.y - 40 - (1 - Math.abs(k)) * 16, spin: Math.random() * 6 });
    }
    // Room to land and look again: grows with the speed, so the pace never gets unfair.
    nextAt = speed * rand(40, 62) + o.w;
  }

  function hit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function update() {
    frame++;
    speed = Math.min(VMAX, V0 + dist / 1800);
    dist += speed;

    // Jump: a press just before landing, or just after leaving a ledge, still counts.
    me.coyote = me.ground ? 6 : Math.max(0, me.coyote - 1);
    if (me.buffer > 0) me.buffer--;
    if (me.buffer > 0 && (me.ground || me.coyote > 0)) jump();
    me.vy += me.vy < 0 && me.held ? GRAV_HOLD : GRAV;
    me.y += me.vy;
    if (me.y >= GY - PH) {
      if (!me.ground) for (let i = 0; i < 5; i++) dust.push({ x: PX + 10, y: GY, vx: rand(-2.4, 0.6), vy: rand(-1.6, -0.2), t: 0 });
      me.y = GY - PH; me.vy = 0; me.ground = true;
    } else me.ground = false;

    nextAt -= speed;
    if (nextAt <= 0) spawn();
    for (const o of obs) o.x -= speed + (o.kind === 'drone' ? 1.6 : 0);
    for (const c of coins) c.x -= speed;
    obs = obs.filter((o) => o.x > -80);
    coins = coins.filter((c) => c.x > -30 && !c.got);
    for (const d of dust) { d.x += d.vx - speed * 0.6; d.y += d.vy; d.t++; }
    dust = dust.filter((d) => d.t < 22);

    const body = { x: PX + 4, y: me.y + 4, w: PW - 8, h: PH - 6 };
    for (const o of obs) {
      if (hit(body, { x: o.x + 3, y: o.y + 3 + (o.kind === 'drone' ? Math.sin((frame + o.bob * 10) / 9) * 4 : 0), w: o.w - 6, h: o.h - 6 })) return finish();
    }
    for (const c of coins) {
      if (Math.hypot(c.x - (PX + PW / 2), c.y - (me.y + PH / 2)) < 24) { c.got = true; taken++; host.sfx.pickup(); }
    }
    const score = Math.floor(dist / 10) + taken * 50;
    if (frame % 6 === 0) host.onStats({ score, level: 1 + Math.floor(score / 300) });
  }

  function finish() {
    over = true; running = false;
    draw(true);
    const score = Math.floor(dist / 10) + taken * 50;
    host.onStats({ score, level: 1 + Math.floor(score / 300) });
    host.onGameOver(score, false);
  }

  function mountains(base, amp, f1, f2, off, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, GY);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, base - amp * (Math.sin((x + off) * f1) + 0.5 * Math.sin((x + off) * f2) + 1));
    ctx.lineTo(W, GY);
    ctx.closePath();
    ctx.fill();
  }

  function draw(crashed = false) {
    const sky = ctx.createLinearGradient(0, 0, 0, GY);
    sky.addColorStop(0, '#0E0926'); sky.addColorStop(0.55, '#2E1257'); sky.addColorStop(1, '#8A2F6B');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.5 * Math.abs(Math.sin((frame + s.p) / 30))})`;
      ctx.fillRect(((s.x - dist * s.z * 0.05) % W + W) % W, s.y, 2, 2);
    }
    // A striped sun sinking behind the ridge.
    const sun = ctx.createLinearGradient(0, 120, 0, 260);
    sun.addColorStop(0, '#FFD34E'); sun.addColorStop(1, '#FF4D1F');
    ctx.fillStyle = sun;
    ctx.beginPath(); ctx.arc(350, 214, 74, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2E1257';
    for (let k = 0; k < 6; k++) ctx.fillRect(270, 190 + k * 14, 160, 2 + k * 1.2);
    mountains(GY - 40, 26, 0.012, 0.031, dist * 0.18, '#3B1670');
    mountains(GY - 8, 22, 0.02, 0.047, dist * 0.45, '#1C0B3C');

    // Ground with a neon edge and a perspective grid rolling under the runner.
    ctx.fillStyle = '#12082B';
    ctx.fillRect(0, GY, W, H - GY);
    ctx.strokeStyle = 'rgba(255,77,31,0.55)'; ctx.lineWidth = 1;
    for (let k = 1; k < 7; k++) { const y = GY + k * k * 1.8; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    for (let x = -W; x < W * 2; x += 56) {
      const sx = x - (dist % 56);
      ctx.beginPath(); ctx.moveTo(sx, GY); ctx.lineTo(W / 2 + (sx - W / 2) * 3.2, H); ctx.stroke();
    }
    ctx.shadowColor = '#FF4D1F'; ctx.shadowBlur = 12; ctx.strokeStyle = '#FF7A4D'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, GY); ctx.lineTo(W, GY); ctx.stroke();
    ctx.shadowBlur = 0;

    for (const o of obs) {
      if (o.kind === 'drone') {
        const y = o.y + Math.sin((frame + o.bob * 10) / 9) * 4;
        ctx.shadowColor = '#4EA8FF'; ctx.shadowBlur = 10;
        ctx.fillStyle = '#9FB0C9';
        ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, y + 11, o.w / 2, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#4EA8FF';
        ctx.beginPath(); ctx.arc(o.x + o.w / 2, y + 8, 6, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#FF4D1F';
        ctx.fillRect(o.x + o.w / 2 - 3 + Math.sin(frame / 4) * 10, y + 15, 6, 3);
      } else {
        const parts = o.kind === 'twin' ? [[0, 22, 26], [30, 22, 32]] : [[0, o.w, o.h]];
        for (const [dx, w, h] of parts) {
          ctx.shadowColor = '#FF4D1F'; ctx.shadowBlur = 10;
          ctx.fillStyle = '#FF4D1F';
          ctx.beginPath();
          ctx.moveTo(o.x + dx, GY);
          ctx.lineTo(o.x + dx + w * 0.12, GY - h * 0.7);
          ctx.lineTo(o.x + dx + w * 0.4, GY - h);
          ctx.lineTo(o.x + dx + w * 0.82, GY - h * 0.78);
          ctx.lineTo(o.x + dx + w, GY);
          ctx.closePath(); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.beginPath(); ctx.moveTo(o.x + dx + w * 0.4, GY - h); ctx.lineTo(o.x + dx + w * 0.55, GY - h * 0.55); ctx.lineTo(o.x + dx + w * 0.3, GY - h * 0.4); ctx.closePath(); ctx.fill();
        }
      }
    }

    for (const c of coins) {
      c.spin += 0.12;
      const sx = Math.abs(Math.cos(c.spin));
      ctx.fillStyle = '#FFD34E';
      ctx.shadowColor = '#FFD34E'; ctx.shadowBlur = 8;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) { const a = (k * Math.PI) / 5 - Math.PI / 2, r = k % 2 ? 4.6 : 11; ctx.lineTo(c.x + Math.cos(a) * r * (0.35 + 0.65 * sx), c.y + Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (const d of dust) { ctx.fillStyle = `rgba(245,245,247,${0.5 * (1 - d.t / 22)})`; ctx.fillRect(d.x, d.y, 3, 3); }

    // The astronaut: backpack, suit, helmet with a glowing visor, and legs that run or tuck.
    const x = PX, y = me.y;
    const stride = me.ground ? Math.sin(dist * 0.28) * 7 : 0;
    ctx.fillStyle = '#9FB0C9'; ctx.fillRect(x - 6, y + 14, 9, 17);
    ctx.fillStyle = crashed ? '#B8B4C2' : '#F5F5F7';
    ctx.fillRect(x + 1, y + 28, 7, me.ground ? 12 + stride * 0.3 : 8);                      // legs
    ctx.save(); ctx.translate(stride * 0.5, 0); ctx.fillRect(x + 12, y + 28, 7, me.ground ? 12 - stride * 0.3 : 10); ctx.restore();
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y + 12, PW, 20, 6) : ctx.rect(x, y + 12, PW, 20); ctx.fill();   // torso
    ctx.beginPath(); ctx.arc(x + PW / 2 + 2, y + 9, 11, 0, Math.PI * 2); ctx.fill();                                    // helmet
    ctx.fillStyle = '#0A0A0C';
    ctx.beginPath(); ctx.ellipse(x + PW / 2 + 5, y + 9, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4EA8FF';
    ctx.beginPath(); ctx.ellipse(x + PW / 2 + 7, y + 7, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FF4D1F'; ctx.fillRect(x + 8, y + 20, 6, 3);                           // chest light
  }

  function loop(t) {
    if (!running) return;
    acc = paused ? 0 : acc + Math.min(100, last ? t - last : STEP);
    last = t;
    for (; acc >= STEP && running; acc -= STEP) update();
    if (running && !paused) draw();
    rafId = requestAnimationFrame(loop);
  }

  function press(down) {
    if (!running || paused) return;
    me.held = down;
    if (down) { me.buffer = 7; if (me.ground || me.coyote > 0) jump(); }
  }
  const onDown = (e) => { e.preventDefault(); press(true); };
  const onUp = () => press(false);

  return {
    start() {
      obs = []; coins = []; dust = []; dist = 0; nextAt = 260; speed = V0; frame = 0; taken = 0;
      stars = Array.from({ length: 56 }, () => ({ x: Math.random() * W, y: Math.random() * (GY - 60), z: 0.3 + Math.random(), p: Math.random() * 100 }));
      me.y = GY - PH; me.vy = 0; me.ground = true; me.held = false; me.buffer = 0; me.coyote = 0;
      paused = false; running = true; over = false; last = 0; acc = 0;
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      host.onStats({ score: 0, level: 1 });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'up' || a === 'action') press(down);
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
