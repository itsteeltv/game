// Reversi. You play black, the machine plays white. Place a disc so that it traps a line of enemy discs
// against one of yours: they all flip. When the board is full (or nobody can move) the most discs win.
// The AI searches the tree with alpha-beta (2, 4 or 5 plies) over a corners-and-edges weight table and mobility;
// on the easy level it also slips now and then.
const SIZE = 8, CELL = 44, X0 = 24, Y0 = 58;
const ME = 1, AI = 2;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

// Corners are gold, the squares next to them are traps, edges are good.
const ROW = [
  [100, -20, 10, 5, 5, 10, -20, 100],
  [-20, -50, -2, -2, -2, -2, -50, -20],
  [10, -2, -1, -1, -1, -1, -2, 10],
  [5, -2, -1, -1, -1, -1, -2, 5],
];
const WEIGHT = new Int16Array(64);
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) WEIGHT[r * 8 + c] = ROW[r < 4 ? r : 7 - r][c];

/** Discs a move at i would flip for `who` on board b (empty array = illegal). */
function flipsFor(b, i, who) {
  if (b[i]) return [];
  const r = (i / 8) | 0, c = i % 8, out = [];
  for (const [dr, dc] of DIRS) {
    let rr = r + dr, cc = c + dc;
    const line = [];
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === 3 - who) { line.push(rr * 8 + cc); rr += dr; cc += dc; }
    if (line.length && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === who) out.push(...line);
  }
  return out;
}

function movesOf(b, who) {
  const out = [];
  for (let i = 0; i < 64; i++) { const f = flipsFor(b, i, who); if (f.length) out.push({ i, f }); }
  return out;
}

/** How many squares `who` could play, without building the flip lists — the evaluation calls this at every leaf. */
function mobility(b, who) {
  let n = 0;
  for (let i = 0; i < 64; i++) {
    if (b[i]) continue;
    const r = (i / 8) | 0, c = i % 8;
    for (const [dr, dc] of DIRS) {
      let rr = r + dr, cc = c + dc, seen = 0;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === 3 - who) { seen++; rr += dr; cc += dc; }
      if (seen && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === who) { n++; break; }
    }
  }
  return n;
}

function play(b, m, who) {
  const n = b.slice();
  n[m.i] = who;
  for (const k of m.f) n[k] = who;
  return n;
}

const count = (b, who) => { let n = 0; for (let i = 0; i < 64; i++) if (b[i] === who) n++; return n; };

function evaluate(b) {
  let pos = 0, discs = 0, empty = 0;
  for (let i = 0; i < 64; i++) {
    if (b[i] === AI) { pos += WEIGHT[i]; discs++; }
    else if (b[i] === ME) { pos -= WEIGHT[i]; discs--; }
    else empty++;
  }
  const mob = mobility(b, AI) - mobility(b, ME);
  return empty > 10 ? pos + mob * 7 : pos * 0.4 + mob * 4 + discs * 12;   // late on, discs are what counts
}

let nodes = 0;
function search(b, who, depth, alpha, beta) {
  if (++nodes > 60000) return evaluate(b);   // a soft ceiling, so a slow phone never freezes
  const ms = movesOf(b, who);
  if (!ms.length) {
    if (!movesOf(b, 3 - who).length) return (count(b, AI) - count(b, ME)) * 1000;   // the game is over: only discs matter
    return search(b, 3 - who, depth, alpha, beta);   // a pass costs a turn, not a ply
  }
  if (depth === 0) return evaluate(b);
  ms.sort((x, y) => WEIGHT[y.i] - WEIGHT[x.i]);
  if (who === AI) {
    let best = -Infinity;
    for (const m of ms) { best = Math.max(best, search(play(b, m, who), ME, depth - 1, alpha, beta)); alpha = Math.max(alpha, best); if (alpha >= beta) break; }
    return best;
  }
  let best = Infinity;
  for (const m of ms) { best = Math.min(best, search(play(b, m, who), AI, depth - 1, alpha, beta)); beta = Math.min(beta, best); if (alpha >= beta) break; }
  return best;
}

/** Best move for `who` looking `depth` plies ahead (the AI maximises, the player's hint minimises). */
function bestMove(b, who, depth) {
  const ms = movesOf(b, who);
  if (!ms.length) return null;
  nodes = 0;
  let pick = null, bestScore = who === AI ? -Infinity : Infinity;
  for (const m of ms) {
    const s = search(play(b, m, who), 3 - who, depth - 1, -Infinity, Infinity);
    if (who === AI ? s > bestScore : s < bestScore) { bestScore = s; pick = m; }
  }
  return { move: pick, all: ms };
}

export function createGame(canvas, host, opts = {}) {
  canvas.width = 400; canvas.height = 448;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const lvl = opts.difficulty ?? 1;
  const DEPTH = [2, 4, 5][lvl];

  let board, turn, valid, anim, msg, msgT, cursor, showCursor, hintCell, timer, over;
  let paused = false, running = false, rafId = null, last = 0, now = 0;

  const discs = () => [count(board, ME), count(board, AI)];

  function refresh() {
    valid = movesOf(board, ME);
    const [p, a] = discs();
    host.onStats({ score: p * 10, level: 1 + Math.floor((p + a - 4) / 10), lives: `${p}–${a}` });
  }

  function say(text, ms = 1400) { msg = text; msgT = ms; }

  function place(m, who) {
    const prev = board;
    board = play(board, m, who);
    const touched = new Set([m.i, ...m.f]);
    anim = anim.filter((q) => !touched.has(q.i));          // a square being flipped again restarts its animation
    anim.push({ i: m.i, t: 0, kind: 'drop' });
    m.f.forEach((i, k) => anim.push({ i, t: -k * 40, kind: 'flip', from: prev[i] }));
    host.sfx[who === ME ? 'move' : 'shoot']();
    hintCell = -1;
  }

  function afterMove(who) {
    refresh();
    const other = 3 - who;
    const otherMoves = movesOf(board, other);
    if (otherMoves.length) { turn = other; schedule(); return; }
    if (movesOf(board, who).length) {   // the other side must pass
      say(other === ME ? 'Tu passes ton tour' : 'L’IA passe son tour', 1600);
      turn = who; schedule(); return;
    }
    finish();
  }

  function schedule() {
    clearTimeout(timer);
    if (turn === AI) timer = setTimeout(aiMove, 520 + Math.random() * 200);
  }

  function aiMove() {
    if (!running || over) return;
    if (paused) { timer = setTimeout(aiMove, 200); return; }
    const res = bestMove(board, AI, DEPTH);
    if (!res) return afterMove(ME);
    let m = res.move;
    // Easy: a third of the time it just plays something reasonable instead of the best.
    if (lvl === 0 && Math.random() < 0.35) m = res.all[(Math.random() * res.all.length) | 0];
    place(m, AI);
    afterMove(AI);
  }

  function finish() {
    over = true; running = false;
    clearTimeout(timer);
    const [p, a] = discs();
    const won = p > a;
    const score = p * 10 + (won ? 300 + (p - a) * 10 : 0);
    draw();
    host.onStats({ score, level: 1, lives: `${p}–${a}` });
    host.onGameOver(score, won, `${p} — ${a}`);
  }

  function tryMove(i) {
    if (!running || paused || over || turn !== ME) return;
    const m = valid.find((v) => v.i === i);
    if (!m) { host.sfx.hit(); say('Coup impossible : il doit retourner des pions', 1300); return; }
    place(m, ME);
    afterMove(ME);
  }

  const hint = () => {
    if (!running || paused || over || turn !== ME) return;
    const res = bestMove(board, ME, 3);
    if (res) { hintCell = res.move.i; host.sfx.pickup(); say('Indice : la case clignote', 1500); }
  };

  function disc(cx, cy, who, scaleX = 1, scale = 1) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scaleX * scale, scale);
    const r = CELL / 2 - 5;
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, 2, 0, 0, r);
    if (who === ME) { g.addColorStop(0, '#5A5A66'); g.addColorStop(1, '#0C0C10'); }
    else { g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#C9C9D4'); }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, W, canvas.height);

    // Header: the two scores and what's happening.
    const [p, a] = discs();
    ctx.textBaseline = 'middle';
    ctx.font = '700 17px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#F5F5F7';
    disc(X0 + 12, 28, ME, 1, 0.55);
    ctx.fillText(`Toi  ${p}`, X0 + 30, 29);
    ctx.textAlign = 'right';
    ctx.fillText(`${a}  IA`, W - X0 - 30, 29);
    disc(W - X0 - 12, 28, AI, 1, 0.55);
    ctx.textAlign = 'center';
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = turn === ME ? '#8BE04E' : '#FFB020';
    const status = msgT > 0 ? msg : over ? 'Partie terminée' : turn === ME ? 'À toi de jouer' : 'L’IA réfléchit…';
    ctx.fillText(status, W / 2, 29);

    // Felt and grid.
    const bw = SIZE * CELL;
    const felt = ctx.createLinearGradient(0, Y0, 0, Y0 + bw);
    felt.addColorStop(0, '#0E6B45'); felt.addColorStop(1, '#0A5236');
    ctx.fillStyle = felt;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(X0 - 6, Y0 - 6, bw + 12, bw + 12, 10) : ctx.rect(X0 - 6, Y0 - 6, bw + 12, bw + 12); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.38)'; ctx.lineWidth = 1.5;
    for (let k = 0; k <= SIZE; k++) {
      ctx.beginPath(); ctx.moveTo(X0 + k * CELL, Y0); ctx.lineTo(X0 + k * CELL, Y0 + bw); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X0, Y0 + k * CELL); ctx.lineTo(X0 + bw, Y0 + k * CELL); ctx.stroke();
    }

    // Legal moves, only on your turn.
    if (turn === ME && !over) {
      for (const v of valid) {
        const cx = X0 + (v.i % 8) * CELL + CELL / 2, cy = Y0 + ((v.i / 8) | 0) * CELL + CELL / 2;
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
      }
    }

    for (let i = 0; i < 64; i++) {
      if (!board[i]) continue;
      const cx = X0 + (i % 8) * CELL + CELL / 2, cy = Y0 + ((i / 8) | 0) * CELL + CELL / 2;
      const an = anim.find((q) => q.i === i && q.t < 320);
      if (an && an.kind === 'flip') {
        if (an.t < 0) { disc(cx, cy, an.from); continue; }          // waiting for its turn in the ripple
        const k = an.t / 320;                                          // 0 -> 1: edge-on at 0.5, new colour after
        disc(cx, cy, k < 0.5 ? an.from : board[i], Math.max(0.04, Math.abs(Math.cos(k * Math.PI))));
      } else if (an && an.kind === 'drop') disc(cx, cy, board[i], 1, 0.6 + 0.4 * Math.min(1, an.t / 160));
      else disc(cx, cy, board[i]);
    }

    if (hintCell >= 0) {
      const cx = X0 + (hintCell % 8) * CELL, cy = Y0 + ((hintCell / 8) | 0) * CELL;
      ctx.strokeStyle = `rgba(78,168,255,${0.45 + 0.55 * Math.abs(Math.sin(now / 220))})`; ctx.lineWidth = 4;
      ctx.strokeRect(cx + 3, cy + 3, CELL - 6, CELL - 6);
    }
    if (showCursor) {
      const cx = X0 + (cursor % 8) * CELL, cy = Y0 + ((cursor / 8) | 0) * CELL;
      ctx.strokeStyle = '#F5F5F7'; ctx.lineWidth = 3;
      ctx.strokeRect(cx + 2, cy + 2, CELL - 4, CELL - 4);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(64, last ? t - last : 16);
    last = t; now = t;
    if (!paused) {
      for (const q of anim) q.t += dt;
      anim = anim.filter((q) => q.t < 340);
      if (msgT > 0) msgT -= dt;
      draw();
    }
    rafId = requestAnimationFrame(loop);
  }

  const onDown = (e) => {
    e.preventDefault();
    const b = canvas.getBoundingClientRect();
    const x = (e.clientX - b.left) * (W / b.width) - X0, y = (e.clientY - b.top) * (canvas.height / b.height) - Y0;
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    if (c < 0 || c >= 8 || r < 0 || r >= 8) return;
    showCursor = false; cursor = r * 8 + c;
    tryMove(r * 8 + c);
  };

  return {
    start() {
      board = new Int8Array(64);
      board[27] = AI; board[36] = AI; board[28] = ME; board[35] = ME;   // the standard opening square
      clearTimeout(timer);
      turn = ME; anim = []; msg = ''; msgT = 0; hintCell = -1; showCursor = false;
      over = false; paused = false; running = true; last = 0;
      refresh();
      cursor = valid[0].i;
      canvas.addEventListener('pointerdown', onDown);
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down || !running || paused) return;
      showCursor = true;
      const r = (cursor / 8) | 0, c = cursor % 8;
      if (a === 'left') cursor = r * 8 + (c + 7) % 8;
      else if (a === 'right') cursor = r * 8 + (c + 1) % 8;
      else if (a === 'up') cursor = ((r + 7) % 8) * 8 + c;
      else if (a === 'down') cursor = ((r + 1) % 8) * 8 + c;
      else if (a === 'action') tryMove(cursor);
      else if (a === 'hold') hint();
    },
    destroy() {
      running = false;
      clearTimeout(timer);
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
    },
  };
}
