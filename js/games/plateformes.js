// Plateformes. Six tableaux d'un écran chacun : cours, saute, ramasse les pièces,
// atteins le drapeau. Les tableaux s'enchaînent et repassent plus vite.
const T = 20;                 // tile size
const COLS = 24, ROWS = 16;
const W = COLS * T, H = ROWS * T;
const STEP = 1000 / 60;

// '#' sol · '=' plateforme · 'o' pièce · '^' pique · 'w' marcheur · 'p' départ · 'F' drapeau
const LEVELS = [
  [
    '                        ',
    '                        ',
    '          ooo           ',
    '         =====          ',
    '                    oo  ',
    '              ===  ==== ',
    '      oo                ',
    '     ====        w      ',
    '               =====    ',
    '  o                     ',
    ' ===     ^^      o    F ',
    '        ####    ===  ###',
    '                        ',
    'p         w             ',
    '########################',
    '########################',
  ],
  [
    '                        ',
    '            ooo         ',
    '           =====        ',
    '                        ',
    '     oo            F    ',
    '    ====          ####  ',
    '              o         ',
    '        w    ===        ',
    '      =====             ',
    ' o                  o   ',
    '===        w      ===   ',
    '         =====          ',
    '   ^^^                  ',
    'p  ###        ^^^^      ',
    '#######   #########     ',
    '####################### ',
  ],
  [
    '       o        o       ',
    '      ===      ===      ',
    '                        ',
    '   o       w        o   ',
    '  ===    =====     ===  ',
    '                        ',
    '       o        o     F ',
    '      ===      ===  ====',
    '            w           ',
    '  o      =======     o  ',
    ' ===                === ',
    '        ^^^^^^          ',
    'p      ########         ',
    '####                 ###',
    '####   ^^^^^^^^^^^   ###',
    '#######################=',
  ],
  [
    '                      F ',
    '                    ====',
    '          ooo           ',
    '         =====      w   ',
    '                  ===== ',
    '    w                   ',
    '  =====      oo         ',
    '            ====        ',
    '  o                 o   ',
    ' ===     ^^^^     ===   ',
    '         ####           ',
    '     o            w     ',
    'p   ===        ======   ',
    '###          ^^^        ',
    '####        #####       ',
    '########################',
  ],
  [
    '  o   o   o   o   o   o ',
    ' === === === === === ===',
    '                        ',
    '          w             ',
    '       =======          ',
    '                        ',
    '   o              o     ',
    '  ====    w     ====    ',
    '        ======        F ',
    '                   =====',
    '  ^^^        ^^^        ',
    'p ###   o    ###    w   ',
    '###### ====  ###  ===== ',
    '                        ',
    '     ^^^^^^^^^^^^^^     ',
    '########################',
  ],
  [
    '    o           o       ',
    '   ===         ===      ',
    '         w              ',
    '      =======           ',
    '                   oo   ',
    '  o              ====== ',
    ' ===     ^^^            ',
    '         ###       w    ',
    '              ========= ',
    '    w     o             ',
    ' ======  ===        F   ',
    '                  ===== ',
    '       ^^^^^^^^         ',
    'p      ########     ^^^ ',
    '####            ########',
    '########################',
  ],
];

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Easy: a floaty jump, slow walkers, four lives. Hard: tight, fast, three.
  const D = [
    { lives: 4, run: 1.9, jump: 6.4, grav: 0.33, foe: 0.55, coyote: 8 },
    { lives: 3, run: 2.2, jump: 6.2, grav: 0.38, foe: 0.8, coyote: 6 },
    { lives: 3, run: 2.5, jump: 6.1, grav: 0.44, foe: 1.1, coyote: 4 },
  ][opts.difficulty ?? 1];

  let map, p, foes, coins, flag, lap, idx, score, level, lives, inv, won;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;
  const key = { left: false, right: false, up: false };
  let jumpArmed = true;   // a held button must not re-jump the moment you land

  const solid = (c, r) => (map[r]?.[c] === '#' || map[r]?.[c] === '=');
  const spikeAt = (c, r) => map[r]?.[c] === '^';

  function loadLevel(n) {
    idx = n % LEVELS.length;
    lap = Math.floor(n / LEVELS.length);
    map = LEVELS[idx].map((row) => row.padEnd(COLS, ' ').slice(0, COLS).split(''));
    foes = []; coins = []; flag = null;
    let startAt = { x: T, y: H - 3 * T };
    map.forEach((row, r) => row.forEach((ch, c) => {
      if (ch === 'p') { startAt = { x: c * T, y: r * T }; map[r][c] = ' '; }
      if (ch === 'o') { coins.push({ c, r, got: false }); map[r][c] = ' '; }
      if (ch === 'w') { foes.push({ x: c * T, y: r * T, vx: D.foe * (1 + lap * 0.35), dead: 0 }); map[r][c] = ' '; }
      if (ch === 'F') { flag = { c, r }; map[r][c] = ' '; }
    }));
    p = { x: startAt.x, y: startAt.y, vx: 0, vy: 0, w: 14, h: 18, ground: 0, face: 1 };
    inv = 40;
    level = n + 1;
    host.onStats({ level });
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
    loadLevel(level - 1);   // same tableau, fresh start
  }

  /** Axis-by-axis AABB against the tile map — the standard, and the only one that never sticks. */
  function moveX(dx) {
    p.x += dx;
    const top = Math.floor(p.y / T), bot = Math.floor((p.y + p.h - 1) / T);
    if (dx > 0) {
      const c = Math.floor((p.x + p.w) / T);
      for (let r = top; r <= bot; r++) if (solid(c, r)) { p.x = c * T - p.w - 0.01; p.vx = 0; }
    } else if (dx < 0) {
      const c = Math.floor(p.x / T);
      for (let r = top; r <= bot; r++) if (solid(c, r)) { p.x = (c + 1) * T + 0.01; p.vx = 0; }
    }
    p.x = Math.max(0, Math.min(W - p.w, p.x));
  }

  function moveY(dy) {
    p.y += dy;
    const left = Math.floor(p.x / T), right = Math.floor((p.x + p.w - 1) / T);
    if (dy > 0) {
      const r = Math.floor((p.y + p.h) / T);
      for (let c = left; c <= right; c++) if (solid(c, r)) {
        p.y = r * T - p.h - 0.01; p.vy = 0; p.ground = D.coyote;
      }
    } else if (dy < 0) {
      const r = Math.floor(p.y / T);
      for (let c = left; c <= right; c++) if (solid(c, r)) { p.y = (r + 1) * T + 0.01; p.vy = 0; }
    }
  }

  function update() {
    const steer = (key.right ? 1 : 0) - (key.left ? 1 : 0);
    if (steer) p.face = steer;
    p.vx += (steer * D.run * 2.2 - p.vx) * 0.3;
    if (p.ground > 0) p.ground--;
    if (inv > 0) inv--;

    // Coyote time: a jump pressed a frame after leaving the ledge still counts.
    if (key.up && jumpArmed && p.ground > 0) {
      p.vy = -D.jump; p.ground = 0; jumpArmed = false;
      host.sfx.shoot();
    }
    // Letting go early cuts the jump short — the one thing that makes a jump feel yours.
    if (!key.up && p.vy < -2) p.vy *= 0.86;

    p.vy = Math.min(10, p.vy + D.grav);
    moveX(p.vx);
    moveY(p.vy);

    if (p.y > H + 40) return hurt();

    // Spikes: feet only, so brushing one with your head is survivable.
    const fc = Math.floor((p.x + p.w / 2) / T), fr = Math.floor((p.y + p.h) / T);
    if (spikeAt(fc, fr) || spikeAt(Math.floor(p.x / T), fr) || spikeAt(Math.floor((p.x + p.w) / T), fr)) hurt();

    for (const c of coins) {
      if (c.got) continue;
      if (Math.abs(c.c * T + T / 2 - (p.x + p.w / 2)) < 14 && Math.abs(c.r * T + T / 2 - (p.y + p.h / 2)) < 16) {
        c.got = true;
        score += 50;
        host.sfx.pickup();
        host.onStats({ score });
      }
    }

    for (const f of foes) {
      if (f.dead) { f.dead--; continue; }
      // Fall first, so "am I standing on something?" is answered before it turns.
      f.y += 2;
      const fr2 = Math.floor((f.y + T) / T);
      let grounded = false;
      for (let c = Math.floor(f.x / T); c <= Math.floor((f.x + T - 1) / T); c++) {
        if (solid(c, fr2)) { f.y = fr2 * T - T; grounded = true; }
      }
      f.x += f.vx;
      // Turn at a wall, and at the edge of whatever it is standing on — never mid-air,
      // which used to make a falling walker flip direction every single frame.
      const ahead = Math.floor((f.x + (f.vx > 0 ? T : -1)) / T);
      const below = Math.floor((f.y + T + 1) / T);
      if (f.x < 0 || f.x > W - T || solid(ahead, Math.floor(f.y / T)) || (grounded && !solid(ahead, below))) {
        f.vx *= -1;
        f.x = Math.max(0, Math.min(W - T, f.x));
      }

      const hitX = Math.abs(f.x + T / 2 - (p.x + p.w / 2)) < (T + p.w) / 2 - 3;
      const hitY = f.y < p.y + p.h && f.y + T > p.y;
      if (!hitX || !hitY) continue;
      if (p.vy > 1.2 && p.y + p.h < f.y + T * 0.7) {
        // Stomped: the classic, with the little bounce that rewards it.
        f.dead = 18;
        p.vy = -D.jump * 0.72;
        score += 120;
        host.sfx.score();
        host.onStats({ score });
      } else hurt();
    }
    foes = foes.filter((f) => f.dead !== 1 && f.y < H + T * 2);

    if (flag && Math.abs(flag.c * T + T / 2 - (p.x + p.w / 2)) < 16 && Math.abs(flag.r * T - p.y) < T * 1.4) {
      const left = coins.filter((c) => !c.got).length;
      score += 500 + (left === 0 ? 400 : 0);
      host.sfx.win();
      host.onStats({ score });
      // Six tableaux cleared: that is a win. Then they come round again, faster.
      if (level % LEVELS.length === 0) { won = true; return finish(true); }
      loadLevel(level);
    }
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);

    // Background: a few hills that change hue per tableau, so each one reads differently.
    const hue = (idx * 47 + lap * 90) % 360;
    ctx.fillStyle = `hsl(${hue} 42% 11%)`;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = `hsl(${hue} 38% 15%)`;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(60 + i * 110, H - 40, 70, Math.PI, 0);
      ctx.fill();
    }

    map.forEach((row, r) => row.forEach((ch, c) => {
      const x = c * T, y = r * T;
      if (ch === '#') {
        ctx.fillStyle = `hsl(${hue} 30% 26%)`;
        ctx.fillRect(x, y, T, T);
        ctx.fillStyle = `hsl(${hue} 34% 34%)`;
        ctx.fillRect(x, y, T, 4);
      } else if (ch === '=') {
        ctx.fillStyle = '#FFB020';
        ctx.fillRect(x, y, T, 6);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x, y + 6, T, 3);
      } else if (ch === '^') {
        ctx.fillStyle = '#FF5A52';
        ctx.beginPath();
        ctx.moveTo(x, y + T); ctx.lineTo(x + T / 2, y + 4); ctx.lineTo(x + T, y + T);
        ctx.closePath(); ctx.fill();
      }
    }));

    coins.forEach((c) => {
      if (c.got) return;
      const bob = Math.sin(performance.now() / 220 + c.c) * 2;
      ctx.fillStyle = '#FFD24A';
      ctx.beginPath();
      ctx.arc(c.c * T + T / 2, c.r * T + T / 2 + bob, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(c.c * T + T / 2 - 1, c.r * T + T / 2 - 3 + bob, 2, 6);
    });

    if (flag) {
      ctx.fillStyle = '#A8B8CE';
      ctx.fillRect(flag.c * T + 8, flag.r * T - T, 3, T * 2);
      ctx.fillStyle = '#19D197';
      ctx.beginPath();
      ctx.moveTo(flag.c * T + 11, flag.r * T - T);
      ctx.lineTo(flag.c * T + 11 + 14, flag.r * T - T + 6);
      ctx.lineTo(flag.c * T + 11, flag.r * T - T + 12);
      ctx.closePath(); ctx.fill();
    }

    foes.forEach((f) => {
      if (f.dead) {
        ctx.fillStyle = 'rgba(167,123,255,0.4)';
        ctx.fillRect(f.x + 2, f.y + T - 5, T - 4, 5);
        return;
      }
      ctx.fillStyle = '#A77BFF';
      ctx.fillRect(f.x + 2, f.y + 3, T - 4, T - 3);
      ctx.fillStyle = '#08070A';
      ctx.fillRect(f.x + (f.vx > 0 ? T - 9 : 5), f.y + 8, 3, 3);
      ctx.fillRect(f.x + (f.vx > 0 ? T - 14 : 10), f.y + 8, 3, 3);
    });

    if (inv === 0 || Math.floor(inv / 4) % 2 === 0) {
      ctx.fillStyle = '#F5F2EA';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#FF5A2B';
      ctx.fillRect(p.x, p.y, p.w, 5);
      ctx.fillStyle = '#08070A';
      ctx.fillRect(p.x + (p.face > 0 ? 8 : 3), p.y + 8, 3, 3);
    }

    ctx.font = '600 10px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(245,242,234,0.5)';
    ctx.fillText(`TABLEAU ${idx + 1}/${LEVELS.length}${lap ? ' · TOUR ' + (lap + 1) : ''}`, 6, 14);
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
      score = 0; lives = D.lives; won = false;
      paused = false; running = true; over = false; last = 0; acc = 0;
      key.left = key.right = key.up = false;
      jumpArmed = true;
      loadLevel(0);
      host.onStats({ score, level, lives });
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'left' || a === 'right') key[a] = down;
      if (a === 'up' || a === 'action') { key.up = down; if (!down) jumpArmed = true; }
    },
    destroy() { running = false; cancelAnimationFrame(rafId); },
  };
}
