// Profil, XP, badges et défis du jour — la seule couche « progression » du site.
// Tout tient dans une clé localStorage à côté des scores : aucun compte, aucun
// serveur, et « Effacer les données locales » l'efface comme le reste.
import { read, write, getAnyBest, hasPlayed } from './storage.js';
import { GAMES } from './catalog.js';

const KEY = 'arcade:prog';
const HISTORY_MAX = 60;

const BLANK = {
  xp: 0, runs: 0, wins: 0, hardWins: 0, bestRun: 0, dailies: 0,
  streak: 0, bestStreak: 0, lastDay: null, night: false,
  badges: [], favs: [], history: [], games: {}, daily: null,
};

/** Date locale en AAAA-MM-JJ : la journée de joueur est celle de son fuseau, pas UTC. */
export const dayKey = (d = new Date()) => (
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
);

const yesterday = () => dayKey(new Date(Date.now() - 864e5));

/** Hachage stable : le défi du jour est le même toute la journée, sans rien stocker. */
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/** Toute lecture passe par la forme attendue : une clé trafiquée dégrade, elle ne casse pas. */
export function getProg() {
  const raw = read(KEY, null);
  const p = { ...BLANK, ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) };
  for (const k of ['badges', 'favs', 'history']) if (!Array.isArray(p[k])) p[k] = [];
  if (!p.games || typeof p.games !== 'object' || Array.isArray(p.games)) p.games = {};
  for (const k of ['xp', 'runs', 'wins', 'hardWins', 'bestRun', 'dailies', 'streak', 'bestStreak']) {
    p[k] = Number.isFinite(Number(p[k])) ? Number(p[k]) : 0;
  }
  return p;
}

const save = (p) => { write(KEY, p); return p; };

/* --- Niveaux -------------------------------------------------------------- */

/** Chaque niveau coûte 150 XP de plus que le précédent : ça monte vite, puis ça se mérite. */
const cost = (level) => 200 + (level - 1) * 150;

export function levelOf(xp) {
  let level = 1, rest = Math.max(0, xp), need = cost(1);
  while (rest >= need) { rest -= need; level++; need = cost(level); }
  return { level, into: rest, need, pct: Math.round((rest / need) * 100) };
}

export const TITLES = [
  [1, 'Badge visiteur'], [3, 'Habitué du hall'], [6, 'Compteur de jetons'],
  [10, 'Main sûre'], [15, 'Tueur de bornes'], [22, 'Légende du hall'],
];
export const titleFor = (level) => [...TITLES].reverse().find(([l]) => level >= l)?.[1] ?? TITLES[0][1];

/* --- Favoris -------------------------------------------------------------- */

export const getFavs = () => getProg().favs.filter((id) => GAMES.some((g) => g.id === id));
export const isFav = (id) => getProg().favs.includes(id);

export function toggleFav(id) {
  const p = getProg();
  const i = p.favs.indexOf(id);
  if (i < 0) p.favs.unshift(id); else p.favs.splice(i, 1);
  save(p);
  return i < 0;
}

/* --- Historique et statistiques ------------------------------------------- */

export const getHistory = () => getProg().history;
export const gameStats = (id) => ({ runs: 0, wins: 0, best: 0, last: 0, ...(getProg().games[id] || {}) });

/* --- Défi du jour --------------------------------------------------------- */

/** Deux objectifs par jour : une borne tirée au sort, et trois bornes différentes. */
export function getDaily(p = getProg()) {
  const key = dayKey();
  const pool = GAMES.filter((g) => !g.custom);
  const game = pool[hash(key) % pool.length];
  const st = p.daily?.key === key ? p.daily : null;
  // L'objectif est figé au premier regard de la journée : battre son record ne doit
  // pas rendre le défi du jour plus dur en cours de route.
  const best = getAnyBest(game.id);
  const goal = Number.isFinite(st?.goal) ? st.goal
    : best ? Math.max(100, Math.round((best * 0.6) / 50) * 50) : 0;
  const variety = Array.isArray(st?.variety) ? st.variety : [];
  return {
    key, game, goal,
    borneDone: !!st?.borne,
    variety: variety.length,
    varietyDone: variety.length >= 3,
    label: goal
      ? `Marque ${goal.toLocaleString('fr-FR')} points à ${game.name}`
      : `Ouvre ${game.name} et marque des points`,
  };
}

export const DAILY_XP = { borne: 150, variety: 100 };

/* --- Badges --------------------------------------------------------------- */

// `test(p, ctx)` ne lit que des compteurs déjà à jour : un badge ne se calcule jamais
// à partir d'un autre badge.
export const BADGES = [
  { id: 'premier', name: 'Premier jeton', desc: 'Jouer une première partie.', test: (p) => p.runs >= 1 },
  { id: 'dix', name: 'Dix parties', desc: 'Dix parties terminées.', test: (p) => p.runs >= 10 },
  { id: 'cent', name: 'Cent parties', desc: 'Cent parties terminées.', test: (p) => p.runs >= 100 },
  { id: 'curieux', name: 'Touche-à-tout', desc: 'Essayer dix bornes différentes.', test: (p, c) => c.played >= 10 },
  { id: 'collection', name: 'Collectionneur', desc: 'Essayer vingt-cinq bornes.', test: (p, c) => c.played >= 25 },
  { id: 'hall', name: 'Tout le hall', desc: 'Essayer toutes les bornes du catalogue.', test: (p, c) => c.played >= c.total },
  { id: 'vainqueur', name: 'Vainqueur', desc: 'Gagner une partie.', test: (p) => p.wins >= 1 },
  { id: 'increvable', name: 'Increvable', desc: 'Gagner dix parties.', test: (p) => p.wins >= 10 },
  { id: 'costaud', name: 'En difficile', desc: 'Gagner une partie réglée sur difficile.', test: (p) => p.hardWins >= 1 },
  { id: 'cinqmille', name: 'Cinq mille', desc: 'Cinq mille points en une seule partie.', test: (p) => p.bestRun >= 5000 },
  { id: 'centmille', name: 'Cumul 100 000', desc: 'Cent mille points cumulés sur tes records.', test: (p, c) => c.totalBest >= 100000 },
  { id: 'serie3', name: 'Trois jours', desc: 'Jouer trois jours de suite.', test: (p) => p.bestStreak >= 3 },
  { id: 'serie7', name: 'Une semaine', desc: 'Jouer sept jours de suite.', test: (p) => p.bestStreak >= 7 },
  { id: 'defi', name: 'Défi relevé', desc: 'Remplir un défi du jour.', test: (p) => p.dailies >= 1 },
  { id: 'defi10', name: 'Dix défis', desc: 'Remplir dix défis du jour.', test: (p) => p.dailies >= 10 },
  { id: 'nocturne', name: 'Nocturne', desc: 'Finir une partie entre 2 h et 5 h du matin.', test: (p) => p.night },
  { id: 'classe', name: 'Signature', desc: 'Entrer au tableau des scores de dix bornes.', test: (p, c) => c.ranked >= 10 },
];

export const BADGE_XP = 100;

function context() {
  const scored = GAMES.filter((g) => getAnyBest(g.id) !== null);
  return {
    total: GAMES.length,
    played: GAMES.filter((g) => hasPlayed(g.id)).length,
    ranked: scored.length,
    totalBest: scored.reduce((sum, g) => sum + (getAnyBest(g.id) || 0), 0),
  };
}

/** Profil complet, pour la page et les tuiles. */
export function getProfile() {
  const p = getProg();
  const ctx = context();
  const lv = levelOf(p.xp);
  return {
    ...p, ...ctx, ...lv,
    title: titleFor(lv.level),
    unlocked: BADGES.filter((b) => p.badges.includes(b.id)),
    locked: BADGES.filter((b) => !p.badges.includes(b.id)),
  };
}

/* --- Enregistrer une partie ---------------------------------------------- */

/**
 * Appelé une fois par fin de partie. Fait tout le travail de progression et
 * renvoie ce qu'il faut annoncer au joueur : XP gagnée, niveau pris, badges
 * décrochés, défis remplis.
 */
export function addRun({ id, score = 0, won = false, diff = 1, display = null }) {
  const p = getProg();
  const n = Math.max(0, Math.round(Number(score) || 0));
  const key = dayKey();
  const before = levelOf(p.xp).level;

  // Une partie vaut sa participation, sa performance, sa victoire et son niveau de difficulté.
  let gained = 10 + Math.floor(Math.sqrt(n)) + (won ? 25 : 0) + diff * 5;

  p.runs++;
  if (won) p.wins++;
  if (won && diff === 2) p.hardWins++;
  if (n > p.bestRun) p.bestRun = n;
  const h = new Date().getHours();
  if (h >= 2 && h < 5) p.night = true;

  // Série de jours : hier compte, avant-hier remet à un.
  if (p.lastDay !== key) {
    p.streak = p.lastDay === yesterday() ? p.streak + 1 : 1;
    p.lastDay = key;
    if (p.streak > p.bestStreak) p.bestStreak = p.streak;
  }

  const g = { runs: 0, wins: 0, best: 0, last: 0, ...(p.games[id] || {}) };
  g.runs++;
  if (won) g.wins++;
  if (n > g.best) g.best = n;
  g.last = Date.now();
  p.games[id] = g;

  p.history.unshift({ id, score: n, display, won, diff, date: Date.now() });
  p.history = p.history.slice(0, HISTORY_MAX);

  // Défis du jour : la borne tirée au sort, et trois bornes différentes aujourd'hui.
  const target = getDaily(p);
  const st = p.daily?.key === key ? p.daily : { key, borne: false, variety: [] };
  if (!Array.isArray(st.variety)) st.variety = [];
  st.goal = target.goal;
  const done = [];
  if (!st.variety.includes(id)) st.variety.push(id);
  if (!st.borne && id === target.game.id && n >= target.goal && n > 0) {
    st.borne = true; p.dailies++; gained += DAILY_XP.borne; done.push('Défi de la borne du jour');
  }
  if (!st.varietyDone && st.variety.length >= 3) {
    st.varietyDone = true; p.dailies++; gained += DAILY_XP.variety; done.push('Défi « trois bornes »');
  }
  p.daily = st;

  p.xp += gained;

  // Badges : testés après la mise à jour des compteurs, et chacun une seule fois.
  const ctx = context();
  const fresh = BADGES.filter((b) => !p.badges.includes(b.id) && b.test(p, ctx));
  for (const b of fresh) { p.badges.push(b.id); p.xp += BADGE_XP; }
  gained += fresh.length * BADGE_XP;

  save(p);
  const after = levelOf(p.xp);
  return {
    gained, xp: p.xp, level: after.level, levelUp: after.level > before,
    badges: fresh, daily: done, streak: p.streak,
  };
}
