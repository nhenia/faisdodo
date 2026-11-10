const CACHE="moyster-shell-v1";
const CORE=["./","./index.html","./manifest.webmanifest","./icon.svg","./moyster.js"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE).catch(()=>{})));self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",event=>{const request=event.request;if(request.method!=="GET"||new URL(request.url).origin!==self.location.origin)return;event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy))}return response}).catch(()=>caches.match(request).then(r=>r||caches.match("./index.html"))))});
