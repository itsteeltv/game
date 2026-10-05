// Éboulis — dans l'esprit de Boulder Dash (1984). Creuse la terre, ramasse les
// diamants, sors avant la fin du temps — et n'oublie jamais ce qu'il y a au-dessus
// de ta tête : un rocher qui tombe ne pardonne pas.
const COLS = 20, ROWS = 13, CELL = 24;
const W = COLS * CELL, H = ROWS * CELL + 20;
const STEP = 1000 / 60;

const EMPTY = ' ', DIRT = '.', ROCK = 'r', GEM = 'd', WALL = '#', EXIT = 'E';

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Facile : peu de rochers, beaucoup de temps. Difficile : la grotte est pleine de pièges.
  const D = [
    { lives: 4, rocks: 0.16, gems: 0.07, need: 8, time: 150, step: 9 },
    { lives: 3, rocks: 0.22, gems: 0.06, need: 11, time: 120, step: 8 },
    { lives: 3, rocks: 0.30, gems: 0.055, need: 14, time: 95, step: 7 },
  ][opts.difficulty ?? 1];

  let grid, fall, p, got, need, exitAt, score, level, lives, timer, cool, dead;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;
  const key = { up: false, down: false, left: false, right: false };

  const at = (c, r) => (grid[r]?.[c] ?? WALL);
  const set = (c, r, v) => { if (grid[r]) grid[r][c] = v; };

  function buildLevel() {
    grid = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => {
      if (c === 0 || r === 0 || c === COLS - 1 || r === ROWS - 1) return WALL;
      const k = Math.random();
      if (k < D.rocks) return ROCK;
      if (k < D.rocks + D.gems + level * 0.004) return GEM;
      if (k < D.rocks + D.gems + 0.1) return EMPTY;
      return DIRT;
    }));
    fall = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));

    // Le joueur part en haut à gauche, dans une poche creusée pour lui.
    p = { c: 2, r: 2 };
    // Une vraie poche de départ : hemmé par deux rochers dès la première seconde, on
    // n'a nulle part où creuser.
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 2; dc++) {
        if (at(p.c + dc, p.r + dr) !== WALL) set(p.c + dc, p.r + dr, dc === 2 ? DIRT : EMPTY);
      }
    }
    // La sortie est en bas à droite, murée jusqu'à ce que le quota soit atteint.
    exitAt = { c: COLS - 3, r: ROWS - 3 };
    set(exitAt.c, exitAt.r, EXIT);

    // Il faut pouvoir trouver assez de diamants : on en sème jusqu'au compte.
    need = D.need + (level - 1) * 2;
    let count = grid.flat().filter((v) => v === GEM).length;
    while (count < need + 4) {
      const c = 1 + ((Math.random() * (COLS - 2)) | 0), r = 1 + ((Math.random() * (ROWS - 2)) | 0);
      if (at(c, r) === DIRT) { set(c, r, GEM); count++; }
    }
    got = 0;
    timer = D.time * 60;
    cool = 0;
    dead = 0;
  }

  function finish(won) {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, won);
  }

  function die() {
    if (dead) return;
    dead = 60;
    host.sfx.hit();
    navigator.vibrate?.(80);
  }

  function respawn() {
    lives--;
    host.onStats({ lives });
    if (lives <= 0) return finish(false);
    buildLevel();
  }

  /** Un tour de physique : rochers et diamants tombent, puis roulent sur un dos rond. */
  function settle() {
    for (let r = ROWS - 2; r >= 0; r--) {
      for (let c = 1; c < COLS - 1; c++) {
        const v = at(c, r);
        if (v !== ROCK && v !== GEM) continue;
        const below = at(c, r + 1);
        if (below === EMPTY) {
          set(c, r, EMPTY); set(c, r + 1, v);
          fall[r][c] = false; fall[r + 1][c] = true;
          continue;
        }
        // Tombé sur le joueur : c'est fini pour lui.
        if (fall[r][c] && p.c === c && p.r === r + 1) die();
        if (below === ROCK || below === GEM) {
          // Ça roule d'un côté si la case et la diagonale sont libres.
          for (const d of Math.random() < 0.5 ? [-1, 1] : [1, -1]) {
            if (at(c + d, r) === EMPTY && at(c + d, r + 1) === EMPTY) {
              set(c, r, EMPTY); set(c + d, r, v);
              fall[r][c] = false; fall[r][c + d] = true;
              break;
            }
          }
        } else if (fall[r][c]) {
          fall[r][c] = false;
          host.sfx.move();
        }
      }
    }
  }

  function tryMove(dc, dr) {
    const c = p.c + dc, r = p.r + dr;
    const v = at(c, r);
    if (v === WALL) return;
    if (v === ROCK) {
      // On ne pousse un rocher qu'à l'horizontale, et seulement s'il a de la place.
      if (dr !== 0 || at(c + dc, r) !== EMPTY) return;
      set(c + dc, r, ROCK);
      set(c, r, EMPTY);
      host.sfx.move();
    }
    if (v === GEM) {
      got++;
      score += 100;
      host.sfx.pickup();
      host.onStats({ score });
    }
    if (v === DIRT) score += 2;
    if (v === EXIT) {
      if (got < need) return;             // la sortie reste scellée tant que le quota manque
      score += 1000 + Math.floor(timer / 60) * 10;
      level++;
      host.sfx.win();
      host.onStats({ score, level });
      if (level > 6) return finish(true);
      return buildLevel();
    }
    set(c, r, EMPTY);
    p.c = c; p.r = r;
  }

  let physT = 0;
  function update() {
    if (dead) { if (--dead <= 0) respawn(); return; }

    if (--timer <= 0) { host.sfx.gameover(); return respawn(); }

    if (cool > 0) cool--;
    else {
      const dc = (key.right ? 1 : 0) - (key.left ? 1 : 0);
      const dr = (key.down ? 1 : 0) - (key.up ? 1 : 0);
      if (dc || dr) {
        tryMove(dc ? dc : 0, dc ? 0 : dr);   // une seule direction à la fois, comme à l'original
        cool = D.step;
      }
    }

    // La physique tourne à son propre rythme, plus lent que l'affichage.
    if (++physT >= 6) { physT = 0; settle(); }

    // Écrasé sur place (un rocher a roulé sur la tête).
    if (at(p.c, p.r) === ROCK || at(p.c, p.r) === GEM) die();
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * CELL, y = r * CELL + 20, v = grid[r][c];
        if (v === WALL) {
          ctx.fillStyle = '#39405A';
          ctx.fillRect(x, y, CELL, CELL);
          ctx.fillStyle = '#464E6C';
          ctx.fillRect(x + 1, y + 1, CELL - 2, 4);
        } else if (v === DIRT) {
          ctx.fillStyle = '#4A3826';
          ctx.fillRect(x, y, CELL, CELL);
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(x + 4, y + 6, 3, 3);
          ctx.fillRect(x + 14, y + 15, 3, 3);
        } else if (v === ROCK) {
          ctx.fillStyle = '#9AA3BC';
          ctx.beginPath();
          ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 2 - 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.28)';
          ctx.beginPath();
          ctx.arc(x + CELL / 2 - 3, y + CELL / 2 - 4, 3.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (v === GEM) {
          const k = 0.75 + Math.sin(performance.now() / 180 + c + r) * 0.25;
          ctx.fillStyle = `rgba(82,180,255,${k})`;
          ctx.beginPath();
          ctx.moveTo(x + CELL / 2, y + 3);
          ctx.lineTo(x + CELL - 4, y + CELL / 2);
          ctx.lineTo(x + CELL / 2, y + CELL - 3);
          ctx.lineTo(x + 4, y + CELL / 2);
          ctx.closePath();
          ctx.fill();
        } else if (v === EXIT) {
          ctx.fillStyle = got >= need ? '#19D197' : '#2A3348';
          ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
          ctx.fillStyle = '#08070A';
          ctx.fillRect(x + 7, y + 9, CELL - 14, CELL - 11);
        }
      }
    }

    // Le creuseur.
    const px = p.c * CELL, py = p.r * CELL + 20;
    if (!dead || Math.floor(dead / 5) % 2 === 0) {
      ctx.fillStyle = dead ? '#FF5A52' : '#FFB325';
      ctx.fillRect(px + 3, py + 3, CELL - 6, CELL - 6);
      ctx.fillStyle = '#08070A';
      ctx.fillRect(px + 7, py + 8, 3, 3);
      ctx.fillRect(px + 14, py + 8, 3, 3);
      ctx.fillRect(px + 7, py + 15, 10, 2);
    }

    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = got >= need ? '#19D197' : 'rgba(245,242,234,0.6)';
    ctx.fillText(`DIAMANTS ${got} / ${need}`, 6, 14);
    ctx.textAlign = 'right';
    ctx.fillStyle = timer < 1800 ? '#FF5A52' : 'rgba(245,242,234,0.6)';
    ctx.fillText(`TEMPS ${Math.ceil(timer / 60)}`, W - 6, 14);
    ctx.textAlign = 'start';
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
      buildLevel();
      host.onStats({ score, level, lives });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) { if (a in key) key[a] = down; },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
