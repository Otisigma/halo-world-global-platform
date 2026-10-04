(function (global) {
  "use strict";

  // Strict upload-batch memory guard and silent Live Intelligence loader for the DJ deck.
  // TrackMemoryManager keeps only the most recently uploaded batch in booth memory and rejects
  // load requests for anything outside it. LiveIntelligenceSystem runs its search/load work with
  // the system UI audio bus held at volume 0 so UI cues and guide speech stay out of the room.
  // This is best-effort enforcement on the deck's own audio paths; it does not guarantee
  // absolute silence for audio produced outside the deck (other tabs, OS sounds, microphones).

  const LOG_PREFIX = "[HALO OS]";
  const LIVE_PREFIX = "[Live Intelligence]";
  const UNAUTHORIZED_MESSAGE = "Track not found in the current upload batch. Load aborted.";

  function normalizeId(value) {
    return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  }

  function resolveLogger(logger) {
    const base = logger || global.console || {};
    const noop = () => {};
    return {
      info: typeof base.info === "function" ? base.info.bind(base) : typeof base.log === "function" ? base.log.bind(base) : noop,
      warn: typeof base.warn === "function" ? base.warn.bind(base) : noop,
      error: typeof base.error === "function" ? base.error.bind(base) : noop
    };
  }

  class TrackMemoryManager {
    constructor(options = {}) {
      this.logger = resolveLogger(options.logger);
      this.now = typeof options.now === "function" ? options.now : () => Date.now();
      this.activeBatch = new Map();
      this.batchId = null;
      this.lockedAt = 0;
    }

    get size() {
      return this.activeBatch.size;
    }

    // Wipes any previous batch first, then locks in only the freshly uploaded tracks.
    lockUploadBatch(newTracks) {
      const previousSize = this.activeBatch.size;
      this.activeBatch = new Map();
      this.batchId = null;
      this.lockedAt = 0;
      if (previousSize) this.logger.info(`${LOG_PREFIX} Past booth memory cleared (${previousSize} track${previousSize === 1 ? "" : "s"}).`);

      const list = Array.isArray(newTracks) ? newTracks : [];
      list.forEach(track => {
        const id = normalizeId(track?.id);
        if (!id || this.activeBatch.has(id)) return;
        this.activeBatch.set(id, track);
      });
      if (this.activeBatch.size) {
        this.lockedAt = this.now();
        this.batchId = `upload-batch-${this.lockedAt}`;
      }
      this.logger.info(`${LOG_PREFIX} Upload batch locked. ${this.activeBatch.size} track${this.activeBatch.size === 1 ? "" : "s"} ready.`);
      return this.snapshot();
    }

    // Intercepts load requests so only tracks from the active upload batch reach a deck.
    getAuthorizedTrack(trackId) {
      const track = this.activeBatch.get(normalizeId(trackId));
      if (!track) {
        this.logger.warn(`${LOG_PREFIX} Blocked: attempted to load a track outside the current upload batch.`);
        return null;
      }
      return track;
    }

    isAuthorized(trackId) {
      return this.activeBatch.has(normalizeId(trackId));
    }

    release(trackId) {
      return this.activeBatch.delete(normalizeId(trackId));
    }

    clear() {
      this.activeBatch = new Map();
      this.batchId = null;
      this.lockedAt = 0;
    }

    list() {
      return [...this.activeBatch.values()];
    }

    snapshot() {
      return { batchId: this.batchId, lockedAt: this.lockedAt, size: this.activeBatch.size, trackIds: [...this.activeBatch.keys()] };
    }
  }

  class LiveIntelligenceSystem {
    constructor(audioController, memoryManager, options = {}) {
      if (!audioController || typeof audioController.setSystemUIVolume !== "function" || typeof audioController.loadTrackSilently !== "function") {
        throw new TypeError("LiveIntelligenceSystem needs an audio controller with setSystemUIVolume() and loadTrackSilently().");
      }
      if (!memoryManager || typeof memoryManager.getAuthorizedTrack !== "function") {
        throw new TypeError("LiveIntelligenceSystem needs a TrackMemoryManager.");
      }
      this.audioController = audioController;
      this.memoryManager = memoryManager;
      this.logger = resolveLogger(options.logger);
    }

    muteSystemUi() {
      try {
        this.audioController.setSystemUIVolume(0);
        return true;
      } catch (error) {
        this.logger.error(`${LIVE_PREFIX} Could not mute the system UI audio bus:`, error);
        return false;
      }
    }

    // Searches only the active upload batch while the system UI bus is held at volume 0.
    silentSearch(query = "") {
      this.muteSystemUi();
      try {
        const needle = String(query || "").trim().toLowerCase();
        const batch = typeof this.memoryManager.list === "function" ? this.memoryManager.list() : [];
        if (!needle) return batch;
        return batch.filter(track => `${track?.title || ""} ${track?.artist || ""}`.toLowerCase().includes(needle));
      } finally {
        this.muteSystemUi();
      }
    }

    // Verifies batch membership, then loads through the deck's audio controller with UI audio muted.
    async silentSearchAndLoad(trackId, options = {}) {
      this.logger.info(`${LIVE_PREFIX} Engaging silent search…`);
      try {
        if (!this.muteSystemUi()) {
          return { ok: false, reason: "mute-failed", trackId, message: "System UI audio could not be muted. Load aborted." };
        }
        const track = this.memoryManager.getAuthorizedTrack(trackId);
        if (!track) {
          this.logger.error(`${LIVE_PREFIX} Silent load refused: ${UNAUTHORIZED_MESSAGE}`);
          return { ok: false, reason: "unauthorized", trackId, message: UNAUTHORIZED_MESSAGE };
        }
        await this.audioController.loadTrackSilently(track, options);
        this.logger.info(`${LIVE_PREFIX} ${track.title || track.id} loaded silently${options.deckId ? ` to deck ${options.deckId}` : ""}.`);
        return { ok: true, trackId: track.id, track };
      } catch (error) {
        this.logger.error(`${LIVE_PREFIX} Silent load failed:`, error);
        return { ok: false, reason: "load-failed", trackId, message: error?.message || "Silent load failed." };
      } finally {
        // Keep the system UI bus muted after the operation, including on error.
        this.muteSystemUi();
      }
    }
  }

  global.HaloTrackMemoryManager = TrackMemoryManager;
  global.HaloLiveIntelligenceSystem = LiveIntelligenceSystem;
  global.HaloLiveIntelligenceSystem.UNAUTHORIZED_MESSAGE = UNAUTHORIZED_MESSAGE;
})(typeof window !== "undefined" ? window : globalThis);
