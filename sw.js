const CACHE_NAME = "orbe-granada-v2-1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=2.1",
  "./app.js?v=2.1",
  "./pois.js?v=2.1",
  "./manifest.webmanifest",
  "./icons/orbe-192.png",
  "./icons/orbe-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Los mapas externos no pasan por el service worker: el navegador gestiona su caché.
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") return caches.match("./index.html");
        throw new Error("Recurso no disponible sin conexión");
      })
  );
});
