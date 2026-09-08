const CACHE_NAME = "halo-app-shell-v4";
const APP_SHELL = [
  "/halo",
  "/app.webmanifest",
  "/mobile-navigation.css",
  "/mobile-navigation.js",
  "/assets/halo-app-icon-192.png",
  "/assets/halo-app-icon-512.png"
];

const CANONICAL_ROUTE_REDIRECTS = new Map([
  ["/artists", "/artists/"],
  ["/artist-pro", "/artist-pro/"],
  ["/campaign-studio", "/campaign-studio/"],
  ["/creator-freedom", "/creator-freedom/"],
  ["/creators", "/creators/"],
  ["/dreamweaver", "/dreamweaver/"],
  ["/dreamweaver-lab", "/dreamweaver-lab/"],
  ["/finish-house", "/finish-house/"],
  ["/iam-social", "/iam-social/"],
  ["/mixes", "/mixes/"],
  ["/music", "/music/"],
  ["/radio", "/radio/"],
  ["/release-house", "/release-house/"],
  ["/signal", "/signal-network/"],
  ["/song-catalog", "/song-catalog/"],
  ["/support", "/support/"],
  ["/youtube-studio", "/youtube-studio/"],
  ["/dj-deck", "/dj-deck.html"],
  ["/halo-command", "/halo-command.html"],
  ["/halo-live", "/halo-live.html"],
  ["/halo-x", "/halo-x.html"],
  ["/magazine", "/magazine.html"],
]);

const CANONICAL_FILE_REDIRECTS = new Map([
  ["/halo.html", "/halo"],
  ["/dreamweaver/index.html", "/dreamweaver/"],
  ["/mixes/index.html", "/mixes/"],
  ["/music/index.html", "/music/"],
  ["/radio/index.html", "/radio/"],
  ["/creators/index.html", "/creators/"],
]);

function canonicalNavigationPath(pathname = "/") {
  if (!pathname || pathname === "/" || pathname === "/halo/" || pathname === "/halo.html") return "/halo";
  if (pathname.endsWith("/index.html")) return pathname.replace(/index\.html$/, "");
  if (CANONICAL_FILE_REDIRECTS.has(pathname)) return CANONICAL_FILE_REDIRECTS.get(pathname);
  if (CANONICAL_ROUTE_REDIRECTS.has(pathname)) return CANONICAL_ROUTE_REDIRECTS.get(pathname);
  return pathname;
}

function cacheKeyForNavigation(requestOrUrl) {
  const url = new URL(typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.url, self.location.origin);
  url.hash = "";
  url.pathname = canonicalNavigationPath(url.pathname);
  return url.toString();
}

const HOME_CACHE_KEY = cacheKeyForNavigation("/halo");

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
    fetch(new Request(event.request, { cache: "no-store" }))
      .then(async response => {
        if (!response.ok || response.type !== "basic") return response;
        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        const cacheControl = (response.headers.get("cache-control") || "").toLowerCase();
        const canCache = contentType.includes("text/html") && !cacheControl.includes("no-store");
        if (!canCache) return response;
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
