const CACHE_NAME = "pinglet-shell-v17";
const APP_SHELL = ["/", "/style.css", "/app.js", "/vendor/socket.io.js", "/vendor/jsQR.js", "/terms.html", "/privacy.html", "/child-safety.html", "/delete-account.html", "/icon.svg", "/manifest.webmanifest"];
const NETWORK_FIRST_ASSETS = new Set(["/app.js", "/style.css", "/vendor/socket.io.js", "/vendor/jsQR.js"]);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return;
  if (["/health", "/readyz", "/livez"].includes(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { cache: "no-store" }).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put("/", copy));
      }
      return response;
    }).catch(async () => {
      const fallback = await caches.match("/");
      return fallback || new Response("Pinglet is offline. Reconnect and try again.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }));
    return;
  }

  if (NETWORK_FIRST_ASSETS.has(url.pathname)) {
    event.respondWith(fetch(request, { cache: "no-store" }).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(async () => {
      const fallback = await caches.match(request);
      return fallback || new Response("This Pinglet resource is unavailable offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }));
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
