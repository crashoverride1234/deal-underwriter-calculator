const CACHE_NAME = 'underwriter-v20';

// Live data APIs — never cache these (autocomplete queries and property
// lookups must always be fresh, and caching every keystroke bloats storage)
const NETWORK_ONLY_HOSTS = ['api.rentcast.io', 'photon.komoot.io', 'parser-external.geo.moveaws.com', 'property.melissadata.net'];
const NETWORK_ONLY_SUFFIXES = ['.workers.dev']; // user-deployed data proxy
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './engine.js',
  './app.js',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Drop caches from previous versions so updates actually ship
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function fetchAndCache(request) {
  return fetch(request).then(response => {
    // Cache successful basic/cors responses and opaque CDN responses
    if (response && (response.ok || response.type === 'opaque')) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  });
}

// Same-origin: network-first so edits/updates ship immediately, cache as
// offline fallback. Cross-origin (CDN scripts, fonts): cache-first — those
// are pinned versions and this keeps them working offline.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (NETWORK_ONLY_HOSTS.includes(url.hostname)) return; // straight to network
  if (NETWORK_ONLY_SUFFIXES.some(s => url.hostname.endsWith(s))) return;
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    event.respondWith(
      fetchAndCache(event.request).catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetchAndCache(event.request))
    );
  }
});
