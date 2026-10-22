/**
 * WPipe Studio - Offline Cache Service Worker
 * Author: William Rodriguez (wisrovi.dev)
 */

const CACHE_NAME = "wpipe-studio-cache-v1";
const OFFLINE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(OFFLINE_URLS).catch((err) => {
        console.warn("[SW] Cache addAll warning:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never cache requests to localhost or the wpipe-engine API
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.port === "49152") {
    return;
  }

  // Network first with cache fallback for static app assets
  if (request.method === "GET") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          if (request.mode === "navigate") {
            return caches.match("./index.html") || caches.match("./");
          }
          return new Response("Offline", { status: 503, statusText: "Offline" });
        })
    );
  }
});
