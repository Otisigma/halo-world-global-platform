(function (global) {
  "use strict";

  class HaloTrackMemoryManager {
    constructor() {
      this.batch = null;
      this.pinned = new Set();
      this.decodeQueue = Promise.resolve();
    }

    lockUploadBatch(tracks) {
      this.batch = new Map(tracks.filter(track => track?.id).map(track => [track.id, track]));
    }

    isAuthorized(trackId) {
      return this.batch === null || this.batch.has(trackId);
    }

    list() {
      return this.batch === null ? null : [...this.batch.values()];
    }

    release(trackId) {
      this.batch?.delete(trackId);
    }

    pinAssets(assets) {
      const next = new Set(assets.filter(Boolean));
      for (const asset of this.pinned) {
        if (!next.has(asset)) asset.buffer = null;
      }
      this.pinned = next;
    }

    decode(asset, context) {
      if (!this.pinned.has(asset)) return Promise.resolve(null);
      if (asset.buffer) return Promise.resolve(asset.buffer);
      if (asset.promise) return asset.promise;
      const task = this.decodeQueue.then(async () => {
        if (!this.pinned.has(asset)) return null;
        const encoded = await asset.file.arrayBuffer();
        if (!this.pinned.has(asset)) return null;
        const buffer = await context.decodeAudioData(encoded);
        // A replaced/ejected deck must not repopulate the library's decoded cache.
        if (!this.pinned.has(asset)) return null;
        asset.buffer = buffer;
        return buffer;
      });
      asset.promise = task.finally(() => { asset.promise = null; });
      this.decodeQueue = asset.promise.then(() => null, () => null);
      return asset.promise;
    }
  }

  async function indexUploadBatch(files, indexTrack) {
    const tracks = [];
    for (let index = 0; index < files.length; index += 1) {
      tracks.push(await indexTrack(files[index], index));
      if ((index + 1) % 8 === 0) await new Promise(resolve => global.setTimeout(resolve, 0));
    }
    return tracks;
  }

  class HaloLiveIntelligenceSystem {
    constructor(controller, memory) {
      this.controller = controller;
      this.memory = memory;
    }

    silentSearchAndLoad(trackId, { deckId } = {}) {
      try {
        if (!this.memory.isAuthorized(trackId)) return { ok: false, reason: "unauthorized" };
        if (!this.controller.canLoad(deckId)) return { ok: false, reason: "deck-busy" };
        const loaded = this.controller.loadTrackSilently(deckId, trackId);
        return { ok: Boolean(loaded), reason: loaded ? null : "load-failed" };
      } catch {
        return { ok: false, reason: "load-failed" };
      }
    }
  }

  global.HaloTrackMemoryManager = HaloTrackMemoryManager;
  global.HaloLiveIntelligenceSystem = HaloLiveIntelligenceSystem;
  global.HaloIndexUploadBatch = indexUploadBatch;
})(typeof window !== "undefined" ? window : globalThis);
