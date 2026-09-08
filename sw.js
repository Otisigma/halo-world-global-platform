import { CANONICAL_HOME_ROUTE, canonicalizeRoutePath } from "./lib/route-registry.js";

const CACHE_NAME = "halo-app-shell-v4";
const APP_SHELL = [
  CANONICAL_HOME_ROUTE,
  "/app.webmanifest",
  "/mobile-navigation.css",
  "/mobile-navigation.js",
  "/assets/halo-app-icon-192.png",
  "/assets/halo-app-icon-512.png"
];

function cacheKeyForNavigation(requestOrUrl) {
  const url = new URL(typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.url, self.location.origin);
  url.hash = "";
  url.pathname = canonicalizeRoutePath(url.pathname);
  return url.toString();
}

const HOME_CACHE_KEY = cacheKeyForNavigation(CANONICAL_HOME_ROUTE);

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("halo-app-shell-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate" || event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then(async response => {
        if (!response.ok || response.type !== "basic") return response;
        const cache = await caches.open(CACHE_NAME);
        await cache.put(cacheKeyForNavigation(event.request), response.clone());
        return response;
      })
      .catch(async () => {
        const cachedPage = await caches.match(cacheKeyForNavigation(event.request));
        const cachedHome = await caches.match(HOME_CACHE_KEY);
        return cachedPage || cachedHome || new Response("HALO is temporarily offline.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      })
  );
});
