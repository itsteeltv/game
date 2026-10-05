// Foreuse — dans l'esprit de Dig Dug (1982). Creuse tes galeries, gonfle les
// bestioles au harpon jusqu'à ce qu'elles éclatent — ou lâche-leur un rocher sur
// la tête, ça paie cinq fois plus. Plus tu creuses profond, plus ça rapporte.
const COLS = 18, ROWS = 14, CELL = 24;
const W = COLS * CELL, H = ROWS * CELL + 20;
const STEP = 1000 / 60;

const EMPTY = 0, DIRT = 1, ROCK = 2;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
// Les quatre strates, comme sur la borne : la profondeur se lit à la couleur.
const STRATA = ['#C9743A', '#B8553C', '#8F4B6E', '#3F5B9E'];

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Facile : peu de bestioles, lentes, et un harpon long. Difficile : ça traverse la terre.
  const D = [
    { lives: 4, foes: 3, foeStep: 26, ghost: 0.002, reach: 5, step: 7 },
    { lives: 3, foes: 4, foeStep: 20, ghost: 0.004, reach: 4, step: 6 },
    { lives: 3, foes: 5, foeStep: 15, ghost: 0.008, reach: 4, step: 6 },
  ][opts.difficulty ?? 1];

  let grid, p, foes, falls, harpoon, score, level, lives, cool, dead, grace;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;
  const key = { up: false, down: false, left: false, right: false, action: false };

  const at = (c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS ? DIRT : grid[r][c]);
  const strata = (r) => STRATA[Math.min(STRATA.length - 1, (r / (ROWS / STRATA.length)) | 0)];

  const MID = COLS >> 1;

  function build() {
    grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(DIRT));
    // Comme sur la borne : ta galerie de départ, et les bestioles murées chacune dans sa
    // poche. Elles doivent traverser la terre pour venir — tu as le temps de creuser.
    for (let c = MID - 2; c <= MID + 2; c++) grid[1][c] = EMPTY;
    p = { c: MID, r: 1, face: 'down' };

    foes = [];
    const spots = [[3, 5], [COLS - 4, 5], [3, 9], [COLS - 4, 9], [MID - 1, 12], [MID + 2, 12]];
    for (let i = 0; i < Math.min(D.foes + level - 1, spots.length); i++) {
      const [c, r] = spots[i];
      grid[r][c] = EMPTY; grid[r][c + 1] = EMPTY;      // une poche de deux cases
      foes.push({ c, r, dir: 'left', ghost: 0, pump: 0, t: (i * 7) % D.foeStep, dead: false });
    }

    // Les rochers reposent sur de la terre, et jamais au-dessus de ta galerie.
    let rocks = 0;
    for (let tries = 0; tries < 300 && rocks < 3 + level; tries++) {
      const c = 1 + ((Math.random() * (COLS - 2)) | 0);
      const r = 3 + ((Math.random() * (ROWS - 5)) | 0);
      if (grid[r][c] !== DIRT || grid[r + 1][c] !== DIRT) continue;
      grid[r][c] = ROCK; rocks++;
    }

    falls = [];
    harpoon = null;
    cool = 0;
    dead = 0;
    grace = 150;   // le temps de creuser avant que les bestioles ne traversent la terre
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
    dead = 70;
    harpoon = null;
    host.sfx.hit();
    stats();
    if (lives <= 0) finish(false);
  }

  /** Une bestiole éclate : plus elle était profonde, plus elle vaut. */
  function pop(f, bonus = 1) {
    f.dead = true;
    score += (100 + ((f.r / (ROWS / 4)) | 0) * 100) * bonus;
    host.sfx[bonus > 1 ? 'win' : 'clear']();
    stats();
    if (foes.every((x) => x.dead)) {
      level++;
      score += 500;
      build();
      stats();
    }
  }

  /* --- Rochers ------------------------------------------------------------- */

  function rocksTick() {
    for (let r = ROWS - 2; r >= 0; r--) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] !== ROCK || at(c, r + 1) !== EMPTY) continue;
        grid[r][c] = EMPTY;
        falls.push({ c, r, t: 0, hit: 0 });
      }
    }
    for (const f of falls) {
      if (++f.t < 4) continue;
      f.t = 0;
      const next = at(f.c, f.r + 1);
      // Le rocher écrase tout ce qu'il traverse, bestioles comme foreuse.
      for (const x of foes) if (!x.dead && x.c === f.c && x.r === f.r) { f.hit++; pop(x, 2 + f.hit); }
      if (dead <= 0 && p.c === f.c && p.r === f.r) hurt();
      if (next === EMPTY || next === DIRT) { grid[f.r][f.c] = EMPTY; f.r++; }
      else f.r = -1;   // arrivé sur du dur : il se brise
    }
    falls = falls.filter((f) => f.r >= 0 && f.r < ROWS);
  }

  /* --- Harpon -------------------------------------------------------------- */

  /** Le harpon part tout seul et se rétracte : un appui sec suffit, pas besoin de tenir. */
  function fire() {
    if (harpoon?.target) { pump(); return; }
    if (harpoon) return;
    harpoon = { dir: p.face, len: 0, target: null, life: 26, t: 0 };
    host.sfx.shoot();
  }

  function harpoonTick() {
    if (!harpoon) return;
    if (harpoon.target) {
      // Accroché : c'est chaque nouvel appui qui gonfle, et elle se dégage si tu traînes.
      if (--harpoon.life <= 0) { harpoon.target.pump = 0; harpoon = null; }
      return;
    }
    if (--harpoon.life <= 0) { harpoon = null; return; }
    if (harpoon.len >= D.reach || ++harpoon.t % 2) return;
    const [dc, dr] = DIRS[harpoon.dir];
    const c = p.c + dc * (harpoon.len + 1), r = p.r + dr * (harpoon.len + 1);
    if (at(c, r) !== EMPTY) { harpoon.len = D.reach; return; }
    harpoon.len++;
    const f = foes.find((x) => !x.dead && !x.ghost && x.c === c && x.r === r);
    if (f) { harpoon.target = f; f.pump = 1; harpoon.life = 120; host.sfx.pickup(); }
  }

  /** Un appui de plus sur la touche de harpon gonfle la bestiole accrochée. */
  function pump() {
    if (!harpoon?.target) return;
    const f = harpoon.target;
    f.pump++;
    harpoon.life = 120;
    host.sfx.score();
    if (f.pump >= 4) { pop(f); harpoon = null; }
  }

  /* --- Bestioles ----------------------------------------------------------- */

  function foesTick() {
    for (const f of foes) {
      if (f.dead || f === harpoon?.target) continue;
      if (++f.t < D.foeStep) continue;
      f.t = 0;
      if (f.pump > 0 && Math.random() < 0.3) f.pump--;           // elle se dégonfle doucement

      if (f.ghost > 0) {
        // En fantôme elle traverse la terre en ligne droite vers toi.
        f.ghost--;
        const dc = Math.sign(p.c - f.c), dr = Math.sign(p.r - f.r);
        if (Math.abs(p.c - f.c) >= Math.abs(p.r - f.r)) f.c += dc; else f.r += dr;
        f.c = Math.max(0, Math.min(COLS - 1, f.c));
        f.r = Math.max(0, Math.min(ROWS - 1, f.r));
        if (f.ghost === 0 && at(f.c, f.r) !== EMPTY) grid[f.r][f.c] = EMPTY;
      } else {
        const open = Object.entries(DIRS).filter(([, [dc, dr]]) => at(f.c + dc, f.r + dr) === EMPTY);
        if (!open.length) { f.ghost = 10; continue; }
        // Elle vise la foreuse, mais garde son cap une fois sur deux : sinon elle colle.
        open.sort(([, a], [, b]) => (
          (Math.abs(p.c - (f.c + a[0])) + Math.abs(p.r - (f.r + a[1])))
          - (Math.abs(p.c - (f.c + b[0])) + Math.abs(p.r - (f.r + b[1])))
        ));
        const keep = open.find(([d]) => d === f.dir);
        const [d, [dc, dr]] = (keep && Math.random() < 0.5) ? keep : open[0];
        f.dir = d; f.c += dc; f.r += dr;
        if (grace <= 0 && Math.random() < D.ghost * D.foeStep) f.ghost = 8 + ((Math.random() * 8) | 0);
      }
      if (dead <= 0 && f.c === p.c && f.r === p.r) hurt();
    }
  }

  /* --- Boucle -------------------------------------------------------------- */

  function update() {
    // Mort : la galerie est refermée et les bestioles remurées, comme sur la borne — sinon
    // celle qui t'a eu campe sur ton point de départ et prend les vies qui restent.
    if (dead > 0) { if (--dead === 0 && !over) build(); return; }
    if (grace > 0) grace--;

    harpoonTick();
    if (!harpoon?.target && cool-- <= 0) {
      const dir = Object.keys(DIRS).find((d) => key[d]);
      if (dir) {
        p.face = dir;
        const [dc, dr] = DIRS[dir];
        const c = p.c + dc, r = p.r + dr;
        const cell = at(c, r);
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS && cell !== ROCK) {
          if (cell === DIRT) { grid[r][c] = EMPTY; score += 1; host.sfx.move(); }
          p.c = c; p.r = r;
          stats();
        }
        cool = D.step;
      }
    }
    rocksTick();
    foesTick();
    for (const f of foes) if (!f.dead && dead <= 0 && f.c === p.c && f.r === p.r && f !== harpoon?.target) hurt();
  }

  /* --- Dessin -------------------------------------------------------------- */

  function draw() {
    ctx.fillStyle = '#0A0A10';
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * CELL, y = r * CELL;
        if (grid[r][c] === DIRT) {
          ctx.fillStyle = strata(r);
          ctx.fillRect(x, y, CELL, CELL);
          ctx.fillStyle = 'rgba(0,0,0,0.12)';
          ctx.fillRect(x, y + CELL - 3, CELL, 3);
        } else if (grid[r][c] === ROCK) {
          rock(x, y);
        }
      }
    }
    for (const f of falls) rock(f.c * CELL, f.r * CELL);

    if (harpoon && dead <= 0) {
      const [dc, dr] = DIRS[harpoon.dir];
      ctx.strokeStyle = '#F5F2EA';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.c * CELL + CELL / 2, p.r * CELL + CELL / 2);
      ctx.lineTo((p.c + dc * harpoon.len) * CELL + CELL / 2, (p.r + dr * harpoon.len) * CELL + CELL / 2);
      ctx.stroke();
    }

    for (const f of foes) {
      if (f.dead) continue;
      const s = CELL * (0.78 + f.pump * 0.11);
      const x = f.c * CELL + CELL / 2, y = f.r * CELL + CELL / 2;
      ctx.fillStyle = f.ghost > 0 ? 'rgba(255,179,37,0.45)' : '#FFB325';
      ctx.beginPath(); ctx.arc(x, y, s / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0A0A10';
      ctx.fillRect(x - s * 0.22, y - s * 0.12, s * 0.14, s * 0.14);
      ctx.fillRect(x + s * 0.08, y - s * 0.12, s * 0.14, s * 0.14);
    }

    if (dead <= 0 || (dead >> 3) % 2) {
      const x = p.c * CELL, y = p.r * CELL;
      ctx.fillStyle = '#52B4FF';
      ctx.fillRect(x + 4, y + 4, CELL - 8, CELL - 8);
      ctx.fillStyle = '#F5F2EA';
      const [dc, dr] = DIRS[p.face];
      ctx.fillRect(x + CELL / 2 - 2 + dc * 6, y + CELL / 2 - 2 + dr * 6, 4, 4);
    }

    ctx.fillStyle = 'rgba(245,242,234,0.55)';
    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    ctx.fillText(`PROFONDEUR ${p.r * 2} m`, 8, H - 6);
    const alive = foes.filter((f) => !f.dead).length;
    ctx.fillText(`BESTIOLES ${alive}`, W - 104, H - 6);
  }

  function rock(x, y) {
    ctx.fillStyle = '#6B7280';
    ctx.beginPath();
    ctx.moveTo(x + 3, y + CELL - 2); ctx.lineTo(x + 1, y + 8);
    ctx.lineTo(x + CELL / 2, y + 2); ctx.lineTo(x + CELL - 1, y + 9);
    ctx.lineTo(x + CELL - 3, y + CELL - 2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x + 6, y + 7, 5, 3);
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
      build();
      stats();
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'action' || a === 'hold') {
        if (down && !key.action && dead <= 0) fire();
        key.action = down;
        return;
      }
      if (a in key) { key[a] = down; if (down) cool = 0; }
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
