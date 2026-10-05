// Flipper — dans l'esprit du flipper 3D livré avec Windows (Space Cadet, 1995) : une
// table spatiale où l'on monte en grade en remplissant des missions, avec son carburant,
// son hyperespace, sa multibille — et son tilt, qui punit celui qui secoue trop fort.
// Table, règles et dessin sont écrits ici ; rien n'est repris du jeu d'origine.
const W = 340, H = 520;
const R = 7;                 // rayon de la bille
const STEP = 1000 / 60;      // la physique est réglée pour des images de 1/60 s

// L'échelle des grades, comme sur la table d'origine : chaque mission remplie fait monter.
const RANKS = [
  'Cadet', 'Enseigne', 'Lieutenant', 'Capitaine', 'Capitaine de frégate',
  'Commandant', 'Commodore', 'Amiral', 'Amiral de la flotte',
];

const MISSIONS = [
  'Reconnaissance', 'Escorte du convoi', 'Sauvetage', 'Champ d’astéroïdes',
  'Alerte rouge', 'Contact extraterrestre', 'Trou de ver', 'Patrouille frontière',
];

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Facile : bille paresseuse, flips longs, quatre billes. Difficile : lourde, courts, trois.
  const D = [
    { grav: 0.13, balls: 4, flip: 0.46, arm: 62, bounce: 0.82, mult: 1, gap: 10, burn: 0.05, mission: 1800, tilt: 4 },
    { grav: 0.16, balls: 3, flip: 0.42, arm: 56, bounce: 0.78, mult: 2, gap: 16, burn: 0.08, mission: 1500, tilt: 3 },
    { grav: 0.20, balls: 3, flip: 0.38, arm: 50, bounce: 0.74, mult: 3, gap: 22, burn: 0.12, mission: 1200, tilt: 3 },
  ][opts.difficulty ?? 1];

  // Le drain, c'est la difficulté : les pivots sont posés pour que l'écart entre les deux
  // pointes au repos fasse `gap` — une bille en facile, trois en difficile.
  const REST = 0.46;
  const PIV = W / 2 - D.gap / 2 - D.arm * Math.cos(REST);

  /* --- Géométrie de la table ------------------------------------------------ */
  // Les murs sont des segments ; la bille est repoussée hors de ce qu'elle touche.
  const LANE_W = W - 32;          // le mur intérieur du couloir de lancement
  const WALLS = [
    [[14, 60], [14, 380]], [[W - 14, 18], [W - 14, 380]],          // côtés
    [[14, 60], [60, 18]],                                          // épaule gauche
    [[60, 18], [W - 14, 18]],                                      // la voûte, jusqu'au couloir
    [[14, 380], [PIV - 6, 448]], [[W - 14, 386], [W - PIV + 6, 448]],  // l'entonnoir vers les flips
    [[LANE_W, 46], [LANE_W, 386]], [[LANE_W, 386], [W - 14, 386]], // le couloir de lancement et son fond
  ];
  // Le clapet en haut du couloir : la bille le pousse en montant et ne peut plus redescendre.
  const GATE = [[LANE_W - 1, 44], [W - 14, 44]];

  // Les trois couloirs de rentrée, sous la voûte : la bille qui retombe en allume un.
  const LANE_Y = 60;
  const LANES = [[20, 122], [122, 212], [212, 308]];

  const BUMPERS = [
    { x: 96, y: 158, r: 20, pts: 100, lit: 0, tag: 'B0' },
    { x: 212, y: 158, r: 20, pts: 100, lit: 0, tag: 'B1' },
    { x: 154, y: 214, r: 23, pts: 150, lit: 0, tag: 'B2' },
  ];
  // Les lanceurs : rails rapides au-dessus des flips, qui renvoient la bille en l'air.
  const SLINGS = [
    { a: [40, 300], b: [86, 372], pts: 50 },
    { a: [W - 40, 300], b: [W - 86, 372], pts: 50 },
  ];
  // La rampe à carburant : cinq cibles tombantes qui font le plein et montent le multiplicateur.
  const mkTargets = () => [0, 1, 2, 3, 4].map((i) => ({ x: 78 + i * 38, y: 100, down: false }));

  const SAUCER = { x: 44, y: 268, r: 15 };     // le trou des missions
  const HOLE = { x: W - 62, y: 268, r: 15 };   // l'hyperespace : la bille revient au lanceur

  const FLIP = {
    left:  { px: PIV, py: 452, rest: REST, up: -0.52 },
    right: { px: W - PIV, py: 452, rest: Math.PI - REST, up: Math.PI + 0.52 },
  };

  // Le fond étoilé est tiré une fois pour toutes : il ne doit pas scintiller au hasard.
  const STARS = Array.from({ length: 60 }, () => ({
    x: 16 + Math.random() * (W - 32), y: 20 + Math.random() * (H - 60), r: Math.random() * 1.3 + 0.3,
  }));

  let balls, ball, hold, power, charging, lives, score, mult, fuel, rank;
  let laneLit, targets, flippers, flash, msg, mission, held;
  let idle, shake, tilt, tilted;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;

  const key = { left: false, right: false };

  const mkBall = (x, y, vx = 0, vy = 0) => ({ x, y, px: x, py: y, vx, vy });

  /** Bille au repos dans le couloir, prête à être propulsée. */
  function reset() {
    balls = [mkBall(W - 23, 360)];
    ball = balls[0];
    hold = true; power = 0; charging = false;
    held = null;
  }

  function say(text, t = 110) { msg = { text, t }; }

  function pop(x, y, pts) {
    if (tilted) return;
    const won = Math.round(pts * mult * D.mult);
    score += won;
    flash.push({ x, y, t: 32, pts: won });
    host.onStats({ score });
  }

  function finish() {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, rank >= RANKS.length - 1);
  }

  /* --- Grades et missions --------------------------------------------------- */

  function startMission() {
    if (mission || fuel <= 0) return false;
    const goals = ['B0', 'B1', 'B2', 'L0', 'L1', 'L2'].sort(() => Math.random() - 0.5).slice(0, 3);
    mission = { name: MISSIONS[(Math.random() * MISSIONS.length) | 0], goals, done: [], t: D.mission };
    say(`MISSION : ${mission.name}`, 150);
    host.sfx.win();
    return true;
  }

  /** Un objectif touché. Les trois, et c'est la promotion — plus la multibille. */
  function goal(tag) {
    if (!mission || tilted || mission.done.includes(tag) || !mission.goals.includes(tag)) return;
    mission.done.push(tag);
    host.sfx.pickup();
    pop(W / 2, 250, 500 * (rank + 1));
    if (mission.done.length < mission.goals.length) return;

    mission = null;
    if (rank < RANKS.length - 1) rank++;
    pop(W / 2, 250, 2500 * (rank + 1));
    say(`PROMOTION — ${RANKS[rank]}`, 170);
    host.sfx.win();
    host.onStats({ level: rank + 1 });
    multiball();
    if (rank >= RANKS.length - 1) finish();   // amiral de la flotte : la table est finie
  }

  function failMission() {
    mission = null;
    say('MISSION ÉCHOUÉE', 120);
    host.sfx.gameover();
  }

  /** Deux billes de plus, lâchées du trou des missions. */
  function multiball() {
    if (balls.length > 1) return;
    for (let i = 0; i < 2; i++) balls.push(mkBall(SAUCER.x + 20, SAUCER.y, 1.6 + i, -5 - i));
    say('MULTIBILLE', 120);
  }

  /* --- Secousse et tilt ----------------------------------------------------- */

  function nudge() {
    if (tilted || hold || !running || paused) return;
    shake = 12;
    for (const b of balls) { b.vx += (Math.random() - 0.5) * 4.4; b.vy -= 1.9; }
    host.sfx.hit();
    tilt++;
    if (tilt >= D.tilt) {
      tilted = true;
      say('TILT', 200);
      host.sfx.gameover();
    }
  }

  /* --- Physique ------------------------------------------------------------- */

  /** Repousse la bille hors du segment ab et la réfléchit. `push` s'ajoute à sa vitesse. */
  function hitSegment(a, b, pushX = 0, pushY = 0, bounce = D.bounce) {
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((ball.x - a[0]) * abx + (ball.y - a[1]) * aby) / (abx * abx + aby * aby || 1)));
    const cx = a[0] + abx * t, cy = a[1] + aby * t;
    let dx = ball.x - cx, dy = ball.y - cy;
    let d = Math.hypot(dx, dy);
    if (d > R) return false;
    if (d < 0.001) { dx = 0; dy = -1; d = 1; }
    const nx = dx / d, ny = dy / d;
    ball.x = cx + nx * (R + 0.5);
    ball.y = cy + ny * (R + 0.5);
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      ball.vx -= (1 + bounce) * vn * nx;
      ball.vy -= (1 + bounce) * vn * ny;
    }
    ball.vx += pushX; ball.vy += pushY;
    return true;
  }

  function flipperSegment(side) {
    const f = FLIP[side], s = flippers[side];
    return [[f.px, f.py], [f.px + Math.cos(s.a) * D.arm, f.py + Math.sin(s.a) * D.arm]];
  }

  /** Un trou avale la bille : `onSwallow` décide de ce qui lui arrive ensuite. */
  function swallow(hole) {
    const d = Math.hypot(ball.x - hole.x, ball.y - hole.y);
    return d < hole.r;
  }

  function update() {
    // Les flips rejoignent leur angle cible ; c'est leur vitesse qui propulse la bille.
    for (const side of ['left', 'right']) {
      const f = FLIP[side], s = flippers[side];
      const prev = s.a;
      s.a += (((key[side] && !tilted) ? f.up : f.rest) - s.a) * D.flip;
      s.w = s.a - prev;
    }

    if (msg && --msg.t <= 0) msg = null;
    if (shake > 0) shake--;
    if (tilt > 0 && !tilted) tilt -= 0.004;   // la secousse se pardonne lentement

    // Le lanceur se charge tant que la touche est tenue, comme le ressort de la table.
    if (hold) {
      if (charging) power = Math.min(1, power + 0.022);
      return;
    }

    // Une mission brûle du carburant ; à sec ou en retard, elle échoue.
    if (mission) {
      fuel = Math.max(0, fuel - D.burn);
      if (--mission.t <= 0 || fuel <= 0) failMission();
    }

    // La bille retenue par le trou des missions ressort toute seule.
    if (held) {
      if (--held.t <= 0) {
        held.ball.vy = -7.5; held.ball.vx = 1.6;
        balls.push(held.ball);
        held = null;
      }
    }

    for (let bi = balls.length - 1; bi >= 0; bi--) {
      ball = balls[bi];
      ball.px = ball.x; ball.py = ball.y;

      ball.vy += D.grav;
      ball.vx *= 0.9975;
      const sp = Math.hypot(ball.vx, ball.vy);
      if (sp > 14.5) { ball.vx *= 14.5 / sp; ball.vy *= 14.5 / sp; }

      // Sous-pas : une bille rapide ne doit pas traverser un flip.
      const sub = Math.max(1, Math.ceil(sp / 4));
      for (let i = 0; i < sub; i++) {
        ball.x += ball.vx / sub;
        ball.y += ball.vy / sub;

        for (const [a, b] of WALLS) hitSegment(a, b, 0, 0, 0.62);
        if (ball.vy > 0 && ball.x > LANE_W - 8) hitSegment(GATE[0], GATE[1], 0, 0, 0.5);

        for (const s of SLINGS) {
          if (hitSegment(s.a, s.b, 0, -1.6, 1.0)) {
            host.sfx.hit();
            pop((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, s.pts);
          }
        }

        for (const bp of BUMPERS) {
          const dx = ball.x - bp.x, dy = ball.y - bp.y;
          const d = Math.hypot(dx, dy);
          if (d >= bp.r + R) continue;
          const nx = dx / (d || 1), ny = dy / (d || 1);
          ball.x = bp.x + nx * (bp.r + R + 0.5);
          ball.y = bp.y + ny * (bp.r + R + 0.5);
          const vn = ball.vx * nx + ball.vy * ny;
          ball.vx -= 1.9 * vn * nx; ball.vy -= 1.9 * vn * ny;
          ball.vx += nx * 1.1; ball.vy += ny * 1.1;
          bp.lit = 12;
          host.sfx.score();
          pop(bp.x, bp.y, bp.pts);
          goal(bp.tag);
        }

        for (const tg of targets) {
          if (tg.down) continue;
          if (Math.abs(ball.x - tg.x) > 17 + R || Math.abs(ball.y - tg.y) > 8 + R) continue;
          tg.down = true;
          ball.vy = Math.abs(ball.vy) + 0.8;
          fuel = Math.min(100, fuel + 14);
          host.sfx.pickup();
          pop(tg.x, tg.y, 200);
          if (targets.every((o) => o.down)) {
            // Rampe complète : le plein est fait et le multiplicateur grimpe.
            mult = Math.min(5, mult + 1);
            fuel = 100;
            targets = mkTargets();
            host.sfx.win();
            pop(W / 2, 120, 1000);
            say(`PLEIN FAIT — ×${mult}`);
          }
        }

        // Les flips en dernier : ce sont les seuls murs qui bougent.
        for (const side of ['left', 'right']) {
          const [a, b] = flipperSegment(side);
          const s = flippers[side];
          if (Math.abs(s.w) > 0.004) {
            // Vitesse de la pointe le long de la normale du bras : un flip bien tombé envoie loin.
            const push = -s.w * D.arm * 0.55;
            if (hitSegment(a, b, Math.sin(s.a) * push, -Math.cos(s.a) * push, 0.9)) host.sfx.move();
          } else hitSegment(a, b, 0, 0, 0.35);
        }
      }

      // Rentrée : la bille qui redescend à travers la voûte allume son couloir.
      if (ball.py < LANE_Y && ball.y >= LANE_Y && ball.vy > 0) {
        const i = LANES.findIndex(([x0, x1]) => ball.x >= x0 && ball.x < x1);
        if (i >= 0 && !laneLit[i]) {
          laneLit[i] = true;
          host.sfx.score();
          pop(ball.x, LANE_Y, 250);
          goal(`L${i}`);
          if (laneLit.every(Boolean)) {
            laneLit = [false, false, false];
            fuel = Math.min(100, fuel + 30);
            pop(W / 2, LANE_Y + 20, 1500);
            say('COULOIRS COMPLETS — CARBURANT');
            host.sfx.win();
          }
        }
      }

      // Le trou des missions : il garde la bille le temps de l'annonce, puis la recrache.
      if (!held && swallow(SAUCER)) {
        balls.splice(bi, 1);
        host.sfx.clear();
        if (!startMission()) { pop(SAUCER.x, SAUCER.y, 750); say(fuel <= 0 ? 'PLUS DE CARBURANT' : 'MISSION EN COURS'); }
        held = { ball, t: 48 };
        continue;
      }

      // L'hyperespace : la bille disparaît et ressort au lanceur, prime en poche.
      if (swallow(HOLE)) {
        balls.splice(bi, 1);
        pop(HOLE.x, HOLE.y, 1200);
        say('HYPERESPACE');
        host.sfx.shoot();
        if (!balls.length && !held) { reset(); flash = flash.slice(-4); }
        continue;
      }

      // Sortie du couloir : la bille est poussée vers le jeu au lieu de longer le mur.
      if (ball.x > W - 40 && ball.y < 76) ball.vx -= 0.8;

      if (ball.y > H + 20) {
        balls.splice(bi, 1);
        continue;
      }
    }

    // Plus une bille en jeu (ni en attente dans le trou) : la bille est perdue.
    if (!balls.length && !held && !hold) {
      lives--;
      mult = 1;
      tilt = 0; tilted = false;
      if (mission) failMission();
      host.onStats({ lives });
      host.sfx.gameover();
      if (lives <= 0) return finish();
      reset();
      flash = [];
      idle = 0;
    }

    // Une bille immobile depuis deux secondes est libérée, comme sur une vraie table :
    // sans ça, un coin pourrait la garder indéfiniment.
    const slow = balls.length === 1 && Math.hypot(balls[0].vx, balls[0].vy) < 0.55;
    idle = slow ? idle + 1 : 0;
    if (idle > 120) {
      idle = 0; shake = 12;
      balls[0].vx += (Math.random() - 0.5) * 4;
      balls[0].vy -= 2.6;
      host.sfx.hit();
    }

    flash = flash.filter((f) => --f.t > 0);
    BUMPERS.forEach((b) => { if (b.lit) b.lit--; });
  }

  /* --- Dessin --------------------------------------------------------------- */

  function draw() {
    const sx = shake > 0 ? (Math.random() - 0.5) * 7 : 0;
    ctx.save();
    ctx.translate(sx, 0);
    ctx.fillStyle = '#05060C';
    ctx.fillRect(-8, 0, W + 16, H);

    // Le plateau : un ciel profond, les étoiles, puis le mobilier par-dessus.
    const g = ctx.createRadialGradient(W / 2, 180, 20, W / 2, 320, 360);
    g.addColorStop(0, '#132A52'); g.addColorStop(1, '#070A16');
    ctx.fillStyle = g;
    ctx.fillRect(14, 18, W - 28, H - 18);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    STARS.forEach((s) => { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); });

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(82,180,255,0.45)';
    WALLS.forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });

    ctx.font = '700 11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';

    // Les trois couloirs de rentrée et leurs voyants.
    LANES.forEach(([x0, x1], i) => {
      const cx = (x0 + x1) / 2;
      ctx.strokeStyle = laneLit[i] ? '#FFB325' : 'rgba(82,180,255,0.3)';
      ctx.lineWidth = laneLit[i] ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(x0 + 3, LANE_Y); ctx.lineTo(x1 - 3, LANE_Y); ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, LANE_Y - 11, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = laneLit[i] ? '#FFB325' : 'rgba(255,255,255,0.22)';
      ctx.fill();
    });

    ctx.lineWidth = 5;
    ctx.strokeStyle = '#FF6E99';
    SLINGS.forEach((s) => { ctx.beginPath(); ctx.moveTo(s.a[0], s.a[1]); ctx.lineTo(s.b[0], s.b[1]); ctx.stroke(); });

    targets.forEach((t) => {
      ctx.fillStyle = t.down ? 'rgba(255,255,255,0.12)' : '#19D197';
      ctx.fillRect(t.x - 17, t.y - 4, 34, 8);
    });
    ctx.fillStyle = 'rgba(245,242,234,0.5)';
    ctx.fillText('CARBURANT', W / 2, 86);

    // Les deux trous : missions à gauche, hyperespace à droite.
    [[SAUCER, '#FFB325', 'MISSION'], [HOLE, '#AE82FF', 'HYPER']].forEach(([h, col, label]) => {
      const ring = ctx.createRadialGradient(h.x, h.y, 2, h.x, h.y, h.r);
      ring.addColorStop(0, '#05060C'); ring.addColorStop(1, col);
      ctx.fillStyle = ring;
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.font = '700 9px ui-monospace, Consolas, monospace';
      ctx.fillText(label, h.x, h.y + h.r + 12);
      ctx.font = '700 11px ui-monospace, Consolas, monospace';
    });

    BUMPERS.forEach((b) => {
      const on = b.lit || mission?.goals.includes(b.tag);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = b.lit ? '#FFFFFF' : (mission?.goals.includes(b.tag) && !mission.done.includes(b.tag) ? '#FFB325' : '#52B4FF');
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = on ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)';
      ctx.stroke();
      ctx.fillStyle = '#05060C';
      ctx.fillText(String(b.pts), b.x, b.y + 4);
    });

    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.strokeStyle = tilted ? '#6B7280' : '#F5F2EA';
    ['left', 'right'].forEach((side) => {
      const [a, b] = flipperSegment(side);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    });

    for (const b of balls) {
      const sh = ctx.createRadialGradient(b.x - 2.5, b.y - 3, 1, b.x, b.y, R);
      sh.addColorStop(0, '#FFFFFF'); sh.addColorStop(1, '#8894AC');
      ctx.fillStyle = sh;
      ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, Math.PI * 2); ctx.fill();
    }

    flash.forEach((f) => {
      ctx.globalAlpha = f.t / 32;
      ctx.fillStyle = '#FFF';
      ctx.fillText('+' + f.pts, f.x, f.y - 26 + (32 - f.t));
    });
    ctx.globalAlpha = 1;

    /* Le bandeau du bas : grade, carburant, multiplicateur — et la jauge du lanceur. */
    ctx.fillStyle = 'rgba(5,6,12,0.82)';
    ctx.fillRect(14, H - 26, W - 28, 26);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#52B4FF';
    ctx.fillText(RANKS[rank].toUpperCase(), 20, H - 9);
    ctx.textAlign = 'right';
    ctx.fillStyle = tilted ? '#FF4D1F' : 'rgba(245,242,234,0.55)';
    ctx.fillText(tilted ? 'TILT' : `×${mult}`, W - 20, H - 9);

    // Jauge de carburant, verticale le long du bord gauche.
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(17, 120, 4, 200);
    ctx.fillStyle = fuel > 25 ? '#19D197' : '#FF4D1F';
    ctx.fillRect(17, 320 - fuel * 2, 4, fuel * 2);

    ctx.textAlign = 'center';
    if (mission) {
      ctx.fillStyle = '#FFB325';
      ctx.fillText(`${mission.name.toUpperCase()}  ${mission.done.length}/${mission.goals.length}  ${Math.ceil(mission.t / 60)}s`, W / 2, 36);
    }
    if (msg) {
      ctx.globalAlpha = Math.min(1, msg.t / 40);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 15px ui-monospace, Consolas, monospace';
      ctx.fillText(msg.text, W / 2, 252);
      ctx.font = '700 11px ui-monospace, Consolas, monospace';
      ctx.globalAlpha = 1;
    }
    if (hold) {
      ctx.fillStyle = '#FFB325';
      ctx.fillText(charging ? 'RELÂCHE POUR LANCER' : 'MAINTIENS POUR LANCER', W / 2, 330);
      // Le ressort du lanceur, qui se comprime tant qu'on tient la touche.
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(W - 28, 376, 10, 60);
      ctx.fillStyle = '#FFB325';
      ctx.fillRect(W - 28, 436 - power * 60, 10, power * 60);
    }
    ctx.textAlign = 'start';
    ctx.restore();
  }

  function loop(t) {
    if (!running) return;
    acc = paused ? 0 : acc + Math.min(100, last ? t - last : STEP);
    last = t;
    for (; acc >= STEP && running; acc -= STEP) update();
    if (running && !paused) draw();
    rafId = requestAnimationFrame(loop);
  }

  /* --- Lanceur -------------------------------------------------------------- */

  function charge(on) {
    if (!hold || paused || !running) return;
    if (on) { charging = true; return; }
    if (!charging) return;
    // Lâché tout de suite, le ressort part quand même : on ne reste pas coincé.
    const p = Math.max(0.35, power);
    charging = false;
    hold = false;
    // Même au ressort à peine comprimé, la bille doit franchir le clapet en haut du couloir.
    balls[0].vy = -(11.6 + p * 2.6);
    balls[0].vx = -0.4 - p * 1.1;   // plus le ressort est comprimé, plus la bille part loin à gauche
    power = 0;
    host.sfx.shoot();
  }

  // Une moitié d'écran par flip, tenue tant que le doigt est posé — un flip qu'on peut
  // garder pour bloquer la bille, comme les vrais boutons. La capture garde l'appui même
  // si le doigt sort du canvas.
  const pressed = new Map();
  const sideOf = (e) => {
    const box = canvas.getBoundingClientRect();
    return (e.clientX - box.left) / box.width < 0.5 ? 'left' : 'right';
  };
  const onDown = (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    if (hold) { pressed.set(e.pointerId, 'plunge'); charge(true); return; }
    const side = sideOf(e);
    pressed.set(e.pointerId, side);
    key[side] = true;
  };
  const onUp = (e) => {
    const side = pressed.get(e.pointerId);
    if (!side) return;
    pressed.delete(e.pointerId);
    if (side === 'plunge') return charge(false);
    if (![...pressed.values()].includes(side)) key[side] = false;
  };

  return {
    start() {
      score = 0; lives = D.balls; mult = 1; rank = 0; fuel = 100;
      laneLit = [false, false, false];
      targets = mkTargets();
      flippers = { left: { a: FLIP.left.rest, w: 0 }, right: { a: FLIP.right.rest, w: 0 } };
      flash = []; msg = null; mission = null; held = null;
      paused = false; running = true; over = false; last = 0; acc = 0;
      key.left = key.right = false;
      idle = 0; shake = 0; tilt = 0; tilted = false;
      reset();
      say(`GRADE : ${RANKS[0]}`, 120);
      pressed.clear();
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      host.onStats({ score, level: rank + 1, lives });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'left' || a === 'right') { key[a] = down; return; }
      if (a === 'hold') { if (down) nudge(); return; }      // secousse — et tilt si tu insistes
      if (a === 'action' || a === 'up') charge(down);
      if (a === 'down' && down) nudge();
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    },
  };
}
