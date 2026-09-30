// Maze-chase game built on the classic loop. Maze, sprites and rules are original.
// The old version used a fixed grid of pillars (no real corridors) and snapped
// actors cell-to-cell; this one generates a braided maze and moves continuously.
const COLS = 19, ROWS = 15, CELL = 24;
const TUNNEL_ROW = 7;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const GHOST_INK = ['#FF4D1F', '#F5F2EA', '#9D6BFF', '#4EA8FF'];

/** Randomised DFS, then "braid" away most dead ends so the maze has loops to run. */
function buildMaze() {
  const wall = [];
  for (let c = 0; c < COLS; c++) { wall[c] = []; for (let r = 0; r < ROWS; r++) wall[c][r] = true; }

  const stack = [[1, 1]];
  wall[1][1] = false;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const opts = [[2, 0], [-2, 0], [0, 2], [0, -2]]
      .map(([dc, dr]) => [c + dc, r + dr])
      .filter(([nc, nr]) => nc > 0 && nc < COLS - 1 && nr > 0 && nr < ROWS - 1 && wall[nc][nr]);
    if (!opts.length) { stack.pop(); continue; }
    const [nc, nr] = opts[(Math.random() * opts.length) | 0];
    wall[(c + nc) / 2][(r + nr) / 2] = false;
    wall[nc][nr] = false;
    stack.push([nc, nr]);
  }

  // A pure DFS maze is all dead ends — lethal in a chase game. Open most of them.
  for (let c = 1; c < COLS - 1; c++) {
    for (let r = 1; r < ROWS - 1; r++) {
      if (wall[c][r]) continue;
      const open = Object.values(DIRS).filter(([dc, dr]) => !wall[c + dc]?.[r + dr]);
      if (open.length > 1 || Math.random() > 0.85) continue;
      const cand = Object.values(DIRS).filter(([dc, dr]) => {
        const x = c + dc, y = r + dr;
        return x > 0 && x < COLS - 1 && y > 0 && y < ROWS - 1 && wall[x][y];
      });
      if (cand.length) {
        const [dc, dr] = cand[(Math.random() * cand.length) | 0];
        wall[c + dc][r + dr] = false;
      }
    }
  }

  // Side tunnels: run off one edge, come back on the other.
  [0, 1, COLS - 2, COLS - 1].forEach((c) => { wall[c][TUNNEL_ROW] = false; });
  return wall;
}

export function createGame(canvas, host, opts = {}) {
  // Difficulty = how many ghosts, how fast they are, and how long a pellet lasts.
  const D = [
    { ghosts: -1, gs: -1.3, fright: 1.5, lives: 5 },
    { ghosts: 0, gs: 0, fright: 1, lives: 3 },
    { ghosts: 1, gs: 1.2, fright: 0.55, lives: 2 },
  ][opts.difficulty ?? 1];

  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext('2d');

  let wall, food, foodLeft, score, lives, level;
  let player, ghosts, fright, chain, mouth, grace, scatter;
  let paused = false, running = false, rafId = null, last = 0, over = false;

  const wrap = (c) => (c + COLS) % COLS;
  const free = (c, r) => r >= 0 && r < ROWS && !wall[wrap(c)][r];

  function placeActors() {
    player = { c: 1, r: ROWS - 2, dc: 1, dr: 0, next: 'right', prog: 0 };
    while (wall[player.c][player.r] && player.r > 1) player.r--;
    if (food[player.c][player.r]) { food[player.c][player.r] = 0; foodLeft--; }

    const far = [];
    for (let c = 1; c < COLS - 1; c++) {
      for (let r = 1; r < ROWS - 1; r++) {
        if (wall[c][r]) continue;
        const d = Math.abs(c - player.c) + Math.abs(r - player.r);
        if (d >= 9) far.push({ c, r, d });
      }
    }
    far.sort((a, b) => b.d - a.d);

    const n = Math.max(1, Math.min(4, 2 + Math.floor(level / 2) + D.ghosts));
    ghosts = [];
    for (let i = 0; i < n; i++) {
      const spot = far[i % Math.max(1, far.length)] || { c: COLS >> 1, r: 1 };
      let { c, r } = spot;
      while (wall[c][r] && c > 1) c--;
      ghosts.push({ c, r, dc: 0, dr: 0, prog: 0, ink: GHOST_INK[i], state: 'chase', wait: i * 45 });
      if (food[c][r]) { food[c][r] = 0; foodLeft--; }
    }
    fright = 0; chain = 0; mouth = 0;
    // Breathing room on every (re)spawn: ghosts wander before they hunt, and the
    // player can't be touched. Without this, one death cascaded into three.
    grace = 2200;
    scatter = 4500;
  }

  function spawnLevel() {
    wall = buildMaze();
    food = [];
    foodLeft = 0;
    for (let c = 0; c < COLS; c++) {
      food[c] = [];
      for (let r = 0; r < ROWS; r++) {
        food[c][r] = wall[c][r] ? 0 : 1;
        if (food[c][r]) foodLeft++;
      }
    }
    [[1, 1], [COLS - 2, 1], [1, ROWS - 2], [COLS - 2, ROWS - 2]].forEach(([c, r]) => {
      if (!wall[c][r]) food[c][r] = 2;
    });
    placeActors();
    host.onStats({ score, level, lives });
  }

  const pSpeed = () => Math.min(9.5, 6.2 + level * 0.25);
  const gSpeed = () => Math.min(9.2, 5.2 + D.gs + level * 0.3);

  function step(e, speed, dt, pick) {
    e.prog += speed * (dt / 1000);
    let guard = 4;
    while (e.prog >= 1 && guard-- > 0) {
      e.prog -= 1;
      e.c = wrap(e.c + e.dc);
      e.r += e.dr;
      pick(e);
      if (!free(e.c + e.dc, e.r + e.dr)) { e.dc = 0; e.dr = 0; e.prog = 0; break; }
    }
  }

  function playerPick(e) {
    const [ndc, ndr] = DIRS[e.next];
    if (free(e.c + ndc, e.r + ndr)) { e.dc = ndc; e.dr = ndr; }
  }

  function ghostPick(g) {
    const back = [-g.dc, -g.dr];
    let opts = Object.values(DIRS).filter(([dc, dr]) => free(g.c + dc, g.r + dr));
    // Never about-face in a corridor — reversing each tick reads as a stutter.
    const fwd = opts.filter(([dc, dr]) => !(dc === back[0] && dr === back[1]));
    if (fwd.length) opts = fwd;
    if (!opts.length) return;

    const scored = opts.map(([dc, dr]) => ({
      dc, dr,
      d: Math.abs(wrap(g.c + dc) - player.c) + Math.abs(g.r + dr - player.r),
    }));
    // Frightened ghosts flee, the rest close in — with some noise so they don't
    // all trace the same line.
    scored.sort((a, b) => (g.state === 'flee' ? b.d - a.d : a.d - b.d));
    const focus = scatter > 0 ? 0.2 : 0.78;   // scatter phase = mostly wandering
    const s = Math.random() < focus ? scored[0] : scored[(Math.random() * scored.length) | 0];
    g.dc = s.dc; g.dr = s.dr;
  }

  function eatAt(c, r) {
    const f = food[c][r];
    if (!f) return;
    food[c][r] = 0;
    foodLeft--;
    if (f === 1) { score += 10; host.sfx.move(); }
    else {
      score += 50;
      chain = 0;
      fright = Math.max(1600, (7000 - level * 450) * D.fright);
      ghosts.forEach((g) => { if (g.state === 'chase') g.state = 'flee'; });
      host.sfx.pickup();
    }
    host.onStats({ score });
    if (foodLeft <= 0) nextLevel();
  }

  function nextLevel() {
    level++;
    score += 200;
    host.sfx.win();
    spawnLevel();
  }

  function loseLife() {
    lives--;
    host.sfx.hit();
    host.onStats({ lives, score });
    if (lives <= 0) return finish();
    placeActors();
  }

  function finish() {
    if (over) return;
    over = true;
    running = false;
    host.onGameOver(score, false);
  }

  function collide() {
    if (grace > 0) return;
    const px = player.c + player.dc * player.prog;
    const py = player.r + player.dr * player.prog;
    for (const g of ghosts) {
      if (g.wait > 0) continue;
      const gx = g.c + g.dc * g.prog, gy = g.r + g.dr * g.prog;
      if (Math.abs(gx - px) + Math.abs(gy - py) > 0.7) continue;

      if (g.state === 'flee') {
        chain++;
        score += 200 * Math.min(8, 2 ** (chain - 1));
        host.sfx.score();
        host.onStats({ score });
        Object.assign(g, { state: 'chase', wait: 160, c: COLS >> 1, r: 1, dc: 0, dr: 0, prog: 0 });
        while (wall[g.c][g.r] && g.c > 1) g.c--;
      } else {
        loseLife();
      }
      return;
    }
  }

  function update(dt) {
    if (grace > 0) grace -= dt;
    if (scatter > 0) scatter -= dt;
    if (fright > 0) {
      fright -= dt;
      if (fright <= 0) ghosts.forEach((g) => { if (g.state === 'flee') g.state = 'chase'; });
    }
    mouth = (mouth + dt / 90) % (Math.PI * 2);

    if (player.dc === 0 && player.dr === 0) playerPick(player);
    step(player, pSpeed(), dt, playerPick);
    eatAt(player.c, player.r);
    if (!running) return;

    for (const g of ghosts) {
      if (g.wait > 0) { g.wait -= dt / 16; continue; }
      if (g.dc === 0 && g.dr === 0) ghostPick(g);
      step(g, g.state === 'flee' ? gSpeed() * 0.62 : gSpeed(), dt, ghostPick);
    }
    collide();
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const x = c * CELL, y = r * CELL;
        if (wall[c][r]) {
          ctx.fillStyle = '#241F2C';
          ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        } else if (food[c][r] === 1) {
          ctx.fillStyle = '#6F6A7C';
          ctx.fillRect(x + CELL / 2 - 2, y + CELL / 2 - 2, 4, 4);
        } else if (food[c][r] === 2) {
          ctx.fillStyle = '#FFB020';
          ctx.beginPath();
          ctx.arc(x + CELL / 2, y + CELL / 2, 4 + Math.sin(mouth * 2) * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Player: the only amber wedge on screen, so it always reads as "you".
    const px = (player.c + player.dc * player.prog) * CELL + CELL / 2;
    const py = (player.r + player.dr * player.prog) * CELL + CELL / 2;
    const face = Math.atan2(player.dr, player.dc);
    const gap = 0.16 + Math.abs(Math.sin(mouth)) * 0.3;
    ctx.globalAlpha = grace > 0 && Math.floor(grace / 130) % 2 === 0 ? 0.35 : 1;
    ctx.fillStyle = '#FFB020';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, CELL / 2.2, face + gap, face - gap + Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    for (const g of ghosts) {
      const x = (g.c + g.dc * g.prog) * CELL + CELL / 2;
      const y = (g.r + g.dr * g.prog) * CELL + CELL / 2;
      const rad = CELL / 2.2;
      const blink = fright > 0 && fright < 1600 && Math.floor(fright / 200) % 2 === 0;
      ctx.globalAlpha = g.wait > 0 ? 0.35 : 1;
      ctx.fillStyle = g.state === 'flee' ? (blink ? '#F5F2EA' : '#4EA8FF') : g.ink;
      ctx.beginPath();
      ctx.arc(x, y, rad, Math.PI, 0);
      ctx.lineTo(x + rad, y + rad);
      ctx.lineTo(x + rad * 0.45, y + rad * 0.55);
      ctx.lineTo(x, y + rad);
      ctx.lineTo(x - rad * 0.45, y + rad * 0.55);
      ctx.lineTo(x - rad, y + rad);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#08070A';
      ctx.fillRect(x - rad * 0.55, y - rad * 0.3, rad * 0.35, rad * 0.5);
      ctx.fillRect(x + rad * 0.2, y - rad * 0.3, rad * 0.35, rad * 0.5);
      ctx.globalAlpha = 1;
    }
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(48, last ? t - last : 16);
    last = t;
    if (!paused) { update(dt); if (running) draw(); }
    rafId = requestAnimationFrame(loop);
  }

  return {
    start() {
      paused = false; running = true; over = false; last = 0;
      score = 0; lives = D.lives; level = 1;
      spawnLevel();
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down || !DIRS[a] || !player) return;
      player.next = a;
      // Reversing is allowed mid-corridor: flip in place, keep the travel fraction.
      const [dc, dr] = DIRS[a];
      if ((player.dc || player.dr) && dc === -player.dc && dr === -player.dr) {
        player.c = wrap(player.c + player.dc);
        player.r += player.dr;
        player.dc = dc; player.dr = dr;
        player.prog = 1 - player.prog;
      }
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
