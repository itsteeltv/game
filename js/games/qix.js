// Qix — dans l'esprit de Qix (1981). Tu longes le bord, tu plonges dans le vide,
// tu refermes ta ligne : la zone découpée qui ne contient pas le Qix est à toi.
// Avance lentement et elle vaut le double — mais si le Qix touche ta ligne, tu meurs.
const COLS = 36, ROWS = 26, CELL = 12;
const W = COLS * CELL, H = ROWS * CELL + 22;
const STEP = 1000 / 60;

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Facile : un Qix lent et une mèche patiente. Difficile : deux Qix, et ça brûle vite.
  const D = [
    { lives: 4, qix: 1, speed: 1.5, fuse: 150, fuseStep: 26, target: 0.6 },
    { lives: 3, qix: 1, speed: 2.1, fuse: 110, fuseStep: 18, target: 0.7 },
    { lives: 3, qix: 2, speed: 2.6, fuse: 80, fuseStep: 12, target: 0.75 },
  ][opts.difficulty ?? 1];

  let filled, p, path, pathSet, qixes, fuse, fuseIdle, score, level, lives, dead, claimed, slow, cool;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;
  const key = { up: false, down: false, left: false, right: false };

  const INTERIOR = (COLS - 2) * (ROWS - 2);

  const cell = (r, c) => (r < 0 || r >= ROWS || c < 0 || c >= COLS ? true : filled[r][c]);
  /** Un point du quadrillage est sûr s'il touche au moins une case déjà prise. */
  const safe = (c, r) => cell(r - 1, c - 1) || cell(r - 1, c) || cell(r, c - 1) || cell(r, c);
  const pk = (c, r) => `${c},${r}`;

  function build() {
    filled = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => (
      r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1
    )));
    p = { c: COLS >> 1, r: ROWS - 1 };
    path = null; pathSet = null; fuse = 0; fuseIdle = 0; claimed = 0; cool = 0;
    qixes = Array.from({ length: D.qix + (((level - 1) / 3) | 0) }, (_, i) => {
      const a = Math.PI * (0.25 + i * 0.4);
      const sp = D.speed + (level - 1) * 0.15;
      return {
        x: W / 2 + (i - 0.5) * 60, y: H * 0.35,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        trail: [],
      };
    });
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
    path = null; pathSet = null; fuse = 0;
    host.sfx.hit();
    stats();
    if (lives <= 0) finish(false);
  }

  /* --- Découpe -------------------------------------------------------------- */

  /** Les arêtes couvertes par la ligne en cours : elles bloquent le remplissage. */
  function pathEdges() {
    const hE = new Set(), vE = new Set();
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if (a.r === b.r) hE.add(`${a.r},${Math.min(a.c, b.c)}`);
      else vE.add(`${Math.min(a.r, b.r)},${a.c}`);
    }
    return { hE, vE };
  }

  /** Ferme la ligne : tout ce que le Qix ne peut plus atteindre devient à toi. */
  function close() {
    const { hE, vE } = pathEdges();
    const seen = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
    const queue = [];
    for (const q of qixes) {
      const c = Math.min(COLS - 1, Math.max(0, (q.x / CELL) | 0));
      const r = Math.min(ROWS - 1, Math.max(0, (q.y / CELL) | 0));
      if (!filled[r][c] && !seen[r][c]) { seen[r][c] = true; queue.push([r, c]); }
    }
    for (let i = 0; i < queue.length; i++) {
      const [r, c] = queue[i];
      const step = (nr, nc, blockedBy) => {
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return;
        if (seen[nr][nc] || filled[nr][nc] || blockedBy) return;
        seen[nr][nc] = true; queue.push([nr, nc]);
      };
      step(r - 1, c, hE.has(`${r},${c}`));
      step(r + 1, c, hE.has(`${r + 1},${c}`));
      step(r, c - 1, vE.has(`${r},${c}`));
      step(r, c + 1, vE.has(`${r},${c + 1}`));
    }

    let got = 0;
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (!filled[r][c] && !seen[r][c]) { filled[r][c] = true; got++; }
      }
    }
    // La ligne elle-même devient du solide : sinon elle resterait un couloir ouvert.
    for (const pt of path) {
      for (const [dr, dc] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
        const r = pt.r + dr, c = pt.c + dc;
        if (r > 0 && c > 0 && r < ROWS - 1 && c < COLS - 1 && !filled[r][c] && !seen[r][c]) filled[r][c] = true;
      }
    }

    path = null; pathSet = null; fuse = 0; fuseIdle = 0;
    if (got) {
      claimed += got;
      score += got * 10 * (slow ? 2 : 1);
      host.sfx[slow ? 'win' : 'clear']();
      stats();
    } else host.sfx.move();

    if (claimed / INTERIOR >= D.target) {
      level++;
      score += 2000;
      build();
      stats();
    }
  }

  /* --- Qix et mèche --------------------------------------------------------- */

  function qixTick() {
    for (const q of qixes) {
      const nx = q.x + q.vx, ny = q.y + q.vy;
      // Il ne va que dans le vide : le solide le renvoie.
      if (cell((ny / CELL) | 0, (nx / CELL) | 0)) {
        if (cell((q.y / CELL) | 0, (nx / CELL) | 0)) q.vx = -q.vx;
        if (cell((ny / CELL) | 0, (q.x / CELL) | 0)) q.vy = -q.vy;
      } else { q.x = nx; q.y = ny; }
      // Un peu d'errance, comme l'original qui ne va jamais droit très longtemps.
      const a = Math.atan2(q.vy, q.vx) + (Math.random() - 0.5) * 0.25;
      const sp = Math.hypot(q.vx, q.vy) || D.speed;
      q.vx = Math.cos(a) * sp; q.vy = Math.sin(a) * sp;
      q.trail.unshift({ x: q.x, y: q.y });
      if (q.trail.length > 14) q.trail.pop();
    }

    if (!path || dead > 0) return;
    // Le Qix touche la ligne : c'est fini pour cette vie.
    for (const q of qixes) {
      for (let i = 1; i < path.length; i++) {
        if (distToSeg(q.x, q.y, path[i - 1], path[i]) < CELL * 0.5) { hurt(); return; }
      }
    }
  }

  function distToSeg(x, y, a, b) {
    const ax = a.c * CELL, ay = a.r * CELL, bx = b.c * CELL, by = b.r * CELL;
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
  }

  /** La mèche : reste immobile en pleine ligne et elle te rattrape par le début. */
  function fuseTick() {
    if (!path) { fuse = 0; fuseIdle = 0; return; }
    if (++fuseIdle < D.fuse) return;
    if ((fuseIdle - D.fuse) % D.fuseStep) return;
    fuse++;
    host.sfx.move();
    if (fuse >= path.length - 1) hurt();
  }

  /* --- Boucle -------------------------------------------------------------- */

  function tryMove(dir) {
    const [dc, dr] = DIRS[dir];
    const c = p.c + dc, r = p.r + dr;
    if (c < 0 || c > COLS || r < 0 || r > ROWS) return;

    if (!path) {
      if (safe(c, r)) { p.c = c; p.r = r; return; }           // on longe le bord
      // Plongée dans le vide : la ligne commence ici.
      path = [{ c: p.c, r: p.r }, { c, r }];
      pathSet = new Set([pk(p.c, p.r), pk(c, r)]);
      p.c = c; p.r = r;
      fuse = 0; fuseIdle = 0;
      host.sfx.shoot();
      return;
    }
    if (pathSet.has(pk(c, r))) return;                        // jamais sur sa propre ligne
    path.push({ c, r });
    pathSet.add(pk(c, r));
    p.c = c; p.r = r;
    // Le mur est retrouvé après au moins deux segments : on referme.
    if (safe(c, r) && path.length > 2) close();
  }

  function update() {
    if (dead > 0) {
      if (--dead === 0 && !over) { p.c = COLS >> 1; p.r = ROWS - 1; }
      return;
    }
    if (--cool <= 0) {
      const dir = Object.keys(DIRS).find((d) => key[d]);
      if (dir) {
        tryMove(dir);
        cool = slow ? 11 : 5;
        if (path) fuseIdle = 0;
      }
    }
    qixTick();
    fuseTick();
  }

  /* --- Dessin -------------------------------------------------------------- */

  function draw() {
    ctx.fillStyle = '#05060C';
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!filled[r][c]) continue;
        const edge = r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1;
        ctx.fillStyle = edge ? '#232A3D' : '#1D3C6E';
        ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
      }
    }
    // Un liseré clair sur ce que tu as pris : la zone se lit d'un coup d'œil.
    ctx.fillStyle = 'rgba(82,180,255,0.18)';
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) if (filled[r][c]) ctx.fillRect(c * CELL, r * CELL, CELL - 1, CELL - 1);
    }

    for (const q of qixes) {
      for (let i = 1; i < q.trail.length; i++) {
        ctx.strokeStyle = `hsla(${(i * 24 + 280) % 360},100%,65%,${1 - i / q.trail.length})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(q.trail[i - 1].x, q.trail[i - 1].y);
        ctx.lineTo(q.trail[i].x, q.trail[i].y);
        ctx.stroke();
      }
    }

    if (path) {
      ctx.strokeStyle = '#FFB325';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(path[0].c * CELL, path[0].r * CELL);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].c * CELL, path[i].r * CELL);
      ctx.stroke();
      if (fuse > 0) {
        const f = path[Math.min(fuse, path.length - 1)];
        ctx.fillStyle = '#FF4D1F';
        ctx.beginPath(); ctx.arc(f.c * CELL, f.r * CELL, 4, 0, Math.PI * 2); ctx.fill();
      }
    }

    if (dead <= 0 || (dead >> 3) % 2) {
      ctx.fillStyle = slow ? '#19D197' : '#F5F2EA';
      ctx.beginPath(); ctx.arc(p.c * CELL, p.r * CELL, 4.5, 0, Math.PI * 2); ctx.fill();
    }

    const pct = Math.round((claimed / INTERIOR) * 100);
    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(245,242,234,0.55)';
    ctx.fillText(`ZONE ${pct} % · OBJECTIF ${Math.round(D.target * 100)} %`, 8, H - 7);
    if (slow) { ctx.fillStyle = '#19D197'; ctx.fillText('LENT ×2', W - 72, H - 7); }
    ctx.fillStyle = 'rgba(82,180,255,0.5)';
    ctx.fillRect(0, H - 3, W * Math.min(1, (claimed / INTERIOR) / D.target), 3);
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
      score = 0; level = 1; lives = D.lives; dead = 0; slow = false;
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
      if (a === 'hold' || a === 'action') { slow = down; return; }
      if (a in key) { key[a] = down; if (down) cool = 0; }
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
