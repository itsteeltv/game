// Caverne — un petit jeu de plateforme en cinq salles. Cours, saute (plus longtemps
// appuyé, plus haut), ramasse les gemmes, atteins la porte. Les pics et la lave tuent.
// Chaque salle est dessinée à la main : la porte est toujours atteignable en marchant
// et en sautant des trous de deux cases ; les gemmes, elles, se méritent.
//
// # mur · ^ pic · ~ lave · o gemme · - plateforme mobile · D porte · @ départ
const ROOMS = [
  [ // 1
    '####################',
    '#                  #',
    '#        o o       #',
    '#      ######      #',
    '#                  #',
    '#   o          o   #',
    '#  ####      ####  #',
    '#                  #',
    '#@              D  #',
    '####^^####^^########',
    '####################',
  ],
  [ // 2
    '####################',
    '#          o       #',
    '#        #####     #',
    '#    o             #',
    '#   ####       o   #',
    '#            ####  #',
    '#@              D  #',
    '####  ####  ########',
    '#   ~~~~~~~~~~~~~  #',
    '#~~~~~~~~~~~~~~~~~~#',
    '####################',
  ],
  [ // 3
    '####################',
    '#              o   #',
    '#           #####  #',
    '#                  #',
    '#   o              #',
    '#  ###    ---      #',
    '#                  #',
    '#@                D#',
    '#####  ######  #####',
    '#   ~~~~    ~~~~   #',
    '####################',
  ],
  [ // 4
    '####################',
    '#  o            D  #',
    '#  ####      #######',
    '#                  #',
    '#        ######    #',
    '#   o              #',
    '# #####       o    #',
    '#           #####  #',
    '#@    ^^           #',
    '####################',
    '####################',
  ],
  [ // 5
    '####################',
    '#     o      o     #',
    '#   #####  #####   #',
    '#                  #',
    '#        ---       #',
    '#   o              #',
    '#  ###         o   #',
    '#@          ###   D#',
    '####^^#####  #######',
    '#   ~~~~~~~~~~~~   #',
    '####################',
  ],
];

const CELL = 24, COLS = 20, ROWS = 11, TOP = 30;
const C = {
  bg: '#08070A', rock: '#2B2733', rockTop: '#3C3747', back: '#121117',
  spike: '#FF453A', lava: '#FF4D1F', coin: '#FFD24A', door: '#12C98C', you: '#9D6BFF', text: '#9E9AAA',
};

export function createGame(canvas, host, opts = {}) {
  const lvl = opts.difficulty ?? 1;
  const D = [{ lives: 5, time: 75 }, { lives: 3, time: 60 }, { lives: 2, time: 45 }][lvl];

  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL + TOP;
  const ctx = canvas.getContext('2d');

  // Physics in pixels per second, so a 120 Hz screen plays at the same speed.
  const G = 1500, RUN = 158, JUMP = 468, JUMP_CUT = 0.42, COYOTE = 90, MAX_FALL = 620;

  let room, tiles, coins, movers, you, lives, score, timeLeft, keys, coyote, dead, won, flash;
  let exit = { c: COLS - 2, r: 1 };
  let paused = false, running = false, rafId = null, last = 0, alive = true;

  const solidAt = (c, r) => (tiles[r]?.[c] ?? '#') === '#';
  const kindAt = (c, r) => tiles[r]?.[c] ?? '#';

  function load(i) {
    const raw = ROOMS[i].map((l) => l.padEnd(COLS, ' ').slice(0, COLS));
    tiles = raw.map((l) => [...l]);
    coins = [];
    movers = [];
    let start = { c: 1, r: ROWS - 2 }, door = { c: COLS - 2, r: 1 };

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = tiles[r][c];
        if (ch === 'o') { coins.push({ c, r, got: false }); tiles[r][c] = ' '; }
        if (ch === '@') { start = { c, r }; tiles[r][c] = ' '; }
        if (ch === 'D') { door = { c, r }; tiles[r][c] = ' '; }
        // A run of dashes is ONE platform: read the untouched row, since tiles are being blanked.
        if (ch === '-') {
          if (c === 0 || raw[r][c - 1] !== '-') movers.push({ c0: c, r, w: 1, t: Math.random() * 6 });
          else movers.at(-1).w++;
          tiles[r][c] = ' ';
        }
      }
    }
    // A platform sweeps as far as its row is clear, so it never slides into rock.
    for (const m of movers) {
      let left = 0, right = 0;
      while (left < 4 && !solidAt(m.c0 - left - 1, m.r)) left++;
      while (right < 4 && !solidAt(m.c0 + m.w + right, m.r)) right++;
      m.span = Math.min(left, right) * CELL;
      m.x = m.c0 * CELL; m.y = TOP + m.r * CELL; m.vx = 0;
    }
    you = {
      x: start.c * CELL + 3, y: TOP + start.r * CELL + 2,
      w: CELL - 6, h: CELL - 2, vx: 0, vy: 0, onGround: false, face: 1, ride: null,
    };
    exit = door;
  }

  /* --- collisions --------------------------------------------------------- */

  /** Solid tiles overlapping a box, plus the moving platforms under it. */
  function hitsSolid(x, y, w, h) {
    const c0 = Math.floor(x / CELL), c1 = Math.floor((x + w - 1) / CELL);
    const r0 = Math.floor((y - TOP) / CELL), r1 = Math.floor((y + h - 1 - TOP) / CELL);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (solidAt(c, r)) return true;
    return false;
  }

  const moverTop = (m) => ({ x: m.x, y: m.y, w: m.w * CELL, h: 8 });

  function hurtAt(x, y, w, h) {
    const c0 = Math.floor(x / CELL), c1 = Math.floor((x + w - 1) / CELL);
    const r0 = Math.floor((y - TOP) / CELL), r1 = Math.floor((y + h - 1 - TOP) / CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = kindAt(c, r);
        if (k === '^' || k === '~') return k;
      }
    }
    return null;
  }

  /* --- run --------------------------------------------------------------- */

  function die() {
    if (dead || won) return;
    dead = true;
    flash = 420;
    lives--;
    host.sfx.gameover();
    report();
    setTimeout(() => {
      if (!alive || !running) return;
      if (lives <= 0) return finish(false);
      dead = false;
      load(room);
    }, 430);
  }

  function nextRoom() {
    host.sfx.clear();
    score += 300 + Math.max(0, Math.round(timeLeft)) * 5;
    if (room + 1 >= ROOMS.length) return finish(true);
    room++;
    timeLeft = D.time;
    load(room);
    report();
  }

  function finish(ok) {
    if (won) return;
    won = true; running = false;
    if (ok) { score += 500 + lives * 100; host.sfx.win(); }
    report();
    draw();
    setTimeout(() => { if (alive) host.onGameOver(score, ok); }, 450);
  }

  let shown = '';
  function report() {
    const k = `${score}|${room}|${lives}`;
    if (k === shown) return;
    shown = k;
    host.onStats({ score, level: room + 1, lives: Math.max(0, lives) });
  }

  function step(dt) {
    const s = dt / 1000;
    if (flash > 0) flash -= dt;
    if (dead || won) return;

    timeLeft -= s;
    if (timeLeft <= 0) { timeLeft = 0; return die(); }

    for (const m of movers) {
      m.t += s;
      const px = m.x;
      m.x = m.c0 * CELL + Math.sin(m.t * 0.9) * m.span;
      m.vx = m.x - px;
    }

    // horizontal
    you.vx = (keys.right ? RUN : 0) - (keys.left ? RUN : 0);
    if (you.vx) you.face = Math.sign(you.vx);
    if (you.ride) you.x += you.ride.vx;
    let nx = you.x + you.vx * s;
    if (hitsSolid(nx, you.y, you.w, you.h)) {
      // step back to the wall face
      while (Math.abs(nx - you.x) > 0.5) {
        nx = (nx + you.x) / 2;
        if (!hitsSolid(nx, you.y, you.w, you.h)) break;
      }
      if (hitsSolid(nx, you.y, you.w, you.h)) nx = you.x;
    }
    you.x = Math.max(0, Math.min(COLS * CELL - you.w, nx));

    // vertical
    you.vy = Math.min(MAX_FALL, you.vy + G * s);
    if (!keys.jump && you.vy < 0) you.vy *= Math.pow(JUMP_CUT, dt / 16);   // released early: shorter hop
    let ny = you.y + you.vy * s;
    you.onGround = false;
    you.ride = null;

    if (hitsSolid(you.x, ny, you.w, you.h)) {
      const dir = Math.sign(you.vy) || 1;
      while (hitsSolid(you.x, ny, you.w, you.h) && Math.abs(ny - you.y) > 0.25) ny -= dir * 0.5;
      if (dir > 0) { you.onGround = true; coyote = COYOTE; }
      you.vy = 0;
    }
    // platform tops catch a falling player
    if (you.vy >= 0) {
      for (const m of movers) {
        const t = moverTop(m);
        const feetWas = you.y + you.h, feetNow = ny + you.h;
        if (you.x + you.w > t.x && you.x < t.x + t.w && feetWas <= t.y + 2 && feetNow >= t.y) {
          ny = t.y - you.h;
          you.vy = 0;
          you.onGround = true;
          you.ride = m;
          coyote = COYOTE;
        }
      }
    }
    you.y = ny;
    if (!you.onGround) coyote -= dt;

    // fell out of the room
    if (you.y > TOP + ROWS * CELL) return die();

    const hurt = hurtAt(you.x + 2, you.y + 2, you.w - 4, you.h - 4);
    if (hurt) return die();

    for (const co of coins) {
      if (co.got) continue;
      const x = co.c * CELL + CELL / 2, y = TOP + co.r * CELL + CELL / 2;
      if (Math.abs(x - (you.x + you.w / 2)) < 15 && Math.abs(y - (you.y + you.h / 2)) < 16) {
        co.got = true;
        score += 100;
        host.sfx.pickup();
        report();
      }
    }

    const dx = exit.c * CELL + CELL / 2 - (you.x + you.w / 2);
    const dy = TOP + exit.r * CELL + CELL / 2 - (you.y + you.h / 2);
    if (Math.abs(dx) < 16 && Math.abs(dy) < 18) nextRoom();
  }

  function jump() {
    if (dead || won || !running || paused) return;
    if (!you.onGround && coyote <= 0) return;
    you.vy = -JUMP;
    you.onGround = false;
    coyote = -1;
    host.sfx.move();
  }

  /* --- drawing ----------------------------------------------------------- */

  function draw() {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = C.back;
    ctx.fillRect(0, TOP, canvas.width, ROWS * CELL);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = tiles[r][c];
        const x = c * CELL, y = TOP + r * CELL;
        if (k === '#') {
          ctx.fillStyle = C.rock;
          ctx.fillRect(x, y, CELL, CELL);
          if (!solidAt(c, r - 1)) { ctx.fillStyle = C.rockTop; ctx.fillRect(x, y, CELL, 4); }
        } else if (k === '^') {
          ctx.fillStyle = C.spike;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(x + i * 8, y + CELL);
            ctx.lineTo(x + i * 8 + 4, y + CELL * 0.35);
            ctx.lineTo(x + i * 8 + 8, y + CELL);
            ctx.closePath();
            ctx.fill();
          }
        } else if (k === '~') {
          const g = ctx.createLinearGradient(0, y, 0, y + CELL);
          g.addColorStop(0, '#FF7A3C');
          g.addColorStop(1, '#8E1B06');
          ctx.fillStyle = g;
          ctx.fillRect(x, y, CELL, CELL);
        }
      }
    }

    for (const m of movers) {
      const t = moverTop(m);
      ctx.fillStyle = '#4EA8FF';
      ctx.fillRect(t.x, t.y, t.w, 8);
      ctx.fillStyle = 'rgba(78,168,255,0.25)';
      ctx.fillRect(t.x, t.y + 8, t.w, 4);
    }

    for (const co of coins) {
      if (co.got) continue;
      const x = co.c * CELL + CELL / 2, y = TOP + co.r * CELL + CELL / 2;
      ctx.save();
      ctx.shadowColor = C.coin;
      ctx.shadowBlur = 10;
      ctx.fillStyle = C.coin;
      ctx.beginPath();
      ctx.ellipse(x, y, 5, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // door
    const dx = exit.c * CELL, dy = TOP + exit.r * CELL;
    ctx.fillStyle = '#0E2B22';
    ctx.fillRect(dx + 3, dy, CELL - 6, CELL);
    ctx.strokeStyle = C.door;
    ctx.lineWidth = 2;
    ctx.strokeRect(dx + 3, dy + 1, CELL - 6, CELL - 2);
    ctx.fillStyle = C.door;
    ctx.fillRect(dx + CELL - 9, dy + CELL / 2 - 2, 3, 4);

    // you
    if (!dead || Math.floor(flash / 70) % 2 === 0) {
      ctx.fillStyle = C.you;
      ctx.save();
      ctx.shadowColor = C.you;
      ctx.shadowBlur = 10;
      ctx.fillRect(you.x, you.y + 4, you.w, you.h - 4);
      ctx.restore();
      ctx.fillStyle = '#F5F5F7';
      ctx.fillRect(you.x + (you.face > 0 ? you.w - 7 : 3), you.y + 7, 4, 4);
    }

    // readout
    ctx.font = '600 13px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.text;
    ctx.textAlign = 'left';
    ctx.fillText(`SALLE ${room + 1}/${ROOMS.length}`, 8, 15);
    ctx.textAlign = 'center';
    ctx.fillStyle = C.coin;
    ctx.fillText(`${coins.filter((c) => c.got).length}/${coins.length}`, canvas.width / 2, 15);
    ctx.textAlign = 'right';
    ctx.fillStyle = timeLeft < 10 ? C.spike : C.text;
    ctx.fillText(`${Math.ceil(timeLeft)} s`, canvas.width - 8, 15);

    if (won) {
      ctx.fillStyle = 'rgba(8,7,10,0.74)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = lives > 0 ? C.door : C.spike;
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lives > 0 ? 'SORTIE TROUVÉE' : 'PERDU DANS LA CAVERNE', canvas.width / 2, canvas.height / 2);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(32, last ? t - last : 16);
    last = t;
    if (!paused) { step(dt); if (running) draw(); }
    rafId = requestAnimationFrame(loop);
  }

  // Touch: the left half of the screen walks that way, the right half jumps —
  // on top of the pad under the screen.
  const onDown = (e) => {
    e.preventDefault();
    const b = canvas.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width;
    if (x > 0.62) jump();
    else if (x < 0.38) { keys.left = true; setTimeout(() => { keys.left = false; }, 220); }
    else { keys.right = true; setTimeout(() => { keys.right = false; }, 220); }
  };

  return {
    start() {
      room = 0; lives = D.lives; score = 0; timeLeft = D.time;
      keys = { left: false, right: false, jump: false };
      dead = false; won = false; flash = 0; coyote = 0; shown = '';
      paused = false; running = true; last = 0;
      load(0);
      canvas.addEventListener('pointerdown', onDown);
      report();
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'left') keys.left = down;
      else if (a === 'right') keys.right = down;
      else if (a === 'action' || a === 'up') {
        keys.jump = down;
        if (down) jump();
      }
    },
    destroy() {
      running = false; alive = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
    },
  };
}
