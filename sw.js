const CACHE = 'nour-al-islam-v2'; // ⚠️ à incrémenter (v3, v4, ...) à chaque nouveau déploiement

self.addEventListener('install', e => {
  self.skipWaiting(); // active la nouvelle version sans attendre la fermeture de l'app
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/index.html'])));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()) // prend le contrôle immédiat des onglets déjà ouverts
  );
});

self.addEventListener('fetch', e => {
  // Page HTML : toujours vérifier le réseau en premier pour avoir la dernière version
  if (e.request.mode === 'navigate' || e.request.url.endsWith('/index.html') || e.request.url.endsWith('/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const resClone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, resClone));
          return res;
        })
        .catch(() => caches.match(e.request)) // hors-ligne : on retombe sur le cache
    );
    return;
  }

  // Autres ressources (images, css, etc.) : cache d'abord, réseau en secours
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
