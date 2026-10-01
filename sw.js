// Offline play. Everything the site needs is cached on install; after that the
// network is tried first so a new version lands at once, and the cache answers
// when there is no network. Adding a game? Add its module and image below.
// Freedoom's 28 MB WAD is left out of the install on purpose: it is cached the
// first time someone plays it, so only players who want it pay for it.
const CACHE = 'mini-arcade-v3';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'img/games/2048.png',
  'img/games/asteroids.png',
  'img/games/breakout.png',
  'img/games/centipede.png',
  'img/games/connect4.png',
  'img/games/doom.png',
  'img/games/flappy.png',
  'img/games/frogger.png',
  'img/games/galaxian.png',
  'img/games/invaders.png',
  'img/games/lander.png',
  'img/games/lightcycles.png',
  'img/games/memory.png',
  'img/games/minesweeper.png',
  'img/games/missile.png',
  'img/games/pacman.png',
  'img/games/pong.png',
  'img/games/simon.png',
  'img/games/snake.png',
  'img/games/tetris.png',
  'img/icons/apple-touch-icon.png',
  'img/icons/icon-192.png',
  'img/icons/icon-512.png',
  'img/icons/maskable-512.png',
  'js/app.js',
  'js/audio.js',
  'js/catalog.js',
  'js/games/2048.js',
  'js/games/asteroids.js',
  'js/games/breakout.js',
  'js/games/centipede.js',
  'js/games/connect4.js',
  'js/games/doom.js',
  'js/games/doom/engine.js',
  'js/games/doom/engine.wasm',
  'js/games/flappy.js',
  'js/games/frogger.js',
  'js/games/galaxian.js',
  'js/games/invaders.js',
  'js/games/lander.js',
  'js/games/lightcycles.js',
  'js/games/memory.js',
  'js/games/minesweeper.js',
  'js/games/missile.js',
  'js/games/pacman.js',
  'js/games/pong.js',
  'js/games/simon.js',
  'js/games/snake.js',
  'js/games/tetris.js',
  'js/storage.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
