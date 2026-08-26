const CACHE_VERSION = "v3";
const SHELL_CACHE = `halo-app-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `halo-runtime-${CACHE_VERSION}`;
const APP_SHELL = [
  "/",
  "/app.webmanifest",
  "/accessibility.css",
  "/accessibility.js",
  "/halo-brand.css",
  "/mobile-navigation.css",
  "/mobile-navigation.js",
  "/stats.js",
  "/assets/halo-app-icon-192.png",
  "/assets/halo-app-icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("halo-") && ![SHELL_CACHE, RUNTIME_CACHE].includes(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const home = await caches.match("/");
      if (home) return home;
    }
    return new Response("HALO is temporarily offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

self.addEventListener("install", event => {
  event.waitUntil(
    Promise.resolve()
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/") || event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (["style", "script", "image", "font", "manifest"].includes(event.request.destination)) {
    event.respondWith(cacheFirst(event.request));
  }
});
