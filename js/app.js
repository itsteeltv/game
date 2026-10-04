import { GAMES, getGame, stars, glyphSVG } from './catalog.js';
import {
  getSettings, setSettings, saveScore, getHighScores, getBestLabel, getAnyBest,
  getDifficulty, setDifficulty, markPlayed, hasPlayed, getLastGame,
  resetAllData, setLastGame, LEVELS, levelName, renameScore,
} from './storage.js';
import { sfx, beep, SONGS, playMusic, stopMusic, setMusicRate } from './audio.js';

const app = document.getElementById('app');
const themeBtn = document.getElementById('theme-toggle');
const soundBtn = document.getElementById('sound-toggle');
const srStatus = document.getElementById('sr-status');
const metaTheme = document.querySelector('meta[name="theme-color"]');
const DEFAULT_TITLE = document.title;

/** One title per page: tabs, history and screen readers all read it. */
const setTitle = (t) => { document.title = t ? `${t} — Mini Arcade` : DEFAULT_TITLE; };

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
  metaTheme?.setAttribute('content', s.theme === 'dark' ? '#050506' : '#F5F5F7');
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
  const first = (location.hash.slice(1) || '/').split('/').filter(Boolean)[0];
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
  document.body.dataset.view = route === '/game' ? 'game' : 'page'; // phones drop the tab bar mid-game
  document.querySelectorAll('.main-nav a').forEach((a) => {
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

/* --- Cabinet partials ---------------------------------------------------- */

/** The game's own screen, captured from a real run (img/games/<id>.png).
    The glyph underneath shows through if a new game has no capture yet. */
function art(g, eager = false) {
  // The first thing on the page (the featured card) is the LCP: it must not wait to be scrolled to.
  const load = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  return `
    <span class="art">
      ${glyphSVG(g, 44)}
      <img src="img/games/${g.id}.png" alt="" ${load} decoding="async" onerror="this.remove()">
    </span>`;
}

/** The link's spoken name: what the machine is, its genre, and the thing worth knowing — your record, else how hard it is. */
const tileLabel = (g, best) => `Jouer à ${g.name}${g.new ? ' (nouveau)' : ''} — ${g.category}, ${best === null ? `difficulté ${g.difficulty} sur 5` : `record ${fmtScore(best)}`}`;

/** A little arcade cabinet: lit marquee with the name, the game's screen, a
    control panel with the Jouer button. The whole machine is the link. */
function cabTile(g) {
  const d = getDifficulty(g.id);
  const best = getBestLabel(g.id, d);
  return `
    <a class="cab" href="#/game/${g.id}" style="--ink: ${g.ink}" aria-label="${esc(tileLabel(g, best))}">
      <span class="cab-marquee">${esc(g.name)}${g.new ? '<span class="cab-new" aria-hidden="true">Nouveau</span>' : ''}</span>
      <span class="cab-bezel">${art(g)}</span>
      <span class="cab-panel" aria-hidden="true">
        <span class="cab-stick"></span>
        <span class="cab-dots"><i></i><i></i></span>
        <span class="cab-play">Jouer</span>
      </span>
      <span class="cab-base">
        <span class="cab-meta">${esc(g.category)} · ${best === null ? stars(g.difficulty) : `record ${esc(fmtScore(best))}`}</span>
        ${hasPlayed(g.id) ? '<i class="played" aria-hidden="true"></i>' : ''}
      </span>
    </a>
  `;
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

/* --- Home: explain first, then the wall of cabinets ---------------------- */

function renderHome() {
  setTitle(null);
  render(`
    <section class="hero">
      <div class="intro">
        <span class="eyebrow">${bornes()} · rien à installer</span>
        <h1 class="page-title">Une salle d’arcade dans ton navigateur</h1>
        <p class="intro-lede">
          ${COUNT} bornes, de Pong (1972) à Doom (1993) — Tetris, Galaxie, Astéroïdes, Mille-pattes…
          Tu choisis une borne, elle se charge en une seconde, tu joues.
          Au clavier sur ordinateur, avec les commandes à l’écran sur téléphone.
        </p>
        <div class="intro-actions">
          <a class="btn btn-primary" href="#/games">Choisir une borne</a>
          <a class="btn" href="#/about">Comment c’est fait</a>
        </div>
      </div>
      ${featureCard()}
    </section>

    <ol class="steps">
      <li>
        <b>Choisis ta borne</b>
        <span>Chaque vignette est une machine : son nom, son écran, son genre. Un appui et la partie s’ouvre.</span>
      </li>
      <li>
        <b>Règle la difficulté</b>
        <span>Facile, normal ou difficile, sur la borne elle-même. Chaque niveau garde son propre classement.</span>
      </li>
      <li>
        <b>Garde tes scores</b>
        <span>Ils restent dans ce navigateur. Aucun compte, aucun serveur, rien n’est envoyé nulle part.</span>
      </li>
    </ol>

    <section>
      <h2 class="section-title">Les ${bornes()}</h2>
      <div class="tile-grid">${GAMES.map(cabTile).join('')}</div>
    </section>
  `);
}

/** The last cabinet played — the one thing a returning visitor wants. First visit: Tetris. */
function featureCard() {
  const last = getGame(getLastGame());
  const g = last || getGame('tetris') || GAMES[0];
  const d = getDifficulty(g.id);
  const best = getBestLabel(g.id, d);
  return `
    <a class="feature" href="#/game/${g.id}" style="--ink: ${g.ink}">
      ${art(g, true)}
      <span class="feature-foot">
        <span class="feature-info">
          <span class="eyebrow">${last ? 'Ta dernière borne' : 'À essayer'}</span>
          <b class="feature-name">${esc(g.name)}</b>
          <span class="feature-meta">${esc(g.category)} · ${esc(levelName(d))}${best === null ? '' : ` · record ${esc(fmtScore(best))}`}</span>
        </span>
        <span class="btn btn-primary">${last ? 'Reprendre' : 'Jouer'}</span>
      </span>
    </a>`;
}

/* --- Catalog ------------------------------------------------------------- */

function renderGames() {
  setTitle('Les bornes');
  const categories = ['Tous', ...new Set(GAMES.map((g) => g.category))];
  const countOf = (c) => (c === 'Tous' ? COUNT : GAMES.filter((g) => g.category === c).length);
  let query = '';
  let filter = 'Tous';

  render(`
    <header class="page-head">
      <span class="eyebrow">Catalogue</span>
      <h1 class="page-title">Choisis ta borne</h1>
    </header>
    <div class="toolbar">
      <input type="search" id="search" placeholder="Chercher une borne…" aria-label="Chercher une borne par nom ou par genre">
      ${categories.map((c) => `
        <button class="filter-chip${c === 'Tous' ? ' active' : ''}" type="button"
                data-cat="${esc(c)}" aria-pressed="${c === 'Tous'}">${esc(c)}<small aria-hidden="true">${countOf(c)}</small></button>
      `).join('')}
      <button class="filter-chip shuffle" type="button" id="shuffle">Au hasard</button>
    </div>
    <div class="tile-grid" id="games-grid"></div>
    <p class="eyebrow" id="result-count" role="status" style="margin-top:1.5rem"></p>
  `);

  const grid = app.querySelector('#games-grid');
  const count = app.querySelector('#result-count');

  function paint() {
    const q = norm(query.trim());
    const hits = GAMES.filter((g) => (
      (filter === 'Tous' || g.category === filter) &&
      (!q || norm(`${g.name} ${g.category} ${g.description}`).includes(q))
    ));
    grid.innerHTML = hits.length
      ? hits.map(cabTile).join('')
      : `<p class="empty-state">Aucune borne ne correspond. Essaie un autre nom ou retire le filtre.</p>`;
    count.textContent = `${bornes(hits.length)} sur ${COUNT}`;
  }

  paint();

  app.querySelector('#search').addEventListener('input', (e) => {
    query = e.target.value;
    paint();
  });

  app.querySelectorAll('.filter-chip[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.cat;
      app.querySelectorAll('.filter-chip[data-cat]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      paint();
    });
  });

  // "Au hasard": a cabinet you haven't tried yet, if any are left.
  app.querySelector('#shuffle').addEventListener('click', () => {
    const fresh = GAMES.filter((g) => !hasPlayed(g.id));
    const pool = fresh.length ? fresh : GAMES;
    location.hash = `#/game/${pool[(Math.random() * pool.length) | 0].id}`;
  });
}

/* --- Scores -------------------------------------------------------------- */

function renderScores() {
  setTitle('Meilleurs scores');
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });

  const played = GAMES.filter((g) => hasPlayed(g.id));
  const withScore = GAMES.filter((g) => getAnyBest(g.id) !== null);
  const total = withScore.reduce((sum, g) => sum + (getAnyBest(g.id) || 0), 0);

  render(`
    <header class="page-head">
      <span class="eyebrow">Sauvegardé sur cette machine</span>
      <h1 class="page-title">Meilleurs scores</h1>
    </header>

    <dl class="summary">
      <div class="summary-tile"><dt>Bornes essayées</dt><dd>${played.length} / ${COUNT}</dd></div>
      <div class="summary-tile"><dt>Bornes classées</dt><dd>${withScore.length}</dd></div>
      <div class="summary-tile"><dt>Cumul des records</dt><dd>${fmtScore(total)}</dd></div>
    </dl>

    <div class="scores-grid">
      ${GAMES.map((g) => `
        <div class="score-card" data-game="${g.id}" style="--ink: ${g.ink}">
          <a class="score-title" href="#/game/${g.id}">${art(g)}<b>${esc(g.name)}</b></a>
          <div class="score-head">${diffControl(g.id, `s-${g.id}`)}</div>
          <div class="score-body" id="sb-${g.id}"></div>
        </div>
      `).join('')}
    </div>
  `);

  function paintScores(g, d) {
    const list = getHighScores(g.id, d);
    const body = app.querySelector(`#sb-${g.id}`);
    if (!body) return;
    body.innerHTML = list.length ? `
      <table class="score-table">
        <caption>Meilleurs scores — ${esc(g.name)} — ${esc(levelName(d))}</caption>
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
      : `<p class="score-empty">Rien en ${esc(levelName(d).toLowerCase())} — la borne t'attend.</p>`;
  }

  GAMES.forEach((g) => {
    paintScores(g, getDifficulty(g.id));
    // The picker here only browses the table; it doesn't change what you'll play.
    bindSeg(app, `s-${g.id}`, (d) => paintScores(g, d));
  });
}

/* --- Settings ------------------------------------------------------------ */

function renderSettings() {
  setTitle('Réglages');
  const s = getSettings();
  // The whole row is the label, so the text is a hit target too; the switch is named by its title.
  const row = (id, title, desc, on) => `
    <label class="settings-row" for="${id}">
      <span class="label"><b id="${id}-t">${title}</b><span id="${id}-d">${desc}</span></span>
      <span class="switch"><input type="checkbox" role="switch" id="${id}" aria-labelledby="${id}-t" aria-describedby="${id}-d"${on ? ' checked' : ''}><span class="slider"></span></span>
    </label>`;

  render(`
    <header class="page-head">
      <span class="eyebrow">Stocké dans ce navigateur</span>
      <h1 class="page-title">Réglages</h1>
    </header>
    <div class="settings-list">
      ${row('set-theme', 'Thème sombre', 'Décoché, le site passe en thème clair. L’écran de jeu reste noir.', s.theme === 'dark')}
      ${row('set-sfx', 'Effets sonores', 'Sons générés à la volée, aucun fichier téléchargé.', s.sfx)}
      ${row('set-music', 'Musique', 'Airs chiptune joués par certaines bornes, qui accélèrent avec le niveau.', s.music)}
      ${row('set-crt', 'Écran cathodique', 'Lignes de balayage et verre bombé, comme sur la borne. Désactivé par défaut sur téléphone.', s.crt)}
      <div class="settings-row">
        <label class="label" for="set-volume"><b>Volume</b><span id="vol-read" class="data">${Math.round(s.volume * 100)} %</span></label>
        <input type="range" id="set-volume" min="0" max="1" step="0.05" value="${s.volume}">
      </div>
      ${row('set-anim', 'Animations', 'Décoché, les transitions et les effets de survol s’arrêtent.', s.animations)}
      <div class="settings-row">
        <span class="label"><b>Effacer les données locales</b><span>Supprime les scores et les réglages. Sans retour possible.</span></span>
        <button class="btn btn-danger" type="button" id="reset-data">Effacer</button>
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
    if (!confirm('Effacer tous les scores et réglages enregistrés sur cette machine ? Cette action est irréversible.')) return;
    resetAllData();
    applySettings();
    renderSettings();
  });
}

/* --- About --------------------------------------------------------------- */

function renderAbout() {
  setTitle('À propos');
  const gh = 'https://github.com/itsteeltv/game';
  const ext = (href, label) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  render(`
    <header class="page-head">
      <span class="eyebrow">Comment c'est fait</span>
      <h1 class="page-title">À propos</h1>
    </header>
    <div class="prose">
      <p>Mini Arcade est fait par <b>SteelTV</b> (LeVraiSteelTV). C'est un site entièrement statique : pas de serveur, pas de base de données, pas de compte. Tout tourne dans ton navigateur, et les scores vivent dans le <code>localStorage</code> de ta machine. Le code est ouvert : ${ext(gh, 'github.com/itsteeltv/game')}.</p>

      <h2>Sur téléphone</h2>
      <p>Installe le site comme une appli : sur iPhone, <b>Partager → Sur l'écran d'accueil</b> ; sur Android, <b>menu → Installer l'application</b>. Il s'ouvre alors en plein écran et marche même sans réseau. Tourne le téléphone pour jouer en mode console portable.</p>

      <h2>Freedoom et le moteur de Doom</h2>
      <p>La borne Freedoom fait tourner le vrai moteur de <i>Doom</i> (1993), dont id Software a publié le code source : ici la version ${ext('https://github.com/ozkl/doomgeneric', 'doomgeneric')}, sous licence GNU GPL v2, compilée en WebAssembly. Les modifications pour le navigateur sont dans ${ext(`${gh}/tree/main/tools/doom`, '<code>tools/doom/</code>')} ; le texte de la licence est fourni avec le moteur (${ext(`${gh}/blob/main/js/games/doom/ENGINE-LICENSE.txt`, '<code>ENGINE-LICENSE.txt</code>')}).</p>
      <p>Les niveaux, monstres, sons et musiques sont ceux de ${ext('https://freedoom.github.io/', 'Freedoom')} (licence BSD, ${ext(`${gh}/blob/main/js/games/doom/FREEDOOM-COPYING.txt`, '<code>FREEDOOM-COPYING.txt</code>')}) : un jeu complet, libre et gratuit. Si tu possèdes le <i>Doom</i> original, « Charger mon DOOM.WAD » le lance à la place : le fichier est lu sur ton appareil et n’est jamais envoyé nulle part. DOOM est une marque de ses propriétaires ; ce site n’y est pas affilié.</p>

      <h2>Vie privée</h2>
      <p>Aucune collecte, aucun tracker, aucune dépendance externe. Rien ne sort du navigateur — et « Effacer les données locales », dans les réglages, efface vraiment tout. Le bouton « Partager » d'un score ne fait que préparer un texte et un lien : rien n'est envoyé tant que tu ne l'envoies pas toi-même.</p>

      <h2>Les graphismes</h2>
      <p>Chaque borne reprend les règles et l'ambiance de son époque — vitesse qui monte, sons synthétisés, initiales au tableau des scores — mais sprites, labyrinthe et sons sont faits pour ce site. Des hommages au principe, pas des copies. Seule musique reprise : <i>Korobeiniki</i>, chanson populaire russe du XIXᵉ siècle, dans le domaine public.</p>

      <h2>Ajouter une borne</h2>
      <p>Un jeu est un module autonome de <code>js/games/</code> qui exporte <code>createGame(canvas, host, opts)</code> et renvoie <code>start</code>, <code>togglePause</code>, <code>input</code> et <code>destroy</code>. Il reçoit <code>host.onStats</code> pour l'afficheur, <code>host.onGameOver</code> pour la fin de partie et <code>host.sfx</code> pour le son ; <code>opts.difficulty</code> vaut 0, 1 ou 2.</p>
      <p>Une fois le module écrit, ajoute son entrée dans <code>js/catalog.js</code> — nom, encre, pictogramme, genre, difficulté — puis lance <code>node tools/shoot.mjs identifiant</code> pour photographier son écran. Le reste du site s'adapte, et le jeu n'est téléchargé qu'au moment où on le lance.</p>
    </div>
  `);
}

/* --- Game page ----------------------------------------------------------- */

function renderGamePage(id) {
  const game = getGame(id);
  if (!game) return renderNotFound('Cette borne n’existe pas — ou plus.');

  setTitle(game.name);
  setLastGame(id);
  let diff = getDifficulty(id);
  const best = getBestLabel(id, diff);

  // The stage (bar, screen, readout, pad) is sized to the viewport on phones so
  // nothing needs scrolling mid-game; options and help sit below it.
  render(`
    <section class="play" style="--ink: ${game.ink}">
      <div class="play-stage">
        <div class="play-bar">
          <a class="back-link" href="#/games" aria-label="Toutes les bornes">Bornes</a>
          <h1 class="play-title">${esc(game.name)}</h1>
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

      <p class="help-text" id="help-text"></p>
    </section>
  `);

  const canvas = app.querySelector('#game-canvas');
  const screenEl = app.querySelector('#screen');

  // Contain-fit the canvas in its screen at any size, up or down. The games map
  // pointer coordinates from the canvas box, so it must stay undistorted.
  function fit() {
    const s = Math.min(screenEl.clientWidth / canvas.width, screenEl.clientHeight / canvas.height);
    canvas.style.width = `${Math.floor(canvas.width * s)}px`;
    canvas.style.height = `${Math.floor(canvas.height * s)}px`;
    canvas.style.imageRendering = s >= 1 ? 'pixelated' : 'auto'; // crisp upscale; no dropped lines downscaled
  }
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

  const coarse = matchMedia('(pointer: coarse)').matches;
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
    showOverlay(
      won ? 'Gagné' : 'Partie terminée',
      `<span class="final-score">${esc(shown)}</span>
       <span class="overlay-sub">${esc(levelName(diff))}</span>${sign}`,
      'Rejouer',
      start,
      res.record ? 'Nouveau record' : res.rank >= 0 ? 'Top 5' : null,
      Number(score) > 0 ? String(shown) : null,
    );
    announce(`${won ? 'Gagné' : 'Partie terminée'}. Score : ${shown}.${res.record ? ' Nouveau record.' : ''}`);

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

    const { createGame } = await import(game.module);
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
    if (controller?.ownsKeyboard && !finished) return;   // Doom reads the whole keyboard itself
    if (e.key === 'Escape') {
      if (e.type === 'keydown') setPaused();
      return;
    }
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
  scores: renderScores,
  settings: renderSettings,
  about: renderAbout,
};

function renderNotFound(msg) {
  setTitle('Introuvable');
  render(`
    <header class="page-head">
      <span class="eyebrow">Erreur 404</span>
      <h1 class="page-title">Page introuvable</h1>
    </header>
    <p class="intro-lede">${esc(msg)}</p>
    <div class="intro-actions">
      <a class="btn btn-primary" href="#/games">Voir les bornes</a>
      <a class="btn" href="#/">Accueil</a>
    </div>
  `);
}

const scrollMemo = new Map();   // where each page was scrolled to, so Back returns you to your place in the catalogue
let backNav = false;

function route() {
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  const name = parts[0] || '';
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

