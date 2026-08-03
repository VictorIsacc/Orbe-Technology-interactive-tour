const ORBE_VERSION = "2.9";
const CACHE_PREFIX = "orbe-";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "ORBE_VERSION") event.source?.postMessage({ type: "ORBE_VERSION", version: ORBE_VERSION });
});

// Orbe v2.9: red directa, sin interceptar ni retener recursos.
