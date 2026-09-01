const CACHE_NAME = "control-financiero-v2";
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

// Estrategia "red primero": siempre intenta traer la versión más nueva.
// Solo usa la copia guardada si no hay internet. Así, cada vez que actualicemos
// la app, se ve reflejado de inmediato sin quedar pegado en una versión vieja.
self.addEventListener("fetch", (event) => {
  if (event.request.url.includes("/api/") || event.request.url.includes("firestore") || event.request.url.includes("googleapis")) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
