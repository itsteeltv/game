import { GAMES, getGame, stars, glyphSVG } from './catalog.js';
import {
  getSettings, setSettings, saveScore, getHighScores, getBestLabel, getAnyBest,
  getDifficulty, setDifficulty, markPlayed, hasPlayed, getLastGame,
  resetAllData, setLastGame, LEVELS, levelName,
} from './storage.js';
import { sfx, beep } from './audio.js';

const app = document.getElementById('app');
const themeBtn = document.getElementById('theme-toggle');
const soundBtn = document.getElementById('sound-toggle');

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
  const dark = s.theme === 'dark';
  themeBtn.textContent = dark ? '◐' : '◑';
  themeBtn.setAttribute('aria-label', dark ? 'Passer en thème clair' : 'Passer en thème sombre');
  soundBtn.textContent = s.sfx ? '🔊' : '🔇';
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

function render(html) {
  teardown();
  renderToken++;
  app.innerHTML = html;
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

/* --- Cabinet partials ---------------------------------------------------- */

/** The game's own screen, captured from a real run (img/games/<id>.png).
    The glyph underneath shows through if a new game has no capture yet. */
function art(g) {
  return `
    <span class="art">
      ${glyphSVG(g, 44)}
      <img src="img/games/${g.id}.png" alt="" loading="lazy" decoding="async" onerror="this.remove()">
    </span>`;
}

/** A game card. The whole tile is the link — one tap, one game. */
function cabTile(g) {
  const d = getDifficulty(g.id);
  const best = getBestLabel(g.id, d);
  return `
    <a class="tile" href="#/game/${g.id}" style="--ink: ${g.ink}" aria-label="Jouer à ${esc(g.name)}">
      ${art(g)}
      <span class="tile-info">
        <span class="tile-name">${esc(g.name)}${hasPlayed(g.id) ? '<i class="played" aria-hidden="true"></i>' : ''}</span>
        <span class="tile-meta">${esc(g.category)} · ${best === null ? stars(g.difficulty) : `record ${esc(fmtScore(best))}`}</span>
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
  render(`
    <section class="hero">
      <div class="intro">
        <span class="eyebrow">${bornes()} · rien à installer</span>
        <h1 class="page-title">Une salle d’arcade dans ton navigateur</h1>
        <p class="intro-lede">
          ${COUNT} classiques réécrits de zéro — Pong, Tetris, Démineur, Serpent…
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
      ${art(g)}
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
  const categories = ['Tous', ...new Set(GAMES.map((g) => g.category))];
  let query = '';
  let filter = 'Tous';

  render(`
    <header class="page-head">
      <span class="eyebrow">Catalogue</span>
      <h1 class="page-title">Choisis ta borne</h1>
    </header>
    <div class="toolbar">
      <input type="search" id="search" placeholder="Chercher une borne…" aria-label="Chercher une borne par nom">
      ${categories.map((c) => `
        <button class="filter-chip${c === 'Tous' ? ' active' : ''}" type="button"
                data-cat="${esc(c)}" aria-pressed="${c === 'Tous'}">${esc(c)}</button>
      `).join('')}
    </div>
    <div class="tile-grid" id="games-grid"></div>
    <p class="eyebrow" id="result-count" role="status" style="margin-top:1.5rem"></p>
  `);

  const grid = app.querySelector('#games-grid');
  const count = app.querySelector('#result-count');

  function paint() {
    const q = query.trim().toLowerCase();
    const hits = GAMES.filter((g) => (
      (filter === 'Tous' || g.category === filter) &&
      (g.name.toLowerCase().includes(q) || g.category.toLowerCase().includes(q))
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

  app.querySelectorAll('.filter-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.cat;
      app.querySelectorAll('.filter-chip').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      paint();
    });
  });
}

/* --- Scores -------------------------------------------------------------- */

function renderScores() {
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });

  const played = GAMES.filter((g) => hasPlayed(g.id));
  const withScore = GAMES.filter((g) => getAnyBest(g.id) !== null);
  const total = withScore.reduce((sum, g) => sum + (getAnyBest(g.id) || 0), 0);

  render(`
    <header class="page-head">
      <span class="eyebrow">Sauvegardé sur cette machine</span>
      <h1 class="page-title">Meilleurs scores</h1>
    </header>

    <div class="summary">
      <div class="summary-tile"><dt>Bornes essayées</dt><dd>${played.length} / ${COUNT}</dd></div>
      <div class="summary-tile"><dt>Bornes classées</dt><dd>${withScore.length}</dd></div>
      <div class="summary-tile"><dt>Cumul des records</dt><dd>${fmtScore(total)}</dd></div>
    </div>

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
  const s = getSettings();

  render(`
    <header class="page-head">
      <span class="eyebrow">Stocké dans ce navigateur</span>
      <h1 class="page-title">Réglages</h1>
    </header>
    <div class="settings-list">
      <div class="settings-row">
        <span class="label"><b>Thème sombre</b><span>Décoché, le site passe en thème clair. L’écran de jeu reste noir.</span></span>
        <span class="switch"><input type="checkbox" id="set-theme" ${s.theme === 'dark' ? 'checked' : ''}><span class="slider"></span></span>
      </div>
      <div class="settings-row">
        <span class="label"><b>Effets sonores</b><span>Sons générés à la volée, aucun fichier téléchargé.</span></span>
        <span class="switch"><input type="checkbox" id="set-sfx" ${s.sfx ? 'checked' : ''}><span class="slider"></span></span>
      </div>
      <div class="settings-row">
        <label class="label" for="set-volume"><b>Volume</b><span id="vol-read" class="data">${Math.round(s.volume * 100)} %</span></label>
        <input type="range" id="set-volume" min="0" max="1" step="0.05" value="${s.volume}">
      </div>
      <div class="settings-row">
        <span class="label"><b>Animations</b><span>Décoché, les transitions et les effets de survol s’arrêtent.</span></span>
        <span class="switch"><input type="checkbox" id="set-anim" ${s.animations ? 'checked' : ''}><span class="slider"></span></span>
      </div>
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
  render(`
    <header class="page-head">
      <span class="eyebrow">Comment c'est fait</span>
      <h1 class="page-title">À propos</h1>
    </header>
    <div class="prose">
      <p>Mini Arcade est un site entièrement statique : pas de serveur, pas de base de données, pas de compte. Tout tourne dans ton navigateur, et les scores vivent dans le <code>localStorage</code> de ta machine.</p>

      <h2>Vie privée</h2>
      <p>Aucune collecte, aucun tracker, aucune dépendance externe. Rien ne sort du navigateur — et « Effacer les données locales », dans les réglages, efface vraiment tout.</p>

      <h2>Les graphismes</h2>
      <p>Chaque borne a sa couleur d'encre et son pictogramme, dessinés pour ce site. Rien n'est repris des jeux d'origine : ce sont des hommages au principe, pas des copies.</p>

      <h2>Ajouter une borne</h2>
      <p>Un jeu est un module autonome de <code>js/games/</code> qui exporte <code>createGame(canvas, host)</code> et renvoie <code>start</code>, <code>togglePause</code>, <code>input</code> et <code>destroy</code>. Il reçoit <code>host.onStats</code> pour l'afficheur, <code>host.onGameOver</code> pour la fin de partie et <code>host.sfx</code> pour le son.</p>
      <p>Une fois le module écrit, ajoute son entrée dans <code>js/catalog.js</code> — nom, encre, pictogramme, genre, difficulté. Le reste du site s'adapte, et le jeu n'est téléchargé qu'au moment où on le lance.</p>
    </div>
  `);
}

/* --- Game page ----------------------------------------------------------- */

function renderGamePage(id) {
  const game = getGame(id);
  if (!game) { location.hash = '#/games'; return; }

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
          <button class="btn btn-sm" type="button" id="pause-btn">Pause</button>
        </div>

        <div class="screen" id="screen">
          <canvas id="game-canvas" width="480" height="360" aria-label="Zone de jeu ${esc(game.name)}"></canvas>
          <div class="game-overlay" id="overlay">
            <p class="overlay-badge" id="overlay-badge" hidden>Nouveau record</p>
            <p class="overlay-title" id="overlay-title">Prêt ?</p>
            <p id="overlay-text">${esc(game.description)}</p>
            <button class="btn btn-primary" type="button" id="overlay-btn">Démarrer</button>
          </div>
        </div>

        <dl class="readout">
          <div><dt>Score</dt><dd id="stat-score">0</dd></div>
          <div><dt>Niveau</dt><dd id="stat-level">1</dd></div>
          <div id="lives-wrap" hidden><dt>${esc(game.livesLabel || 'Vies')}</dt><dd id="stat-lives">—</dd></div>
          <div><dt>Record</dt><dd id="stat-best">${best === null ? '—' : esc(fmtScore(best))}</dd></div>
        </dl>

        <div class="touch-controls" id="touch-controls"></div>
      </div>

      <div class="play-options">
        ${diffControl(id, 'game', diff)}
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
  const overlayBtn = app.querySelector('#overlay-btn');
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
    : `${game.keys} <kbd>Échap</kbd> met en pause.`;

  let controller = null;
  let paused = false;
  let finished = false;

  function onStats({ score, level, lives } = {}) {
    if (score !== undefined) statScore.textContent = fmtScore(score);
    if (level !== undefined) statLevel.textContent = level;
    if (lives !== undefined) { livesWrap.hidden = false; statLives.textContent = lives; }
  }

  function showOverlay(title, text, btnLabel, onClick, record = false) {
    badge.hidden = !record;
    overlayTitle.textContent = title;
    overlayText.innerHTML = text;
    overlayBtn.textContent = btnLabel;
    overlayBtn.onclick = onClick;
    overlay.hidden = false;
  }

  function onGameOver(score, won, display = null) {
    finished = true;
    paused = false;
    pauseBtn.textContent = 'Pause';
    const isRecord = saveScore(id, score, game.higherIsBetter, display, diff);
    markPlayed(id);
    const b = getBestLabel(id, diff);
    statBest.textContent = b === null ? '—' : fmtScore(b);
    if (won) sfx.win(); else sfx.gameover();
    showOverlay(
      won ? 'Gagné' : 'Partie terminée',
      `<span class="final-score">${esc(fmtScore(display ?? score))}</span>
       <span class="overlay-sub">${esc(levelName(diff))}</span>`,
      'Rejouer',
      start,
      isRecord,
    );
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
    controller = createGame(canvas, { onStats, onGameOver, sfx, tone: beep }, { difficulty: diff });
    fit(); // each game sets its own canvas size
    controller.start();
    markPlayed(id);
  }

  function setPaused(next) {
    if (!controller || finished) return;
    paused = controller.togglePause();
    pauseBtn.textContent = paused ? 'Reprendre' : 'Pause';
    if (paused) {
      showOverlay('Pause', 'La partie reprend là où tu l\'as laissée.', 'Reprendre', () => setPaused());
    } else {
      overlay.hidden = true;
    }
  }

  overlayBtn.addEventListener('click', start);
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

  function onKey(e) {
    if (e.key === 'Escape') {
      if (e.type === 'keydown') setPaused();
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
      resizer.disconnect();
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

function route() {
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  if (parts[0] === 'game' && parts[1]) renderGamePage(parts[1]);
  else (ROUTES[parts[0] || ''] || renderHome)();
  window.scrollTo(0, 0);   // a game opened from deep in the grid must start at its stage
}

window.addEventListener('hashchange', route);
applySettings();
route();
