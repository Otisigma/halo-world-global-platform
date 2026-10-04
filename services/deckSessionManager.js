(function (global) {
  "use strict";

  // DJ deck session hygiene for HALO OS takeovers.
  // A takeover launch (e.g. /dj-deck.html?takeover=60) must begin with a clean deck:
  // persisted deck/queue snapshots are purged, Deck A/B memory is reset and the queued
  // playlist container is emptied. Pass restore=1 to explicitly keep the saved session.
  // UI preferences (collapsed panels, booth screen mode) are intentionally preserved.

  const DECK_SESSION_STORAGE_KEYS = Object.freeze(["halo.dj.session.v1"]);
  const RESTORE_VALUES = new Set(["1", "true", "yes", "session"]);

  function readParams(search) {
    if (search && typeof search === "object" && typeof search.get === "function") return search;
    try {
      return new URLSearchParams(typeof search === "string" ? search : "");
    } catch {
      return null;
    }
  }

  function isSessionRestoreRequested(search) {
    const params = readParams(search);
    if (!params) return false;
    return RESTORE_VALUES.has(String(params.get("restore") || "").trim().toLowerCase());
  }

  function getTakeoverMinutes(search) {
    const params = readParams(search);
    if (!params || !params.has("takeover")) return 0;
    const minutes = Number(params.get("takeover"));
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  }

  function shouldStartFreshTakeover(search) {
    return getTakeoverMinutes(search) > 0 && !isSessionRestoreRequested(search);
  }

  function resolveStorage(storage) {
    if (storage) return storage;
    try {
      return global.localStorage || null;
    } catch {
      return null;
    }
  }

  function clearDeckSession(options = {}) {
    const storage = resolveStorage(options.storage);
    const keys = Array.isArray(options.keys) && options.keys.length ? options.keys : DECK_SESSION_STORAGE_KEYS;
    const cleared = [];
    if (!storage || typeof storage.removeItem !== "function") return cleared;
    for (const key of keys) {
      try {
        const existed = typeof storage.getItem === "function" ? storage.getItem(key) !== null : true;
        storage.removeItem(key);
        if (existed) cleared.push(key);
      } catch {}
    }
    return cleared;
  }

  function createFreshDeckState() {
    return { decks: { A: null, B: null }, queue: [], playlist: [] };
  }

  function clearPlaylistContainers(containers) {
    let cleared = 0;
    for (const container of Array.isArray(containers) ? containers : [containers]) {
      if (!container) continue;
      if (typeof container.replaceChildren === "function") container.replaceChildren();
      else if ("innerHTML" in container) container.innerHTML = "";
      else continue;
      cleared += 1;
    }
    return cleared;
  }

  function initializeFreshTakeover(options = {}) {
    const clearedKeys = clearDeckSession(options);
    const clearedContainers = clearPlaylistContainers(options.playlistContainers);
    return { ...createFreshDeckState(), clearedKeys, clearedContainers, initializedAt: new Date().toISOString() };
  }

  global.HaloDeckSessionManager = Object.freeze({
    DECK_SESSION_STORAGE_KEYS,
    clearDeckSession,
    initializeFreshTakeover,
    createFreshDeckState,
    shouldStartFreshTakeover,
    isSessionRestoreRequested,
    getTakeoverMinutes
  });
})(typeof window !== "undefined" ? window : globalThis);
