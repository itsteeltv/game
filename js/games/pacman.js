// Maze chase in the 1980 mould: one fixed symmetric maze, a ghost house behind a
// gate, four pursuers that each aim somewhere different, scatter/chase waves,
// bonus fruit, a "ready" beat and a flashing maze on clear. Maze, sprites and
// colours are original to this site; only the rules of the genre are kept.
const MAZE = [
  '###################',
  '#........#........#',
  '#o##.###.#.###.##o#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.###   ###.####',
  '####.#       #.####',
  '####.# ##-## #.####',
  '    .  #GGG#  .    ',
  '####.# ##### #.####',
  '####.#       #.####',
  '####.# ##### #.####',
  '#........#........#',
  '#.##.###.#.###.##.#',
  '#o.#.....P.....#.o#',
  '##.#.#.#####.#.#.##',
  '#....#...#...#....#',
  '#.######.#.######.#',
  '#.................#',
  '###################',
];
const COLS = MAZE[0].length, ROWS = MAZE.length, CELL = 20;
const TUNNEL_ROW = 9;
const DOOR = [9, 7];          // the tile just outside the gate
const HOME = [9, 9];          // centre of the house
const FRUIT_AT = [9, 11];
const DIRS = { up: [0, -1], left: [-1, 0], down: [0, 1], right: [1, 0] };   // tie-break order: up, left, down, right
const DIR_LIST = Object.values(DIRS);

// Four personalities. Corners are where each one retreats to in scatter.
const GHOSTS = [
  { ink: '#FF4D1F', corner: [COLS - 1, -2], at: DOOR },      // the hunter: aims at you
  { ink: '#FF8AC0', corner: [0, -2], at: [9, 9] },           // the ambusher: aims ahead of you
  { ink: '#4EA8FF', corner: [COLS - 1, ROWS], at: [8, 9] },  // the flanker: pincers with the hunter
  { ink: '#FFB020', corner: [0, ROWS], at: [10, 9] },        // the shy one: closes in, then loses nerve
];
// Seconds of scatter, chase, scatter, chase… then chase for good.
const WAVES = [7, 20, 7, 20, 5, 20, 5, Infinity];
const FRUIT_POINTS = [100, 300, 500, 500, 700, 700, 1000, 1000, 2000, 2000, 3000, 3000, 5000];
const FRUIT_INK = ['#FF4D1F', '#FF8A3D', '#FF5C8A', '#FF5C8A', '#8BE04E', '#8BE04E', '#FFB020', '#FFB020', '#4EA8FF'];

export function createGame(canvas, host, opts = {}) {
  // Difficulty: ghost count and pace, how long a power pellet lasts, spare lives.
  const D = [
    { ghosts: 3, gs: -0.9, fright: 1.5, lives: 5 },
    { ghosts: 4, gs: 0, fright: 1, lives: 3 },
    { ghosts: 4, gs: 0.7, fright: 0.6, lives: 2 },
  ][opts.difficulty ?? 1];

  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext('2d');

  let food, foodTotal, eaten, score, lives, level, extraGiven;
  let player, ghosts, fright, chain, mouth, waveI, waveT;
  let ready, dying, flashing, fruit, fruitsShown, popups, waka, sirenT;
  let paused = false, running = false, rafId = null, last = 0, over = false;

  const tile = (c, r) => (r < 0 || r >= ROWS ? '#' : MAZE[r][((c % COLS) + COLS) % COLS]);
  const wrap = (c) => (c + COLS) % COLS;
  const walkable = (c, r) => !'#-G'.includes(tile(c, r));
  const ghostCan = (g, c, r) => {
    const t = tile(c, r);
    if (t === '#') return false;
    if (t === '-' || t === 'G') return g.state === 'eyes' || g.state === 'leave';
    return true;
  };

  // Breadth-first distances to the door, so returning eyes always find the house.
  const doorDist = (() => {
    const d = MAZE.map((row) => [...row].map(() => Infinity));
    const q = [DOOR];
    d[DOOR[1]][DOOR[0]] = 0;
    while (q.length) {
      const [c, r] = q.shift();
      for (const [dc, dr] of DIR_LIST) {
        const nc = wrap(c + dc), nr = r + dr;
        if (walkable(nc, nr) && d[nr][nc] === Infinity) { d[nr][nc] = d[r][c] + 1; q.push([nc, nr]); }
      }
    }
    return d;
  })();

  const mode = () => (waveI % 2 === 0 ? 'scatter' : 'chase');
  const pSpeed = () => Math.min(9.6, 7.6 + (level - 1) * 0.25);
  const gSpeed = () => Math.min(9.8, 7.0 + D.gs + (level - 1) * 0.3);

  function placeActors() {
    player = { c: 9, r: 15, dc: -1, dr: 0, fc: -1, fr: 0, next: 'left', prog: 0 };
    const release = level > 2 ? 0.5 : 1;
    ghosts = GHOSTS.slice(0, D.ghosts).map((g, i) => ({
      id: i, ink: g.ink, corner: g.corner,
      c: g.at[0], r: g.at[1], dc: i === 0 ? -1 : 0, dr: 0, prog: 0,
      state: i === 0 ? mode() : 'pen',
      wait: [0, 1000, 4000, 7000][i] * release,
      reverse: false,
    }));
    fright = 0; chain = 0; mouth = 0; waveI = 0; waveT = 0;
    ready = 1700; dying = 0;
  }

  function spawnLevel() {
    food = MAZE.map((row) => [...row].map((t) => (t === '.' ? 1 : t === 'o' ? 2 : 0)));
    foodTotal = food.flat().filter(Boolean).length;
    eaten = 0; fruit = null; fruitsShown = 0; popups = [];
    placeActors();
    host.onStats({ score, level, lives });
  }

  function addScore(n) {
    score += n;
    if (!extraGiven && score >= 10000) {   // one bonus life, at ten thousand — the genre's promise
      extraGiven = true; lives++;
      host.sfx.pickup();
      host.onStats({ lives });
    }
    host.onStats({ score });
  }

  /* --- Movement ---------------------------------------------------------- */

  function step(e, speed, dt, pick, can) {
    e.prog += speed * (dt / 1000);
    let guard = 4;
    while (e.prog >= 1 && guard-- > 0) {
      e.prog -= 1;
      e.c = wrap(e.c + e.dc);
      e.r += e.dr;
      pick(e);
      if (!can(e, e.c + e.dc, e.r + e.dr)) { e.dc = 0; e.dr = 0; e.prog = 0; break; }
    }
  }

  function playerPick(p) {
    const [ndc, ndr] = DIRS[p.next];
    if (walkable(p.c + ndc, p.r + ndr)) { p.dc = ndc; p.dr = ndr; }
    if (p.dc || p.dr) { p.fc = p.dc; p.fr = p.dr; }
  }

  function target(g) {
    if (g.state === 'leave') return DOOR;
    if (g.state === 'scatter') return g.corner;
    const p = player;
    if (g.id === 1) return [p.c + 4 * p.fc, p.r + 4 * p.fr];
    if (g.id === 2) {
      const hunter = ghosts[0];
      const ax = p.c + 2 * p.fc, ay = p.r + 2 * p.fr;
      return [2 * ax - hunter.c, 2 * ay - hunter.r];
    }
    if (g.id === 3 && (g.c - p.c) ** 2 + (g.r - p.r) ** 2 < 64) return g.corner;
    return [p.c, p.r];
  }

  function ghostPick(g) {
    if (g.state === 'eyes' && g.c === DOOR[0] && g.r === DOOR[1]) { g.dc = 0; g.dr = 1; return; }
    if (g.state === 'eyes' && g.c === HOME[0] && g.r === HOME[1]) {
      g.state = 'leave'; g.dc = 0; g.dr = -1; return;
    }
    if (g.state === 'leave' && g.c === DOOR[0] && g.r === DOOR[1]) {
      g.state = fright > 0 ? 'fright' : mode();
    }
    const can = DIR_LIST.filter(([dc, dr]) => ghostCan(g, g.c + dc, g.r + dr));
    if (g.reverse) {
      g.reverse = false;
      const back = can.find(([dc, dr]) => dc === -g.dc && dr === -g.dr);
      if (back) { [g.dc, g.dr] = back; return; }
    }
    const fwd = can.filter(([dc, dr]) => !(dc === -g.dc && dr === -g.dr));
    const opts = fwd.length ? fwd : can;
    if (!opts.length) { g.dc = 0; g.dr = 0; return; }

    let pick;
    if (g.state === 'fright') pick = opts[(Math.random() * opts.length) | 0];
    else if (g.state === 'eyes') {
      pick = opts.reduce((a, b) => (doorDist[g.r + b[1]]?.[wrap(g.c + b[0])] < doorDist[g.r + a[1]]?.[wrap(g.c + a[0])] ? b : a));
    } else {
      const [tx, ty] = target(g);
      const d = ([dc, dr]) => (g.c + dc - tx) ** 2 + (g.r + dr - ty) ** 2;
      pick = opts.reduce((a, b) => (d(b) < d(a) ? b : a));   // first wins ties: up, left, down, right
    }
    [g.dc, g.dr] = pick;
  }

  /* --- Rules ------------------------------------------------------------- */

  function eatAt(c, r) {
    const f = food[r][c];
    if (!f) return;
    food[r][c] = 0;
    eaten++;
    if (f === 1) {
      addScore(10);
      waka = !waka;   // the two-tone chomp
      host.tone?.({ freq: waka ? 520 : 390, duration: 0.05, type: 'triangle', gain: 0.07 });
    } else {
      addScore(50);
      chain = 0;
      fright = Math.max(1000, (6000 - (level - 1) * 500) * D.fright);
      ghosts.forEach((g) => {
        if (g.state === 'scatter' || g.state === 'chase') { g.state = 'fright'; g.reverse = true; }
      });
      host.sfx.pickup();
    }
    // Fruit shows up twice a level, at a third and two thirds of the dots.
    if (fruitsShown < 2 && eaten >= foodTotal * (fruitsShown + 1) / 3) {
      fruitsShown++;
      fruit = { t: 9500 };
    }
    if (eaten >= foodTotal) { flashing = 1600; host.sfx.win(); }
  }

  function loseLife() {
    lives--;
    host.onStats({ lives });
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
    const px = player.c + player.dc * player.prog, py = player.r + player.dr * player.prog;
    if (fruit && Math.abs(px - FRUIT_AT[0]) + Math.abs(py - FRUIT_AT[1]) < 0.6) {
      const v = FRUIT_POINTS[Math.min(level - 1, FRUIT_POINTS.length - 1)];
      addScore(v);
      popups.push({ x: FRUIT_AT[0], y: FRUIT_AT[1], text: String(v), t: 1200 });
      fruit = null;
      host.sfx.pickup();
    }
    for (const g of ghosts) {
      if (g.state === 'pen' || g.state === 'eyes' || g.state === 'leave') continue;
      const gx = g.c + g.dc * g.prog, gy = g.r + g.dr * g.prog;
      const dx = Math.abs(((gx - px + COLS / 2) % COLS + COLS) % COLS - COLS / 2);
      if (dx + Math.abs(gy - py) > 0.6) continue;
      if (g.state === 'fright') {
        const v = 200 * 2 ** Math.min(3, chain++);
        addScore(v);
        popups.push({ x: gx, y: gy, text: String(v), t: 900 });
        g.state = 'eyes';
        host.sfx.score();
      } else {
        dying = 1300;
        host.sfx.hit();
        return;
      }
    }
  }

  function update(dt) {
    popups.forEach((p) => { p.t -= dt; });
    popups = popups.filter((p) => p.t > 0);
    mouth = (mouth + dt / 70) % (Math.PI * 2);

    if (flashing > 0) {
      flashing -= dt;
      if (flashing <= 0) { level++; spawnLevel(); }
      return;
    }
    if (dying > 0) {
      dying -= dt;
      if (dying <= 0) loseLife();
      return;
    }
    if (ready > 0) { ready -= dt; return; }

    // Scatter/chase waves; the clock stops while the ghosts are frightened.
    if (fright > 0) {
      fright -= dt;
      if (fright <= 0) ghosts.forEach((g) => { if (g.state === 'fright') g.state = mode(); });
    } else {
      waveT += dt / 1000;
      if (waveT >= WAVES[waveI]) {
        waveT = 0; waveI++;
        ghosts.forEach((g) => {
          if (g.state === 'scatter' || g.state === 'chase') { g.state = mode(); g.reverse = true; }
        });
      }
    }
    if (fruit && (fruit.t -= dt) <= 0) fruit = null;

    // A faint siren under everything, higher when the ghosts run.
    sirenT = (sirenT || 0) + dt;
    if (sirenT > 420) {
      sirenT = 0;
      host.tone?.({ freq: fright > 0 ? 170 : (waveT * 1000) % 840 < 420 ? 300 : 360, duration: 0.38, type: 'sine', gain: 0.025 });
    }

    if (player.dc === 0 && player.dr === 0) playerPick(player);
    step(player, pSpeed(), dt, playerPick, (_, c, r) => walkable(c, r));
    eatAt(player.c, player.r);
    if (flashing > 0) return;

    for (const g of ghosts) {
      if (g.state === 'pen') {
        g.wait -= dt;
        if (g.wait <= 0) { g.state = 'leave'; ghostPick(g); }
        continue;
      }
      if (g.dc === 0 && g.dr === 0) ghostPick(g);
      let sp = gSpeed();
      if (g.state === 'fright') sp *= 0.55;
      else if (g.state === 'eyes') sp = 15;
      else if (g.state === 'leave') sp *= 0.6;
      if (g.r === TUNNEL_ROW && (g.c <= 3 || g.c >= COLS - 4) && g.state !== 'eyes') sp *= 0.5;   // tunnels slow them
      step(g, sp, dt, ghostPick, ghostCan);
    }
    collide();
  }

  /* --- Drawing ----------------------------------------------------------- */

  function drawMaze(edge) {
    ctx.lineWidth = 2;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = MAZE[r][c], x = c * CELL, y = r * CELL;
        if (t === '#') {
          ctx.fillStyle = '#0E1430';
          ctx.fillRect(x, y, CELL, CELL);
          // Outline only where the wall meets a corridor: the classic hollow look.
          ctx.strokeStyle = edge;
          ctx.beginPath();
          const open = (cc, rr) => cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && MAZE[rr][cc] !== '#';
          if (open(c, r - 1)) { ctx.moveTo(x, y + 1); ctx.lineTo(x + CELL, y + 1); }
          if (open(c, r + 1)) { ctx.moveTo(x, y + CELL - 1); ctx.lineTo(x + CELL, y + CELL - 1); }
          if (open(c - 1, r)) { ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + CELL); }
          if (open(c + 1, r)) { ctx.moveTo(x + CELL - 1, y); ctx.lineTo(x + CELL - 1, y + CELL); }
          ctx.stroke();
        } else if (t === '-') {
          ctx.fillStyle = '#FF8AC0';
          ctx.fillRect(x, y + CELL / 2 - 2, CELL, 3);
        }
      }
    }
  }

  function drawGhost(g) {
    const x = (g.c + g.dc * g.prog) * CELL + CELL / 2;
    const bob = g.state === 'pen' ? Math.sin(mouth * 0.7 + g.id) * 2 : 0;
    const y = (g.r + g.dr * g.prog) * CELL + CELL / 2 + bob;
    const rad = CELL * 0.46;
    const scared = g.state === 'fright';
    const blink = scared && fright < 1800 && Math.floor(fright / 200) % 2 === 0;

    if (g.state !== 'eyes') {
      ctx.fillStyle = scared ? (blink ? '#F5F2EA' : '#2B4BFF') : g.ink;
      ctx.beginPath();
      ctx.arc(x, y - 1, rad, Math.PI, 0);
      const lift = Math.floor(mouth * 2) % 2 ? 4 : 2;   // the skirt ripples as they move
      const w = (2 * rad) / 3;
      ctx.lineTo(x + rad, y + rad);
      for (let i = 0; i < 3; i++) {
        ctx.lineTo(x + rad - i * w - w / 2, y + rad - lift);
        ctx.lineTo(x + rad - (i + 1) * w, y + rad);
      }
      ctx.closePath();
      ctx.fill();
    }
    if (scared) {
      ctx.fillStyle = blink ? '#FF4D1F' : '#FFD9C2';
      ctx.fillRect(x - 4, y - 4, 3, 3);
      ctx.fillRect(x + 1, y - 4, 3, 3);
      for (let i = 0; i < 4; i++) ctx.fillRect(x - 6 + i * 3, y + 3 + (i % 2) * 2, 3, 2);
      return;
    }
    // Eyes look where the ghost is heading.
    const lx = g.dc * 1.6, ly = g.dr * 1.6;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(x - 3.6, y - 2, 3.2, 0, Math.PI * 2); ctx.arc(x + 3.6, y - 2, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2B4BFF';
    ctx.beginPath(); ctx.arc(x - 3.6 + lx, y - 2 + ly, 1.6, 0, Math.PI * 2); ctx.arc(x + 3.6 + lx, y - 2 + ly, 1.6, 0, Math.PI * 2); ctx.fill();
  }

  function drawFruit() {
    const x = FRUIT_AT[0] * CELL + CELL / 2, y = FRUIT_AT[1] * CELL + CELL / 2 + 1;
    ctx.fillStyle = FRUIT_INK[Math.min(level - 1, FRUIT_INK.length - 1)];
    ctx.beginPath(); ctx.arc(x - 3, y + 2, 4.2, 0, Math.PI * 2); ctx.arc(x + 3.5, y + 3, 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8BE04E';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - 3, y - 1); ctx.quadraticCurveTo(x, y - 9, x + 5, y - 8); ctx.lineTo(x + 3.5, y); ctx.stroke();
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // On clear the maze flashes white and blue, then the next board loads.
    drawMaze(flashing > 0 && Math.floor(flashing / 220) % 2 === 0 ? '#F5F2EA' : '#4EA8FF');

    const blinkOn = Math.floor(mouth / 1.6) % 2 === 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const f = food[r][c];
        if (f === 1) {
          ctx.fillStyle = '#FFD9C2';
          ctx.fillRect(c * CELL + CELL / 2 - 2, r * CELL + CELL / 2 - 2, 4, 4);
        } else if (f === 2 && (blinkOn || ready > 0)) {
          ctx.fillStyle = '#FFD9C2';
          ctx.beginPath(); ctx.arc(c * CELL + CELL / 2, r * CELL + CELL / 2, 6, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    if (fruit) drawFruit();

    if (flashing <= 0 && !(dying > 0 && dying < 1000)) ghosts.forEach(drawGhost);

    // The player: an amber wedge. Dying, the mouth opens until nothing is left.
    const px = (player.c + player.dc * player.prog) * CELL + CELL / 2;
    const py = (player.r + player.dr * player.prog) * CELL + CELL / 2;
    const face = Math.atan2(player.fr, player.fc);
    let gap = 0.08 + Math.abs(Math.sin(mouth)) * 0.36;
    if (dying > 0) gap = Math.min(Math.PI, 0.1 + (1 - Math.min(1, dying / 1000)) * Math.PI);
    if (!(dying > 0 && dying < 120)) {
      ctx.fillStyle = '#FFB020';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, CELL * 0.46, face + gap, face - gap + Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.font = '700 10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7BF0CB';
    popups.forEach((p) => ctx.fillText(p.text, p.x * CELL + CELL / 2, p.y * CELL + CELL / 2));
    if (ready > 0) {
      ctx.font = '700 13px ui-monospace, Consolas, monospace';
      ctx.fillStyle = '#FFB020';
      ctx.fillText('PRÊT !', FRUIT_AT[0] * CELL + CELL / 2, FRUIT_AT[1] * CELL + CELL / 2);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
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
      score = 0; lives = D.lives; level = 1; extraGiven = false; flashing = 0;
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
        player.fc = dc; player.fr = dr;
        player.prog = 1 - player.prog;
      }
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
