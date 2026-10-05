// Défense — tower defense. Les créatures suivent toujours la même route ; tu bâtis
// autour. Canon : dégâts. Givre : ralentit. Chaque tour monte trois fois.
// Douze vagues ; une créature qui sort te coûte une vie.
const COLS = 12, ROWS = 9, CELL = 34, TOP = 36;

// The lane, as corners. Everything else is buildable ground next to it.
const WAY = [[0, 4], [3, 4], [3, 1], [8, 1], [8, 7], [11, 7]];

const C = {
  bg: '#08070A', grass: '#14161B', grass2: '#171A20', road: '#2E2A33', roadEdge: '#3C3743',
  slot: 'rgba(255,255,255,0.05)', cursor: '#F5F5F7', text: '#9E9AAA', bright: '#F5F5F7',
  canon: '#FFB020', givre: '#4EA8FF', foe: '#FF5C8A', boss: '#9D6BFF', hp: '#12C98C', gold: '#FFD24A',
};

const KINDS = {
  canon: { name: 'Canon', cost: 50, range: 76, rate: 620, dmg: 11, col: C.canon },
  givre: { name: 'Givre', cost: 70, range: 66, rate: 900, dmg: 4, slow: 0.45, col: C.givre },
};

export function createGame(canvas, host, opts = {}) {
  const lvl = opts.difficulty ?? 1;
  const D = [
    { gold: 180, hp: 0.8, lives: 14, waves: 10 },
    { gold: 140, hp: 1.0, lives: 10, waves: 12 },
    { gold: 110, hp: 1.35, lives: 7, waves: 14 },
  ][lvl];

  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL + TOP;
  const ctx = canvas.getContext('2d');

  // Pixel centre of a cell, and the lane as a pixel polyline.
  const cx = (c) => c * CELL + CELL / 2;
  const cy = (r) => TOP + r * CELL + CELL / 2;
  const LANE = WAY.map(([c, r]) => ({ x: cx(c), y: cy(r) }));

  /** Cells the lane runs through — not buildable. */
  const roadCells = new Set();
  for (let i = 0; i < WAY.length - 1; i++) {
    const [c1, r1] = WAY[i], [c2, r2] = WAY[i + 1];
    const steps = Math.max(Math.abs(c2 - c1), Math.abs(r2 - r1));
    for (let s = 0; s <= steps; s++) {
      roadCells.add(`${c1 + Math.sign(c2 - c1) * s},${r1 + Math.sign(r2 - r1) * s}`);
    }
  }
  /** Buildable cells: next to the lane, never on it. */
  const slots = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (roadCells.has(`${c},${r}`)) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
        .some(([dc, dr]) => roadCells.has(`${c + dc},${r + dr}`));
      if (near) slots.push({ c, r });
    }
  }

  let towers, foes, shots, gold, lives, wave, spawnLeft, spawnT, waveT, kind, cursor, score, msg, msgT;
  let paused = false, running = false, over = false, rafId = null, last = 0, alive = true;

  const slotAt = (c, r) => slots.findIndex((s) => s.c === c && s.r === r);
  const towerAt = (i) => towers.find((t) => t.slot === i);

  function say(m) { msg = m; msgT = 0; }

  /* --- waves ------------------------------------------------------------- */

  function waveSize(w) { return 6 + w * 2; }
  function foeHp(w) { return Math.round((18 + w * 11) * D.hp); }

  function startWave() {
    wave++;
    if (wave > D.waves) return finish(true);
    spawnLeft = waveSize(wave);
    spawnT = 0;
    say(`Vague ${wave} / ${D.waves}`);
    host.sfx.score();
    report();
  }

  function spawn() {
    const boss = spawnLeft === 1 && wave % 5 === 0;
    foes.push({
      seg: 0, t: 0, x: LANE[0].x, y: LANE[0].y,
      hp: foeHp(wave) * (boss ? 6 : 1), max: foeHp(wave) * (boss ? 6 : 1),
      speed: (boss ? 26 : 38 + wave) * (lvl === 2 ? 1.15 : 1),
      slow: 0, boss, worth: boss ? 60 : 8 + ((wave / 2) | 0),
    });
  }

  /* --- building ---------------------------------------------------------- */

  function build(i) {
    if (i < 0 || over) return;
    const t = towerAt(i);
    if (t) return upgrade(t);
    const k = KINDS[kind];
    if (gold < k.cost) { say(`${k.name} : ${k.cost} pièces`); host.sfx.hit(); return; }
    gold -= k.cost;
    towers.push({ slot: i, kind, level: 1, cool: 0, c: slots[i].c, r: slots[i].r });
    host.sfx.pickup();
    report();
  }

  function upgrade(t) {
    if (t.level >= 3) { say('Tour au maximum'); host.sfx.hit(); return; }
    const cost = Math.round(KINDS[t.kind].cost * 0.6 * t.level);
    if (gold < cost) { say(`Améliorer : ${cost} pièces`); host.sfx.hit(); return; }
    gold -= cost;
    t.level++;
    host.sfx.pickup();
    report();
  }

  const stat = (t) => {
    const k = KINDS[t.kind];
    return { range: k.range * (1 + (t.level - 1) * 0.16), dmg: k.dmg * t.level, rate: k.rate / (1 + (t.level - 1) * 0.35) };
  };

  /* --- loop -------------------------------------------------------------- */

  let shown = '';
  function report() {
    // Only when something changed: the HUD is DOM, not canvas.
    const k = `${score}|${wave}|${lives}`;
    if (k === shown) return;
    shown = k;
    host.onStats({ score, level: Math.max(1, wave), lives });
  }

  function finish(won) {
    if (over) return;
    over = true; running = false;
    score += lives * 50 + (won ? 500 : 0);
    report();
    draw();
    if (won) host.sfx.win(); else host.sfx.gameover();
    setTimeout(() => { if (alive) host.onGameOver(score, won); }, 500);
  }

  function step(dt) {
    waveT += dt;
    if (msg) { msgT += dt; if (msgT > 1800) msg = ''; }

    // spawning
    if (spawnLeft > 0) {
      spawnT -= dt;
      if (spawnT <= 0) { spawn(); spawnLeft--; spawnT = Math.max(260, 760 - wave * 24); }
    } else if (!foes.length) {
      waveT = 0;
      gold += 30;
      score += 100;
      startWave();
    }

    // foes along the lane
    for (const f of foes) {
      const speed = f.speed * (f.slow > 0 ? 0.45 : 1) * (dt / 1000);
      if (f.slow > 0) f.slow -= dt;
      let left = speed;
      while (left > 0 && f.seg < LANE.length - 1) {
        const a = LANE[f.seg], b = LANE[f.seg + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const need = len - f.t;
        if (left < need) { f.t += left; left = 0; } else { left -= need; f.seg++; f.t = 0; }
      }
      if (f.seg >= LANE.length - 1) { f.dead = true; f.leaked = true; continue; }
      const a = LANE[f.seg], b = LANE[f.seg + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      f.x = a.x + (b.x - a.x) * (f.t / len);
      f.y = a.y + (b.y - a.y) * (f.t / len);
    }

    for (const f of foes) {
      if (!f.leaked) continue;
      lives--;
      host.sfx.hit();
      if (lives <= 0) { foes = foes.filter((x) => !x.dead); return finish(false); }
    }
    foes = foes.filter((f) => !f.dead);

    // towers fire at the foe nearest the exit inside range
    for (const t of towers) {
      t.cool -= dt;
      if (t.cool > 0) continue;
      const s = stat(t);
      const tx = cx(t.c), ty = cy(t.r);
      let best = null;
      for (const f of foes) {
        if (Math.hypot(f.x - tx, f.y - ty) > s.range) continue;
        if (!best || f.seg > best.seg || (f.seg === best.seg && f.t > best.t)) best = f;
      }
      if (!best) continue;
      t.cool = s.rate;
      t.flash = 110;
      shots.push({ x: tx, y: ty, foe: best, dmg: s.dmg, kind: t.kind, t: 0 });
      if (t.kind === 'canon') host.sfx.shoot();
    }

    // shots are short-lived beams: they land on the next step
    for (const s of shots) {
      s.t += dt;
      if (s.t < 60) continue;
      s.done = true;
      const f = s.foe;
      if (!f || f.dead) continue;
      f.hp -= s.dmg;
      if (s.kind === 'givre') f.slow = 900;
      if (f.hp <= 0) {
        f.dead = true;
        gold += f.worth;
        score += f.worth * 2;
        host.sfx.score();
      }
    }
    shots = shots.filter((s) => !s.done);
    foes = foes.filter((f) => !f.dead);
    for (const t of towers) if (t.flash > 0) t.flash -= dt;
    report();
  }

  /* --- drawing ----------------------------------------------------------- */

  function draw() {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ground
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (r + c) % 2 ? C.grass : C.grass2;
        ctx.fillRect(c * CELL, TOP + r * CELL, CELL, CELL);
      }
    }
    // lane
    ctx.strokeStyle = C.road;
    ctx.lineWidth = CELL - 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    LANE.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.strokeStyle = C.roadEdge;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    LANE.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);

    // free slots
    for (let i = 0; i < slots.length; i++) {
      if (towerAt(i)) continue;
      const s = slots[i];
      ctx.fillStyle = C.slot;
      ctx.fillRect(s.c * CELL + 6, TOP + s.r * CELL + 6, CELL - 12, CELL - 12);
    }

    // towers
    for (const t of towers) {
      const x = cx(t.c), y = cy(t.r);
      const k = KINDS[t.kind];
      const s = stat(t);
      if (cursor === t.slot) {
        ctx.strokeStyle = `${k.col}55`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, s.range, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#0D0C11';
      ctx.beginPath(); ctx.arc(x, y, CELL * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = k.col;
      if (t.flash > 0) { ctx.save(); ctx.shadowColor = k.col; ctx.shadowBlur = 16; }
      ctx.beginPath(); ctx.arc(x, y, CELL * 0.3, 0, Math.PI * 2); ctx.fill();
      if (t.flash > 0) ctx.restore();
      ctx.fillStyle = '#0A0A0C';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(t.level), x, y + 1);
    }

    // shots
    for (const s of shots) {
      if (!s.foe || s.foe.dead) continue;
      ctx.strokeStyle = s.kind === 'canon' ? C.canon : C.givre;
      ctx.lineWidth = s.kind === 'canon' ? 2.5 : 4;
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.foe.x, s.foe.y); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // foes
    for (const f of foes) {
      const rad = f.boss ? 13 : 8;
      ctx.fillStyle = f.boss ? C.boss : C.foe;
      ctx.save();
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = f.boss ? 14 : 8;
      ctx.beginPath(); ctx.arc(f.x, f.y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (f.slow > 0) {
        ctx.strokeStyle = C.givre;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, rad + 3, 0, Math.PI * 2); ctx.stroke();
      }
      const w = rad * 2.4;
      ctx.fillStyle = '#000';
      ctx.fillRect(f.x - w / 2, f.y - rad - 7, w, 3);
      ctx.fillStyle = C.hp;
      ctx.fillRect(f.x - w / 2, f.y - rad - 7, w * Math.max(0, f.hp / f.max), 3);
    }

    // cursor on an empty slot
    if (cursor >= 0 && !towerAt(cursor)) {
      const s = slots[cursor];
      const k = KINDS[kind];
      ctx.strokeStyle = gold >= k.cost ? C.cursor : '#FF453A';
      ctx.lineWidth = 2;
      ctx.strokeRect(s.c * CELL + 3, TOP + s.r * CELL + 3, CELL - 6, CELL - 6);
      ctx.strokeStyle = `${k.col}44`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx(s.c), cy(s.r), k.range, 0, Math.PI * 2); ctx.stroke();
    }

    // readout
    ctx.font = '600 13px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = C.gold;
    ctx.fillText(`${gold}`, 26, 17);
    ctx.fillStyle = C.text;
    ctx.fillText('PIÈCES', 52, 17);
    ctx.fillStyle = C.foe;
    ctx.fillText(`♥ ${lives}`, 118, 17);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'right';
    ctx.fillText(`VAGUE ${Math.max(1, wave)}/${D.waves}`, canvas.width - 8, 17);
    ctx.textAlign = 'center';
    const k = KINDS[kind];
    ctx.fillStyle = k.col;
    ctx.fillText(`${k.name} ${k.cost}`, canvas.width / 2 + 22, 17);

    if (msg) {
      ctx.fillStyle = 'rgba(8,7,10,0.8)';
      ctx.fillRect(0, canvas.height / 2 - 18, canvas.width, 36);
      ctx.fillStyle = C.bright;
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
    }
    if (over) {
      ctx.fillStyle = 'rgba(8,7,10,0.74)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = lives > 0 ? C.hp : C.foe;
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.fillText(lives > 0 ? 'LIGNE TENUE' : 'LIGNE PERCÉE', canvas.width / 2, canvas.height / 2);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(64, last ? t - last : 16);
    last = t;
    if (!paused) { step(dt); if (running) draw(); }
    rafId = requestAnimationFrame(loop);
  }

  // A tap builds on the slot touched, or upgrades the tower there. The type selector
  // is the top strip: tapping it swaps Canon and Givre.
  const onDown = (e) => {
    e.preventDefault();
    const b = canvas.getBoundingClientRect();
    const x = (e.clientX - b.left) * (canvas.width / b.width);
    const y = (e.clientY - b.top) * (canvas.height / b.height);
    if (y < TOP) { kind = kind === 'canon' ? 'givre' : 'canon'; host.sfx.move(); return; }
    const c = Math.floor(x / CELL), r = Math.floor((y - TOP) / CELL);
    const i = slotAt(c, r);
    if (i < 0) return;
    cursor = i;
    build(i);
  };

  return {
    start() {
      towers = []; foes = []; shots = [];
      gold = D.gold; lives = D.lives; wave = 0; score = 0;
      spawnLeft = 0; spawnT = 0; waveT = 0; kind = 'canon'; msg = ''; msgT = 0;
      cursor = slots.findIndex((s) => s.c <= 2);
      if (cursor < 0) cursor = 0;
      paused = false; running = true; over = false; last = 0; shown = '';
      canvas.addEventListener('pointerdown', onDown);
      startWave();
      report();
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down || !running) return;
      if (a === 'hold') { kind = kind === 'canon' ? 'givre' : 'canon'; host.sfx.move(); return; }
      if (a === 'action') { build(cursor); return; }
      // Arrows walk the buildable slots in reading order, so every slot is reachable.
      const cur = slots[cursor] || slots[0];
      const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[a];
      if (!dir) return;
      let best = -1, bestD = 1e9;
      slots.forEach((s, i) => {
        const dc = s.c - cur.c, dr = s.r - cur.r;
        if (dir[0] && Math.sign(dc) !== dir[0]) return;
        if (dir[1] && Math.sign(dr) !== dir[1]) return;
        if (dir[0] && Math.abs(dr) > 2) return;
        if (dir[1] && Math.abs(dc) > 2) return;
        const d = Math.abs(dc) * (dir[0] ? 1 : 3) + Math.abs(dr) * (dir[1] ? 1 : 3);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0) { cursor = best; host.sfx.move(); }
    },
    destroy() {
      running = false; alive = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
    },
  };
}
