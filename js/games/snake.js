// Snake. Grid-stepped with a queued turn buffer so fast double-taps aren't eaten.
const COLS = 24, ROWS = 18, CELL = 20;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function createGame(canvas, host, opts = {}) {
  // Easy wraps at the walls instead of killing you — the clearest difficulty tell.
  const D = [
    { base: 190, dec: 6, min: 90, wrap: true },
    { base: 150, dec: 9, min: 60, wrap: false },
    { base: 115, dec: 11, min: 48, wrap: false },
  ][opts.difficulty ?? 1];

  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext('2d');

  let snake, dir, turns, food, bonus, bonusT, grow, score, level, acc;
  let paused = false, running = false, rafId = null, last = 0, over = false;

  const stepMs = () => Math.max(D.min, D.base - (level - 1) * D.dec);

  function placeFood() {
    const free = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (!snake.some((s) => s.c === c && s.r === r)) free.push({ c, r });
      }
    }
    if (!free.length) return finish(true);
    food = free[(Math.random() * free.length) | 0];
    // Every 5th apple also puts a timed bonus on the board.
    if (score > 0 && score % 50 === 0 && !bonus) {
      bonus = free[(Math.random() * free.length) | 0];
      bonusT = 6000;
    }
  }

  function finish(won) {
    if (over) return;
    over = true; running = false;
    host.sfx[won ? 'win' : 'gameover']();
    host.onGameOver(score, won);
  }

  function step() {
    if (turns.length) dir = turns.shift();
    const head = { c: snake[0].c + dir[0], r: snake[0].r + dir[1] };

    if (D.wrap) {
      head.c = (head.c + COLS) % COLS;
      head.r = (head.r + ROWS) % ROWS;
    } else if (head.c < 0 || head.c >= COLS || head.r < 0 || head.r >= ROWS) {
      return finish(false);
    }
    // The tail cell frees up this tick unless we're growing, so it isn't a crash.
    const body = grow > 0 ? snake : snake.slice(0, -1);
    if (body.some((s) => s.c === head.c && s.r === head.r)) return finish(false);

    snake.unshift(head);
    if (grow > 0) grow--; else snake.pop();

    if (head.c === food.c && head.r === food.r) {
      grow += 2;
      score += 10;
      level = 1 + Math.floor(snake.length / 8);
      host.sfx.move();
      host.onStats({ score, level });
      placeFood();
    } else if (bonus && head.c === bonus.c && head.r === bonus.r) {
      grow += 3;
      score += 75;
      bonus = null;
      host.sfx.pickup();
      host.onStats({ score });
    }
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(245,242,234,0.045)';
    for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * CELL + .5, 0); ctx.lineTo(c * CELL + .5, ROWS * CELL); ctx.stroke(); }
    for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * CELL + .5); ctx.lineTo(COLS * CELL, r * CELL + .5); ctx.stroke(); }

    ctx.fillStyle = '#FF4D1F';
    ctx.fillRect(food.c * CELL + 4, food.r * CELL + 4, CELL - 8, CELL - 8);

    if (bonus) {
      ctx.globalAlpha = bonusT < 1800 && Math.floor(bonusT / 180) % 2 === 0 ? 0.35 : 1;
      ctx.fillStyle = '#FFB020';
      ctx.fillRect(bonus.c * CELL + 3, bonus.r * CELL + 3, CELL - 6, CELL - 6);
      ctx.globalAlpha = 1;
    }

    snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? '#F5F2EA' : '#8BE04E';
      ctx.globalAlpha = i === 0 ? 1 : Math.max(0.42, 1 - i / (snake.length + 6));
      ctx.fillRect(s.c * CELL + 1, s.r * CELL + 1, CELL - 2, CELL - 2);
    });
    ctx.globalAlpha = 1;
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(48, last ? t - last : 16);
    last = t;
    if (!paused) {
      acc += dt;
      if (bonus) { bonusT -= dt; if (bonusT <= 0) bonus = null; }
      while (acc >= stepMs() && running) { acc -= stepMs(); step(); }
      if (running) draw();
    }
    rafId = requestAnimationFrame(loop);
  }

  return {
    start() {
      snake = [{ c: 6, r: ROWS >> 1 }, { c: 5, r: ROWS >> 1 }, { c: 4, r: ROWS >> 1 }];
      dir = DIRS.right; turns = [];
      grow = 0; score = 0; level = 1; acc = 0; bonus = null; bonusT = 0;
      paused = false; running = true; over = false; last = 0;
      placeFood();
      host.onStats({ score, level });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down || !DIRS[a] || !running) return;
      // Buffer turns: pressing up-then-left inside one tick used to lose the second
      // press. The queue applies them on consecutive steps instead.
      const prev = turns.length ? turns[turns.length - 1] : dir;
      const d = DIRS[a];
      if (d[0] === -prev[0] && d[1] === -prev[1]) return;   // no 180° into your own neck
      if (d[0] === prev[0] && d[1] === prev[1]) return;
      if (turns.length < 2) turns.push(d);
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
