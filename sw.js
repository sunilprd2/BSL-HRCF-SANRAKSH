const CACHE="sanraksh-v2";
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["./","./index.html","./styles.css","./app.js","./config.js","./manifest.webmanifest","./industrial-bg.jpg","./sanraksh-icon.png"]))));
self.addEventListener("fetch",e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));
