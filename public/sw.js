// ---------------------------------------------------------------------------
// Service worker minimal de Détours :
// - à l'installation, on met en cache les assets statiques de l'app
//   (page, styles, script, manifeste, icônes, vendor MapLibre local) ;
// - stratégie cache-first pour ces assets (chargement instantané, hors-ligne) ;
// - stratégie network-first pour /api/ et /data/ (données toujours fraîches,
//   repli sur le cache si le réseau tombe) ;
// - skipWaiting + clients.claim pour activer le SW sans attendre.
// ---------------------------------------------------------------------------

const CACHE_NAME = 'detours-v1';

const STATIC_ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'sw.js',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'apple-touch-icon.png',
  'vendor/maplibre-gl.css',
  'vendor/maplibre-gl.js',
  'vendor/LICENSE.txt'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // On nettoie les anciens caches et on prend le contrôle des clients ouverts.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Les données dynamiques : network-first, repli sur le cache hors-ligne.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Assets statiques (même origine uniquement) : cache-first, puis réseau.
  if (event.request.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      }))
    );
  }
});
