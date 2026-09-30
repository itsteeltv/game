// Puissance 4 vs an alpha-beta AI. Beat it repeatedly — the score is your streak.
const COLS = 7, ROWS = 6, CELL = 58;
const ME = 1, AI = 2;

export function createGame(canvas, host, opts = {}) {
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL + 34;
  const ctx = canvas.getContext('2d');
  const TOP = 34;

  // Search depth is the whole difficulty knob: deeper = it sees your traps coming.
  const D = [{ depth: 2, slip: 0.35 }, { depth: 4, slip: 0.12 }, { depth: 6, slip: 0 }][opts.difficulty ?? 1];

  let board, streak, score, turn, winLine, hover, thinking, msg;
  let paused = false, running = false, rafId = null, over = false;

  const at = (c, r) => board[c][r];
  const openRow = (c) => { for (let r = ROWS - 1; r >= 0; r--) if (!board[c][r]) return r; return -1; };
  const validCols = () => { const o = []; for (let c = 0; c < COLS; c++) if (openRow(c) >= 0) o.push(c); return o; };

  function lineAt(c, r, dc, dr, who) {
    const cells = [];
    for (let i = 0; i < 4; i++) {
      const x = c + dc * i, y = r + dr * i;
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS || at(x, y) !== who) return null;
      cells.push([x, y]);
    }
    return cells;
  }

  function findWin(who) {
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
          const l = lineAt(c, r, dc, dr, who);
          if (l) return l;
        }
      }
    }
    return null;
  }

  /** Count open 2s and 3s — enough shape for the AI to build and block. */
  function heuristic(who) {
    let s = 0;
    const foe = who === ME ? AI : ME;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
          let mine = 0, theirs = 0, ok = true;
          for (let i = 0; i < 4; i++) {
            const x = c + dc * i, y = r + dr * i;
            if (x < 0 || x >= COLS || y < 0 || y >= ROWS) { ok = false; break; }
            const v = at(x, y);
            if (v === who) mine++; else if (v === foe) theirs++;
          }
          if (!ok || (mine && theirs)) continue;
          if (mine === 3) s += 60; else if (mine === 2) s += 8; else if (mine === 1) s += 1;
          if (theirs === 3) s -= 70; else if (theirs === 2) s -= 9;
        }
      }
    }
    // Centre columns are worth more; it's where most fours run through.
    for (let r = 0; r < ROWS; r++) if (at(3, r) === who) s += 5;
    return s;
  }

  function search(depth, alpha, beta, maximizing) {
    if (findWin(AI)) return 10000 + depth;
    if (findWin(ME)) return -10000 - depth;
    const cols = validCols();
    if (!cols.length || depth === 0) return heuristic(AI);

    // Try the middle first so alpha-beta prunes more.
    cols.sort((a, b) => Math.abs(3 - a) - Math.abs(3 - b));

    if (maximizing) {
      let best = -Infinity;
      for (const c of cols) {
        const r = openRow(c);
        board[c][r] = AI;
        best = Math.max(best, search(depth - 1, alpha, beta, false));
        board[c][r] = 0;
        alpha = Math.max(alpha, best);
        if (alpha >= beta) break;
      }
      return best;
    }
    let best = Infinity;
    for (const c of cols) {
      const r = openRow(c);
      board[c][r] = ME;
      best = Math.min(best, search(depth - 1, alpha, beta, true));
      board[c][r] = 0;
      beta = Math.min(beta, best);
      if (alpha >= beta) break;
    }
    return best;
  }

  function aiMove() {
    const cols = validCols();
    if (!cols.length) return null;
    // A deliberate slip rate keeps the easier settings beatable.
    if (Math.random() < D.slip) return cols[(Math.random() * cols.length) | 0];

    let bestC = cols[0], bestV = -Infinity;
    cols.sort((a, b) => Math.abs(3 - a) - Math.abs(3 - b));
    for (const c of cols) {
      const r = openRow(c);
      board[c][r] = AI;
      const v = search(D.depth - 1, -Infinity, Infinity, false);
      board[c][r] = 0;
      if (v > bestV) { bestV = v; bestC = c; }
    }
    return bestC;
  }

  function newBoard(keepScore) {
    board = Array.from({ length: COLS }, () => new Array(ROWS).fill(0));
    winLine = null; turn = ME; thinking = 0; msg = '';
    if (!keepScore) { streak = 0; score = 0; }
    host.onStats({ score, level: streak + 1, lives: streak });
  }

  function finish(won) {
    if (over) return;
    over = true; running = false;
    host.onGameOver(score, won);
  }

  function drop(c, who) {
    const r = openRow(c);
    if (r < 0) return false;
    board[c][r] = who;
    host.sfx.move();
    const line = findWin(who);
    if (line) {
      winLine = line;
      if (who === ME) {
        streak++;
        score += 100 + streak * 50;
        msg = 'Manche gagnée';
        host.sfx.win();
        host.onStats({ score, level: streak + 1, lives: streak });
        thinking = -1200;           // negative = pause before the next board
      } else {
        msg = 'Manche perdue';
        host.sfx.gameover();
        setTimeout(() => finish(streak > 0), 900);
      }
      return true;
    }
    if (!validCols().length) {
      msg = 'Match nul';
      score += 25;
      host.onStats({ score });
      thinking = -1200;
      return true;
    }
    turn = who === ME ? AI : ME;
    if (turn === AI) thinking = 320;   // a beat, so the AI doesn't feel instant
    return true;
  }

  function play(c) {
    if (!running || paused || turn !== ME || winLine || thinking) return;
    drop(c, ME);
  }

  function update(dt) {
    if (thinking < 0) {
      thinking += dt;
      if (thinking >= 0) { thinking = 0; if (!over) newBoard(true); }
      return;
    }
    if (thinking > 0) {
      thinking -= dt;
      if (thinking <= 0) {
        thinking = 0;
        if (turn === AI && !winLine) {
          const c = aiMove();
          if (c !== null) drop(c, AI);
        }
      }
    }
  }

  function disc(c, r, who, glow) {
    const x = c * CELL + CELL / 2, y = TOP + r * CELL + CELL / 2;
    ctx.beginPath();
    ctx.arc(x, y, CELL / 2 - 5, 0, Math.PI * 2);
    ctx.fillStyle = who === ME ? '#FF4D1F' : who === AI ? '#FFB020' : '#08070A';
    ctx.fill();
    if (glow) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#F5F2EA';
      ctx.stroke();
    }
  }

  function draw() {
    ctx.fillStyle = '#08070A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (hover !== null && hover !== undefined && turn === ME && !winLine && running) {
      ctx.fillStyle = 'rgba(255,77,31,0.5)';
      ctx.fillRect(hover * CELL + 6, 4, CELL - 12, 6);
    }

    ctx.fillStyle = '#241F2C';
    ctx.fillRect(0, TOP, canvas.width, ROWS * CELL);

    const win = new Set((winLine || []).map(([c, r]) => `${c},${r}`));
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) disc(c, r, board[c][r], win.has(`${c},${r}`));
    }

    ctx.font = '600 11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#8E8A98';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg || (turn === ME ? 'À TOI' : 'ELLE RÉFLÉCHIT'), 8, 16);
    ctx.textAlign = 'right';
    ctx.fillText(`SÉRIE ${streak}`, canvas.width - 8, 16);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(48, 16);
    if (!paused) { update(dt); if (running) draw(); }
    rafId = requestAnimationFrame(loop);
  }

  const colAt = (ev) => {
    const b = canvas.getBoundingClientRect();
    return Math.floor((ev.clientX - b.left) * (canvas.width / b.width) / CELL);
  };
  const onDown = (e) => { e.preventDefault(); play(colAt(e)); };
  const onMove = (e) => { hover = colAt(e); };
  const onLeave = () => { hover = null; };

  return {
    start() {
      paused = false; running = true; over = false; hover = null;
      newBoard(false);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerleave', onLeave);
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down) return;
      if (a === 'left') hover = Math.max(0, (hover ?? 3) - 1);
      if (a === 'right') hover = Math.min(COLS - 1, (hover ?? 3) + 1);
      if (a === 'action' || a === 'down') play(hover ?? 3);
    },
    destroy() {
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    },
  };
}
