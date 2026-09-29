/**
 * HALO audio-optimized PWA service worker.
 *
 * This worker is additive to the primary app-shell worker at `/sw.js` and is
 * intended to be registered with a dedicated scope (for example
 * `navigator.serviceWorker.register("/public/sw.js", { scope: "/public/" })`
 * from an audio-playback surface) so it does not interfere with the existing
 * navigation caching behaviour already provided by `/sw.js`.
 *
 * Caching strategy:
 *  - Audio mixes/tracks: cache-first. Once a track has been streamed it is
 *    served from the cache on subsequent requests (including HTTP Range
 *    requests used for seeking), enabling offline playback.
 *  - Dynamic app/API assets (JSON responses, `/api/*` calls): network-first,
 *    falling back to the last successfully cached response when offline.
 */
const AUDIO_CACHE_NAME = "halo-audio-cache-v1";
const APP_CACHE_NAME = "halo-app-assets-v1";
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"];
// Cap the offline audio cache so it can't grow without bound and exhaust
// device storage; oldest cached tracks are evicted first (FIFO/LRU-ish,
// since Cache API iteration order reflects insertion order).
const MAX_AUDIO_CACHE_ENTRIES = 60;

/**
 * @param {Request} request
 * @returns {boolean}
 */
function isAudioRequest(request) {
  if (request.destination === "audio") return true;
  try {
    const { pathname } = new URL(request.url);
    return AUDIO_EXTENSIONS.some((extension) => pathname.toLowerCase().endsWith(extension));
  } catch {
    return false;
  }
}

/**
 * @param {Request} request
 * @returns {boolean}
 */
function isDynamicAppRequest(request) {
  if (request.method !== "GET") return false;
  try {
    const { pathname } = new URL(request.url);
    return pathname.startsWith("/api/") || pathname.endsWith(".json");
  } catch {
    return false;
  }
}

async function trimAudioCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_AUDIO_CACHE_ENTRIES;
  if (overflow <= 0) return;
  // Cache.keys() returns entries in insertion order, so the oldest cached
  // tracks are evicted first once the cap is exceeded.
  await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
}

async function cacheFirstAudio(request) {
  const cache = await caches.open(AUDIO_CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;

  const response = await fetch(request);
  // Only cache complete (200) responses; partial (206) range responses are
  // still returned to the client but not stored so the cache always holds a
  // full, seekable copy of the track.
  if (response && response.ok && response.status === 200) {
    cache
      .put(request, response.clone())
      .then(() => trimAudioCache(cache))
      .catch(() => undefined);
  }
  return response;
}

async function networkFirstAppAsset(request) {
  const cache = await caches.open(APP_CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![AUDIO_CACHE_NAME, APP_CACHE_NAME].includes(key) && key.startsWith("halo-audio"))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (isAudioRequest(request)) {
    event.respondWith(cacheFirstAudio(request));
    return;
  }

  if (isDynamicAppRequest(request)) {
    event.respondWith(networkFirstAppAsset(request));
  }
});

// Allow pages to drive Media Session playback state (play/pause/seek) via
// postMessage so background audio controls stay in sync while this worker
// manages offline caching.
self.addEventListener("message", (event) => {
  const { data } = event;
  if (!data || data.type !== "HALO_MEDIA_SESSION_STATE") return;
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      clients.forEach((client) => client.postMessage(data));
    })
  );
});
