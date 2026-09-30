// Simon — watch the sequence, repeat it. Each pad has its own tone.
const PADS = [
  { ink: '#FF4D1F', lit: '#FF9E7E', freq: 330, key: 'up' },
  { ink: '#12C98C', lit: '#7BF0CB', freq: 392, key: 'right' },
  { ink: '#4EA8FF', lit: '#A9D5FF', freq: 262, key: 'down' },
  { ink: '#FFB020', lit: '#FFD98A', freq: 494, key: 'left' },
];

export function createGame(canvas, host, opts = {}) {
  const SIZE = 360;
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  // Easy shows the sequence slowly and forgives two slips; hard is one and done.
  const D = [
    { show: 620, gap: 200, lives: 3, grow: 1 },
    { show: 440, gap: 140, lives: 2, grow: 1 },
    { show: 300, gap: 90, lives: 1, grow: 2 },
  ][opts.difficulty ?? 1];

  let seq, step, lit, phase, timer, score, round, lives;
  let paused = false, running = false, rafId = null, last = 0, over = false;

  const mid = SIZE / 2, RING = 26;

  function addSteps(n) {
    for (let i = 0; i < n; i++) seq.push((Math.random() * 4) | 0);
  }

  function startRound() {
    round++;
    addSteps(round === 1 ? 1 : D.grow);
    step = 0;
    phase = 'show';
    timer = 500;
    lit = -1;
    host.onStats({ level: round, score, lives });
  }

  // Each pad is a distinct pitch, so the sequence is audible as well as visual.
  const tone = (i) => host.tone?.({ freq: PADS[i].freq, duration: 0.2, type: 'triangle', gain: 0.16 });

  function press(i) {
    if (phase !== 'input' || !running || paused) return;
    lit = i; timer = 160;
    tone(i);

    if (seq[step] === i) {
      step++;
      score += 5 * round;
      host.onStats({ score });
      if (step >= seq.length) {
        phase = 'wait';
        timer = 600;
        score += 20 * round;
        host.sfx.win();
        host.onStats({ score });
      }
    } else {
      lives--;
      host.sfx.hit();
      host.onStats({ lives });
      if (lives <= 0) return finish();
      phase = 'replay';     // same sequence again, one life down
      timer = 900;
    }
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, false);
  }

  function update(dt) {
    timer -= dt;
    if (timer > 0) return;

    if (phase === 'show') {
      if (lit >= 0) { lit = -1; timer = D.gap; phase = 'show'; step++; if (step >= seq.length) { step = 0; phase = 'input'; } return; }
      lit = seq[step];
      tone(lit);
      timer = D.show;
      return;
    }
    if (phase === 'input') { lit = -1; return; }
    if (phase === 'wait') { startRound(); return; }
    if (phase === 'replay') { step = 0; phase = 'show'; lit = -1; timer = 200; return; }
  }

  function wedge(i, active) {
    const a0 = i * (Math.PI / 2) - Math.PI;
    ctx.beginPath();
    ctx.moveTo(mid, mid);
    ctx.arc(mid, mid, mid - 8, a0 + 0.03, a0 + Math.PI / 2 - 0.03);
    ctx.closePath();
    ctx.fillStyle = active ? PADS[i].lit : PADS[i].ink;
    ctx.globalAlpha = active ? 1 : 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 4; i++) wedge(i, lit === i);

    ctx.fillStyle = '#08070A';
    ctx.beginPath();
    ctx.arc(mid, mid, RING * 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#8E8A98';
    ctx.font = '600 10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(phase === 'input' ? 'À TOI' : phase === 'show' ? 'REGARDE' : '···', mid, mid - 8);
    ctx.fillStyle = '#F5F2EA';
    ctx.font = '600 24px ui-monospace, Consolas, monospace';
    ctx.fillText(String(seq.length), mid, mid + 18);
    ctx.textAlign = 'start';
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(48, last ? t - last : 16);
    last = t;
    if (!paused) { update(dt); if (running) draw(); }
    rafId = requestAnimationFrame(loop);
  }

  function onPointer(ev) {
    ev.preventDefault();
    const b = canvas.getBoundingClientRect();
    const x = (ev.clientX - b.left) * (SIZE / b.width) - mid;
    const y = (ev.clientY - b.top) * (SIZE / b.height) - mid;
    if (Math.hypot(x, y) < RING * 2) return;     // dead centre is the readout
    const a = Math.atan2(y, x) + Math.PI;
    press(Math.min(3, (a / (Math.PI / 2)) | 0));
  }

  return {
    start() {
      seq = []; round = 0; score = 0; lives = D.lives;
      lit = -1; phase = 'wait'; timer = 400; step = 0;
      paused = false; running = true; over = false; last = 0;
      canvas.addEventListener('pointerdown', onPointer);
      host.onStats({ score, level: 1, lives });
      startRound();
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down) return;
      const i = PADS.findIndex((p) => p.key === a);
      if (i >= 0) press(i);
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onPointer);
    },
  };
}
