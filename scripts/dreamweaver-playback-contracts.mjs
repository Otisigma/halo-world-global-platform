import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { DREAMWEAVER_STOREFRONT_MIX_ID, buildDreamweaverStorefrontPath } from "../lib/dreamweaver-storefront.js";

const script = await readFile(new URL("../dreamweaver/dreamweaver.js", import.meta.url), "utf8");
const declarations = script.slice(script.indexOf("(() => {"), script.indexOf('  if (document.readyState === "loading")'));
const songId = "11111111-1111-4111-8111-111111111111";
const stream = "https://halo.test/song.mp3";
const release = {
  id: songId, title: "Linked song", artist: "Linked artist", streamUrl: stream,
  dreamweaverPayload: {
    songId, title: "Linked song", artist: "Linked artist",
    audioStreamUrl: stream, systemStatus: "OPERATIONAL", handledDegradations: []
  }
};
const mix = { id: "linked-mix-id", title: "Linked mix", creator: { name: "Mix artist" }, audioUrl: "https://halo.test/mix.mp3", durationSeconds: 120 };

function fixture(search, { releases = [release], mixes = [mix], blocked = false, failed = false, unlock = null, pathname = "/dreamweaver/" } = {}) {
  class Element extends EventTarget {
    constructor() {
      super();
      this.hidden = true;
      this.dataset = {};
      this.style = { setProperty() {} };
      this.attributes = new Map();
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.textContent = "";
      this.src = "";
      this.paused = true;
      this.readyState = failed ? 0 : 2;
      this.volume = 1;
      this.loads = 0;
      this.plays = 0;
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return name === "src" ? this.src : this.attributes.get(name); }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    closest() { return null; }
    pause() { this.paused = true; }
    load() {
      this.loads++;
      if (failed) queueMicrotask(() => {
        this.error = { code: 2 };
        this.dispatchEvent(new Event("error"));
      });
    }
    async play() {
      this.plays++;
      if (blocked) throw Object.assign(new Error("Autoplay blocked"), { name: "NotAllowedError" });
      this.paused = false;
      this.dispatchEvent(new Event("playing"));
    }
  }
  const nodes = new Map();
  const getElement = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const location = new URL(`${pathname}${search}`, "https://halo.test");
  const requests = [];
  const context = {
    URL, URLSearchParams, console, location, DREAMWEAVER_STOREFRONT_MIX_ID, buildDreamweaverStorefrontPath,
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    document: { getElementById: getElement, querySelector: getElement, body: new Element() },
    localStorage: { getItem: () => null },
    history: { replaceState: (_state, _title, url) => { location.href = new URL(url, location).href; } },
    window: { clearTimeout() {}, setTimeout: () => 1, requestAnimationFrame: callback => callback() },
    fixtures: { releases, mixes, unlock, requests }
  };
  vm.runInNewContext(`${declarations}
    hydrateAudioFeedbackQueue = () => {};
    flushQueuedAudioFeedback = async () => {};
    queueAudioFeedbackIncident = () => {};
    showToast = () => {};
    startSatelliteAgentLoop = stopSatelliteAgentLoop = () => {};
    loadVideos = async () => {};
    cacheDreamweaverRelease = () => {};
    preferredHeroVideo = () => null;
    renderStoryActs = () => {};
    syncDreamweaverLyrics = () => {};
    fetchReleaseCatalog = async () => fixtures.releases;
    fetchExactMixById = async id => fixtures.mixes.find(mix => mix.id === id);
    fetchJsonWithTimeout = async url => {
      fixtures.requests.push(url);
      return { response: { ok: true }, payload: { mixes: fixtures.mixes } };
    };
    state.unlock = fixtures.unlock;
    elements.audio.addEventListener("playing", () => setReleasePlaybackState("playing"));
    globalThis.player = { state, initializeDreamweaver, shouldPromptLocalUpload, resolvePrimaryPlaybackMix };
  })();`, context);
  return { ...context.player, nodes, requests };
}

for (const search of [
  `?song=${songId}`,
  `?song=${songId}&mix=${DREAMWEAVER_STOREFRONT_MIX_ID}&satellite=dreamweaver`,
  `?song=${songId}&experience=studio`
]) {
  const unrelatedRelease = {
    ...release, id: "22222222-2222-4222-8222-222222222222",
    dreamweaverHubUrl: `/dreamweaver/?mix=${DREAMWEAVER_STOREFRONT_MIX_ID}`,
    dreamweaverPayload: { ...release.dreamweaverPayload, songId: "22222222-2222-4222-8222-222222222222", audioStreamUrl: "https://halo.test/unrelated.mp3" }
  };
  const f = fixture(search, { blocked: true, releases: [unrelatedRelease, release] });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").src, stream);
  assert.equal(f.nodes.get("showAudio").preload, "auto");
  assert.equal(f.nodes.get("showAudio").loads, 1);
  assert.equal(f.nodes.get("showAudio").plays, 1);
  assert.equal(f.nodes.get("songLobbyPlayerTitle").textContent, release.title);
  assert.equal(f.nodes.get("songLobbyPlayerArtist").textContent, release.artist);
  assert.equal(f.nodes.get("songLobbyPlayerStatePill").textContent, "Ready");
  assert.match(f.nodes.get("songLobbyPlayerStatus").textContent, /Linked song.*ready/);
  assert.match(f.nodes.get("songLobbyPlayerSource").textContent, /Linked song/);
  assert.equal(f.nodes.get("dreamweaverSystemStatus").textContent, "SYSTEM / OPERATIONAL");
  assert.equal(f.shouldPromptLocalUpload(), false, "autoplay blocking must not require an upload");
  assert.equal(f.requests.length, 0, "song preload must not wait for the unrelated mix library");
  assert.equal(f.nodes.get("showShell").hidden, !search.includes("experience=studio"));
}

for (const search of ["?mix=linked-mix-id", `?mix=linked-mix-id&song=${songId}`, "?mix=linked-mix-id&satellite=dreamweaver"]) {
  const f = fixture(search, { releases: [] });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").src, mix.audioUrl);
  assert.equal(f.nodes.get("showAudio").loads, 1);
  assert.equal(f.nodes.get("songLobbyPlayerTitle").textContent, mix.title);
  assert.equal(f.nodes.get("songLobbyPlayerArtist").textContent, mix.creator.name);
  assert.equal(f.nodes.get("songLobbyPlayerDuration").textContent, "02:00");
  assert.equal(f.state.releasePlaybackState, "playing");
  assert.equal(f.shouldPromptLocalUpload(), false);
  assert.equal(f.nodes.get("showShell").hidden, search.includes("satellite=dreamweaver"));
}

for (const releases of [[], [{ ...release, streamUrl: "", dreamweaverPayload: { ...release.dreamweaverPayload, audioStreamUrl: null } }]]) {
  const f = fixture(`?song=${songId}`, { releases });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").loads, 0);
  assert.equal(f.shouldPromptLocalUpload(), true);
  assert.equal(f.state.releasePlaybackState, "unavailable");
  assert.equal(f.nodes.get("showShell").hidden, true);
}

for (const options of [{ unlock: { firstName: "Listener", favoritePlatform: "spotify" } }, { pathname: `/dreamweaver/satellite/${songId}/` }]) {
  const f = fixture(`?song=${songId}`, { ...options, blocked: true });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").src, stream);
  assert.equal(f.nodes.get("showShell").hidden, !options.unlock);
}

{
  const f = fixture(`?song=${songId}`, { failed: true });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").loads, 1);
  assert.equal(f.nodes.get("showAudio").plays, 0);
  assert.equal(f.shouldPromptLocalUpload(), true, "unavailable remote audio must retain upload fallback");
  assert.equal(f.state.releasePlaybackState, "unavailable", "hydration must not overwrite the audio failure");
}

{
  const f = fixture(`?song=${songId}`, { releases: [{ ...release, dreamweaverPayload: undefined }], blocked: true });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").src, stream, "legacy releases must resolve their public stream without a payload");
  assert.equal(f.shouldPromptLocalUpload(), false);
}

{
  const f = fixture("");
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").loads, 0, "unlinked satellite entry must remain unchanged");
  assert.equal(f.resolvePrimaryPlaybackMix([mix], "", null, { allowFallback: false }), null);
}

console.log("Dreamweaver playback contracts: deep links, preload, labels, autoplay blocking, shells, and upload fallback passed.");
