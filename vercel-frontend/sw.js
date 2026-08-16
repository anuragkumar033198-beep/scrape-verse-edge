/* App-shell cache, network-first for the shell files so a redeploy is
   never masked by a stale cache. CACHE_NAME is versioned — bump it on
   any future deploy where sw.js itself doesn't otherwise change, to
   force Chrome to detect an update and refresh the cache. */

const CACHE_NAME = "edge-console-shell-v2";
const SHELL_FILES = ["/index.html", "/style.css", "/app.js", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_FILES).catch((err) => {
        console.error("Shell cache failed:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API/socket calls to the Termux edge tunnel.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) {
    return;
  }

  // Network-first for the app shell: always try to get the latest
  // deployed version, and only fall back to the cache if the network
  // is unavailable (true offline case).
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
