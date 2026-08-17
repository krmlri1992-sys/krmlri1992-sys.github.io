// QALAM — Service Worker
// Rend l'application utilisable hors ligne en mettant en cache
// la coquille de l'app (HTML/CSS/JS) et les librairies externes,
// et en gardant en cache la dernière réponse connue des appels réseau
// (Firebase, horaires de prière, etc.) pour un affichage dégradé hors ligne.

const CACHE_VERSION = "qalam-cache-v2";

// Fichiers/ressources essentielles à précharger dès l'installation
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icône-192.png",
  "./icône-512.png",
  "./react.production.min.js",
  "./react-dom.production.min.js",
  "https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch(() => {
            // On ignore silencieusement une ressource qui échouerait
            // au préchargement (ex: hors ligne dès la 1ère installation)
          })
        )
      )
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // On ne gère que les requêtes GET
  if (request.method !== "GET") return;

  // 1) Navigation (chargement de la page elle-même) :
  //    réseau en priorité pour avoir la dernière version,
  //    repli sur le cache si hors ligne.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // 2) Ressources de la coquille (librairies CDN, manifest, icône) :
  //    cache en priorité, réseau en secours.
  const isShellAsset = APP_SHELL.some((asset) => request.url.includes(asset.replace("./", "")));
  if (isShellAsset) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  // 3) Tout le reste (API Firebase, horaires de prière Aladhan, etc.) :
  //    réseau en priorité pour avoir des données à jour,
  //    mais on garde toujours la dernière réponse en cache
  //    pour pouvoir l'afficher si l'utilisateur passe hors ligne.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && request.url.startsWith("http")) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
