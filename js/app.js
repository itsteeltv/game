import { GAMES, getGame, glyphSVG } from './catalog.js';
import {
  getSettings, setSettings, saveScore, getHighScores, getBestLabel, getAnyBest,
  getDifficulty, setDifficulty, markPlayed, hasPlayed, getLastGame,
  resetAllData, setLastGame, LEVELS, levelName, renameScore, dataSummary,
} from './storage.js';
import { sfx, beep, SONGS, playMusic, stopMusic, setMusicRate } from './audio.js';
import {
  getProfile, getProg, addRun, getDaily, getFavs, isFav, toggleFav,
  getHistory, gameStats, BADGES, levelOf, DAILY_XP,
} from './progress.js';

const app = document.getElementById('app');
const themeBtn = document.getElementById('theme-toggle');
const soundBtn = document.getElementById('sound-toggle');
const srStatus = document.getElementById('sr-status');
const metaTheme = document.querySelector('meta[name="theme-color"]');
const DEFAULT_TITLE = document.title;
const metaDesc = document.querySelector('meta[name="description"]');
const canonical = document.querySelector('link[rel="canonical"]');
const DEFAULT_DESC = metaDesc?.content || '';
const BASE_URL = canonical?.getAttribute('href') || `${location.href.split('#')[0]}`;
const META = {
  ogTitle: document.querySelector('meta[property="og:title"]'),
  ogDesc: document.querySelector('meta[property="og:description"]'),
  ogUrl: document.querySelector('meta[property="og:url"]'),
  twTitle: document.querySelector('meta[name="twitter:title"]'),
  twDesc: document.querySelector('meta[name="twitter:description"]'),
};

/**
 * One title, one description and one canonical URL per page: that is what a tab, a
 * screen reader, a crawler and a pasted link all read.
 * ponytail: the routing is hash-based, so every borne still shares one indexable
 * document. Real per-borne pages would mean one static HTML file per borne (and a
 * build step to emit them) — worth it only if search traffic ever matters here.
 */
function setPage(title, desc = DEFAULT_DESC, path = location.hash) {
  const full = title ? `${title} — Mini Arcade` : DEFAULT_TITLE;
  document.title = full;
  metaDesc?.setAttribute('content', desc);
  // La query appartient à l'état de la page (le filtre favoris), pas à son adresse
  // canonique : deux URLs pour le même contenu, c'est exactement ce qu'un canonical évite.
  const clean = (path || '').split('?')[0];
  const url = BASE_URL + (clean && clean !== '#/' ? clean : '');
  canonical?.setAttribute('href', url);
  META.ogUrl?.setAttribute('content', url);
  META.ogTitle?.setAttribute('content', full);
  META.twTitle?.setAttribute('content', full);
  META.ogDesc?.setAttribute('content', desc);
  META.twDesc?.setAttribute('content', desc);
}

/** A borne's own structured data, so a shared link describes the game, not the site. */
function setGameLd(game) {
  document.getElementById('game-ld')?.remove();
  if (!game) return;
  const el = document.createElement('script');
  el.type = 'application/ld+json';
  el.id = 'game-ld';
  el.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: game.name,
    description: game.description,
    genre: game.category,
    url: `${BASE_URL}#/game/${game.id}`,
    image: `${BASE_URL}img/games/${game.id}.png`,
    playMode: 'SinglePlayer',
    gamePlatform: 'Web browser',
    applicationCategory: 'Game',
    operatingSystem: 'Any',
    inLanguage: 'fr',
    isAccessibleForFree: true,
    author: { '@type': 'Organization', name: 'SteelTV', alternateName: 'LeVraiSteelTV' },
  });
  document.head.appendChild(el);
}

/** Polite live announcement. The zero-width toggle makes an identical message read again. */
let srFlip = false;
const announce = (msg) => { srFlip = !srFlip; srStatus.textContent = msg + (srFlip ? '\u200b' : ''); };

let currentController = null; // whatever owns a rAF loop / listeners on this page
let renderToken = 0;          // guards async work against a navigation that already happened

const COUNT = GAMES.length;
const bornes = (n = COUNT) => `${n} borne${n > 1 ? 's' : ''}`;

/* --- Chrome -------------------------------------------------------------- */

function applySettings() {
  const fc = document.getElementById('footer-count');
  if (fc) fc.textContent = bornes();
  const s = getSettings();
  document.documentElement.setAttribute('data-theme', s.theme);
  metaTheme?.setAttribute('content', s.theme === 'dark' ? '#07080D' : '#F2F3F8');
  themeBtn.setAttribute('aria-label', s.theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre');
  soundBtn.setAttribute('aria-pressed', String(s.sfx));
  soundBtn.setAttribute('aria-label', s.sfx ? 'Couper le son' : 'Activer le son');
  document.body.classList.toggle('no-animations', !s.animations);
}

themeBtn.addEventListener('click', () => {
  setSettings({ theme: getSettings().theme === 'dark' ? 'light' : 'dark' });
  applySettings();
});

soundBtn.addEventListener('click', () => {
  setSettings({ sfx: !getSettings().sfx });
  applySettings();
});

/* --- Render plumbing ----------------------------------------------------- */

function teardown() {
  if (currentController?.destroy) currentController.destroy();
  currentController = null;
}

function activeRoute() {
  const first = (location.hash.slice(1) || '/').split('/').filter(Boolean)[0]?.split('?')[0];
  return first ? `/${first}` : '/';
}

let firstRender = true;
function render(html) {
  teardown();
  renderToken++;
  app.innerHTML = html;
  app.dataset.ready = '1';
  // A new page takes the keyboard focus, and the screen reader's attention, at its title.
  const h1 = app.querySelector('h1');
  if (h1) { h1.tabIndex = -1; if (!firstRender) h1.focus({ preventScroll: true }); }
  firstRender = false;
  const route = activeRoute();
  // Phones drop the tab bar mid-game — but only on a real game page, not on a 404 reached through /game/.
  document.body.dataset.view = app.querySelector('.play') ? 'game' : 'page';
  document.querySelectorAll('.rail-nav a').forEach((a) => {
    const on = a.dataset.route === route;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

// Scores read as numbers, so group them: 125430 -> 125 430. Pong stores "7 — 4",
// which is already a string and passes through untouched.
const fmtScore = (v) => (typeof v === 'number' ? v.toLocaleString('fr-FR') : v);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** Search folding: "asteroides" must find "Astéroïdes". */
const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/* --- Card partials -------------------------------------------------------- */

/** The borne's own screen, captured from a real run (img/games/<id>.png). The glyph
    underneath shows through when a borne has no capture yet; the fixed size keeps the
    grid from jumping while the pictures arrive. */
function cardArt(g, eager = false) {
  const load = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  return `${glyphSVG(g, 52)}<img src="img/games/${g.id}.png" alt="" width="480" height="360" ${load} decoding="async" onerror="this.remove()">`;
}

/** Difficulty as five dots — never the only signal: the spoken label says it in words. */
const dots = (n) => `<span class="dots" aria-hidden="true">${
  Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--on-ink)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4.5 4.5L19 7"/></svg>';

/** What a card is called out loud: the borne, its genre, and the one thing worth knowing. */
const cardLabel = (g, best, played) => `Jouer à ${g.name}${g.new ? ' (nouveau)' : ''} — ${g.category}, ${
  best === null ? `difficulté ${g.difficulty} sur 5` : `ton record ${fmtScore(best)}`}${played ? ', déjà jouée' : ''}`;

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.6l6.1-.8z"/></svg>';

/** One cabinet: marquee strip, screen, then the base with name and best score.
    The favourite toggle is a sibling of the link, never nested inside it. */
function gameCard(g, eager = false) {
  const d = getDifficulty(g.id);
  const best = getBestLabel(g.id, d);
  const played = hasPlayed(g.id);
  const fav = isFav(g.id);
  return `
    <div class="tile" style="--ink: ${g.ink}">
      <a class="card" href="#/game/${g.id}" aria-label="${esc(cardLabel(g, best, played))}">
        <span class="card-art">
          ${cardArt(g, eager)}
          <span class="card-cat" aria-hidden="true">${esc(g.category)}</span>
          ${g.new ? '<span class="tag" aria-hidden="true">Nouveau</span>' : ''}
          ${played ? `<span class="tag tag-played" aria-hidden="true">${CHECK}</span>` : ''}
        </span>
        <span class="card-body">
          <span class="card-title">${esc(g.name)}</span>
          <span class="card-meta">${
            best === null ? dots(g.difficulty) : `<span class="best">${esc(fmtScore(best))}</span>`}</span>
        </span>
      </a>
      <button class="fav-btn${fav ? ' on' : ''}" type="button" data-fav="${g.id}"
              aria-pressed="${fav}" aria-label="${esc(`${fav ? 'Retirer' : 'Ajouter'} ${g.name} de tes favoris`)}">${STAR}</button>
    </div>`;
}

/** Wires every favourite toggle rendered under `root`, wherever the cards live. */
function bindFavs(root, after = null) {
  root.querySelectorAll('[data-fav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = getGame(btn.dataset.fav);
      const on = toggleFav(btn.dataset.fav);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `${on ? 'Retirer' : 'Ajouter'} ${g.name} de tes favoris`);
      sfx.score();
      announce(`${g.name} ${on ? 'ajoutée à' : 'retirée de'} tes favoris`);
      after?.();
    });
  });
}

/** Segmented 3-way difficulty picker. `name` scopes the radio group. */
function diffControl(gameId, name, current = getDifficulty(gameId)) {
  return `
    <div class="seg" role="radiogroup" aria-label="Difficulté">
      ${LEVELS.map((l) => `
        <button class="seg-btn${l.id === current ? ' active' : ''}" type="button"
                role="radio" aria-checked="${l.id === current}"
                data-diff="${l.id}" data-seg="${esc(name)}">${esc(l.name)}</button>
      `).join('')}
    </div>`;
}

/** Wire a seg control; `onPick` gets the chosen level id. */
function bindSeg(root, name, onPick) {
  root.querySelectorAll(`[data-seg="${name}"]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = Number(btn.dataset.diff);
      root.querySelectorAll(`[data-seg="${name}"]`).forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
      });
      onPick(d);
    });
  });
}

/* --- Home ----------------------------------------------------------------- */

/** A shelf: one row of cabinets that scrolls sideways, like a row in the hall. */
function shelf(title, list, href = '#/games', more = 'Tout voir →') {
  if (!list.length) return '';
  return `
    <section class="section" style="--ink: ${list[0].ink}">
      <div class="section-head">
        <h2 class="section-title">${esc(title)}</h2>
        <a class="link-more" href="${href}">${esc(more)}</a>
      </div>
      <div class="shelf">${list.map((g) => gameCard(g)).join('')}</div>
    </section>`;
}

/** The two daily goals, as a card you can act on: one borne, one variety run. */
function dailyCard() {
  const d = getDaily();
  const g = d.game;
  const line = (done, label, xp) => `
    <li class="${done ? 'done' : ''}">
      <span class="quest-mark" aria-hidden="true">${done ? '✓' : '○'}</span>
      <span class="quest-label">${label}</span>
      <span class="quest-xp">${done ? 'fait' : `+${xp} XP`}</span>
    </li>`;
  return `
    <div class="quest" style="--ink: ${g.ink}">
      <div class="quest-head">
        <span class="eyebrow">Défis du jour · remis à zéro à minuit</span>
        <a class="btn btn-sm btn-primary" href="#/game/${g.id}">Jouer ${esc(g.name)}</a>
      </div>
      <ul class="quest-list">
        ${line(d.borneDone, esc(d.label), DAILY_XP.borne)}
        ${line(d.varietyDone, `Joue trois bornes différentes aujourd’hui <b>(${d.variety}/3)</b>`, DAILY_XP.variety)}
      </ul>
    </div>`;
}

/** The XP bar: level, title, and how far the next level is. */
function xpBar(p = getProfile(), compact = false) {
  return `
    <div class="xp${compact ? ' xp-compact' : ''}">
      <div class="xp-head">
        <span class="xp-level">Niveau ${p.level}</span>
        <span class="xp-title">${esc(p.title)}</span>
        <span class="xp-num">${fmtScore(p.into)} / ${fmtScore(p.need)} XP</span>
      </div>
      <div class="xp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
           aria-valuenow="${p.pct}" aria-label="Progression vers le niveau ${p.level + 1}">
        <i style="width:${p.pct}%"></i>
      </div>
    </div>`;
}

function renderHome() {
  setPage(null);
  const last = getGame(getLastGame());
  const prof = getProfile();
  const favs = getFavs().map(getGame).filter(Boolean);
  const played = GAMES.filter((g) => hasPlayed(g.id));
  const fresh = GAMES.filter((g) => g.new);
  const ranked = GAMES.filter((g) => getAnyBest(g.id) !== null);
  const total = ranked.reduce((sum, g) => sum + (getAnyBest(g.id) || 0), 0);
  const starters = ['tetris', 'pacman', 'bombes', 'pyramide', 'invaders', 'eboulis', 'tuyaux', 'breakout']
    .map(getGame).filter(Boolean);
  const picks = played.length ? played.slice(0, 10) : starters;
  // One shelf per genre, in catalogue order, so the whole hall is reachable from here.
  const cats = [...new Set(GAMES.map((g) => g.category))];

  render(`
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">${bornes()} · rien à installer</span>
        <h1 class="page-title">La salle d’arcade <em>tient dans ton onglet</em></h1>
        <p class="lede">
          De Pong (1972) à Doom (1993) : Qix, Foreuse, Échelles, Colonnes, Flipper,
          Le Mot… Tu choisis, ça se charge en une seconde, tu joues. Au clavier sur
          ordinateur, aux commandes à l’écran sur téléphone.
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/games">Choisir une borne</a>
          <a class="btn" href="#/game/${esc((last || starters[0] || GAMES[0]).id)}">${last ? 'Reprendre' : 'Jouer tout de suite'}</a>
        </div>
      </div>
      <div class="attract">
        <canvas id="attract-canvas" width="480" height="360" aria-hidden="true"></canvas>
        <span class="attract-label" aria-hidden="true">Démo · Pong</span>
      </div>
    </section>

    <dl class="stat-row">
      <div class="stat"><dt>Bornes</dt><dd>${COUNT}</dd></div>
      <div class="stat"><dt>Essayées</dt><dd>${played.length} <span class="data">/ ${COUNT}</span></dd></div>
      <div class="stat"><dt>Niveau</dt><dd>${prof.level} <span class="data">${fmtScore(prof.xp)} XP</span></dd></div>
      <div class="stat"><dt>Cumul des records</dt><dd>${fmtScore(total)}</dd></div>
    </dl>

    <section class="section" style="margin-top:0">
      <div class="section-head">
        <h2 class="section-title">Ton profil</h2>
        <a class="link-more" href="#/profil">Profil complet →</a>
      </div>
      ${xpBar(prof)}
      ${dailyCard()}
    </section>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">${last ? 'Là où tu t’es arrêté' : 'La borne du jour'}</h2>
        <a class="link-more" href="#/scores">Tes scores →</a>
      </div>
      ${resumeCard(last)}
    </section>

    ${shelf('Tes favoris', favs, '#/games?fav', 'Gérer →')}
    ${shelf('Nouvelles bornes', fresh)}
    ${shelf(played.length ? 'Tes bornes' : 'Pour commencer', picks, '#/games', `Les ${bornes()} →`)}
    ${cats.map((c) => shelf(c, GAMES.filter((g) => g.category === c))).join('')}

    <section class="section">
      <h2 class="section-title">Comment ça marche</h2>
      <div class="rowgrid" style="margin-top:var(--s4)">
        <div class="note"><b>Trois difficultés</b><span>Facile, normal ou difficile, réglé sur la borne. Chaque niveau garde son propre classement.</span></div>
        <div class="note"><b>Tes scores restent ici</b><span>Dans ce navigateur, sur cette machine. Aucun compte, aucun serveur, rien n’est envoyé nulle part.</span></div>
        <div class="note"><b>Même sans réseau</b><span>Installe le site comme une appli : les bornes déjà ouvertes restent jouables hors ligne.</span></div>
      </div>
    </section>
  `);

  bindFavs(app);
  startAttract();
}

/** Attract mode: Pong plays itself in the hero, as a cabinet left on in a quiet hall.
    Off when motion is unwelcome, and torn down the moment you leave the page. */
function startAttract() {
  const canvas = app.querySelector('#attract-canvas');
  if (!canvas) return;
  if (!getSettings().animations || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    canvas.closest('.attract')?.remove();
    return;
  }
  const mine = renderToken;
  import('./games/pong.js').then(({ createGame }) => {
    if (mine !== renderToken) return;           // navigated away while the module loaded
    const demo = createGame(canvas, {}, { autoplay: true, difficulty: 1 });
    demo.start();
    currentController = { destroy() { demo.destroy(); } };
  }).catch(() => { canvas.closest('.attract')?.remove(); });
}

/** The last borne played — the one thing a returning visitor wants. First visit: Tetris. */
function resumeCard(last) {
  const g = last || getGame('tetris') || GAMES[0];
  const d = getDifficulty(g.id);
  const best = getBestLabel(g.id, d);
  return `
    <a class="resume" href="#/game/${g.id}" style="--ink: ${g.ink}"
       aria-label="${esc(`${last ? 'Reprendre' : 'Jouer à'} ${g.name} — ${g.category}, ${levelName(d)}`)}">
      <img src="img/games/${g.id}.png" alt="" width="480" height="360" loading="eager" fetchpriority="high" decoding="async" onerror="this.remove()">
      <span class="resume-foot">
        <span class="resume-info">
          <span class="eyebrow">${last ? 'Ta dernière borne' : 'À essayer'}</span>
          <span class="resume-name">${esc(g.name)}</span>
          <span class="resume-meta">${esc(g.category)} · ${esc(levelName(d))}${best === null ? '' : ` · record ${esc(fmtScore(best))}`}</span>
        </span>
        <span class="btn btn-primary">${last ? 'Reprendre' : 'Jouer'}</span>
      </span>
    </a>`;
}

/* --- Catalogue ------------------------------------------------------------ */

const SORTS = {
  cat:  { label: 'Ordre du catalogue', fn: null },
  az:   { label: 'Nom (A → Z)', fn: (a, b) => a.name.localeCompare(b.name, 'fr') },
  best: { label: 'Tes records d’abord', fn: (a, b) => (getAnyBest(b.id) ?? -1) - (getAnyBest(a.id) ?? -1) },
  easy: { label: 'Les plus faciles', fn: (a, b) => a.difficulty - b.difficulty },
  hard: { label: 'Les plus corsées', fn: (a, b) => b.difficulty - a.difficulty },
};

// How a borne is played, read off the touch spec it already declares: no second
// source of truth to keep in step with the catalogue.
const CONTROLS = {
  all:  { label: 'Toutes les commandes', fn: null },
  one:  { label: 'Une seule touche', fn: (g) => !g.touch?.pad && (g.touch?.actions?.length ?? 0) === 1 },
  point: { label: 'Souris ou doigt seul', fn: (g) => !g.touch?.pad && !g.touch?.actions?.length },
  lr:   { label: 'Gauche / droite', fn: (g) => g.touch?.pad === 'lr' || g.touch?.pad === 'ud' || g.touch?.pad === 'joystick-lr' || g.touch?.pad === 'joystick-ud' },
  dpad: { label: 'Quatre directions', fn: (g) => g.touch?.pad === 'dpad' || g.touch?.pad === 'joystick' },
};

function renderGames() {
  setPage('Les bornes', `Les ${COUNT} bornes de Mini Arcade : arcade, puzzle, action, réflexe et réflexion, jouables tout de suite dans le navigateur.`);
  const cats = ['Tous', ...new Set(GAMES.map((g) => g.category))];
  const countOf = (c) => (c === 'Tous' ? COUNT : GAMES.filter((g) => g.category === c).length);
  let query = '';
  let cat = 'Tous';
  let freshOnly = false;
  let favOnly = location.hash.includes('?fav');
  let ctrl = 'all';
  let sort = 'cat';

  render(`
    <header class="page-head">
      <span class="eyebrow">Catalogue</span>
      <h1 class="page-title">Choisis ta borne</h1>
    </header>

    <div class="toolbar">
      <div class="toolbar-row">
        <input type="search" id="search" class="search" placeholder="Chercher une borne…"
               aria-label="Chercher une borne par nom, genre ou description" autocomplete="off">
        <span class="sort-wrap">
          <label for="sort">Trier</label>
          <select id="sort" class="sort">
            ${Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}
          </select>
        </span>
        <span class="sort-wrap">
          <label for="ctrl">Commandes</label>
          <select id="ctrl" class="sort">
            ${Object.entries(CONTROLS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}
          </select>
        </span>
      </div>
      <div class="toolbar-row chips" role="group" aria-label="Filtrer les bornes">
        ${cats.map((c) => `
          <button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === 'Tous'}">${esc(c)}<small>${countOf(c)}</small></button>
        `).join('')}
        <button class="chip chip-ghost" type="button" id="only-fav" aria-pressed="${favOnly}">★ Favoris<small>${getFavs().length}</small></button>
        <button class="chip chip-ghost" type="button" id="only-new" aria-pressed="false">Jamais jouées</button>
        <button class="chip chip-ghost" type="button" id="shuffle">Au hasard</button>
      </div>
    </div>

    <p class="result-line" id="result-line" role="status"></p>
    <div class="grid" id="games-grid" style="margin-top:var(--s4)"></div>
  `);

  const grid = app.querySelector('#games-grid');
  const line = app.querySelector('#result-line');

  function paint() {
    const q = norm(query.trim());
    const byCtrl = CONTROLS[ctrl]?.fn;
    const favs = getFavs();
    let hits = GAMES.filter((g) => (
      (cat === 'Tous' || g.category === cat) &&
      (!freshOnly || !hasPlayed(g.id)) &&
      (!favOnly || favs.includes(g.id)) &&
      (!byCtrl || byCtrl(g)) &&
      (!q || norm(`${g.name} ${g.category} ${g.description}`).includes(q))
    ));
    const by = SORTS[sort]?.fn;
    if (by) hits = [...hits].sort(by);

    grid.innerHTML = hits.length
      ? hits.map((g, i) => gameCard(g, i < 4)).join('')
      : `<div class="empty">
           <b>Aucune borne ne correspond</b>
           <span>${esc(query.trim() ? `Rien pour « ${query.trim()} »` : 'Aucune borne dans cette combinaison')}${cat === 'Tous' ? '' : esc(` dans ${cat}`)}${freshOnly ? ', parmi celles jamais jouées' : ''}.</span>
           <button class="btn" type="button" data-clear>Tout effacer</button>
         </div>`;

    const tags = [];
    if (query.trim()) tags.push(`<span>« ${esc(query.trim())} »</span>`);
    if (cat !== 'Tous') tags.push(`<span>${esc(cat)}</span>`);
    if (favOnly) tags.push('<span>★ Favoris</span>');
    if (ctrl !== 'all') tags.push(`<span>${esc(CONTROLS[ctrl].label)}</span>`);
    if (freshOnly) tags.push('<span>Jamais jouées</span>');
    if (sort !== 'cat') tags.push(`<span>${esc(SORTS[sort].label)}</span>`);
    line.innerHTML = `
      <span><b>${hits.length}</b> borne${hits.length > 1 ? 's' : ''} sur ${COUNT}</span>
      ${tags.length ? `<span class="active-filters">${tags.join('')}</span>
        <button class="btn btn-sm" type="button" data-clear>Tout effacer</button>` : ''}`;
    app.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', clearAll));
    // A borne un-starred while the favourites filter is on must leave the grid at once.
    bindFavs(grid, () => {
      app.querySelector('#only-fav').querySelector('small').textContent = getFavs().length;
      if (favOnly) paint();
    });
  }

  function clearAll() {
    query = ''; cat = 'Tous'; freshOnly = false; favOnly = false; ctrl = 'all'; sort = 'cat';
    app.querySelector('#search').value = '';
    app.querySelector('#sort').value = 'cat';
    app.querySelector('#ctrl').value = 'all';
    app.querySelector('#only-fav').setAttribute('aria-pressed', 'false');
    app.querySelector('#only-new').setAttribute('aria-pressed', 'false');
    app.querySelectorAll('.chip[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === 'Tous')));
    paint();
    app.querySelector('#search').focus();
    announce('Filtres effacés');
  }

  paint();

  app.querySelector('#search').addEventListener('input', (e) => { query = e.target.value; paint(); });
  app.querySelector('#sort').addEventListener('change', (e) => { sort = e.target.value; paint(); });
  app.querySelector('#ctrl').addEventListener('change', (e) => { ctrl = e.target.value; paint(); });

  app.querySelector('#only-fav').addEventListener('click', (e) => {
    favOnly = !favOnly;
    e.currentTarget.setAttribute('aria-pressed', String(favOnly));
    paint();
  });

  app.querySelectorAll('.chip[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      cat = btn.dataset.cat;
      app.querySelectorAll('.chip[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      paint();
    });
  });

  app.querySelector('#only-new').addEventListener('click', (e) => {
    freshOnly = !freshOnly;
    e.currentTarget.setAttribute('aria-pressed', String(freshOnly));
    paint();
  });

  // "Au hasard": a borne you have not tried yet, if any are left.
  app.querySelector('#shuffle').addEventListener('click', () => {
    const untouched = GAMES.filter((g) => !hasPlayed(g.id));
    const pool = untouched.length ? untouched : GAMES;
    location.hash = `#/game/${pool[(Math.random() * pool.length) | 0].id}`;
  });
}

/* --- Profile -------------------------------------------------------------- */

function renderProfile() {
  setPage('Ton profil', 'Ton niveau, tes XP, tes badges, tes défis du jour et l’historique de tes parties — stockés sur ta machine, sans compte.');
  const p = getProfile();
  const hist = getHistory();
  const fmtWhen = (ts) => new Date(ts).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  // Les bornes les plus jouées d'abord : c'est la statistique qu'on vient chercher.
  const perGame = GAMES
    .map((g) => ({ g, s: gameStats(g.id) }))
    .filter(({ s }) => s.runs > 0)
    .sort((a, b) => b.s.runs - a.s.runs);

  render(`
    <header class="page-head">
      <span class="eyebrow">Progression · stockée sur cette machine</span>
      <h1 class="page-title">Ton profil</h1>
    </header>

    ${xpBar(p)}

    <dl class="stat-row">
      <div class="stat"><dt>Parties</dt><dd>${fmtScore(p.runs)}</dd></div>
      <div class="stat"><dt>Victoires</dt><dd>${fmtScore(p.wins)}</dd></div>
      <div class="stat"><dt>Série</dt><dd>${p.streak} <span class="data">j · record ${p.bestStreak}</span></dd></div>
      <div class="stat"><dt>Défis remplis</dt><dd>${fmtScore(p.dailies)}</dd></div>
    </dl>

    <section class="section" style="margin-top:0">
      <h2 class="section-title">Défis du jour</h2>
      <div style="margin-top:var(--s4)">${dailyCard()}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">Badges</h2>
        <span class="link-more" aria-hidden="true">${p.unlocked.length} / ${BADGES.length}</span>
      </div>
      <ul class="badges">
        ${BADGES.map((b) => {
          const on = p.unlocked.some((u) => u.id === b.id);
          return `
            <li class="badge${on ? ' on' : ''}">
              <span class="badge-mark" aria-hidden="true">${on ? '★' : '☆'}</span>
              <span class="badge-txt"><b>${esc(b.name)}</b><span>${esc(b.desc)}</span></span>
              <span class="sr-only">${on ? 'Débloqué' : 'À débloquer'}</span>
            </li>`;
        }).join('')}
      </ul>
    </section>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">Tes dernières parties</h2>
        <a class="link-more" href="#/scores">Meilleurs scores →</a>
      </div>
      ${hist.length ? `
        <table class="score-table hist">
          <caption class="sr-only">Les ${hist.length} dernières parties enregistrées</caption>
          <thead><tr><th scope="col">Borne</th><th scope="col">Score</th><th scope="col">Niveau</th><th scope="col">Quand</th></tr></thead>
          <tbody>
            ${hist.map((r) => {
              const g = getGame(r.id);
              return `
                <tr>
                  <td class="who">${g ? `<a href="#/game/${g.id}">${esc(g.name)}</a>` : esc(r.id)}${r.won ? ' <span class="pill-win">gagné</span>' : ''}</td>
                  <td class="val">${esc(fmtScore(r.display ?? r.score))}</td>
                  <td class="when">${esc(levelName(r.diff))}</td>
                  <td class="when">${fmtWhen(r.date)}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>` : `
        <div class="empty">
          <b>Aucune partie enregistrée</b>
          <span>L’historique se remplit tout seul à la fin de chaque partie.</span>
          <a class="btn btn-primary" href="#/games">Choisir une borne</a>
        </div>`}
    </section>

    ${perGame.length ? `
      <section class="section">
        <h2 class="section-title">Par borne</h2>
        <table class="score-table hist" style="margin-top:var(--s4)">
          <thead><tr><th scope="col">Borne</th><th scope="col">Parties</th><th scope="col">Victoires</th><th scope="col">Meilleur</th></tr></thead>
          <tbody>
            ${perGame.map(({ g, s }) => `
              <tr>
                <td class="who"><a href="#/game/${g.id}">${esc(g.name)}</a></td>
                <td class="val">${fmtScore(s.runs)}</td>
                <td class="val">${fmtScore(s.wins)}</td>
                <td class="val">${fmtScore(getAnyBest(g.id) ?? s.best)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </section>` : ''}

    <section class="section">
      <h2 class="section-title">Comment ça compte</h2>
      <div class="rowgrid" style="margin-top:var(--s4)">
        <div class="note"><b>XP</b><span>Chaque partie rapporte 10 XP, plus la racine de ton score, plus 25 si tu gagnes, plus un bonus de difficulté. Un badge en vaut 100.</span></div>
        <div class="note"><b>Défis</b><span>Deux par jour, tirés au sort pour tout le monde à la même date, remis à zéro à minuit — heure de ta machine.</span></div>
        <div class="note"><b>Rien ne sort d’ici</b><span>Niveau, badges et historique vivent dans ce navigateur, comme les scores. Les réglages les effacent pour de bon.</span></div>
      </div>
    </section>
  `);
}

/* --- Scores --------------------------------------------------------------- */

function renderScores() {
  setPage('Meilleurs scores', 'Tes records borne par borne et par difficulté, gardés dans ce navigateur.');
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });

  const played = GAMES.filter((g) => hasPlayed(g.id));
  const ranked = GAMES.filter((g) => getAnyBest(g.id) !== null);
  const total = ranked.reduce((sum, g) => sum + (getAnyBest(g.id) || 0), 0);
  // Your three biggest numbers, whatever borne they came from.
  const podium = [...ranked].sort((a, b) => getAnyBest(b.id) - getAnyBest(a.id)).slice(0, 3);

  render(`
    <header class="page-head">
      <span class="eyebrow">Sauvegardé sur cette machine</span>
      <h1 class="page-title">Meilleurs scores</h1>
    </header>

    <dl class="stat-row">
      <div class="stat"><dt>Bornes essayées</dt><dd>${played.length} <span class="data">/ ${COUNT}</span></dd></div>
      <div class="stat"><dt>Bornes classées</dt><dd>${ranked.length}</dd></div>
      <div class="stat"><dt>Cumul des records</dt><dd>${fmtScore(total)}</dd></div>
    </dl>

    ${podium.length ? `
      <div class="podium">
        ${podium.map((g, i) => `
          <a class="podium-item" href="#/game/${g.id}" style="--ink: ${g.ink}"
             aria-label="${esc(`${g.name}, ${i + 1}${i ? 'e' : 'er'} de tes records : ${fmtScore(getAnyBest(g.id))}`)}">
            <span class="podium-rank" aria-hidden="true">${i + 1}</span>
            <span class="podium-info">
              <span class="podium-name">${esc(g.name)}</span>
              <span class="podium-score">${esc(fmtScore(getAnyBest(g.id)))}</span>
            </span>
          </a>`).join('')}
      </div>` : ''}

    ${ranked.length ? '' : `
      <div class="empty" style="margin-bottom:var(--s5)">
        <b>Rien d’enregistré pour l’instant</b>
        <span>Une partie qui marque des points entre ici, avec tes initiales.</span>
        <a class="btn btn-primary" href="#/games">Choisir une borne</a>
      </div>`}

    <div class="score-list">
      ${GAMES.map((g) => {
        const best = getBestLabel(g.id, getDifficulty(g.id));
        return `
        <details class="score-item" data-game="${g.id}" style="--ink: ${g.ink}">
          <summary>
            <img class="score-thumb" src="img/games/${g.id}.png" alt="" width="480" height="360" loading="lazy" decoding="async" onerror="this.remove()">
            <span class="score-name">${esc(g.name)}<small>${esc(g.category)} · ${esc(levelName(getDifficulty(g.id)))}</small></span>
            <span class="score-best${best === null ? ' none' : ''}">${best === null ? 'aucun score' : esc(fmtScore(best))}</span>
          </summary>
          <div class="score-panel">
            ${diffControl(g.id, `s-${g.id}`)}
            <div id="sb-${g.id}"></div>
          </div>
        </details>`;
      }).join('')}
    </div>
  `);

  function paintScores(g, d) {
    const list = getHighScores(g.id, d);
    const body = app.querySelector(`#sb-${CSS.escape(g.id)}`);
    if (!body) return;
    body.innerHTML = list.length ? `
      <table class="score-table">
        <caption>${esc(g.name)} — ${esc(levelName(d))}</caption>
        <tbody>
          ${list.map((row, i) => `
            <tr>
              <td class="rank">${i + 1}</td>
              <td class="who">${esc(row.name ?? '—')}</td>
              <td class="val">${esc(fmtScore(row.display ?? row.score))}</td>
              <td class="when">${fmtDate(row.date)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
      : `<p class="score-empty">Rien en ${esc(levelName(d).toLowerCase())} — la borne t’attend.</p>`;
  }

  // Tables are built when a borne is opened: 34 of them at once would be wasted work.
  app.querySelectorAll('.score-item').forEach((item) => {
    const g = getGame(item.dataset.game);
    let wired = false;
    item.addEventListener('toggle', () => {
      if (!item.open || wired) return;
      wired = true;
      paintScores(g, getDifficulty(g.id));
      bindSeg(item, `s-${g.id}`, (d) => paintScores(g, d));   // browses the table, does not change what you play
    });
  });
}

/* --- Settings ------------------------------------------------------------- */

function renderSettings() {
  setPage('Réglages', 'Thème, sons, musique, écran cathodique, animations et effacement des données locales.');
  const s = getSettings();
  // The whole row is the label, so the text is a hit target too; the switch is named by its title.
  const row = (id, title, desc, on) => `
    <label class="row" for="${id}">
      <span class="label"><b id="${id}-t">${title}</b><span id="${id}-d">${desc}</span></span>
      <span class="switch"><input type="checkbox" role="switch" id="${id}" aria-labelledby="${id}-t" aria-describedby="${id}-d"${on ? ' checked' : ''}><span class="slider"></span></span>
    </label>`;

  const d = dataSummary();
  const prog = getProg();
  // Le bouton efface tout le préfixe arcade: — la progression comprise. Autant le dire.
  const extra = prog.runs
    ? ` Aussi ton profil : niveau ${levelOf(prog.xp).level}, ${prog.badges.length} badge${prog.badges.length > 1 ? 's' : ''}, ${prog.favs.length} favori${prog.favs.length > 1 ? 's' : ''} et l’historique de ${prog.runs} partie${prog.runs > 1 ? 's' : ''}.`
    : '';
  const held = (d.rows
    ? `${d.rows} score${d.rows > 1 ? 's' : ''} sur ${d.tables} borne${d.tables > 1 ? 's' : ''}, et tes réglages.`
    : 'Aucun score enregistré pour l’instant — seuls tes réglages seraient effacés.') + extra;

  render(`
    <header class="page-head">
      <span class="eyebrow">Stocké dans ce navigateur</span>
      <h1 class="page-title">Réglages</h1>
    </header>
    <div class="list">
      ${row('set-theme', 'Thème sombre', 'Décoché, le site passe en thème clair. L’écran de jeu reste noir.', s.theme === 'dark')}
      ${row('set-sfx', 'Effets sonores', 'Sons générés à la volée, aucun fichier téléchargé.', s.sfx)}
      ${row('set-music', 'Musique', 'Airs chiptune joués par certaines bornes, qui accélèrent avec le niveau.', s.music)}
      ${row('set-crt', 'Écran cathodique', 'Lignes de balayage et verre bombé, comme sur la borne. Désactivé par défaut sur téléphone.', s.crt)}
      <div class="row">
        <label class="label" for="set-volume"><b>Volume</b><span id="vol-read" class="data">${Math.round(s.volume * 100)} %</span></label>
        <input type="range" id="set-volume" class="range" min="0" max="1" step="0.05" value="${s.volume}">
      </div>
      ${row('set-anim', 'Animations', 'Décoché, les transitions et les effets de survol s’arrêtent.', s.animations)}
      <div class="row">
        <span class="label"><b>Effacer les données locales</b><span id="reset-desc">${esc(held)} Sans retour possible.</span></span>
        <button class="btn btn-danger" type="button" id="reset-data" aria-describedby="reset-desc">Effacer</button>
      </div>
    </div>
  `);

  app.querySelector('#set-theme').addEventListener('change', (e) => {
    setSettings({ theme: e.target.checked ? 'dark' : 'light' });
    applySettings();
  });
  app.querySelector('#set-sfx').addEventListener('change', (e) => {
    setSettings({ sfx: e.target.checked });
    applySettings();
  });
  app.querySelector('#set-music').addEventListener('change', (e) => setSettings({ music: e.target.checked }));
  app.querySelector('#set-crt').addEventListener('change', (e) => setSettings({ crt: e.target.checked }));
  app.querySelector('#set-volume').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    setSettings({ volume: v });
    app.querySelector('#vol-read').textContent = `${Math.round(v * 100)} %`;
  });
  app.querySelector('#set-anim').addEventListener('change', (e) => {
    setSettings({ animations: e.target.checked });
    applySettings();
  });
  app.querySelector('#reset-data').addEventListener('click', () => {
    const what = d.rows
      ? `${d.rows} score${d.rows > 1 ? 's' : ''}${prog.runs ? ', ton profil (niveau, badges, favoris, historique)' : ''} et tes réglages`
      : `${prog.runs ? 'ton profil et ' : ''}tes réglages`;
    if (!confirm(`Effacer ${what} sur cette machine ?\n\nCette action est irréversible.`)) return;
    resetAllData();
    applySettings();
    renderSettings();
    announce('Données locales effacées');
  });
}

/* --- About ---------------------------------------------------------------- */

function renderAbout() {
  setPage('À propos', 'Comment Mini Arcade est fait : site statique, aucun serveur, aucun tracker, moteur de Doom en WebAssembly et bornes maison.');
  const gh = 'https://github.com/itsteeltv/game';
  const ext = (href, label) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  render(`
    <header class="page-head">
      <span class="eyebrow">Comment c'est fait</span>
      <h1 class="page-title">À propos</h1>
    </header>
    <div class="prose">
      <p>Mini Arcade est fait par <b>SteelTV</b> (LeVraiSteelTV) : ${COUNT} bornes jouables dans le navigateur. C'est un site entièrement statique — pas de serveur, pas de base de données, pas de compte. Tout tourne chez toi, et les scores vivent dans le <code>localStorage</code> de ta machine. Le code est ouvert : ${ext(gh, 'github.com/itsteeltv/game')}.</p>

      <h2>Sur téléphone</h2>
      <p>Installe le site comme une appli : sur iPhone, <b>Partager → Sur l'écran d'accueil</b> ; sur Android, <b>menu → Installer l'application</b>. Il s'ouvre alors en plein écran et marche même sans réseau. Tourne le téléphone pour jouer en mode console portable.</p>

      <h2>Freedoom et le moteur de Doom</h2>
      <p>La borne Freedoom fait tourner le vrai moteur de <i>Doom</i> (1993), dont id Software a publié le code source : ici la version ${ext('https://github.com/ozkl/doomgeneric', 'doomgeneric')}, sous licence GNU GPL v2, compilée en WebAssembly. Les modifications pour le navigateur sont dans ${ext(`${gh}/tree/main/tools/doom`, '<code>tools/doom/</code>')} ; le texte de la licence est fourni avec le moteur (${ext(`${gh}/blob/main/js/games/doom/ENGINE-LICENSE.txt`, '<code>ENGINE-LICENSE.txt</code>')}).</p>
      <p>Les niveaux, monstres, sons et musiques sont ceux de ${ext('https://freedoom.github.io/', 'Freedoom')} (licence BSD, ${ext(`${gh}/blob/main/js/games/doom/FREEDOOM-COPYING.txt`, '<code>FREEDOOM-COPYING.txt</code>')}) : un jeu complet, libre et gratuit. Si tu possèdes le <i>Doom</i> original, « Charger mon DOOM.WAD » le lance à la place : le fichier est lu sur ton appareil et n’est jamais envoyé nulle part. DOOM est une marque de ses propriétaires ; ce site n’y est pas affilié.</p>

      <h2>Profil, XP et défis</h2>
      <p>Chaque partie terminée rapporte de l'XP, fait monter un niveau et peut décrocher un badge. Deux défis sont tirés au sort chaque jour à partir de la date elle-même — les mêmes pour tout le monde, sans que rien ne soit demandé à un serveur — et se remettent à zéro à minuit, à l'heure de ta machine. Tu peux aussi mettre des bornes en favori avec l'étoile de leur carte : elles remontent sur l'accueil et se filtrent dans le catalogue. Tout ça vit dans ce navigateur, au même endroit que les scores : <a href="#/profil">ton profil</a> n'est visible que par toi.</p>

      <h2>Vie privée</h2>
      <p>Aucune collecte, aucun tracker, aucune dépendance externe. Rien ne sort du navigateur — et « Effacer les données locales », dans les réglages, efface vraiment tout. Le bouton « Partager » d'un score ne fait que préparer un texte et un lien : rien n'est envoyé tant que tu ne l'envoies pas toi-même.</p>

      <h2>Les graphismes et les règles</h2>
      <p>Chaque borne d'époque reprend les règles et l'ambiance de son temps — vitesse qui monte, sons synthétisés, initiales au tableau des scores — mais sprites, labyrinthes et sons sont faits pour ce site. Des hommages au principe, pas des copies. Les bornes maison (Flipper, Plateformes, Rallye, Tuyaux, Le Mot, Défense, Caverne, Entrepôt, Gemmes, Bulles…) sont écrites ici de bout en bout, niveaux compris. Les musiques sont composées pour le site, sauf une reprise : <i>Korobeiniki</i>, chanson populaire russe du XIXᵉ siècle, dans le domaine public.</p>

      <h2>Ajouter une borne</h2>
      <p>Un jeu est un module autonome de <code>js/games/</code> qui exporte <code>createGame(canvas, host, opts)</code> et renvoie <code>start</code>, <code>togglePause</code>, <code>input</code> et <code>destroy</code>. Il reçoit <code>host.onStats</code> pour l'afficheur, <code>host.onGameOver</code> pour la fin de partie et <code>host.sfx</code> pour le son ; <code>opts.difficulty</code> vaut 0, 1 ou 2.</p>
      <p>Une fois le module écrit, ajoute son entrée dans <code>js/catalog.js</code> — nom, encre, pictogramme, genre, difficulté — puis lance <code>node tools/shoot.mjs identifiant</code> pour photographier son écran. Le reste du site s'adapte, le cache hors ligne se met à jour tout seul, et le jeu n'est téléchargé qu'au moment où on le lance.</p>
    </div>
  `);
}

/* --- Game page ----------------------------------------------------------- */

function renderGamePage(id) {
  const game = getGame(id);
  if (!game) return renderNotFound('Cette borne n’existe pas — ou plus.');

  setPage(`${game.name} — ${game.category}`, `${game.description} Jouable tout de suite dans le navigateur, au clavier ou aux commandes à l’écran.`);
  setGameLd(game);
  setLastGame(id);
  let diff = getDifficulty(id);
  const best = getBestLabel(id, diff);
  const coarse = matchMedia('(pointer: coarse)').matches;

  // The stage (bar, screen, readout, pad) is sized to the viewport on phones so
  // nothing needs scrolling mid-game; options and help sit below it.
  render(`
    <section class="play" style="--ink: ${game.ink}">
      <div class="play-stage">
        <div class="play-bar">
          <a class="back-link" href="#/games" aria-label="Toutes les bornes">Bornes</a>
          <h1 class="play-title">${esc(game.name)}</h1>
          <button class="btn btn-sm btn-icon fav-btn fav-inline${isFav(id) ? ' on' : ''}" type="button" data-fav="${id}"
                  aria-pressed="${isFav(id)}" aria-label="${esc(`${isFav(id) ? 'Retirer' : 'Ajouter'} ${game.name} de tes favoris`)}">${STAR}</button>
          ${document.fullscreenEnabled ? `<button class="btn btn-sm btn-icon" type="button" id="fs-btn" aria-label="Plein écran">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>
          </button>` : ''}
          <button class="btn btn-sm" type="button" id="pause-btn" disabled>Pause</button>
        </div>

        <div class="screen${getSettings().crt ? ' crt' : ''}" id="screen">
          <canvas id="game-canvas" width="480" height="360" aria-label="Zone de jeu ${esc(game.name)}"></canvas>
          <div class="game-overlay" id="overlay">
            <p class="overlay-badge" id="overlay-badge" hidden>Nouveau record</p>
            <p class="overlay-title" id="overlay-title">Prêt ?</p>
            <p id="overlay-text">${esc(game.description)}</p>
            ${game.note ? `<p class="overlay-note" id="overlay-note">${esc(game.note)}</p>` : ''}
            <div class="overlay-actions">
              <button class="btn btn-primary" type="button" id="overlay-btn">Démarrer</button>
              <button class="btn" type="button" id="share-btn" hidden>Partager</button>
            </div>
            ${game.filePicker ? `<label class="btn file-btn">${esc(game.filePicker.label)}
              <input type="file" id="file-input" accept="${esc(game.filePicker.accept)}" hidden></label>` : ''}
          </div>
        </div>

        <dl class="readout"${game.custom ? ' hidden' : ''}>
          <div><dt>Score</dt><dd id="stat-score">0</dd></div>
          <div><dt>Niveau</dt><dd id="stat-level">1</dd></div>
          <div id="lives-wrap" hidden><dt>${esc(game.livesLabel || 'Vies')}</dt><dd id="stat-lives">—</dd></div>
          <div><dt>Record</dt><dd id="stat-best">${best === null ? '—' : esc(fmtScore(best))}</dd></div>
        </dl>

        <div class="touch-controls" id="touch-controls"></div>
      </div>

      <div class="play-options">
        ${game.custom ? '' : diffControl(id, 'game', diff)}
        <button class="btn" type="button" id="restart-btn">Recommencer</button>
      </div>

      <details class="help"${coarse ? '' : ' open'}>
        <summary>Règles et commandes</summary>
        <p class="help-text" id="help-text"></p>
      </details>
    </section>
  `);

  bindFavs(app);
  const canvas = app.querySelector('#game-canvas');
  const screenEl = app.querySelector('#screen');

  // Contain-fit the canvas in its screen at any size, up or down. The games map
  // pointer coordinates from the canvas box, so it must stay undistorted.
  function fit() {
    // The frame takes the borne's own shape — a portrait borne is not letterboxed into a
    // 4:3 box. Read from the canvas's intrinsic size, never from its laid-out size, or the
    // observer would feed its own result back in.
    screenEl.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
    const s = Math.min(screenEl.clientWidth / canvas.width, screenEl.clientHeight / canvas.height);
    canvas.style.width = `${Math.floor(canvas.width * s)}px`;
    canvas.style.height = `${Math.floor(canvas.height * s)}px`;
    canvas.style.imageRendering = s >= 1 ? 'pixelated' : 'auto'; // crisp upscale; no dropped lines downscaled
  }
  fit();                     // before the first paint: the observer fires too late and the canvas jumps
  const resizer = new ResizeObserver(fit);
  resizer.observe(screenEl);
  const overlay = app.querySelector('#overlay');
  const overlayTitle = app.querySelector('#overlay-title');
  const overlayText = app.querySelector('#overlay-text');
  const overlayNote = app.querySelector('#overlay-note');
  const overlayBtn = app.querySelector('#overlay-btn');
  const shareBtn = app.querySelector('#share-btn');
  const pauseBtn = app.querySelector('#pause-btn');
  const badge = app.querySelector('#overlay-badge');
  const statBest = app.querySelector('#stat-best');
  const statScore = app.querySelector('#stat-score');
  const statLevel = app.querySelector('#stat-level');
  const statLives = app.querySelector('#stat-lives');
  const livesWrap = app.querySelector('#lives-wrap');

  app.querySelector('#help-text').innerHTML = coarse
    ? (game.touchKeys || 'Utilise les commandes sous l’écran.')
    : `${game.keys}${game.ownsEsc ? '' : ' <kbd>Échap</kbd> met en pause.'}`;

  let controller = null;
  let paused = false;
  let finished = false;
  let lastLives = null;
  let pickedFile = null;   // a game's own data file (Doom: the player's WAD), kept for restarts
  let overlaySince = -1e9; // when the current overlay appeared (see onKey)

  // Era touches: a chiptune that speeds up with the level, and the screen kept awake.
  const song = game.music && SONGS[game.music];
  const mineToken = renderToken;
  let musicRate = 1;
  let wake = null;
  function stayAwake(on) {
    if (!on) { wake?.release().catch(() => {}); wake = null; return; }
    navigator.wakeLock?.request('screen')
      .then((l) => { if (finished || paused || mineToken !== renderToken) l.release(); else wake = l; })
      .catch(() => {});
  }

  function onStats({ score, level, lives } = {}) {
    if (score !== undefined) statScore.textContent = fmtScore(score);
    if (level !== undefined) {
      statLevel.textContent = level;
      musicRate = Math.min(1.6, 1 + (Number(level) - 1) * 0.04);
      if (song) setMusicRate(musicRate);
    }
    if (lives !== undefined) {
      livesWrap.hidden = false;
      statLives.textContent = lives;
      // A buzz when a life goes — the one moment worth a haptic (Android only).
      if (!game.livesLabel && lastLives !== null && lives < lastLives) navigator.vibrate?.(40);
      lastLives = lives;
    }
  }

  function showOverlay(title, text, btnLabel, onClick, badgeText = null, shareLabel = null) {
    badge.hidden = !badgeText;
    if (badgeText) badge.textContent = badgeText;
    overlayTitle.textContent = title;
    overlayText.innerHTML = text;
    if (overlayNote) overlayNote.hidden = true;
    overlayBtn.textContent = btnLabel;
    overlayBtn.onclick = onClick;
    shareBtn.hidden = shareLabel === null;
    shareBtn.onclick = shareLabel === null ? null : () => share(shareLabel);
    overlaySince = performance.now();
    overlay.hidden = false;
  }

  /** Hand the score to the system share sheet, or to the clipboard where there is none. */
  async function share(label) {
    const url = `${location.href.split('#')[0]}#/game/${id}`;
    const text = `J’ai fait ${label} à ${game.name} sur Mini Arcade (SteelTV). À ton tour !`;
    let msg = null;
    try {
      if (navigator.share) await navigator.share({ title: 'Mini Arcade', text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); msg = 'Copié ✓'; }
    } catch (e) { if (e?.name !== 'AbortError') msg = 'Copie impossible'; }
    if (!msg) return;
    shareBtn.textContent = msg;
    announce(msg);
    setTimeout(() => { shareBtn.textContent = 'Partager'; }, 1800);
  }

  function onGameOver(score, won, display = null) {
    finished = true;
    paused = false;
    pauseBtn.textContent = 'Pause';
    pauseBtn.disabled = true;
    stopMusic();
    stayAwake(false);
    navigator.vibrate?.(won ? [30, 60, 30] : 90);
    const initials = getSettings().initials || 'AAA';
    // A run that scored nothing is not a record: it neither enters the table nor asks for a signature.
    const res = Number(score) > 0
      ? saveScore(id, score, game.higherIsBetter, display, diff, initials)
      : { record: false, rank: -1, date: 0 };
    markPlayed(id);
    // Progression : XP, badges et défis du jour, pour les bornes qui tiennent un score.
    const prog = game.custom ? null : addRun({ id, score: Number(score) || 0, won, diff, display });
    const b = getBestLabel(id, diff);
    statBest.textContent = b === null ? '—' : fmtScore(b);
    if (won) sfx.win(); else sfx.gameover();

    // Made the table: sign it with three letters, like on the cabinet.
    const sign = res.rank < 0 ? '' : `
      <label class="initials">
        <span>${res.record ? 'Signe ton record' : `Classé n°${res.rank + 1}`}</span>
        <input id="initials" value="${esc(initials)}" maxlength="3" autocomplete="off"
               autocapitalize="characters" spellcheck="false" enterkeyhint="done"
               aria-label="Tes initiales, trois caractères">
      </label>`;
    const shown = fmtScore(display ?? score);
    // Ce que la partie t'a rapporté, dans l'ordre : l'XP, le niveau, les défis, les badges.
    const gains = !prog ? '' : `
      <span class="gains">
        <span class="gain gain-xp">+${fmtScore(prog.gained)} XP</span>
        ${prog.levelUp ? `<span class="gain gain-up">Niveau ${prog.level}</span>` : ''}
        ${prog.daily.map((d) => `<span class="gain gain-daily">${esc(d)}</span>`).join('')}
        ${prog.badges.map((bg) => `<span class="gain gain-badge">★ ${esc(bg.name)}</span>`).join('')}
      </span>`;
    showOverlay(
      won ? 'Gagné' : 'Partie terminée',
      `<span class="final-score">${esc(shown)}</span>
       <span class="overlay-sub">${esc(levelName(diff))}</span>${gains}${sign}`,
      'Rejouer',
      start,
      res.record ? 'Nouveau record' : res.rank >= 0 ? 'Top 5' : null,
      Number(score) > 0 ? String(shown) : null,
    );
    announce(`${won ? 'Gagné' : 'Partie terminée'}. Score : ${shown}.${res.record ? ' Nouveau record.' : ''}${
      prog ? ` ${prog.gained} XP.${prog.levelUp ? ` Niveau ${prog.level} atteint.` : ''}${
        prog.badges.length ? ` Badge : ${prog.badges.map((bg) => bg.name).join(', ')}.` : ''}${
        prog.daily.length ? ` ${prog.daily.join(', ')} rempli.` : ''}` : ''}`);

    const field = overlay.querySelector('#initials');
    if (field) {
      field.addEventListener('input', () => {
        field.value = field.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
        if (!field.value) return;
        renameScore(id, diff, res.date, field.value);
        setSettings({ initials: field.value });
      });
      field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); overlayBtn.focus(); } });
      if (!coarse) { field.focus(); field.select(); }   // no surprise keyboard on phones
    } else if (!coarse) overlayBtn.focus();             // keyboard players can restart at once
  }

  async function start() {
    const mine = renderToken;
    finished = false;
    paused = false;
    pauseBtn.textContent = 'Pause';
    overlay.hidden = true;
    onStats({ score: 0, level: 1 });

    let createGame;
    try {
      ({ createGame } = await import(game.module));
    } catch (err) {
      if (mine !== renderToken) return;
      // Offline on a borne that was never cached, or a broken file: say it, don't sit on a black screen.
      showOverlay(
        'Borne indisponible',
        `Le jeu n’a pas pu être chargé.${navigator.onLine ? '' : ' Tu es hors ligne : ouvre cette borne une fois avec du réseau et elle restera jouable.'}`,
        'Réessayer', start,
      );
      announce('La borne n’a pas pu être chargée.');
      pauseBtn.disabled = true;
      return;
    }
    if (mine !== renderToken) return; // navigated away while the module loaded

    controller?.destroy();
    lastLives = null;
    musicRate = 1;
    // A tall stage (a phone held upright) lets games that can pick a portrait layout do so.
    const portrait = screenEl.clientHeight > screenEl.clientWidth * 1.15;
    controller = createGame(canvas, { onStats, onGameOver, sfx, tone: beep }, { difficulty: diff, file: pickedFile, portrait });
    fit(); // each game sets its own canvas size
    controller.start();
    pauseBtn.disabled = false;
    if (song) playMusic(song, musicRate);
    stayAwake(true);
    markPlayed(id);
    announce('Partie lancée');
  }

  function setPaused() {
    if (!controller || finished) return;
    paused = controller.togglePause();
    pauseBtn.textContent = paused ? 'Reprendre' : 'Pause';
    stayAwake(!paused);
    announce(paused ? 'Pause' : 'Reprise');
    if (paused) {
      stopMusic();
      showOverlay('Pause', 'La partie reprend là où tu l’as laissée.', 'Reprendre', () => setPaused());
    } else {
      if (song) playMusic(song, musicRate);
      overlay.hidden = true;
    }
  }

  // Switching apps on a phone (or tabs) pauses the run instead of losing it.
  const onVisibility = () => { if (document.hidden && controller && !finished && !paused) setPaused(); };
  document.addEventListener('visibilitychange', onVisibility);

  app.querySelector('#fs-btn')?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else app.querySelector('.play').requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  });

  /* Swipes on the screen, for games that declare them: the gesture is the d-pad.
     `swipe: { down: 'action', tap: 'up' }` remaps a direction or adds a tap. */
  if (game.swipe) {
    const map = typeof game.swipe === 'object' ? game.swipe : {};
    let from = null;
    screenEl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || !overlay.hidden || !controller) return;
      from = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    screenEl.addEventListener('pointerup', (e) => {
      if (!from || e.pointerId !== from.id) return;
      const dx = e.clientX - from.x, dy = e.clientY - from.y;
      from = null;
      let a;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) a = map.tap;
      else {
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        a = map[dir] ?? dir;
      }
      if (!a || !controller || paused || finished) return;
      controller.input(a, true);
      controller.input(a, false);
    });
  }

  // One handler, swapped by showOverlay: Démarrer, Reprendre and Rejouer each do one thing.
  overlayBtn.onclick = () => start();
  app.querySelector('#file-input')?.addEventListener('change', (e) => {
    pickedFile = e.target.files[0] || null;
    if (pickedFile) start();
  });
  pauseBtn.addEventListener('click', () => setPaused());

  // Changing difficulty restarts: a run half-played on two settings means nothing.
  bindSeg(app, 'game', (d) => {
    diff = setDifficulty(id, d);
    const b = getBestLabel(id, diff);
    statBest.textContent = b === null ? '—' : fmtScore(b);
    if (controller) start();
    else {
      overlayTitle.textContent = 'Prêt ?';
      overlayText.textContent = `${game.description} — ${levelName(diff)}`;
      badge.hidden = true;
    }
  });
  app.querySelector('#restart-btn').addEventListener('click', start);

  /* Touch controls — only on coarse pointers, mirroring the keyboard map. */
  const wrap = app.querySelector('#touch-controls');
  const spec = game.touch || {};
  if (coarse && (spec.pad || spec.actions?.length)) {
    const PADS = {
      dpad: `<div class="dpad">
        <button class="pad-btn" type="button" data-a="up" aria-label="Haut">↑</button>
        <button class="pad-btn" type="button" data-a="left" aria-label="Gauche">←</button>
        <button class="pad-btn" type="button" data-a="right" aria-label="Droite">→</button>
        <button class="pad-btn" type="button" data-a="down" aria-label="Bas">↓</button>
      </div>`,
      lr: `<div class="pad-row">
        <button class="pad-btn" type="button" data-a="left" aria-label="Gauche">←</button>
        <button class="pad-btn" type="button" data-a="right" aria-label="Droite">→</button>
      </div>`,
      ud: `<div class="pad-row">
        <button class="pad-btn" type="button" data-a="up" aria-label="Haut">↑</button>
        <button class="pad-btn" type="button" data-a="down" aria-label="Bas">↓</button>
      </div>`,
      joystick: `<div class="joystick" data-joy data-dirs="up,down,left,right" aria-hidden="true">
        <div class="joystick-base"><div class="joystick-thumb"></div></div>
      </div>`,
      'joystick-lr': `<div class="joystick" data-joy data-dirs="left,right" aria-hidden="true">
        <div class="joystick-base"><div class="joystick-thumb"></div></div>
      </div>`,
      'joystick-ud': `<div class="joystick" data-joy data-dirs="up,down" aria-hidden="true">
        <div class="joystick-base"><div class="joystick-thumb"></div></div>
      </div>`,
    };
    const actions = (spec.actions || [])
      .map((b) => `<button class="action-btn" type="button" data-a="${b.a}" aria-label="${esc(b.aria)}">${esc(b.label)}</button>`)
      .join('');

    wrap.classList.add('enabled');
    wrap.innerHTML = (spec.pad ? PADS[spec.pad] : '') + (actions ? `<div class="action-btns">${actions}</div>` : '');

    wrap.querySelectorAll('[data-a]').forEach((btn) => {
      const send = (down) => (e) => {
        e.preventDefault();
        btn.classList.toggle('is-down', down); // :active is unreliable under touch on iOS
        controller?.input(btn.dataset.a, down);
      };
      // Fire on pointerdown so the press itself is the feedback, never the release.
      btn.addEventListener('pointerdown', send(true));
      btn.addEventListener('pointerup', send(false));
      btn.addEventListener('pointercancel', send(false));
      btn.addEventListener('pointerleave', send(false));
    });

    // Joystick: a dragged thumb mapped to the same discrete up/down/left/right
    // actions the d-pad sends — direct 1:1 tracking while held, snap back on release.
    wrap.querySelectorAll('[data-joy]').forEach((joy) => {
      const dirs = joy.dataset.dirs.split(',');
      const base = joy.querySelector('.joystick-base');
      const thumb = joy.querySelector('.joystick-thumb');
      const RADIUS = 32, DEADZONE = 14;
      let active = null, pointerId = null;

      const setDir = (dir) => {
        if (dir === active) return;
        if (active) controller?.input(active, false);
        if (dir) controller?.input(dir, true);
        active = dir;
      };
      const update = (x, y) => {
        const r = base.getBoundingClientRect();
        const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy) || 1;
        const clamped = Math.min(dist, RADIUS);
        thumb.style.transform = `translate(${(dx / dist) * clamped}px, ${(dy / dist) * clamped}px)`;
        let dir = null;
        if (dist > DEADZONE) {
          dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
          if (!dirs.includes(dir)) dir = null;
        }
        setDir(dir);
      };
      const release = () => { setDir(null); pointerId = null; joy.classList.remove('dragging'); thumb.style.transform = ''; };

      joy.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pointerId = e.pointerId;
        joy.setPointerCapture(pointerId);
        joy.classList.add('dragging');
        update(e.clientX, e.clientY);
      });
      joy.addEventListener('pointermove', (e) => {
        if (e.pointerId !== pointerId) return;
        e.preventDefault();
        update(e.clientX, e.clientY);
      });
      joy.addEventListener('pointerup', (e) => { if (e.pointerId === pointerId) release(); });
      joy.addEventListener('pointercancel', (e) => { if (e.pointerId === pointerId) release(); });
    });
  }

  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    z: 'up', s: 'down', q: 'left', d: 'right',          // ZQSD, the French default
    w: 'up', a: 'left',                                  // and WASD for good measure
    ' ': 'action', Enter: 'action', f: 'action', c: 'hold', Shift: 'hold',
  };
  const isPress = (e) => e.key === 'Enter' || e.key === ' ';

  function onKey(e) {
    const t = e.target;
    if (t.closest?.('input, textarea, select')) return;   // typing initials, not playing
    // A control the player reached with Tab keeps Enter and Space: the key presses it, it doesn't play.
    if (isPress(e) && t.closest?.('a, button, summary, [role="button"]') && t.matches(':focus-visible')) return;
    // Escape stays the page's pause for every borne but the ones that claim it (Doom's own menu).
    if (e.key === 'Escape') {
      if (!game.ownsEsc && e.type === 'keydown') setPaused();
      return;
    }
    if (controller?.ownsKeyboard && !finished) return;   // Doom and Le Mot read the keyboard themselves
    // On the title, pause and game-over screens Enter and Space are the start button — but not at
    // once: someone mashing Space as they die has to see their score before a new game begins.
    if (isPress(e) && !overlay.hidden) {
      e.preventDefault();
      if (e.type === 'keydown' && !e.repeat && performance.now() - overlaySince > 700) overlayBtn.click();
      return;
    }
    const action = KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase?.()];
    if (!action || !controller) return;
    e.preventDefault();
    controller.input(action, e.type === 'keydown');
  }

  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  currentController = {
    destroy() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      resizer.disconnect();
      stopMusic();
      stayAwake(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      controller?.destroy();
    },
  };
}

/* --- Router -------------------------------------------------------------- */

const ROUTES = {
  '': renderHome,
  games: renderGames,
  profil: renderProfile,
  scores: renderScores,
  settings: renderSettings,
  about: renderAbout,
};

function renderNotFound(msg) {
  // Une page qui n'existe pas ne se déclare pas canonique : elle renvoie vers l'accueil.
  setPage('Introuvable', DEFAULT_DESC, '#/');
  render(`
    <header class="page-head">
      <span class="eyebrow">Erreur 404</span>
      <h1 class="page-title">Page introuvable</h1>
    </header>
    <div class="empty">
      <b>${esc(msg)}</b>
      <span>Le catalogue, lui, est toujours là : ${bornes()} t'attendent.</span>
      <span class="hero-actions">
        <a class="btn btn-primary" href="#/games">Voir les bornes</a>
        <a class="btn" href="#/">Accueil</a>
      </span>
    </div>
  `);
}

const scrollMemo = new Map();   // where each page was scrolled to, so Back returns you to your place in the catalogue
let backNav = false;

function route() {
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  // "#/games?fav" is the catalogue with its favourites filter already on: the query
  // belongs to the page, not to the route name.
  const name = (parts[0] || '').split('?')[0];
  setGameLd(null);
  if (name === 'game') {
    if (parts[1]) renderGamePage(parts[1]); else renderNotFound('Il manque le nom de la borne.');
  } else if (Object.hasOwn(ROUTES, name)) ROUTES[name]();
  else renderNotFound('Cette page n’existe pas.');
  // Going back restores the place you left; any other arrival starts at the top (a game opened
  // from deep in the grid must start at its stage).
  window.scrollTo(0, backNav ? scrollMemo.get(location.hash || '#/') || 0 : 0);
  backNav = false;
}

history.scrollRestoration = 'manual';
window.addEventListener('popstate', () => { backNav = true; });
window.addEventListener('hashchange', (e) => {
  try { scrollMemo.set(new URL(e.oldURL).hash || '#/', window.scrollY); } catch { /* ignore */ }
  route();
});
// "#app" is not a route: the skip link moves focus to the content instead of leaving the page.
document.querySelector('.skip-link').addEventListener('click', (e) => { e.preventDefault(); app.focus(); });
applySettings();
route();

// Installable and playable offline. Needs HTTPS (GitHub Pages) or localhost.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

