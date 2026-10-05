// Offline play. The shell is cached on install, together with every game module
// and cover read straight from the catalogue — so adding a borne can no longer
// forget to update this file. After install the network is tried first, and the
// cache answers when there is none.
// Freedoom's 28 MB WAD is left out on purpose: it lands in the cache the first
// time someone plays that borne, so only players who want it pay for it.
const CACHE = 'mini-arcade-v7';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/audio.js',
  'js/catalog.js',
  'js/storage.js',
  'img/og.png',
  'img/icons/apple-touch-icon.png',
  'img/icons/icon-192.png',
  'img/icons/icon-512.png',
  'img/icons/maskable-512.png',
];

/** One module and one cover per borne, taken from the catalogue itself. */
async function gameFiles() {
  try {
    const src = await (await fetch('js/catalog.js', { cache: 'reload' })).text();
    const ids = [...src.matchAll(/^\s+id: '([^']+)'/gm)].map((m) => m[1]);
    return ids.flatMap((id) => [`js/games/${id}.js`, `img/games/${id}.png`]);
  } catch {
    return [];   // offline on the very first visit: the runtime cache will fill in
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const files = [...SHELL, ...await gameFiles()];
    // One file per request, not addAll: a missing cover must cost its own borne's
    // picture, never the whole offline install.
    await Promise.allSettled(files.map((f) => cache.add(new Request(f, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
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
