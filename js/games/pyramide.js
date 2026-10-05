// Pyramide — dans l'esprit de Q*bert (1982). Sept rangées de cubes, des sauts en
// diagonale, et des boules qui descendent. Changer la couleur de tous les cubes
// finit le tableau ; sauter dans le vide finit la vie.
const ROWS = 7;
const CW = 54, CH = 30, CD = 22;      // largeur, hauteur de la face du haut, profondeur
const W = 480, H = 380;
const STEP = 1000 / 60;

// La croix donne les quatre diagonales — la seule façon lisible de jouer à Q*bert au clavier.
const HOPS = {
  up:    [-1, -1],   // en haut à gauche
  right: [-1, 0],    // en haut à droite
  down:  [1, 1],     // en bas à droite
  left:  [1, 0],     // en bas à gauche
};

const FACES = [
  ['#2B2440', '#221C34', '#1A1528'],   // cube neuf
  ['#FFB325', '#C98515', '#9C650F'],   // une fois sauté dessus
  ['#19D197', '#12A074', '#0D7455'],   // cible des tableaux à deux passages
];

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Facile : un seul passage par cube, peu de boules. Difficile : deux passages, ça tombe vite.
  const D = [
    { lives: 4, steps: 1, spawn: 150, ballSpeed: 0.022, max: 2 },
    { lives: 3, steps: 1, spawn: 110, ballSpeed: 0.030, max: 3 },
    { lives: 3, steps: 2, spawn: 85, ballSpeed: 0.038, max: 4 },
  ][opts.difficulty ?? 1];

  let cubes, p, balls, disc, score, level, lives, spawnT, inv, won;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;

  const topX = W / 2, topY = 56;
  const cellX = (r, c) => topX + (c - r / 2) * CW;
  const cellY = (r) => topY + r * (CH + CD - 8);
  const onBoard = (r, c) => r >= 0 && r < ROWS && c >= 0 && c <= r;

  function buildLevel() {
    cubes = Array.from({ length: ROWS }, (_, r) => new Array(r + 1).fill(0));
    p = { r: 0, c: 0, fromR: 0, fromC: 0, t: 1, falling: 0 };
    balls = [];
    disc = { r: 2 + ((Math.random() * 3) | 0), used: false };   // le disque volant, un sauvetage par tableau
    spawnT = 90;
    inv = 30;
  }

  function finish(victory) {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, victory);
  }

  function hurt() {
    if (inv > 0) return;
    lives--;
    host.sfx.hit();
    host.onStats({ lives });
    navigator.vibrate?.(60);
    if (lives <= 0) return finish(false);
    p = { r: 0, c: 0, fromR: 0, fromC: 0, t: 1, falling: 0 };
    balls = [];
    spawnT = 90;
    inv = 60;
  }

  const done = () => cubes.every((row) => row.every((v) => v >= D.steps));

  function land() {
    const { r, c } = p;
    if (cubes[r][c] < D.steps) {
      cubes[r][c]++;
      score += 25;
      host.sfx.score();
      host.onStats({ score });
    }
    if (!done()) return;
    score += 1000;
    level++;
    host.sfx.win();
    host.onStats({ score, level });
    if (level > 6) return finish(true);
    buildLevel();
  }

  function hop(dir) {
    if (p.t < 1 || p.falling || !running || paused) return;
    const [dr, dc] = HOPS[dir];
    const r = p.r + dr, c = p.c + dc;
    p.fromR = p.r; p.fromC = p.c;
    p.t = 0;
    host.sfx.move();
    if (onBoard(r, c)) { p.r = r; p.c = c; return; }
    // Hors de la pyramide : le disque, posé au bord gauche d'une rangée, rattrape le
    // saut vers le haut à gauche. Sinon c'est la chute.
    if (!disc.used && dir === 'up' && p.c === 0 && p.r === disc.r) {
      disc.used = true;
      p.r = r; p.c = c; p.rescue = true;
      score += 500;
      host.sfx.pickup();
      host.onStats({ score });
      return;
    }
    p.r = r; p.c = c;
    p.falling = 1;
  }

  function update() {
    if (inv > 0) inv--;

    if (p.t < 1) {
      p.t = Math.min(1, p.t + 0.12);
      if (p.t >= 1) {
        if (p.rescue) {
          // Le disque repose le joueur au sommet.
          p.rescue = false;
          p.r = 0; p.c = 0; p.fromR = 0; p.fromC = 0;
          land();
        } else if (!p.falling) land();
      }
    }
    if (p.falling) {
      p.falling += 1.2;
      if (p.falling > 40) { p.falling = 0; hurt(); }
      return;
    }

    if (--spawnT <= 0 && balls.length < D.max) {
      spawnT = D.spawn;
      balls.push({ r: 0, c: Math.random() < 0.5 ? 0 : 1, fromR: 0, fromC: 0, t: 0 });
    }

    for (const b of balls) {
      b.t += D.ballSpeed + level * 0.002;
      if (b.t < 1) continue;
      b.t = 0;
      b.fromR = b.r; b.fromC = b.c;
      // Une boule descend, au hasard à gauche ou à droite.
      const left = Math.random() < 0.5;
      b.r += 1;
      b.c += left ? 0 : 1;
      if (b.r >= ROWS) b.gone = true;
    }
    balls = balls.filter((b) => !b.gone);

    // Collision à l'écran, pas à la case : deux sauteurs en l'air se croisent vraiment.
    const [px, py] = hopXY(p);
    if (balls.some((b) => { const [bx, by] = hopXY(b); return Math.hypot(bx - px, by - py) < 17; })) hurt();
  }

  function cube(r, c, state, lift = 0) {
    const x = cellX(r, c), y = cellY(r) - lift;
    const [top, left, right] = FACES[Math.min(state, FACES.length - 1)];
    ctx.beginPath();            // face du dessus
    ctx.moveTo(x, y);
    ctx.lineTo(x + CW / 2, y + CH / 2);
    ctx.lineTo(x, y + CH);
    ctx.lineTo(x - CW / 2, y + CH / 2);
    ctx.closePath();
    ctx.fillStyle = top; ctx.fill();
    ctx.beginPath();            // face gauche
    ctx.moveTo(x - CW / 2, y + CH / 2);
    ctx.lineTo(x, y + CH);
    ctx.lineTo(x, y + CH + CD);
    ctx.lineTo(x - CW / 2, y + CH / 2 + CD);
    ctx.closePath();
    ctx.fillStyle = left; ctx.fill();
    ctx.beginPath();            // face droite
    ctx.moveTo(x + CW / 2, y + CH / 2);
    ctx.lineTo(x, y + CH);
    ctx.lineTo(x, y + CH + CD);
    ctx.lineTo(x + CW / 2, y + CH / 2 + CD);
    ctx.closePath();
    ctx.fillStyle = right; ctx.fill();
  }

  /** Position écran d'un sauteur, entre sa case de départ et son arrivée, avec la cloche du saut. */
  function hopXY(o) {
    const k = Math.min(1, o.t);
    const x = cellX(o.fromR, o.fromC) + (cellX(o.r, o.c) - cellX(o.fromR, o.fromC)) * k;
    const y = cellY(o.fromR) + (cellY(o.r) - cellY(o.fromR)) * k - Math.sin(k * Math.PI) * 26;
    return [x, y];
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);

    for (let r = ROWS - 1; r >= 0; r--) {
      for (let c = 0; c <= r; c++) cube(r, c, cubes[r][c]);
    }

    if (!disc.used) {
      const dx = cellX(disc.r, -1) + 6, dy = cellY(disc.r) + CH / 2;
      ctx.fillStyle = '#55AEFF';
      ctx.beginPath();
      ctx.ellipse(dx, dy, 18, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.ellipse(dx, dy - 2, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    balls.forEach((b) => {
      const [x, y] = hopXY(b);
      ctx.fillStyle = '#FF5A52';
      ctx.beginPath();
      ctx.arc(x, y + CH / 2, 9, 0, Math.PI * 2);
      ctx.fill();
    });

    // Le joueur : un petit bonhomme à bec, qui tombe en tournant hors du plateau.
    let [px, py] = hopXY(p);
    if (p.falling) py += p.falling * p.falling * 0.5;
    if (inv === 0 || Math.floor(inv / 4) % 2 === 0) {
      ctx.fillStyle = '#FFB325';
      ctx.beginPath();
      ctx.arc(px, py + CH / 2 - 4, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FF5A2B';
      ctx.fillRect(px + 4, py + CH / 2 - 4, 10, 5);
      ctx.fillStyle = '#08070A';
      ctx.fillRect(px - 4, py + CH / 2 - 10, 4, 4);
      ctx.fillRect(px + 2, py + CH / 2 - 10, 4, 4);
    }

    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(245,242,234,0.45)';
    ctx.fillText(`TABLEAU ${level}`, 10, 18);
    ctx.textAlign = 'right';
    ctx.fillText(D.steps > 1 ? 'DEUX PASSAGES PAR CUBE' : 'UN PASSAGE PAR CUBE', W - 10, 18);
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

  // Au doigt : on touche le quart de l'écran qui correspond à la diagonale voulue.
  const onPointer = (e) => {
    e.preventDefault();
    const box = canvas.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width - 0.5;
    const y = (e.clientY - box.top) / box.height - 0.5;
    hop(Math.abs(x) > Math.abs(y)
      ? (x > 0 ? (y > 0 ? 'down' : 'right') : (y > 0 ? 'left' : 'up'))
      : (y > 0 ? (x > 0 ? 'down' : 'left') : (x > 0 ? 'right' : 'up')));
  };

  return {
    start() {
      score = 0; level = 1; lives = D.lives; won = false;
      paused = false; running = true; over = false; last = 0; acc = 0;
      buildLevel();
      canvas.addEventListener('pointerdown', onPointer);
      host.onStats({ score, level, lives });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) { if (down && HOPS[a]) hop(a); },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onPointer);
    },
  };
}
