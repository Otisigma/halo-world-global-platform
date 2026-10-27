(() => {
  function createAudioPreloader() {
    const cache = new Map();
    let primary = null;
    let disposed = false;

    function mediaUrl(value) {
      try {
        const url = new URL(value, window.location.origin);
        return value && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
      } catch {
        return "";
      }
    }

    function release(entry) {
      entry.cleanup?.();
      if (!entry.owned) return;
      try {
        entry.audio.pause();
        entry.audio.removeAttribute("src");
        entry.audio.load();
      } catch {}
    }

    // Keep the player's element (and all its listeners) intact; never reload a healthy buffer.
    function prepare(audio, value) {
      const url = mediaUrl(value);
      if (!audio || !url) return false;
      try {
        cache.get(url)?.cleanup?.();
        audio.preload = "auto";
        if (mediaUrl(audio.getAttribute("src")) !== url || audio.error) {
          audio.src = value;
          audio.load();
        }
        return true;
      } catch {
        return false;
      }
    }

    function backgroundAllowed() {
      const connection = window.navigator?.connection;
      return !document.hidden && window.navigator?.onLine !== false && !connection?.saveData
        && !(window.navigator?.deviceMemory <= 2) && !(window.navigator?.hardwareConcurrency <= 2)
        && !(window.navigator?.maxTouchPoints > 0 && !connection)
        && !["slow-2g", "2g", "3g"].includes(connection?.effectiveType);
    }

    function eligible(value) {
      const url = new URL(value);
      return url.origin === window.location.origin && !url.search && !url.hash
        && /^\/audio\/[\w/-]+\.(?:mp3|m4a|aac|ogg|wav|flac|webm)$/i.test(url.pathname);
    }

    function clear() {
      primary?.cleanup?.();
      primary = null;
      for (const entry of cache.values()) release(entry);
      cache.clear();
    }

    function warmPlaylist(values, { primaryAudio } = {}) {
      if (disposed) return;
      const url = values.map(mediaUrl).find(Boolean);
      if ((primary?.audio === primaryAudio || (!primaryAudio && primary?.owned))
        && cache.has(url) && !primary?.audio.error) return;
      clear();
      if (!url) return;
      let audio;
      try {
        audio = primaryAudio || new Audio();
      } catch {
        return;
      }
      primary = { audio, owned: !primaryAudio, cleanup: null };
      cache.set(url, primary);
      let claimed = false;
      const sync = () => {
        if (claimed) return;
        const allowed = backgroundAllowed() && eligible(url);
        const sameSource = mediaUrl(audio.getAttribute("src")) === url;
        const previousPreload = audio.preload;
        if (sameSource && audio.preload === (allowed ? "metadata" : "none")) return;
        if (sameSource && !allowed) {
          audio.removeAttribute("src");
          audio.load();
        }
        audio.preload = allowed ? "metadata" : "none";
        if (mediaUrl(audio.getAttribute("src")) !== url) audio.src = url;
        if (allowed && (!sameSource || previousPreload === "none")) {
          try { audio.load(); } catch {}
        }
      };
      const claim = () => { claimed = true; primary?.cleanup?.(); };
      const connection = window.navigator?.connection;
      primary.cleanup = () => {
        audio.removeEventListener("play", claim);
        document.removeEventListener?.("visibilitychange", sync);
        connection?.removeEventListener?.("change", sync);
        window.removeEventListener("online", sync);
        window.removeEventListener("offline", sync);
      };
      audio.addEventListener("play", claim);
      document.addEventListener?.("visibilitychange", sync);
      connection?.addEventListener?.("change", sync);
      window.addEventListener("online", sync);
      window.addEventListener("offline", sync);
      sync();
    }

    // Transfer ownership to playback so cache cleanup cannot pause an active listening room.
    function take(value) {
      const url = mediaUrl(value);
      const entry = cache.get(url);
      if (!entry?.owned || entry.audio.error) return null;
      cache.delete(url);
      entry.cleanup?.();
      return entry.audio;
    }

    function dispose() {
      disposed = true;
      clear();
      window.removeEventListener("pagehide", clear);
    }

    window.addEventListener("pagehide", clear);
    return { prepare, warmPlaylist, take, clear, dispose };
  }

  window.HaloAudioPreloader = Object.assign(createAudioPreloader(), { create: createAudioPreloader });
})();
