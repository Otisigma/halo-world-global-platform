(() => {
  const trackingDisabled = navigator.doNotTrack === "1" || window.doNotTrack === "1";
  const storageKey = "halo_anonymous_id";
  const sessionKey = "halo_session_id";

  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 18)}`;
  }

  function storedId(storage, key) {
    try {
      const existing = storage.getItem(key);
      if (existing) return existing;
      const id = createId();
      storage.setItem(key, id);
      return id;
    } catch {
      return createId();
    }
  }

  const anonymousId = storedId(window.localStorage, storageKey);
  const sessionId = storedId(window.sessionStorage, sessionKey);

  function track(eventName, metadata = {}) {
    if (trackingDisabled || typeof eventName !== "string") return;

    fetch("/api/stats/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventName,
        anonymousId,
        sessionId,
        pagePath: window.location.pathname,
        metadata
      }),
      credentials: "same-origin",
      keepalive: true
    }).catch(() => {});
  }

  window.haloStats = Object.freeze({ track });

  document.addEventListener("click", event => {
    const target = event.target.closest("[data-stat-event]");
    if (!target) return;
    track(target.dataset.statEvent, {
      target: target.dataset.statTarget || target.textContent.trim().slice(0, 80)
    });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => track("page_view"), { once: true });
  } else {
    track("page_view");
  }

  const playerStyles = document.createElement("link");
  playerStyles.rel = "stylesheet";
  playerStyles.href = "/music-player.css";
  document.head.append(playerStyles);

  const playerScript = document.createElement("script");
  playerScript.src = "/music-player.js";
  playerScript.defer = true;
  document.head.append(playerScript);
})();
