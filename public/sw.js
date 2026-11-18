// Offline: every game file goes into the cache on install and is served from it from then on.
// When any file in public/ changes, bump VERSION here and in core.js — otherwise devices stay on the old version.
// A new version installs in the background and takes over at once; the page reloads itself when it is safe to.
// Music is not part of a version: tracks go into their own cache when first played and stay there across versions.
const VERSION = '0.19.1';
const CACHE = `roll-v${VERSION}`;
const MUSIC_CACHE = 'roll-music-1';   // bump only if a track file changes
const ASSETS = [
  './',
  'index.html',
  'client.js',
  'audio.js',
  'core.js',
  'i18n.js',
  'lang/en.js',
  'lang/de.js',
  'lang/es.js',
  'lang/fr.js',
  'lang/it.js',
  'lang/ja.js',
  'lang/ko.js',
  'lang/nl.js',
  'lang/pl.js',
  'lang/pt.js',
  'lang/ru.js',
  'lang/tr.js',
  'lang/zh.js',
  'manifest.webmanifest',
  'manifest.de.webmanifest',
  'manifest.es.webmanifest',
  'manifest.fr.webmanifest',
  'manifest.it.webmanifest',
  'manifest.ja.webmanifest',
  'manifest.ko.webmanifest',
  'manifest.nl.webmanifest',
  'manifest.pl.webmanifest',
  'manifest.pt.webmanifest',
  'manifest.ru.webmanifest',
  'manifest.tr.webmanifest',
  'manifest.zh.webmanifest',
  'icons/favicon-64.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('roll-') && k !== CACHE && k !== MUSIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('/healthz')) return;
  if (url.pathname.includes('/music/')) {
    e.respondWith(caches.open(MUSIC_CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const r = await fetch(req.url);
      if (r.ok) e.waitUntil(c.put(req.url, r.clone()).catch(() => {}));   // the worker must not be stopped mid-write
      return r;
    }));
    return;
  }
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const page = await c.match('index.html');
        if (page) return page;
      }
      return fetch(req);
    }),
  );
});
