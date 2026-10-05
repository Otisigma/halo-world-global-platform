(() => {
  const CACHE_LIMIT = 4;
  const METADATA_TIMEOUT_MS = 8000;

  class HaloAudioPreloader {
    constructor(audio) {
      this.audio = audio;
      this.cache = new Map();
      this.pending = [];
      this.active = null;
      this.scheduled = null;
      this.primarySource = "";
      this.connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      this.onConditionsChange = () => {
        this.cancelBackground();
        if (document.hidden || this.policy() !== "auto") this.releaseCache();
        this.syncPrimary();
        this.schedule();
      };
      this.onPageHide = () => this.clear();
      window.addEventListener("load", this.onConditionsChange);
      window.addEventListener("online", this.onConditionsChange);
      window.addEventListener("offline", this.onConditionsChange);
      window.addEventListener("pagehide", this.onPageHide);
      document.addEventListener("visibilitychange", this.onConditionsChange);
      this.connection?.addEventListener?.("change", this.onConditionsChange);
    }

    policy() {
      const connection = this.connection;
      if (navigator.onLine === false || connection?.saveData) return "none";
      if (["slow-2g", "2g", "3g"].includes(connection?.effectiveType)
        || (navigator.maxTouchPoints > 0 && !connection)) return "metadata";
      return "auto";
    }

    prepare(sources) {
      this.clear();
      const urls = [...new Set(sources.map(value => {
        try {
          const raw = String(value || "").trim();
          if (!raw || raw.startsWith("//") || raw.includes("\\")) return "";
          const url = new URL(raw, window.location.origin);
          return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
        } catch {
          return "";
        }
      }).filter(Boolean))];
      const first = urls.shift();
      // Warm the real player element so the first click does not discard its buffer.
      if (first && !this.audio.getAttribute("src")) {
        this.primarySource = first;
        this.syncPrimary();
      }
      this.pending = urls;
      this.schedule();
    }

    syncPrimary() {
      if (!this.primarySource) return;
      const policy = document.hidden ? "none" : this.policy();
      if (this.audio.getAttribute("src") && this.audio.src !== this.primarySource) {
        this.claim();
        return;
      }
      if (this.audio.src === this.primarySource && this.audio.preload === policy) return;
      if (this.audio.getAttribute("src")) this.release(this.audio);
      this.audio.preload = policy;
      this.audio.src = this.primarySource;
      try {
        if (policy !== "none") this.audio.load();
      } catch {
        this.audio.removeAttribute("src");
      }
    }

    claim() {
      this.primarySource = "";
    }

    schedule() {
      if (this.scheduled || this.active || !this.pending.length
        || document.readyState !== "complete" || document.hidden || this.policy() !== "auto") return;
      const run = () => {
        this.scheduled = null;
        if (document.hidden || this.policy() !== "auto") return;
        this.warmNext();
      };
      if (typeof window.requestIdleCallback === "function" && typeof window.cancelIdleCallback === "function") {
        this.scheduled = { id: window.requestIdleCallback(run, { timeout: 2000 }), idle: true };
      } else {
        this.scheduled = { id: window.setTimeout(run, 1000), idle: false };
      }
    }

    warmNext() {
      const src = this.pending.shift();
      if (!src) return;
      if (src === this.audio.src || this.cache.has(src)) {
        this.schedule();
        return;
      }
      while (this.cache.size >= CACHE_LIMIT) {
        const [oldSrc, oldAudio] = this.cache.entries().next().value;
        this.release(oldAudio);
        this.cache.delete(oldSrc);
      }
      const audio = document.createElement("audio");
      const finish = success => {
        if (this.active?.audio !== audio) return;
        window.clearTimeout(this.active.timer);
        audio.removeEventListener("loadedmetadata", onReady);
        audio.removeEventListener("suspend", onSuspend);
        audio.removeEventListener("error", onError);
        this.active = null;
        if (!success) {
          this.cache.delete(src);
          this.release(audio);
        }
        this.schedule();
      };
      // Metadata can arrive before the browser stops transferring media.
      const onReady = () => {
        if (audio.networkState === 1) finish(true);
      };
      const onSuspend = () => {
        if (audio.readyState >= 1) finish(true);
      };
      const onError = () => finish(false);
      this.active = {
        src, audio, onReady, onSuspend, onError,
        timer: window.setTimeout(onError, METADATA_TIMEOUT_MS)
      };
      this.cache.set(src, audio);
      audio.addEventListener("loadedmetadata", onReady);
      audio.addEventListener("suspend", onSuspend);
      audio.addEventListener("error", onError);
      audio.preload = "metadata";
      audio.src = src;
      try {
        audio.load();
      } catch {
        finish(false);
      }
    }

    release(audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    cancelBackground() {
      if (this.scheduled) {
        if (this.scheduled.idle) window.cancelIdleCallback(this.scheduled.id);
        else window.clearTimeout(this.scheduled.id);
        this.scheduled = null;
      }
      if (this.active) {
        const { src, audio, timer, onReady, onSuspend, onError } = this.active;
        window.clearTimeout(timer);
        audio.removeEventListener("loadedmetadata", onReady);
        audio.removeEventListener("suspend", onSuspend);
        audio.removeEventListener("error", onError);
        this.active = null;
        this.cache.delete(src);
        this.pending.unshift(src);
        this.release(audio);
      }
    }

    clear() {
      this.cancelBackground();
      this.pending = [];
      this.releaseCache();
      if (this.primarySource) {
        this.claim();
        this.release(this.audio);
      }
    }

    releaseCache() {
      for (const audio of this.cache.values()) this.release(audio);
      this.cache.clear();
    }
  }

  window.HaloAudioPreloader = HaloAudioPreloader;
})();
