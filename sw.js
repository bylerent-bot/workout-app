const CACHE = 'train-v24';
const ASSETS = ['.', 'index.html', 'manifest.json', 'icon.png',
  'data/sessions.json', 'data/equipment.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.startsWith('train-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// Same-origin static GETs only: network-first (fresh sessions win), cache fallback
// for dead zones. Data JSONs cache under a canonical URL so the app's cache-busting
// query param still hits the cached copy offline. The private worker pipe
// (cross-origin, authed) is never cached.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const canonical = url.origin + url.pathname; // strip ?_=timestamp
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(canonical, copy));
      }
      return r;
    }).catch(() => caches.match(canonical, {ignoreSearch: true}))
  );
});
