const CACHE_NAME = "control-financiero-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Nunca cachear llamadas a la API o a Firestore: siempre deben ir a la red.
  if (event.request.url.includes("/api/") || event.request.url.includes("firestore")) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
