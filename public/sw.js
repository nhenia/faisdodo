const CACHE = "faisdodo-pages-v1"; // own name + prefix: Moyster lives on the same github.io address
const BASE = new URL(self.registration.scope).pathname;
const SHELL = ["", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"].map(p => BASE + p);
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("faisdodo-") && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req).then(response => {
      if (response.ok && (req.mode === "navigate" || /\.(?:css|js|png|jpe?g|webp|svg|webmanifest)$/.test(new URL(req.url).pathname))) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(req, copy)));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === "navigate") {
        const fallback = await caches.match(BASE);
        if (fallback) return fallback;
      }
      return Response.error();
    })
  );
});
