// Selma's service worker: keeps a copy of the app so it opens offline.
// Network first, so a connected device always gets the latest version.

const CACHE = 'selma-v1';
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'selma.svg',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Ask the server whether Selma's own files have changed instead of trusting
  // the browser's stored copy, so an update shows on the first refresh.
  const ownFile = new URL(event.request.url).origin === self.location.origin;
  const request = ownFile ? new Request(event.request.url, { cache: 'no-cache' }) : event.request;
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Also keeps the web fonts, which come from another site.
        if (response.ok || response.type === 'opaque') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
