// Échelles — dans l'esprit de Lode Runner (1983). Ramasse tout l'or, échappe aux
// gardiens, et sers-toi de la seule arme du jeu : creuser la brique sous leurs pieds.
// Le trou se rebouche tout seul — ce qui est dedans à ce moment-là y reste.
const COLS = 24, ROWS = 14, CELL = 22;
const W = COLS * CELL, H = ROWS * CELL + 20;
const STEP = 1000 / 60;

const BRICK = '#', SOLID = '@', LADDER = 'H', ROPE = '-', GOLD = '$', AIR = ' ';

// Deux plans dessinés à la main ; le deuxième est joué aussi en miroir.
const MAPS = [
  [
    '                        ',
    '              $H    $   ',
    '#####   #######H########',
    '               H        ',
    '   $     H ----H    $   ',
    '#########H#    #########',
    '         H              ',
    '    $$$  H         H G  ',
    '##  ###############H####',
    '                   H    ',
    '  G H       $      H    ',
    '####H###############  ##',
    '    H   $   P       $   ',
    '@@@@@@@@@@@@@@@@@@@@@@@@',
  ],
  [
    '                        ',
    ' $         H         $  ',
    '###########H##########  ',
    '           H            ',
    '     $     H  ----- H   ',
    '##############     #H###',
    '                    H   ',
    '   H    $$      G   H   ',
    '###H#################  #',
    '   H                    ',
    '   H   G    $       H   ',
    '#  #################H###',
    '  $        P    $   H   ',
    '@@@@@@@@@@@@@@@@@@@@@@@@',
  ],
];

const mirror = (map) => map.map((row) => [...row].reverse().join(''));
const PLANS = [MAPS[0], MAPS[1], mirror(MAPS[0]), mirror(MAPS[1])];

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Facile : des gardiens lents et des trous qui durent. Difficile : ils collent, ça se rebouche vite.
  const D = [
    { lives: 4, step: 7, gstep: 18, hole: 320, climb: 90 },
    { lives: 3, step: 6, gstep: 14, hole: 260, climb: 70 },
    { lives: 3, step: 6, gstep: 11, hole: 200, climb: 55 },
  ][opts.difficulty ?? 1];

  let grid, p, guards, holes, gold, score, level, lives, dead, escape, grace;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;
  const key = { up: false, down: false, left: false, right: false };
  let digL = false, digR = false;

  const at = (c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS ? SOLID : grid[r][c]);
  const set = (c, r, v) => { if (grid[r] && c >= 0 && c < COLS) grid[r][c] = v; };
  const blocked = (c, r) => at(c, r) === BRICK || at(c, r) === SOLID;
  const onLadder = (a) => at(a.c, a.r) === LADDER;
  /** Posé : sur une échelle, suspendu à une corde, ou quelque chose de dur sous les pieds. */
  const grounded = (a) => onLadder(a) || at(a.c, a.r) === ROPE
    || blocked(a.c, a.r + 1) || at(a.c, a.r + 1) === LADDER;

  function build() {
    const plan = PLANS[(level - 1) % PLANS.length];
    grid = plan.map((row) => [...row]);
    guards = []; holes = []; gold = 0; dead = 0; escape = false;
    grace = 90;   // une seconde et demie pour se situer avant que les gardiens ne partent
    p = { c: 0, r: 0, face: 1, t: 0, fall: 0 };
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === 'P') { p.c = c; p.r = r; set(c, r, AIR); }
        else if (grid[r][c] === 'G') { guards.push({ c, r, t: 0, fall: 0, stuck: 0 }); set(c, r, AIR); }
        else if (grid[r][c] === GOLD) gold++;
      }
    }
    // Un gardien de plus par tour bouclé, posé sur un départ déjà connu.
    const extra = ((level - 1) / PLANS.length) | 0;
    for (let i = 0; i < extra && guards.length; i++) {
      const g = guards[i % guards.length];
      guards.push({ c: g.c, r: g.r, t: i * 3, fall: 0, stuck: 0 });
    }
  }

  function stats() { host.onStats({ score, level, lives }); }

  function finish(won) {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, won);
  }

  function hurt() {
    if (dead > 0) return;
    lives--;
    dead = 80;
    host.sfx.hit();
    stats();
    if (lives <= 0) finish(false);
  }

  /** Tout l'or ramassé : les échelles de fuite s'ouvrent vers le haut de l'écran. */
  function openEscape() {
    escape = true;
    for (let c = 0; c < COLS; c++) if (grid[1][c] === LADDER) set(c, 0, LADDER);
    host.sfx.win();
  }

  /* --- Creuser ------------------------------------------------------------- */

  function dig(dir) {
    if (dead > 0 || !grounded(p) || onLadder(p)) return;
    const c = p.c + dir, r = p.r + 1;
    if (at(c, r) !== BRICK || blocked(c, p.r)) return;
    set(c, r, AIR);
    holes.push({ c, r, t: D.hole });
    host.sfx.shoot();
  }

  function holesTick() {
    for (const h of holes) {
      if (--h.t > 0) continue;
      // La brique revient : ce qui est encore dedans disparaît avec elle.
      for (const g of guards) if (g.c === h.c && g.r === h.r) { respawn(g); score += 150; }
      if (dead <= 0 && p.c === h.c && p.r === h.r) hurt();
      set(h.c, h.r, BRICK);
    }
    holes = holes.filter((h) => h.t > 0);
  }

  function respawn(g) {
    g.r = 1; g.c = 1 + ((Math.random() * (COLS - 2)) | 0);
    g.stuck = 0; g.fall = 0;
    while (blocked(g.c, g.r) && g.c < COLS - 1) g.c++;
    host.sfx.clear();
  }

  /* --- Gardiens ------------------------------------------------------------ */

  function guardsTick() {
    if (grace > 0) { grace--; return; }
    for (const g of guards) {
      if (g.stuck > 0) {
        // Coincé dans un trou : il remonte en s'extirpant d'un côté.
        if (--g.stuck === 0) {
          const side = [1, -1].find((d) => !blocked(g.c + d, g.r - 1) && !blocked(g.c + d, g.r));
          if (side !== undefined) { g.c += side; g.r--; } else g.stuck = 20;
        }
        continue;
      }
      if (holes.some((h) => h.c === g.c && h.r === g.r) && grounded(g)) { g.stuck = D.climb; continue; }
      if (!grounded(g)) { if (++g.fall >= 4) { g.fall = 0; g.r++; if (g.r >= ROWS) respawn(g); } continue; }
      if (++g.t < D.gstep) continue;
      g.t = 0;

      // Chasse simple : la verticale d'abord quand une échelle le permet, sinon l'horizontale.
      const moves = [];
      if (p.r < g.r && onLadder(g) && !blocked(g.c, g.r - 1)) moves.push([0, -1]);
      if (p.r > g.r && !blocked(g.c, g.r + 1)) moves.push([0, 1]);
      const dc = Math.sign(p.c - g.c);
      if (dc && !blocked(g.c + dc, g.r)) moves.push([dc, 0]);
      if (!moves.length && !blocked(g.c - (dc || 1), g.r)) moves.push([-(dc || 1), 0]);
      const [mc, mr] = moves[0] || [0, 0];
      g.c += mc; g.r += mr;
      if (dead <= 0 && g.c === p.c && g.r === p.r) hurt();
    }
  }

  /* --- Boucle -------------------------------------------------------------- */

  function update() {
    if (dead > 0) {
      if (--dead === 0 && !over) build();
      return;
    }
    if (digL) { digL = false; dig(-1); }
    if (digR) { digR = false; dig(1); }

    if (!grounded(p)) {
      if (++p.fall >= 4) { p.fall = 0; p.r++; if (p.r >= ROWS) hurt(); }
    } else if (++p.t >= D.step) {
      p.t = 0;
      let moved = false;
      if (key.up && onLadder(p) && !blocked(p.c, p.r - 1)) { p.r--; moved = true; }
      else if (key.down && !blocked(p.c, p.r + 1)) { p.r++; moved = true; }
      else {
        const dc = (key.right ? 1 : 0) - (key.left ? 1 : 0);
        if (dc) {
          p.face = dc;
          if (!blocked(p.c + dc, p.r)) { p.c += dc; moved = true; }
        }
      }
      if (moved) {
        if (at(p.c, p.r) === GOLD) {
          set(p.c, p.r, AIR);
          score += 100;
          gold--;
          host.sfx.pickup();
          stats();
          if (gold === 0) openEscape();
        }
        if (escape && p.r === 0) {
          level++;
          score += 1000;
          host.sfx.win();
          build();
          stats();
          return;
        }
      }
    }
    holesTick();
    guardsTick();
    for (const g of guards) if (g.stuck <= 0 && g.c === p.c && g.r === p.r) hurt();
  }

  /* --- Dessin -------------------------------------------------------------- */

  function draw() {
    ctx.fillStyle = '#07070C';
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * CELL, y = r * CELL, v = grid[r][c];
        if (v === BRICK) {
          ctx.fillStyle = '#9A4B2E';
          ctx.fillRect(x, y, CELL - 1, CELL - 1);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(x, y + CELL / 2 - 1, CELL - 1, 2);
          ctx.fillRect(x + CELL / 2 - 1, y, 2, CELL / 2);
        } else if (v === SOLID) {
          ctx.fillStyle = '#4A5160';
          ctx.fillRect(x, y, CELL - 1, CELL - 1);
        } else if (v === LADDER) {
          ctx.strokeStyle = escape && r === 0 ? '#FFB325' : '#C9CDD8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 4, y); ctx.lineTo(x + 4, y + CELL);
          ctx.moveTo(x + CELL - 5, y); ctx.lineTo(x + CELL - 5, y + CELL);
          for (let i = 0; i < 2; i++) {
            ctx.moveTo(x + 4, y + 5 + i * 10); ctx.lineTo(x + CELL - 5, y + 5 + i * 10);
          }
          ctx.stroke();
        } else if (v === ROPE) {
          ctx.strokeStyle = '#C9CDD8';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, y + 3); ctx.lineTo(x + CELL, y + 3); ctx.stroke();
        } else if (v === GOLD) {
          ctx.fillStyle = '#FFB325';
          ctx.beginPath();
          ctx.arc(x + CELL / 2, y + CELL / 2, CELL * 0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillRect(x + CELL / 2 - 4, y + CELL / 2 - 4, 3, 3);
        }
      }
    }

    for (const g of guards) {
      ctx.fillStyle = g.stuck > 0 ? 'rgba(255,77,31,0.5)' : '#FF4D1F';
      ctx.fillRect(g.c * CELL + 4, g.r * CELL + 3, CELL - 8, CELL - 6);
      ctx.fillStyle = '#07070C';
      ctx.fillRect(g.c * CELL + 6, g.r * CELL + 7, CELL - 12, 3);
    }

    if (dead <= 0 || (dead >> 3) % 2) {
      ctx.fillStyle = '#52B4FF';
      ctx.fillRect(p.c * CELL + 4, p.r * CELL + 3, CELL - 8, CELL - 6);
      ctx.fillStyle = '#07070C';
      ctx.fillRect(p.c * CELL + (p.face > 0 ? CELL - 9 : 5), p.r * CELL + 7, 3, 3);
    }

    ctx.fillStyle = 'rgba(245,242,234,0.55)';
    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    ctx.fillText(escape ? 'SORTIE OUVERTE — GAGNE LE HAUT' : `OR RESTANT ${gold}`, 8, H - 6);
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
      for (const k in key) key[k] = false;
      digL = digR = false;
      build();
      stats();
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'action') { if (down) digR = true; return; }   // creuse à droite
      if (a === 'hold') { if (down) digL = true; return; }     // creuse à gauche
      if (a in key) { key[a] = down; if (down) p.t = D.step; }
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
