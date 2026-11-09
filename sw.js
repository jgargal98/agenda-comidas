'use strict';

// Bump this on every release so old caches are dropped.
const CACHE = 'carta-comidas-v16';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'js/main.js',
  'js/backup.js',
  'js/dates.js',
  'js/domain.js',
  'js/menu.js',
  'js/state.js',
  'js/sync.js',
  'js/today.js',
  'js/ui.js',
  'js/week.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stale-while-revalidate: answer from cache instantly (works offline)
// and refresh the cached copy in the background when there is network.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // The sync API must always reach the network: a cached answer would hide other devices' changes
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
