// Bombes — dans l'esprit de Bomberman (1983). Un labyrinthe de piliers, des briques
// qui sautent, une sortie cachée dessous, et des bombes qui ne distinguent pas leur
// propriétaire : la plupart des parties se terminent dans son propre souffle.
const COLS = 15, ROWS = 11, CELL = 28;
const W = COLS * CELL, H = ROWS * CELL + 2;
const STEP = 1000 / 60;

const EMPTY = 0, SOLID = 1, BRICK = 2;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Facile : peu d'ennemis, une mèche longue. Difficile : ça grouille et ça explose vite.
  const D = [
    { lives: 4, foes: 2, fuse: 150, speed: 1.9, foeSpeed: 0.7, bricks: 0.5 },
    { lives: 3, foes: 3, fuse: 125, speed: 1.8, foeSpeed: 0.95, bricks: 0.62 },
    { lives: 3, foes: 5, fuse: 105, speed: 1.7, foeSpeed: 1.25, bricks: 0.72 },
  ][opts.difficulty ?? 1];

  let grid, items, p, bombs, flames, foes, exit, score, level, lives, inv;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;
  const key = { up: false, down: false, left: false, right: false };

  const cellAt = (c, r) => (grid[r]?.[c] ?? SOLID);

  function build() {
    grid = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => (
      (r % 2 === 0 && c % 2 === 0) ? SOLID : EMPTY
    )));
    // L'entrée reste dégagée : on ne meurt pas avant d'avoir bougé.
    const spawn = [[1, 1], [2, 1], [1, 2]];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] !== EMPTY || spawn.some(([sc, sr]) => sc === c && sr === r)) continue;
        if (c === 0 || r === 0 || c === COLS - 1 || r === ROWS - 1) { grid[r][c] = SOLID; continue; }
        if (Math.random() < D.bricks) grid[r][c] = BRICK;
      }
    }
    // Sortie et bonus, cachés sous des briques tirées au sort.
    const walls = [];
    grid.forEach((row, r) => row.forEach((v, c) => { if (v === BRICK) walls.push({ c, r }); }));
    walls.sort(() => Math.random() - 0.5);
    exit = walls[0] ? { ...walls[0], shown: false } : { c: COLS - 2, r: ROWS - 2, shown: true };
    items = walls.slice(1, 4).map((w, i) => ({ ...w, kind: i === 0 ? 'range' : 'bomb', shown: false }));

    p = { x: CELL * 1.5, y: CELL * 1.5, range: 2, max: 1, face: 'down' };
    bombs = []; flames = [];
    foes = [];
    const spots = [];
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (grid[r][c] === EMPTY && c + r > 8) spots.push({ c, r });
      }
    }
    spots.sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(D.foes + Math.floor((level - 1) / 2), spots.length); i++) {
      const s = spots[i];
      foes.push({ x: (s.c + 0.5) * CELL, y: (s.r + 0.5) * CELL, dir: 'left' });
    }
    inv = 60;
  }

  function finish(won) {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, won);
  }

  function hurt() {
    if (inv > 0) return;
    lives--;
    inv = 90;
    host.sfx.hit();
    host.onStats({ lives });
    navigator.vibrate?.(60);
    if (lives <= 0) return finish(false);
    p.x = CELL * 1.5; p.y = CELL * 1.5;
    bombs = []; flames = [];
  }

  function drop() {
    const c = Math.floor(p.x / CELL), r = Math.floor(p.y / CELL);
    if (bombs.length >= p.max || bombs.some((b) => b.c === c && b.r === r)) return;
    // `under`: on se tient dessus au moment de la poser, donc elle ne bloque pas encore.
    bombs.push({ c, r, t: D.fuse, range: p.range, under: true });
    host.sfx.shoot();
  }

  /** Une bombe explose en croix, s'arrête au premier mur et casse une seule brique par branche. */
  function blow(bomb) {
    const hit = [{ c: bomb.c, r: bomb.r }];
    for (const [dc, dr] of Object.values(DIRS)) {
      for (let i = 1; i <= bomb.range; i++) {
        const c = bomb.c + dc * i, r = bomb.r + dr * i;
        const v = cellAt(c, r);
        if (v === SOLID) break;
        hit.push({ c, r });
        if (v === BRICK) {
          grid[r][c] = EMPTY;
          score += 20;
          if (exit.c === c && exit.r === r) exit.shown = true;
          const it = items.find((o) => o.c === c && o.r === r);
          if (it) it.shown = true;
          break;
        }
      }
    }
    hit.forEach((h) => flames.push({ ...h, t: 26 }));
    host.sfx.clear();
    navigator.vibrate?.(25);
    host.onStats({ score });
    // Une bombe prise dans le souffle part tout de suite : les chaînes sont la moitié du jeu.
    bombs.filter((b) => b !== bomb && hit.some((h) => h.c === b.c && h.r === b.r)).forEach((b) => { b.t = 1; });
  }

  /** Déplacement libre avec aide à l'alignement : on glisse le long d'un pilier au lieu de s'y coller. */
  function moveBody(b, dx, dy, radius = 10) {
    const can = (x, y) => {
      for (const [ox, oy] of [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]]) {
        const c = Math.floor((x + ox) / CELL), r = Math.floor((y + oy) / CELL);
        if (cellAt(c, r) !== EMPTY) return false;
        // On peut sortir de sa propre bombe, pas y revenir.
        if (bombs.some((bb) => bb.c === c && bb.r === r && !bb.under)) return false;
      }
      return true;
    };
    if (dx && can(b.x + dx, b.y)) b.x += dx;
    else if (dx) {
      const centre = (Math.round(b.y / CELL - 0.5) + 0.5) * CELL;
      const slide = Math.sign(centre - b.y) * Math.min(Math.abs(centre - b.y), Math.abs(dx));
      if (Math.abs(centre - b.y) > 0.5 && can(b.x + dx, b.y + slide)) b.y += slide;
    }
    if (dy && can(b.x, b.y + dy)) b.y += dy;
    else if (dy) {
      const centre = (Math.round(b.x / CELL - 0.5) + 0.5) * CELL;
      const slide = Math.sign(centre - b.x) * Math.min(Math.abs(centre - b.x), Math.abs(dy));
      if (Math.abs(centre - b.x) > 0.5 && can(b.x + slide, b.y + dy)) b.x += slide;
    }
  }

  function update() {
    if (inv > 0) inv--;

    const dx = (key.right ? 1 : 0) - (key.left ? 1 : 0);
    const dy = (key.down ? 1 : 0) - (key.up ? 1 : 0);
    if (dx || dy) p.face = dx ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    moveBody(p, dx * D.speed, dy * D.speed);

    // La bombe sur laquelle on se tient ne bloque pas tant qu'on ne l'a pas quittée.
    bombs.forEach((b) => {
      if (Math.floor(p.x / CELL) !== b.c || Math.floor(p.y / CELL) !== b.r) b.under = false;
    });

    for (const b of bombs) if (--b.t <= 0) blow(b);
    bombs = bombs.filter((b) => b.t > 0);

    flames.forEach((f) => f.t--);
    flames = flames.filter((f) => f.t > 0);

    const pc = Math.floor(p.x / CELL), pr = Math.floor(p.y / CELL);
    if (flames.some((f) => f.c === pc && f.r === pr)) hurt();

    for (const f of foes) {
      const [fdc, fdr] = DIRS[f.dir];
      const before = { x: f.x, y: f.y };
      moveBody(f, fdc * D.foeSpeed, fdr * D.foeSpeed, 9);
      // Bloqué, ou un virage de temps en temps : nouvelle direction au hasard.
      if ((Math.abs(f.x - before.x) < 0.1 && Math.abs(f.y - before.y) < 0.1) || Math.random() < 0.012) {
        const options = Object.keys(DIRS).sort(() => Math.random() - 0.5);
        f.dir = options[0];
      }
      if (Math.abs(f.x - p.x) < 15 && Math.abs(f.y - p.y) < 15) hurt();
      const fc = Math.floor(f.x / CELL), fr = Math.floor(f.y / CELL);
      if (flames.some((fl) => fl.c === fc && fl.r === fr)) {
        f.dead = true;
        score += 150;
        host.sfx.score();
        host.onStats({ score });
      }
    }
    foes = foes.filter((f) => !f.dead);

    for (const it of items) {
      if (!it.shown || it.taken) continue;
      if (it.c !== pc || it.r !== pr) continue;
      it.taken = true;
      if (it.kind === 'range') p.range++; else p.max++;
      score += 100;
      host.sfx.pickup();
      host.onStats({ score });
    }

    // La sortie n'ouvre qu'une fois le labyrinthe nettoyé.
    if (exit.shown && !foes.length && exit.c === pc && exit.r === pr) {
      score += 500 + level * 100;
      level++;
      host.sfx.win();
      host.onStats({ score, level });
      if (level > 8) return finish(true);
      build();
    }
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * CELL, y = r * CELL, v = grid[r][c];
        if (v === SOLID) {
          ctx.fillStyle = '#3A4056';
          ctx.fillRect(x, y, CELL, CELL);
          ctx.fillStyle = '#4C5470';
          ctx.fillRect(x, y, CELL, 5);
        } else if (v === BRICK) {
          ctx.fillStyle = '#8A5A3C';
          ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(x + 1, y + CELL / 2 - 1, CELL - 2, 2);
          ctx.fillRect(x + CELL / 2 - 1, y + 1, 2, CELL / 2 - 2);
        } else {
          ctx.fillStyle = (c + r) % 2 ? '#14161F' : '#171A25';
          ctx.fillRect(x, y, CELL, CELL);
        }
      }
    }

    if (exit.shown) {
      ctx.fillStyle = foes.length ? '#5A4A2A' : '#19D197';
      ctx.fillRect(exit.c * CELL + 4, exit.r * CELL + 4, CELL - 8, CELL - 8);
      ctx.fillStyle = '#08070A';
      ctx.fillRect(exit.c * CELL + 9, exit.r * CELL + 11, CELL - 18, CELL - 15);
    }

    items.forEach((it) => {
      if (!it.shown || it.taken) return;
      ctx.fillStyle = it.kind === 'range' ? '#FF5A2B' : '#55AEFF';
      ctx.beginPath();
      ctx.arc((it.c + 0.5) * CELL, (it.r + 0.5) * CELL, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#08070A';
      ctx.font = '700 10px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(it.kind === 'range' ? '+' : 'B', (it.c + 0.5) * CELL, (it.r + 0.5) * CELL + 4);
      ctx.textAlign = 'start';
    });

    bombs.forEach((b) => {
      // La bombe gonfle au rythme de sa mèche : le compte à rebours se voit.
      const beat = 1 + Math.sin(b.t / 5) * 0.12 * (1 - b.t / D.fuse);
      const rad = 9 * beat;
      ctx.fillStyle = '#EDEFF3';
      ctx.beginPath();
      ctx.arc((b.c + 0.5) * CELL, (b.r + 0.5) * CELL, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FF5A2B';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo((b.c + 0.5) * CELL + 3, (b.r + 0.5) * CELL - rad);
      ctx.lineTo((b.c + 0.5) * CELL + 7, (b.r + 0.5) * CELL - rad - 5);
      ctx.stroke();
    });

    flames.forEach((f) => {
      const k = f.t / 26;
      ctx.fillStyle = `rgba(255, ${120 + 110 * k | 0}, 40, ${0.35 + k * 0.6})`;
      const pad = 2 + (1 - k) * 5;
      ctx.fillRect(f.c * CELL + pad, f.r * CELL + pad, CELL - pad * 2, CELL - pad * 2);
    });

    foes.forEach((f) => {
      ctx.fillStyle = '#AE82FF';
      ctx.beginPath();
      ctx.arc(f.x, f.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#08070A';
      ctx.fillRect(f.x - 5, f.y - 3, 3, 3);
      ctx.fillRect(f.x + 2, f.y - 3, 3, 3);
      ctx.fillRect(f.x - 4, f.y + 3, 8, 2);
    });

    if (inv === 0 || Math.floor(inv / 5) % 2 === 0) {
      ctx.fillStyle = '#F5F2EA';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FF5A2B';
      ctx.fillRect(p.x - 10, p.y - 11, 20, 5);
      ctx.fillStyle = '#08070A';
      const eye = { up: [-3, -5, 3, -5], down: [-4, 1, 2, 1], left: [-6, -1, -1, -1], right: [1, -1, 6, -1] }[p.face];
      ctx.fillRect(p.x + eye[0], p.y + eye[1], 3, 3);
      ctx.fillRect(p.x + eye[2], p.y + eye[3], 3, 3);
    }
  }

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
      score = 0; level = 1; lives = D.lives;
      paused = false; running = true; over = false; last = 0; acc = 0;
      key.up = key.down = key.left = key.right = false;
      build();
      host.onStats({ score, level, lives });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a in key) key[a] = down;
      if (down && a === 'action') drop();
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
