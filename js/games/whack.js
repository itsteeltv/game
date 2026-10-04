// Tape-Taupe. Nine holes, one clock. Tap the moles, never the bombs; a streak multiplies your points
// and a golden mole is worth five. Keys 1–9 mirror the grid like a numpad (7 8 9 / 4 5 6 / 1 2 3).
export function createGame(canvas, host, opts = {}) {
  canvas.width = 360; canvas.height = 410;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const lvl = opts.difficulty ?? 1;
  const DURATION = [60000, 45000, 40000][lvl];
  const SPAWN = [[1100, 650], [950, 470], [800, 360]][lvl];     // ms between pop-ups: start, end
  const STAY = [[1350, 850], [1100, 640], [900, 500]][lvl];     // how long a mole stays up: start, end
  const BOMB = [0.1, 0.16, 0.22][lvl];

  const HX = [64, 180, 296], HY = [140, 250, 360];
  const RX = 46, RY = 17;

  let holes, score, combo, elapsed, spawnT, floaters, cursor, showCursor, shake, secLeft;
  let paused = false, running = false, over = false, rafId = null, last = 0;

  const lerp = (a, b, t) => a + (b - a) * t;
  const progress = () => Math.min(1, elapsed / DURATION);

  function spawn() {
    const free = holes.map((h, i) => (h.ph === 'idle' ? i : -1)).filter((i) => i >= 0);
    const maxUp = 1 + Math.floor(progress() * 2.4);
    if (!free.length || holes.filter((h) => h.ph !== 'idle').length >= maxUp) return;
    const h = holes[free[(Math.random() * free.length) | 0]];
    const roll = Math.random();
    h.kind = roll < BOMB ? 'bomb' : roll < BOMB + 0.06 ? 'gold' : 'mole';
    h.ph = 'up'; h.t = 0; h.p = 0;
    h.stay = lerp(STAY[0], STAY[1], progress()) * (h.kind === 'gold' ? 0.7 : 1);
  }

  function whack(i) {
    if (!running || paused || over) return;
    const h = holes[i];
    if (h.ph !== 'up') { combo = 0; return; }   // swinging at an empty hole breaks the streak
    h.ph = 'hit'; h.t = 0;
    const cx = HX[i % 3], cy = HY[Math.floor(i / 3)];
    if (h.kind === 'bomb') {
      score = Math.max(0, score - 40);
      combo = 0; shake = 260;
      floaters.push({ x: cx, y: cy - 50, text: '−40', color: '#FF4D1F', t: 0 });
      host.sfx.hit();
    } else {
      const base = h.kind === 'gold' ? 50 : 10;
      const gain = base * (1 + Math.floor(combo / 4));
      combo++;
      score += gain;
      floaters.push({ x: cx, y: cy - 50, text: `+${gain}`, color: h.kind === 'gold' ? '#FFD34E' : '#8BE04E', t: 0 });
      host.sfx[h.kind === 'gold' ? 'pickup' : 'score']();
    }
    host.onStats({ score, level: 1 + Math.floor(progress() * 4), lives: secLeft });
  }

  function finish() {
    over = true; running = false;
    draw();
    host.onStats({ score, level: 4, lives: 0 });
    // A decent haul is a win; a poor one is just the end of the clock.
    host.onGameOver(score, score >= [180, 250, 300][lvl]);
  }

  function ellipse(x, y, rx, ry, from = 0, to = Math.PI * 2) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, from, to);
  }

  // ctx.roundRect is missing from older Safari; a path of our own works everywhere.
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCreature(h, x, y) {
    // Everything is drawn around (x, y) = the creature's centre while fully up.
    if (h.kind === 'bomb') {
      ctx.fillStyle = '#1B1A21';
      ctx.beginPath(); ctx.arc(x, y + 6, 31, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(x - 11, y - 4, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8E8A98'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x + 8, y - 24); ctx.quadraticCurveTo(x + 18, y - 38, x + 28, y - 34); ctx.stroke();
      ctx.fillStyle = Math.floor(h.t / 90) % 2 ? '#FFD34E' : '#FF4D1F';
      ctx.beginPath(); ctx.arc(x + 29, y - 35, 5, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const gold = h.kind === 'gold';
    ctx.fillStyle = gold ? '#FFB020' : '#8A5A33';
    ctx.beginPath(); ctx.arc(x, y + 4, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = gold ? '#FFE08A' : '#B98557';
    ctx.beginPath(); ctx.ellipse(x, y + 16, 19, 14, 0, 0, Math.PI * 2); ctx.fill();   // muzzle
    ctx.fillStyle = '#F5F5F7';
    for (const dx of [-13, 13]) { ctx.beginPath(); ctx.arc(x + dx, y - 6, 8, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#0A0A0C';
    const dead = h.ph === 'hit';
    for (const dx of [-13, 13]) {
      if (dead) {   // stunned: crossed eyes
        ctx.strokeStyle = '#0A0A0C'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x + dx - 4, y - 10); ctx.lineTo(x + dx + 4, y - 2); ctx.moveTo(x + dx + 4, y - 10); ctx.lineTo(x + dx - 4, y - 2); ctx.stroke();
      } else { ctx.beginPath(); ctx.arc(x + dx, y - 5, 3.6, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.fillStyle = '#FF5C8A';
    ctx.beginPath(); ctx.ellipse(x, y + 10, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    ctx.fillStyle = '#08070A';
    ctx.fillRect(-10, -10, W + 20, H + 20);

    // The field.
    const g = ctx.createLinearGradient(0, 40, 0, H);
    g.addColorStop(0, '#16301F'); g.addColorStop(1, '#0E1F15');
    ctx.fillStyle = g;
    rr(8, 44, W - 16, H - 52, 18); ctx.fill();

    ctx.font = '600 13px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8E8A98';
    ctx.textAlign = 'left';
    const secs = Math.ceil(Math.max(0, DURATION - elapsed) / 1000);
    ctx.fillText(`TEMPS ${secs}s`, 12, 22);
    ctx.textAlign = 'right';
    ctx.fillStyle = combo >= 4 ? '#FFD34E' : '#8E8A98';
    ctx.fillText(`SÉRIE ×${1 + Math.floor(combo / 4)}`, W - 12, 22);

    for (let i = 0; i < 9; i++) {
      const x = HX[i % 3], y = HY[Math.floor(i / 3)], h = holes[i];
      // Back of the hole.
      ctx.fillStyle = '#05100A';
      ellipse(x, y, RX, RY); ctx.fill();
      // The creature, clipped so it rises out of the dark and not over the grass in front.
      if (h.ph !== 'idle') {
        ctx.save();
        ctx.beginPath(); ctx.rect(x - 70, y - 120, 140, 120 + 2); ctx.clip();
        drawCreature(h, x, y + 4 + (1 - h.p) * 70 - 24);
        ctx.restore();
      }
      // Front lip of the hole, over the creature's feet.
      ctx.strokeStyle = '#2C5A3A'; ctx.lineWidth = 6;
      ellipse(x, y, RX, RY, 0, Math.PI); ctx.stroke();
      ctx.fillStyle = '#16301F';
      ellipse(x, y + 4, RX + 3, RY + 2, 0, Math.PI); ctx.fill();

      if (showCursor && cursor === i) {
        ctx.strokeStyle = '#F5F5F7'; ctx.lineWidth = 3;
        rr(x - 58, y - 78, 116, 112, 16); ctx.stroke();
      }
      // The key that hits this hole, faint: a numpad hint for keyboard players.
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = '700 12px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(7 - 3 * Math.floor(i / 3) + (i % 3)), x, y + 34);
    }

    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / 700);
      ctx.fillStyle = f.color;
      ctx.font = '800 22px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y - f.t / 14);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function update(dt) {
    elapsed += dt;
    if (shake > 0) shake -= dt;
    spawnT -= dt;
    if (spawnT <= 0) { spawn(); spawnT = lerp(SPAWN[0], SPAWN[1], progress()) * (0.75 + Math.random() * 0.5); }
    for (const h of holes) {
      if (h.ph === 'idle') continue;
      h.t += dt;
      if (h.ph === 'up') {
        h.p = Math.min(1, h.t / 110);
        if (h.t > h.stay) { h.ph = 'down'; h.t = 0; if (h.kind !== 'bomb') combo = 0; }   // a mole got away: streak lost
      } else if (h.ph === 'down') {
        h.p = Math.max(0, 1 - h.t / 140);
        if (h.p <= 0) h.ph = 'idle';
      } else if (h.ph === 'hit') {
        h.p = Math.max(0, 1 - Math.max(0, h.t - 160) / 160);
        if (h.t > 320) h.ph = 'idle';
      }
    }
    for (const f of floaters) f.t += dt;
    floaters = floaters.filter((f) => f.t < 700);
    const left = Math.ceil(Math.max(0, DURATION - elapsed) / 1000);
    if (left !== secLeft) { secLeft = left; host.onStats({ score, level: 1 + Math.floor(progress() * 4), lives: secLeft }); }
    if (elapsed >= DURATION) finish();
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(64, last ? t - last : 16);
    last = t;
    if (!paused) { update(dt); if (running) draw(); }
    rafId = requestAnimationFrame(loop);
  }

  const onDown = (e) => {
    e.preventDefault();
    const b = canvas.getBoundingClientRect();
    const x = (e.clientX - b.left) * (W / b.width), y = (e.clientY - b.top) * (H / b.height);
    // Nearest hole whose area (the creature stands above it) is under the finger — generous, for thumbs.
    let best = -1, bd = 1e9;
    for (let i = 0; i < 9; i++) {
      const dx = x - HX[i % 3], dy = y - (HY[Math.floor(i / 3)] - 30);
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (bd < 62 * 62) { showCursor = false; cursor = best; whack(best); }
  };

  // Numpad layout: 7 8 9 on top. Registered here because the shell only forwards arrows and Space.
  const onKeys = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (!/^[1-9]$/.test(e.key) || e.repeat) return;
    const n = Number(e.key);
    const i = (2 - Math.floor((n - 1) / 3)) * 3 + ((n - 1) % 3);
    showCursor = true; cursor = i;
    whack(i);
  };

  return {
    start() {
      holes = Array.from({ length: 9 }, () => ({ ph: 'idle', t: 0, p: 0, kind: 'mole', stay: 1000 }));
      score = 0; combo = 0; elapsed = 0; spawnT = 500; floaters = []; cursor = 4; showCursor = false; shake = 0;
      secLeft = Math.ceil(DURATION / 1000);
      paused = false; running = true; over = false; last = 0;
      canvas.addEventListener('pointerdown', onDown);
      window.addEventListener('keydown', onKeys);
      host.onStats({ score: 0, level: 1, lives: secLeft });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down || !running) return;
      showCursor = true;
      const r = Math.floor(cursor / 3), c = cursor % 3;
      if (a === 'left') cursor = r * 3 + Math.max(0, c - 1);
      else if (a === 'right') cursor = r * 3 + Math.min(2, c + 1);
      else if (a === 'up') cursor = Math.max(0, r - 1) * 3 + c;
      else if (a === 'down') cursor = Math.min(2, r + 1) * 3 + c;
      else if (a === 'action') whack(cursor);
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKeys);
    },
  };
}
