(() => {
  class HaloAudioPreloader {
    constructor(audio) {
      this.audio = audio;
      this.primarySource = "";
      this.connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      this.onConditionsChange = () => {
        this.syncPrimary();
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
      if (document.hidden || navigator.onLine === false || connection?.saveData
        || navigator.deviceMemory <= 2 || navigator.hardwareConcurrency <= 2) return "none";
      if (["slow-2g", "2g", "3g"].includes(connection?.effectiveType)
        || (navigator.maxTouchPoints > 0 && !connection)) return "none";
      return "metadata";
    }

    prepare(sources) {
      const first = sources.map(value => {
        try {
          const raw = String(value || "").trim();
          if (!raw || raw.startsWith("//") || raw.includes("\\")) return "";
          const url = new URL(raw, window.location.origin);
          return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
        } catch {
          return "";
        }
      }).find(Boolean);
      if (first === this.primarySource) return;
      if (this.audio.getAttribute("src") && !this.primarySource) return;
      this.clear();
      // Only known public static audio may be requested before a play gesture.
      if (!first) return;
      const url = new URL(first);
      if (url.origin !== window.location.origin || url.search || url.hash
        || !/^\/audio\/[\w/-]+\.(?:mp3|m4a|aac|ogg|wav|flac|webm)$/i.test(url.pathname)) return;
      this.primarySource = first;
      this.syncPrimary();
    }

    syncPrimary() {
      if (!this.primarySource) return;
      const policy = this.policy();
      if (this.audio.getAttribute("src") && this.audio.src !== this.primarySource) {
        this.claim();
        return;
      }
      if (this.audio.src === this.primarySource && this.audio.preload === policy) return;
      const sameSource = this.audio.src === this.primarySource;
      if (sameSource && policy === "none") this.release(this.audio);
      this.audio.preload = policy;
      if (this.audio.src !== this.primarySource) this.audio.src = this.primarySource;
      try {
        if (policy !== "none") this.audio.load();
      } catch {
        this.audio.removeAttribute("src");
      }
    }

    claim() {
      this.primarySource = "";
    }

    release(audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    clear() {
      if (this.primarySource) {
        this.claim();
        this.release(this.audio);
      }
    }

  }

  window.HaloAudioPreloader = HaloAudioPreloader;
})();
