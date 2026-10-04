// Bulles. A honeycomb of coloured bubbles hangs from the ceiling and your cannon fires one at a time.
// Join three or more of a colour and they pop; anything left hanging with nothing above it falls and
// scores double. Miss too often and the ceiling comes down a row — let it reach the line and it's over.
// Aim by pointing (a mouse hovers, a finger drags, and lifting it fires), or ← → to turn and Space to fire.
// Each colour carries a small mark as well, so the board never relies on colour alone.
const R = 16, D = 32, ROWH = 28, W = 360, H = 520;
const X_BASE = 4 + R, Y0 = 22, PIVOT = { x: W / 2, y: 474 };
const LIMIT_ROW = 13;                       // a bubble that lands on this row ends the game
const COLORS = ['#FF5C8A', '#4EA8FF', '#12C98C', '#FFB020', '#9D6BFF', '#8BE04E'];

export function createGame(canvas, host, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const lvl = opts.difficulty ?? 1;
  const KINDS = [5, 5, 6][lvl];
  const START_ROWS = [5, 6, 7][lvl];
  const DROP_EVERY = [9, 7, 5][lvl];       // shots without a pop before the ceiling lowers
  const SPEED = 11;
  const STEP = 1000 / 60;

  let rows, parity, score, shots, level, cur, next, shot, angle, aimTo, keys, falling, parts, popping;
  let paused = false, running = false, over = false, rafId = null, last = 0, acc = 0;

  const rand = (n) => (Math.random() * n) | 0;
  const shiftOf = (r) => (((r + parity) & 1) ? R : 0);
  const colsOf = (r) => (shiftOf(r) ? 10 : 11);
  const px = (r, c) => X_BASE + shiftOf(r) + c * D;
  const py = (r) => Y0 + r * ROWH;
  const cell = (r, c) => (r >= 0 && r < rows.length && c >= 0 && c < colsOf(r) ? rows[r][c] : null);

  /** The up-to-six squares touching (r, c): its row neighbours, and whatever sits half a bubble off above and below. */
  function neighbours(r, c) {
    const out = [];
    const x = px(r, c);
    for (const cc of [c - 1, c + 1]) if (cc >= 0 && cc < colsOf(r)) out.push([r, cc]);
    for (const rr of [r - 1, r + 1]) {
      if (rr < 0 || rr >= rows.length) continue;
      for (let cc = 0; cc < colsOf(rr); cc++) if (Math.abs(px(rr, cc) - x) < D * 0.8) out.push([rr, cc]);
    }
    return out;
  }

  const present = () => [...new Set(rows.flat().filter((v) => v !== null))];
  const pickColour = () => { const p = present(); return p.length ? p[rand(p.length)] : rand(KINDS); };

  function fillRows(n) {
    rows = [];
    for (let r = 0; r < n; r++) rows.push(Array.from({ length: colsOf(r) }, () => rand(KINDS)));
  }

  function mark(k, x, y, s) {   // the small mark inside each colour
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.strokeStyle = 'rgba(255,255,255,0.78)'; ctx.lineWidth = 2;
    ctx.beginPath();
    if (k === 0) ctx.arc(x, y, s * 0.2, 0, Math.PI * 2);
    else if (k === 1) { ctx.arc(x, y, s * 0.3, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); }
    else if (k === 2) ctx.rect(x - s * 0.22, y - s * 0.22, s * 0.44, s * 0.44);
    else if (k === 3) { ctx.moveTo(x, y - s * 0.3); ctx.lineTo(x + s * 0.3, y + s * 0.22); ctx.lineTo(x - s * 0.3, y + s * 0.22); ctx.closePath(); }
    else if (k === 4) { ctx.moveTo(x - s * 0.3, y); ctx.lineTo(x + s * 0.3, y); ctx.moveTo(x, y - s * 0.3); ctx.lineTo(x, y + s * 0.3); ctx.stroke(); ctx.beginPath(); }
    else { ctx.moveTo(x, y - s * 0.34); ctx.lineTo(x + s * 0.3, y); ctx.lineTo(x, y + s * 0.34); ctx.lineTo(x - s * 0.3, y); ctx.closePath(); }
    if (k !== 1 && k !== 4) ctx.fill();
  }

  function bubble(x, y, k, scale = 1, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y); ctx.scale(scale, scale);
    const g = ctx.createRadialGradient(-5, -6, 2, 0, 0, R);
    g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.25, COLORS[k]); g.addColorStop(1, COLORS[k]);
    ctx.fillStyle = COLORS[k];
    ctx.beginPath(); ctx.arc(0, 0, R - 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.arc(0, 3, R - 1, 0, Math.PI); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.ellipse(-5, -6, 5, 3.2, -0.6, 0, Math.PI * 2); ctx.fill();
    mark(k, 0, 1, R * 1.6);
    ctx.restore();
  }

  /** Free grid square nearest to (x, y). */
  function snapCell(x, y) {
    const guess = Math.round((y - Y0) / ROWH);
    let best = null, bd = 1e9;
    for (let r = Math.max(0, guess - 1); r <= guess + 1; r++) {
      while (rows.length <= r) rows.push(new Array(colsOf(rows.length)).fill(null));
      for (let c = 0; c < colsOf(r); c++) {
        if (rows[r][c] !== null) continue;
        const d = (px(r, c) - x) ** 2 + (py(r) - y) ** 2;
        if (d < bd) { bd = d; best = [r, c]; }
      }
    }
    return best;
  }

  function land() {
    const [r, c] = snapCell(shot.x, shot.y);
    rows[r][c] = shot.k;
    shot = null;
    host.sfx.move();

    // Connected bubbles of the same colour.
    const seen = new Set([r * 32 + c]), group = [[r, c]];
    for (let i = 0; i < group.length; i++) {
      for (const [rr, cc] of neighbours(...group[i])) {
        if (rows[rr][cc] === rows[r][c] && !seen.has(rr * 32 + cc)) { seen.add(rr * 32 + cc); group.push([rr, cc]); }
      }
    }
    let gained = 0, popped = false;
    if (group.length >= 3) {
      popped = true;
      for (const [rr, cc] of group) burst(rr, cc, 0);
      gained += group.length * 10;
      // Anything no longer joined to the ceiling falls.
      const anchored = new Set(), queue = [];
      for (let cc = 0; cc < colsOf(0); cc++) if (rows[0][cc] !== null) { anchored.add(cc); queue.push([0, cc]); }
      for (let i = 0; i < queue.length; i++) {
        for (const [rr, cc] of neighbours(...queue[i])) if (rows[rr][cc] !== null && !anchored.has(rr * 32 + cc)) { anchored.add(rr * 32 + cc); queue.push([rr, cc]); }
      }
      let drops = 0;
      rows.forEach((row, rr) => row.forEach((v, cc) => {
        if (v !== null && !anchored.has(rr * 32 + cc) && !(rr === 0)) {
          falling.push({ x: px(rr, cc), y: py(rr), vy: -2 - Math.random() * 2, vx: (Math.random() - 0.5) * 2, k: v });
          row[cc] = null; drops++;
        }
      }));
      gained += drops * 20;
      host.sfx[drops ? 'clear' : 'score']();
      shots = 0;
    } else {
      shots++;
    }
    score += gained;
    while (rows.length && rows[rows.length - 1].every((v) => v === null)) rows.pop();

    if (rows.every((row) => row.every((v) => v === null))) return levelUp();
    if (!popped && shots >= DROP_EVERY) { lower(); shots = 0; }
    if (rows.length > LIMIT_ROW && rows.slice(LIMIT_ROW).some((row) => row.some((v) => v !== null))) return finish();
    report();
    fixColours();
  }

  function lower() {
    parity ^= 1;
    rows.unshift(Array.from({ length: colsOf(0) }, () => rand(KINDS)));
    host.sfx.hit();
  }

  function levelUp() {
    level++;
    score += 500;
    host.sfx.win();
    parity = 0;
    fillRows(Math.min(10, START_ROWS + level - 1));
    shots = 0;
    report();
    fixColours();
  }

  function burst(r, c, delay) {
    const k = rows[r][c];
    rows[r][c] = null;
    popping.push({ x: px(r, c), y: py(r), k, t: -delay });
    for (let i = 0; i < 5; i++) parts.push({ x: px(r, c), y: py(r), vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.8) * 5, t: 0, k });
  }

  /** Colours in the cannon must still exist on the board, or the shot could never pop anything. */
  function fixColours() {
    const p = present();
    if (!p.length) return;
    if (!p.includes(cur)) cur = p[rand(p.length)];
    if (!p.includes(next)) next = p[rand(p.length)];
  }

  function report() { host.onStats({ score, level, lives: Math.max(0, DROP_EVERY - shots) }); }

  function finish() {
    over = true; running = false;
    draw();
    host.onGameOver(score, false);
  }

  function fire() {
    if (!running || paused || over || shot) return;
    aim();
    shot = { x: PIVOT.x, y: PIVOT.y, vx: Math.sin(angle) * SPEED, vy: -Math.cos(angle) * SPEED, k: cur };
    host.sfx.shoot();
    cur = next; next = pickColour();
    fixColours();
  }

  /** Turn the cannon: keys step it, a pointer sets it outright. */
  function aim() {
    if (keys.left || keys.right) { angle += (keys.right - keys.left) * 0.028; aimTo = null; }
    else if (aimTo) {
      const dx = aimTo.x - PIVOT.x, dy = PIVOT.y - aimTo.y;
      if (dy > 12) angle = Math.atan2(dx, dy);
    }
    angle = Math.max(-1.38, Math.min(1.38, angle));
  }

  function swap() { if (!shot) { [cur, next] = [next, cur]; host.sfx.move(); } }

  function update() {
    aim();
    if (shot) {
      for (let s = 0; s < 2 && shot; s++) {
        shot.x += shot.vx / 2; shot.y += shot.vy / 2;
        if (shot.x < R) { shot.x = R; shot.vx = Math.abs(shot.vx); }
        else if (shot.x > W - R) { shot.x = W - R; shot.vx = -Math.abs(shot.vx); }
        let hit = shot.y - R <= Y0 - R + 2;
        if (!hit) {
          outer: for (let r = 0; r < rows.length; r++) for (let c = 0; c < colsOf(r); c++) {
            if (rows[r][c] !== null && (px(r, c) - shot.x) ** 2 + (py(r) - shot.y) ** 2 < (D - 4) ** 2) { hit = true; break outer; }
          }
        }
        if (hit) land();
      }
    }
    for (const f of falling) { f.vy += 0.5; f.y += f.vy; f.x += f.vx; }
    falling = falling.filter((f) => f.y < H + 30);
    for (const p of popping) p.t += STEP;
    popping = popping.filter((p) => p.t < 200);
    for (const p of parts) { p.t += STEP; p.x += p.vx; p.y += p.vy; p.vy += 0.3; }
    parts = parts.filter((p) => p.t < 480);
  }

  function aimGuide() {
    // A dotted line to the first bubble or the ceiling, folded once off a side wall.
    let x = PIVOT.x, y = PIVOT.y, vx = Math.sin(angle) * 7, vy = -Math.cos(angle) * 7;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < 90; i++) {
      x += vx; y += vy;
      if (x < R) { x = R; vx = Math.abs(vx); } else if (x > W - R) { x = W - R; vx = -Math.abs(vx); }
      if (y < Y0) break;
      let stop = false;
      for (let r = 0; r < rows.length && !stop; r++) for (let c = 0; c < colsOf(r); c++) if (rows[r][c] !== null && (px(r, c) - x) ** 2 + (py(r) - y) ** 2 < (D - 4) ** 2) { stop = true; break; }
      if (stop) break;
      if (i % 3 === 0) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#15122B'); bg.addColorStop(1, '#0B0A18');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // The ceiling and the line you must not reach.
    ctx.fillStyle = '#2A2640'; ctx.fillRect(0, 0, W, 6);
    ctx.strokeStyle = 'rgba(255,77,31,0.55)'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, py(LIMIT_ROW) - R); ctx.lineTo(W, py(LIMIT_ROW) - R); ctx.stroke(); ctx.setLineDash([]);

    rows.forEach((row, r) => row.forEach((v, c) => { if (v !== null) bubble(px(r, c), py(r), v); }));
    for (const p of popping) if (p.t > 0) bubble(p.x, p.y, p.k, 1 - p.t / 200, 1 - p.t / 200);
    for (const f of falling) bubble(f.x, f.y, f.k);
    for (const p of parts) { ctx.globalAlpha = Math.max(0, 1 - p.t / 480); ctx.fillStyle = COLORS[p.k]; ctx.fillRect(p.x, p.y, 4, 4); }
    ctx.globalAlpha = 1;

    if (!shot && !over) aimGuide();
    if (shot) bubble(shot.x, shot.y, shot.k);

    // Cannon: a dark base, a barrel pointing where you aim, the loaded bubble and the next one waiting.
    ctx.save();
    ctx.translate(PIVOT.x, PIVOT.y);
    ctx.rotate(angle);
    ctx.fillStyle = '#3A3652';
    ctx.beginPath(); ctx.rect(-7, -34, 14, 34); ctx.fill();
    ctx.fillStyle = '#6A6590';
    ctx.fillRect(-9, -36, 18, 6);
    ctx.restore();
    ctx.fillStyle = '#2A2640';
    ctx.beginPath(); ctx.arc(PIVOT.x, PIVOT.y + 14, 30, Math.PI, 0); ctx.fill();
    if (!shot && cur !== undefined) bubble(PIVOT.x, PIVOT.y, cur);
    ctx.fillStyle = '#8E8A98'; ctx.font = '700 10px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center';
    ctx.fillText('SUIVANT', 58, H - 10);
    if (next !== undefined) bubble(58, H - 34, next, 0.85);
    ctx.fillText(`PLAFOND ${Math.max(0, DROP_EVERY - shots)}`, W - 62, H - 10);
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

  const toPt = (e) => { const b = canvas.getBoundingClientRect(); return { x: (e.clientX - b.left) * (W / b.width), y: (e.clientY - b.top) * (H / b.height) }; };
  const onMove = (e) => { if (e.pointerType === 'mouse' || e.buttons) aimTo = toPt(e); };
  const onDown = (e) => {
    e.preventDefault();
    aimTo = toPt(e);
    if (e.pointerType === 'mouse') fire();   // a click aims and fires; touch fires on release
  };
  const onUp = (e) => { if (e.pointerType !== 'mouse') { aimTo = toPt(e); fire(); } };

  return {
    start() {
      parity = 0; level = 1; score = 0; shots = 0; angle = 0; aimTo = null; shot = null;
      keys = { left: 0, right: 0 }; falling = []; parts = []; popping = [];
      fillRows(START_ROWS);
      cur = pickColour(); next = pickColour();
      paused = false; running = true; over = false; last = 0; acc = 0;
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      report(); draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (a === 'left') keys.left = down ? 1 : 0;
      else if (a === 'right') keys.right = down ? 1 : 0;
      else if (down && a === 'action') fire();
      else if (down && a === 'hold') swap();
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
    },
  };
}
