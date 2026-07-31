const CACHE = 'train-v21';
const ASSETS = ['.', 'index.html', 'manifest.json', 'icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});
// network-first so a freshly programmed session always wins; cache fallback for dead zones
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).then(r => {
      if (e.request.method === 'GET' && r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
