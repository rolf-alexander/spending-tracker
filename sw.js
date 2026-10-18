// Service worker: keeps a copy of the app's files on the phone so it opens offline.
// IMPORTANT: when you change any app file, increase VERSION so phones download the update.

const VERSION = '1.0.0';
const CACHE = `spending-${VERSION}`;

const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/rates.js',
  'js/util.js',
  'js/store.js',
  'js/csv.js',
  'js/charts.js',
  'js/theme.js',
  'js/views/common.js',
  'js/views/dashboard.js',
  'js/views/editor.js',
  'js/views/list.js',
  'js/views/trips.js',
  'js/views/settings.js',
  'js/views/importer.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  // `reload` skips the browser's HTTP cache so we always store the newest files.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('spending-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The app asks the new version to take over when you tap "Update".
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // Only handle the app's own files. Exchange-rate requests go straight to the internet.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) || fetch(req);
    }
    return (await cache.match(req, { ignoreSearch: true })) || fetch(req);
  })());
});
