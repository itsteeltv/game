const KEYS = {
  scores: (id, d) => `arcade:scores:${id}:${d}`,
  legacy: (id) => `arcade:scores:${id}`,
  diff: 'arcade:difficulty',
  played: 'arcade:played',
  settings: 'arcade:settings',
  lastGame: 'arcade:lastGame',
};

const DEFAULT_SETTINGS = {
  theme: 'dark',
  volume: 0.6,
  sfx: true,
  music: true,
  crt: true,          // scanlines and a curved-glass vignette over the game screen
  animations: true,
  initials: 'AAA',    // last initials typed on a high-score table, offered again next time
};

export const LEVELS = [
  { id: 0, name: 'Facile' },
  { id: 1, name: 'Normal' },
  { id: 2, name: 'Difficile' },
];

export const levelName = (d) => LEVELS[d]?.name ?? 'Normal';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode, quota) — fail silently
  }
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write(KEYS.settings, next);
  return next;
}

export function setLastGame(id) { write(KEYS.lastGame, id); }
export function getLastGame() { return read(KEYS.lastGame, null); }

/* --- Difficulty ---------------------------------------------------------- */

export function getDifficulty(gameId) {
  const all = read(KEYS.diff, {});
  const d = Number(all[gameId]);
  return Number.isInteger(d) && d >= 0 && d < LEVELS.length ? d : 1;
}

export function setDifficulty(gameId, d) {
  const all = read(KEYS.diff, {});
  all[gameId] = d;
  write(KEYS.diff, all);
  return d;
}

/* --- Played ------------------------------------------------------------- */

export function markPlayed(gameId) {
  const list = read(KEYS.played, []);
  if (!list.includes(gameId)) {
    list.push(gameId);
    write(KEYS.played, list);
  }
}

export function hasPlayed(gameId) {
  return read(KEYS.played, []).includes(gameId);
}

/* --- Scores -------------------------------------------------------------- */

/**
 * Scores are kept per difficulty — an easy run must never outrank a hard one
 * in the same table. `score` must be a NUMBER so ranking works; pass `display`
 * when the number isn't what the player should read (Pong stores 702, shows "7 — 2").
 */
export function saveScore(gameId, score, higherIsBetter = true, display = null, diff = 1, name = 'AAA') {
  const n = Number(score);
  if (!Number.isFinite(n)) return { record: false, rank: -1, date: 0 };

  const list = getHighScores(gameId, diff);
  const prevBest = list.length ? list[0].score : null;

  const row = { score: n, name, date: Date.now() };
  if (display !== null) row.display = display;
  list.push(row);
  list.sort((a, b) => (higherIsBetter ? b.score - a.score : a.score - b.score));
  const top = list.slice(0, 5);
  write(KEYS.scores(gameId, diff), top);

  return {
    record: prevBest === null || (higherIsBetter ? n > prevBest : n < prevBest),
    rank: top.indexOf(row),   // -1: didn't make the table
    date: row.date,           // the row's id, for renameScore
  };
}

/** Arcade initials: the player signs the row they just set. */
export function renameScore(gameId, diff, date, name) {
  const list = getHighScores(gameId, diff);
  const row = list.find((r) => r.date === date);
  if (!row) return;
  row.name = name;
  write(KEYS.scores(gameId, diff), list);
}

export function getHighScores(gameId, diff = 1) {
  const key = KEYS.scores(gameId, diff);
  let rows = read(key, null);

  // One-time migration: scores saved before difficulties existed land on Normal.
  if (rows === null) {
    const old = read(KEYS.legacy(gameId), null);
    if (old && diff === 1) {
      write(key, old);
      try { localStorage.removeItem(KEYS.legacy(gameId)); } catch { /* ignore */ }
      rows = old;
    }
  }
  // Drop rows whose score isn't numeric, so one bad entry can't unsort a table.
  return (rows || []).filter((s) => Number.isFinite(Number(s.score)));
}

export function getBestScore(gameId, diff = 1) {
  const list = getHighScores(gameId, diff);
  return list.length ? list[0].score : null;
}

/** What to show for the best score — the display string when a game has one. */
export function getBestLabel(gameId, diff = 1) {
  const list = getHighScores(gameId, diff);
  if (!list.length) return null;
  return list[0].display ?? list[0].score;
}

/** Highest score across every difficulty, for summary tiles. */
export function getAnyBest(gameId) {
  let best = null;
  for (const l of LEVELS) {
    const s = getBestScore(gameId, l.id);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}

export function resetAllData() {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('arcade:')) toRemove.push(k);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}
