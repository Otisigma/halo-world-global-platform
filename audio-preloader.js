(() => {
  function createAudioPreloader() {
    const cache = new Map();
    const timers = new Set();
    let queue = [];
    let primary = null;
    let busy = false;
    let disposed = false;
    let waitingForLoad = null;
    const MAX_TRACKS = 6;

    function mediaUrl(value) {
      try {
        const url = new URL(value, window.location.origin);
        return value && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
      } catch {
        return "";
      }
    }

    function later(callback, delay) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
      return timer;
    }

    function cancel(timer) {
      window.clearTimeout(timer);
      timers.delete(timer);
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
      return !connection?.saveData && !["slow-2g", "2g", "3g"].includes(connection?.effectiveType);
    }

    function schedule() {
      if (disposed || busy || !queue.length || !backgroundAllowed()) return;
      busy = true;
      later(warmNext, 250);
    }

    function warmNext() {
      if (disposed || !backgroundAllowed()) {
        busy = false;
        return;
      }
      const url = queue.shift();
      if (!url) {
        busy = false;
        return;
      }
      let entry;
      try {
        const audio = new Audio();
        entry = { audio, owned: true, cleanup: null };
        cache.set(url, entry);
        let settled = false;
        const finish = failed => {
          if (settled) return;
          settled = true;
          entry.cleanup();
          if (failed) {
            cache.delete(url);
            release(entry);
          }
          busy = false;
          schedule();
        };
        const ready = () => finish(false);
        const failed = () => finish(true);
        const timer = later(failed, 5000);
        entry.cleanup = () => {
          cancel(timer);
          audio.removeEventListener("loadedmetadata", ready);
          audio.removeEventListener("error", failed);
        };
        entry.detach = () => finish(false);
        audio.addEventListener("loadedmetadata", ready);
        audio.addEventListener("error", failed);
        audio.preload = "metadata";
        audio.src = url;
        audio.load();
      } catch {
        if (entry) release(entry);
        cache.delete(url);
        busy = false;
        schedule();
      }
    }

    function clear() {
      queue = [];
      busy = false;
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      if (waitingForLoad) window.removeEventListener("load", waitingForLoad);
      waitingForLoad = null;
      primary?.cleanup?.();
      primary = null;
      for (const entry of cache.values()) release(entry);
      cache.clear();
    }

    function warmPlaylist(values, { primaryAudio } = {}) {
      if (disposed) return;
      clear();
      const urls = [...new Set(values.map(mediaUrl).filter(Boolean))].slice(0, MAX_TRACKS);
      if (!urls.length) return;
      let audio;
      try {
        audio = primaryAudio || new Audio();
      } catch {
        return;
      }
      primary = { audio, owned: !primaryAudio, cleanup: null };
      cache.set(urls[0], primary);
      queue = urls.slice(1);
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        primary?.cleanup?.();
        if (document.readyState === "complete") schedule();
        else {
          waitingForLoad = () => {
            waitingForLoad = null;
            schedule();
          };
          window.addEventListener("load", waitingForLoad, { once: true });
        }
      };
      primary.cleanup = () => {
        audio.removeEventListener("canplay", start);
        audio.removeEventListener("error", start);
      };
      primary.detach = start;
      audio.addEventListener("canplay", start);
      audio.addEventListener("error", start);
      if (!prepare(audio, urls[0]) || audio.readyState >= 3 || audio.error) start();
    }

    // Transfer ownership to playback so cache cleanup cannot pause an active listening room.
    function take(value) {
      const url = mediaUrl(value);
      const entry = cache.get(url);
      if (!entry?.owned || entry.audio.error) return null;
      cache.delete(url);
      entry.detach?.();
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
