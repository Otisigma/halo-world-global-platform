import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { resolveObjectURL } from "node:buffer";
import { DREAMWEAVER_STOREFRONT_MIX_ID, buildDreamweaverStorefrontPath } from "../lib/dreamweaver-storefront.js";
import { createLyricInteractionRecorder } from "../lib/journey-interactions.js";
import * as playback from "../lib/dreamweaver-playback.js";
import { catalogAudioUrl, generateAutomatedSet, normalizeCatalog } from "../lib/catalog-curator.js";
import { readRecentTrackIds, recordPlayedTrack } from "../lib/catalog-session.js";
import * as mixIntent from "../lib/mix-intent.js";

const script = await readFile(new URL("../dreamweaver/dreamweaver.js", import.meta.url), "utf8");
const declarations = script.slice(script.indexOf("(() => {"), script.indexOf('  if (document.readyState === "loading")'));
const catalogControlBindings = script.slice(script.indexOf('  elements.catalogGenerate?.addEventListener'), script.indexOf('  if (resumeUploadVerification()'));
const audioErrorBinding = script.slice(script.indexOf('  elements.audio.addEventListener("error", async'), script.indexOf('  elements.muteButton.addEventListener'));
const songId = "11111111-1111-4111-8111-111111111111";
const stream = "https://halo.test/song.mp3";
const masterStream = "https://halo.test/canonical-master.wav";
const binding = {
  songId, status: "ready", audioSource: masterStream,
  visualActs: Array.from({ length: 4 }, (_, index) => ({ act: index + 1, sourceType: "upload", uri: `https://halo.test/act-${index + 1}.jpg` }))
};
const release = {
  id: songId, title: "Linked song", artist: "Linked artist", streamUrl: stream,
  dreamweaverPayload: {
    songId, title: "Linked song", artist: "Linked artist",
    audioStreamUrl: stream, systemStatus: "OPERATIONAL", handledDegradations: []
  }
};
const mix = { id: "linked-mix-id", title: "Linked mix", creator: { name: "Mix artist" }, audioUrl: "https://halo.test/mix.mp3", durationSeconds: 120 };

{
  let requestedSongId = songId;
  const paths = [];
  const context = {
    URLSearchParams,
    RELEASE_CONTEXT_TIMEOUT_MS: 1000,
    resolveDreamweaverRouteContext: () => ({ requestedSongId }),
    fetchJsonWithTimeout: async path => {
      paths.push(path);
      return { response: { ok: true }, payload: { releases: [release] } };
    },
  };
  vm.createContext(context);
  vm.runInContext(script.slice(script.indexOf("  async function fetchReleaseCatalog("),
    script.indexOf("  async function fetchExactMixById(")), context);
  await context.fetchReleaseCatalog();
  assert.equal(new URL(paths[0], "https://halo.test").searchParams.get("songId"), songId,
    "song routes must resolve the exact published song even outside the newest 200 releases");
  requestedSongId = "";
  await context.fetchReleaseCatalog();
  assert.equal(paths[1], "/api/release-catalog", "mix-only routes retain the existing feed lookup");
}

export function fixture(search, { releases = [release], mixes = [mix], blocked = false, failed = false, failingSources = [], rejectedPlaySources = [], loadingSources = [], deferPlaying = false, unlock = null, pathname = "/dreamweaver/", releaseArtwork = undefined, assetBinding = binding, driveCatalog = { configured: false, tracks: [] }, catalogError = false, storage = { getItem: () => null }, storageGetterError = false, preloader } = {}) {
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
      this.muted = false;
      this.loads = 0;
      this.plays = 0;
      this.playLog = [];
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return name === "src" ? this.src : this.attributes.get(name); }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    closest() { return null; }
    click() { this.clicks = (this.clicks || 0) + 1; }
    scrollIntoView() {}
    get currentSrc() { return this.src; }
    querySelectorAll() { return []; }
    pause() { this.paused = true; }
    load() {
      this.loads++;
      const failing = failed || failingSources.includes(this.src);
      this.readyState = failing || loadingSources.includes(this.src) ? 0 : 2;
      if (failing) queueMicrotask(() => {
        this.error = { code: 2 };
        this.dispatchEvent(new Event("error"));
      });
    }
    async play() {
      this.plays++;
      this.playLog.push({ src: this.src, muted: this.muted });
      if (blocked) throw Object.assign(new Error("Autoplay blocked"), { name: "NotAllowedError" });
      if (failed || failingSources.includes(this.src) || rejectedPlaySources.includes(this.src)) throw Object.assign(new Error("Stream unavailable"), { name: "NotSupportedError" });
      this.paused = false;
      if (!deferPlaying) this.dispatchEvent(new Event("playing"));
    }
  }
  const nodes = new Map();
  const getElement = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const location = new URL(`${pathname}${search}`, "https://halo.test");
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  const context = {
    URL, URLSearchParams, console, location, DREAMWEAVER_STOREFRONT_MIX_ID, buildDreamweaverStorefrontPath, createLyricInteractionRecorder, catalogAudioUrl, generateAutomatedSet, normalizeCatalog, readRecentTrackIds, recordPlayedTrack, ...mixIntent, ...playback,
    Image: class {
      set src(value) {
        assert.equal(this.crossOrigin, "anonymous", "CORS must be set before requesting campaign artwork");
        queueMicrotask(() => value.includes("no-cors") ? this.onerror() : this.onload());
      }
    },
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    document: { getElementById: getElement, querySelector: getElement, body: new Element() },
    localStorage: storage,
    history: { replaceState: (_state, _title, url) => { location.href = new URL(url, location).href; } },
    window: { clearTimeout: id => timers.delete(id), setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, requestAnimationFrame: callback => callback(), HaloReleaseArtwork: releaseArtwork, HaloAudioPreloader: preloader },
    fixtures: { releases, mixes, unlock, requests, assetBinding, driveCatalog, catalogError }
  };
  if (storageGetterError) Object.defineProperty(context, "localStorage", { get() { throw new Error("SecurityError"); } });
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
      if (url === "/api/drive-catalog") {
        return { response: { ok: !fixtures.catalogError }, payload: fixtures.driveCatalog };
      }
      if (url.startsWith("/api/dreamweaver-assets?")) {
        return { response: { ok: Boolean(fixtures.assetBinding) }, payload: { binding: fixtures.assetBinding } };
      }
      return { response: { ok: true }, payload: { mixes: fixtures.mixes } };
    };
    state.unlock = fixtures.unlock;
    elements.audio.addEventListener("playing", () => { clearRemoteAudioWatchdog(); measurePlaybackStart(); setReleasePlaybackState("playing"); });
    ${catalogControlBindings}
    ${audioErrorBinding}
    elements.audio.addEventListener("ended", handleCatalogEnded);
    globalThis.player = { state, chapters, initializeDreamweaver, generateCatalogSet, advanceCatalogTrack, retryCatalogProxy, shouldPromptLocalUpload, resolvePrimaryPlaybackMix, resolvePrimaryAudio, handleSoundUnlock, togglePlayback, startUnlockedShow, loadImage, activateLocalMixFile, armRemoteAudioWatchdog, handleLobbyPageHide };
  })();`, context);
  return { ...context.player, nodes, requests, timers, location };
}

for (const search of [
  `?song=${songId}`,
  `?song=${songId}&mix=${DREAMWEAVER_STOREFRONT_MIX_ID}&satellite=dreamweaver`,
  `?song=${songId}&mix=linked-mix-id&satellite=dreamweaver`,
  `?song=${songId}&experience=studio`
]) {
  const unrelatedRelease = {
    ...release, id: "22222222-2222-4222-8222-222222222222",
    dreamweaverHubUrl: `/dreamweaver/?mix=${DREAMWEAVER_STOREFRONT_MIX_ID}`,
    dreamweaverPayload: { ...release.dreamweaverPayload, songId: "22222222-2222-4222-8222-222222222222", audioStreamUrl: "https://halo.test/unrelated.mp3" }
  };
  const f = fixture(search, { blocked: true, releases: [unrelatedRelease, release] });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").src, masterStream);
  assert.equal(f.nodes.get("showAudio").preload, "auto");
  assert.equal(f.nodes.get("showAudio").loads, 1);
  assert.equal(f.nodes.get("showAudio").plays, 0, "preload must never autoplay");
  assert.equal(f.nodes.get("songLobbyPlayerTitle").textContent, release.title);
  assert.equal(f.nodes.get("songLobbyPlayerArtist").textContent, release.artist);
  assert.equal(f.nodes.get("songLobbyPlayerStatePill").textContent, "Ready");
  assert.match(f.nodes.get("songLobbyPlayerStatus").textContent, /Linked song.*ready/);
  assert.match(f.nodes.get("songLobbyPlayerSource").textContent, /Linked song/);
  assert.equal(f.nodes.get("dreamweaverSystemStatus").textContent, "SYSTEM / OPERATIONAL");
  assert.equal(f.nodes.get("dreamweaverSystemStatus").dataset.assetStatus, "ready");
  assert.equal(f.shouldPromptLocalUpload(), false, "autoplay blocking must not require an upload");
  assert.deepEqual(f.requests, [`/api/dreamweaver-assets?songId=${songId}`], "song preload binds the master without fetching unrelated mixes");
  assert.deepEqual(Array.from(f.chapters, chapter => chapter.image), binding.visualActs.map(visual => visual.uri));
  assert.equal(f.nodes.get("showShell").hidden, !search.includes("experience=studio"));
  const params = f.location.searchParams;
  assert.equal(params.get("song"), songId);
  const requestedParams = new URLSearchParams(search);
  if (requestedParams.has("mix")) assert.equal(params.get("mix"), requestedParams.get("mix"));
  if (requestedParams.has("satellite")) assert.equal(params.get("satellite"), "dreamweaver");
}

for (const search of ["?mix=linked-mix-id", "?mix=linked-mix-id&satellite=dreamweaver"]) {
  const f = fixture(search, { releases: [] });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").src, mix.audioUrl);
  assert.equal(f.nodes.get("showAudio").loads, 1);
  assert.equal(f.nodes.get("songLobbyPlayerTitle").textContent, mix.title);
  assert.equal(f.nodes.get("songLobbyPlayerArtist").textContent, mix.creator.name);
  assert.equal(f.nodes.get("songLobbyPlayerDuration").textContent, "02:00");
  assert.equal(f.state.releasePlaybackState, "ready");
  assert.equal(f.shouldPromptLocalUpload(), false);
  assert.equal(f.nodes.get("showShell").hidden, search.includes("satellite=dreamweaver"));
}

for (const releases of [[], [{ ...release, streamUrl: "", dreamweaverPayload: { ...release.dreamweaverPayload, audioStreamUrl: null } }]]) {
  const f = fixture(`?song=${songId}&mix=linked-mix-id&satellite=dreamweaver`, { releases, assetBinding: null });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").loads, 0);
  assert.equal(f.shouldPromptLocalUpload(), true);
  assert.equal(f.state.releasePlaybackState, "unavailable");
  assert.equal(f.nodes.get("showShell").hidden, true);
}

for (const options of [{ unlock: { firstName: "Listener", favoritePlatform: "spotify" } }, { pathname: `/dreamweaver/satellite/${songId}/` }]) {
  const f = fixture(`?song=${songId}`, { ...options, blocked: true });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").src, masterStream);
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
  assert.equal(f.nodes.get("showAudio").src, masterStream, "legacy releases must also consume the backend master binding");
  assert.equal(f.shouldPromptLocalUpload(), false);
}

{
  const f = fixture("");
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").loads, 0, "unlinked satellite entry must remain unchanged");
  assert.equal(f.resolvePrimaryPlaybackMix([mix], "", null, { allowFallback: false }), null);
}

{
  // The shared artwork helper dereferences its track argument, so song routes must never pass it a missing mix.
  const artworkWindow = { location: new URL("https://halo.test/") };
  vm.runInNewContext(await readFile(new URL("../release-artwork.js", import.meta.url), "utf8"), { window: artworkWindow, URL });
  const releaseArtwork = { ...artworkWindow.HaloReleaseArtwork, wire() {} };
  const f = fixture(`?song=${songId}&mix=${DREAMWEAVER_STOREFRONT_MIX_ID}&satellite=dreamweaver`, { blocked: true, releaseArtwork });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").src, masterStream, "the shared artwork helper cannot override the canonical master");
  assert.equal(f.state.release?.id, songId);
  assert.equal(f.resolvePrimaryPlaybackMix([], "", null, { allowFallback: false }), null);
}

for (const assetBinding of [
  null,
  { ...binding, visualActs: binding.visualActs.slice(0, 3) },
  { ...binding, songId: "22222222-2222-4222-8222-222222222222" },
  { ...binding, audioSource: "javascript:alert(1)" },
  { ...binding, visualActs: binding.visualActs.map(visual => ({ ...visual, uri: "javascript:alert(1)" })) }
]) {
  const f = fixture(`?song=${songId}`, { assetBinding });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").loads, 0, "invalid bindings must never fall back to preview audio");
  assert.equal(f.state.releasePlaybackState, "unavailable");
}

{
  const f = fixture(`?song=${songId}`);
  const source = "https://images.halo.test/custom.jpg";
  const image = await f.loadImage(source);
  assert.equal(image.crossOrigin, "anonymous");
  assert.equal(f.state.images.get(source), image);
  assert.equal(await f.loadImage(source), image, "approved images are cached");
  const blockedSource = "https://images.halo.test/no-cors.jpg";
  assert.equal(await f.loadImage(blockedSource), null, "non-CORS hosts must not taint export canvases");
  assert.equal(f.state.images.has(blockedSource), false);
}

// Google Drive share links normalize to the streamable direct-download form; other hosts are rejected.
{
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz";
  const direct = `https://drive.google.com/uc?export=download&id=${id}`;
  for (const share of [
    `https://drive.google.com/file/d/${id}/view?usp=sharing`,
    `https://drive.google.com/file/d/${id}/preview`,
    `https://drive.google.com/file/d/${id}`,
    `https://drive.google.com/open?id=${id}`,
    `https://drive.google.com/uc?id=${id}&export=download`,
    `https://docs.google.com/uc?id=${id}`,
    `https://drive.usercontent.google.com/download?id=${id}&export=download`
  ]) {
    assert.equal(playback.normalizeGoogleDriveAudioUrl(share), direct, share);
    assert.equal(playback.isGoogleDriveUrl(share), true);
  }
  assert.equal(playback.normalizeGoogleDriveAudioUrl(`https://drive.google.com/file/d/${id}/view?resourcekey=0-abc_DEF`), `${direct}&resourcekey=0-abc_DEF`);
  for (const rejected of [
    "", "https://halo.test/song.mp3", `http://drive.google.com/file/d/${id}/view`, `https://evil.test/file/d/${id}/view`,
    `https://drive.google.com.evil.test/file/d/${id}/view`, "https://drive.google.com/file/d/short/view",
    `https://listener@drive.google.com/file/d/${id}/view`, "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp", "javascript:alert(1)"
  ]) assert.equal(playback.normalizeGoogleDriveAudioUrl(rejected), "", rejected);
  assert.equal(playback.isGoogleDriveUrl("https://halo.test/song.mp3"), false);
  assert.deepEqual(playback.googleDriveFallbackSources([
    "https://halo.test/song.mp3", `https://drive.google.com/file/d/${id}/view`, `https://drive.google.com/open?id=${id}`, null
  ]), [direct], "fallbacks are Drive-only and de-duplicated");
  assert.deepEqual(playback.googleDriveFallbackSources([`https://drive.google.com/open?id=${id}`], direct), [], "the primary source is never repeated as a fallback");

  // Direct audio stays primary; Drive is only chosen (normalized) when nothing direct is available.
  const f = fixture("");
  assert.equal(f.resolvePrimaryAudio({ audioUrl: "https://halo.test/direct.mp3", streamUrl: `https://drive.google.com/file/d/${id}/view` }).src, "https://halo.test/direct.mp3");
  assert.equal(f.resolvePrimaryAudio({ audioUrl: `https://drive.google.com/file/d/${id}/view` }).src, "", "raw Drive links never reach the player");
  assert.equal(f.resolvePrimaryAudio({ isCatalogPlayback: true, canonicalBinding: { audioSource: masterStream } }).src, masterStream);
  assert.equal(f.resolvePrimaryAudio({ isCatalogPlayback: true, canonicalBinding: { audioSource: `https://drive.google.com/file/d/${id}/view` } }).src, "", "Drive masters must be resolved to an authorized site proxy on the server");

  // A rejected gesture unlock restores the prior mute state rather than leaving a silent, unmuted element.
  const rejected = { muted: true, paused: true, play: async () => { throw Object.assign(new Error("blocked"), { name: "NotAllowedError" }); } };
  await assert.rejects(playback.unlockDreamweaverAudio(rejected), { name: "NotAllowedError" });
  assert.equal(rejected.muted, true);
}

// Preload never plays; the first gesture uses the existing shared-player buffer.
{
  const f = fixture(`?song=${songId}`);
  await f.initializeDreamweaver();
  const audio = f.nodes.get("showAudio");
  assert.equal(audio.plays, 0);
  const loads = audio.loads;
  const requests = f.requests.length;
  const start = f.startUnlockedShow();
  assert.equal(audio.plays, 1, "Start calls play before its first await, even while the shell is hidden");
  assert.equal(audio.loads, loads, "Start must not reload the already-warmed song");
  assert.equal(f.requests.length, requests, "Start must not await a second catalog/assets request");
  await start;
  assert.equal(f.nodes.get("songLobbyPlayerStatePill").textContent, "Playing now");
  assert.match(audio.dataset.clickToPlayingMs, /^\d+$/);
  await f.startUnlockedShow();
  assert.equal(audio.paused, false, "Start reveals an already-playing show without toggling it off");
}

{
  const f = fixture(`?song=${songId}`, { blocked: true });
  await f.initializeDreamweaver();
  const audio = f.nodes.get("showAudio");
  const unlock = f.nodes.get("dreamweaverSoundUnlock");
  await f.togglePlayback();
  assert.equal(audio.plays, 1);
  assert.equal(audio.muted, false);
  assert.equal(unlock.hidden, false, "policy rejection must expose a tap-Play recovery");
  assert.equal(unlock.dataset.soundUnlock, "blocked");
  assert.match(unlock.textContent, /play with sound/i);
  assert.equal(f.state.releasePlaybackState, "ready");
  assert.equal(f.shouldPromptLocalUpload(), false);
  assert.equal(audio.dataset.clickToPlayingMs, undefined, "rejected play is not a latency measurement");
}

{
  const f = fixture(`?song=${songId}`);
  await f.initializeDreamweaver();
  f.nodes.get("showAudio").muted = true;
  await f.togglePlayback();
  assert.equal(f.nodes.get("showAudio").muted, true, "Play preserves a deliberate mute choice");
  assert.equal(f.nodes.get("showAudio").paused, false);
}

assert.doesNotMatch(script, /setTimeout\([^;]*muted\s*=\s*false/, "Dreamweaver must never unmute on a timer");
assert.match(await readFile(new URL("../dreamweaver/index.html", import.meta.url), "utf8"), /<button class="song-lobby__sound-unlock" id="dreamweaverSoundUnlock" type="button"[^>]*hidden>/);
assert.match(script, /soundUnlockButton: document\.getElementById\("dreamweaverSoundUnlock"\)/, "the unlock control targets a specific element");
assert.match(script, /audio: document\.getElementById\("showAudio"\)/, "Dreamweaver audio targets #showAudio, not a generic selector");

// The authorized site proxy is a fallback only, and only for the same bound song.
{
  const driveDirect = "https://halo.test/api/drive-catalog/audio?track=linked-song";
  const driveRelease = { ...release, streamUrl: driveDirect, dreamweaverPayload: { ...release.dreamweaverPayload, audioStreamUrl: driveDirect } };

  const healthy = fixture(`?song=${songId}`, { releases: [driveRelease] });
  await healthy.initializeDreamweaver();
  assert.equal(healthy.nodes.get("showAudio").src, masterStream, "the canonical master stays primary when Drive is available");
  assert.equal(healthy.nodes.get("showAudio").plays, 0);

  const f = fixture(`?song=${songId}`, { releases: [driveRelease], failingSources: [masterStream] });
  await f.initializeDreamweaver();
  const audio = f.nodes.get("showAudio");
  assert.equal(audio.src, driveDirect, "a failed canonical master falls back to the same-song site proxy");
  assert.equal(audio.loads, 2);
  assert.deepEqual(audio.playLog, [], "preload recovery never autoplays");
  await f.togglePlayback();
  assert.equal(f.state.releasePlaybackState, "playing");
  assert.equal(f.shouldPromptLocalUpload(), false);

  const both = fixture(`?song=${songId}`, { releases: [driveRelease], failingSources: [masterStream, driveDirect] });
  await both.initializeDreamweaver();
  assert.equal(both.nodes.get("showAudio").plays, 0);
  assert.equal(both.state.releasePlaybackState, "unavailable", "a failed Drive fallback still surfaces the upload fallback");
  assert.equal(both.shouldPromptLocalUpload(), true);

  const otherSong = { ...driveRelease, dreamweaverPayload: { ...driveRelease.dreamweaverPayload, songId: "22222222-2222-4222-8222-222222222222" } };
  const mismatched = fixture(`?song=${songId}`, { releases: [otherSong], failingSources: [masterStream], assetBinding: binding });
  await mismatched.initializeDreamweaver();
  assert.notEqual(mismatched.nodes.get("showAudio").src, driveDirect, "Drive fallbacks from another song are never used");

  const invalid = fixture(`?song=${songId}`, { releases: [driveRelease], assetBinding: null });
  await invalid.initializeDreamweaver();
  assert.equal(invalid.nodes.get("showAudio").loads, 0, "Drive cannot replace a missing canonical binding");
  assert.equal(invalid.state.releasePlaybackState, "unavailable");
}

const proxy = "https://halo.test/api/drive-catalog/audio?track=bound-song";
{
  const warmed = [];
  const preloader = {
    clear() {},
    prepare(audio, source) {
      if (audio.src !== source || audio.error) { audio.src = source; audio.load(); }
      return true;
    },
    warmPlaylist(sources, options) {
      warmed.push({ sources: Array.from(sources), options });
      this.prepare(options.primaryAudio, sources[0]);
    }
  };
  const f = fixture(`?song=${songId}`, { preloader, assetBinding: { ...binding, fallbackAudioSource: proxy }, deferPlaying: true });
  await f.initializeDreamweaver();
  const audio = f.nodes.get("showAudio");
  assert.deepEqual(warmed[0].sources, [masterStream, proxy], "warm only the canonical primary and same-song site proxy");
  assert.equal(warmed[0].options.primaryAudio, audio);
  assert.equal(warmed[0].options.respectPolicy, true);
  const start = f.startUnlockedShow();
  assert.equal(audio.plays, 1);
  await start;
  assert.notEqual(f.state.releasePlaybackState, "playing", "a resolved play promise cannot spoof playing");
  assert.equal(audio.dataset.clickToPlayingMs, undefined);
  audio.dispatchEvent(new Event("playing"));
  assert.match(audio.dataset.clickToPlayingMs, /^\d+$/);
}
for (const failure of ["promise", "late-error", "stall"]) {
  const f = fixture(`?song=${songId}`, {
    assetBinding: { ...binding, fallbackAudioSource: proxy },
    rejectedPlaySources: failure === "promise" ? [masterStream] : []
  });
  await f.initializeDreamweaver();
  const audio = f.nodes.get("showAudio");
  audio.muted = true;
  await f.togglePlayback();
  if (failure !== "promise") {
    audio.currentTime = 17;
    if (failure === "late-error") audio.dispatchEvent(new Event("error"));
    else {
      f.armRemoteAudioWatchdog();
      f.timers.get(f.state.remoteAudioWatchdog)();
    }
    {
      const f = fixture(`?song=${songId}`, { assetBinding: { ...binding, fallbackAudioSource: proxy } });
      await f.initializeDreamweaver();
      await f.togglePlayback();
      const audio = f.nodes.get("showAudio");
      audio.currentTime = 10;
      f.armRemoteAudioWatchdog();
      audio.currentTime = 15;
      f.timers.get(f.state.remoteAudioWatchdog)();
      assert.equal(audio.src, masterStream, "a download stall must not replace healthy buffered playback");
      assert.equal(audio.paused, false);
      assert.ok(f.state.remoteAudioWatchdog, "partial progress must not permanently disable stall recovery");
      f.timers.get(f.state.remoteAudioWatchdog)();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(audio.src, proxy, "if buffered progress subsequently stops, the watchdog still recovers");
    }
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(audio.src, proxy, `${failure}: linked songs retry their bound site proxy`);
  assert.equal(audio.muted, true);
  if (failure !== "promise") assert.equal(audio.currentTime, 17);
  assert.equal(f.shouldPromptLocalUpload(), false);
}
{
  const f = fixture(`?song=${songId}`, {
    assetBinding: { ...binding, fallbackAudioSource: proxy }, rejectedPlaySources: [masterStream, proxy]
  });
  await f.initializeDreamweaver();
  await f.togglePlayback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.nodes.get("showAudio").src, proxy);
  assert.equal(f.shouldPromptLocalUpload(), true);
  assert.equal(f.state.releasePlaybackState, "unavailable");
}

{
  const audioFile = (name, type = "audio/mp4") => Object.assign(new Blob(["local audio"], { type }), { name });
  const f = fixture(`?song=${songId}`, {
    assetBinding: { ...binding, fallbackAudioSource: proxy }, rejectedPlaySources: [masterStream, proxy]
  });
  await f.initializeDreamweaver();
  await f.togglePlayback();
  await new Promise(resolve => setImmediate(resolve));
  const audio = f.nodes.get("showAudio");
  const status = f.nodes.get("mixFileStatus");
  const standbySource = audio.src;
  assert.equal(f.shouldPromptLocalUpload(), true, "an unavailable linked stream leaves the song lobby on standby");
  assert.match(f.nodes.get("songLobbyPlayerStatus").textContent, /Preview a local file in this lobby/);
  assert.equal(f.nodes.get("songLobbyPlayerStatePill").textContent, "Preview a local file");

  await f.activateLocalMixFile(undefined);
  assert.equal(status.dataset.state, "error");
  assert.match(status.textContent, /No file selected/);
  await f.activateLocalMixFile(audioFile("notes.txt", "text/plain"));
  assert.equal(status.dataset.state, "error");
  assert.match(status.textContent, /MP3, WAV, M4A, AAC, OGG, FLAC, or WebM/);
  assert.equal(audio.src, standbySource, "rejected files never replace the shared player source");
  assert.equal(f.state.localAudioUrl, "");

  await f.activateLocalMixFile(audioFile("My Place of Peace.m4a"));
  const firstUrl = audio.src;
  assert.equal(f.state.audioSourceMode, "local");
  assert.match(firstUrl, /^blob:/);
  assert.ok(resolveObjectURL(firstUrl), "the active local preview URL stays alive while playing");
  assert.equal(audio.paused, false);
  assert.equal(status.dataset.state, "active");
  assert.match(status.textContent, /My Place of Peace\.m4a plays only in this browser tab/);
  assert.match(status.textContent, /not uploaded, saved, published, or shared with other listeners/);
  assert.match(status.textContent, /Linked song — Linked artist/);
  assert.equal(f.nodes.get("songLobbyPlayerTitle").textContent, release.title, "local preview keeps the linked song identity");
  assert.equal(f.nodes.get("songLobbyPlayerArtist").textContent, release.artist);
  assert.equal(f.nodes.get("songLobbyPlayerStatePill").textContent, "Local preview");
  assert.match(f.nodes.get("songLobbyPlayerStatus").textContent, /this browser only.*Linked song — Linked artist/);
  assert.equal(f.state.publishedSongId, songId, "local preview never rebinds the canonical song");

  await f.activateLocalMixFile(audioFile("Second take.wav", "audio/wav"));
  assert.equal(resolveObjectURL(firstUrl), undefined, "replacing a local preview revokes the previous object URL");
  const secondUrl = audio.src;
  assert.notEqual(secondUrl, firstUrl);
  f.handleLobbyPageHide({ persisted: true });
  assert.ok(resolveObjectURL(secondUrl), "back/forward cache restores keep the preview playable");
  f.handleLobbyPageHide({ persisted: false });
  assert.equal(resolveObjectURL(secondUrl), undefined, "leaving the page revokes the local preview URL");
  assert.equal(f.state.localAudioUrl, "");
}
{
  const f = fixture(`?song=${songId}`, { blocked: true });
  await f.initializeDreamweaver();
  await f.activateLocalMixFile(Object.assign(new Blob(["local audio"], { type: "audio/mpeg" }), { name: "Blocked.mp3" }));
  const status = f.nodes.get("mixFileStatus");
  assert.equal(f.state.audioSourceMode, "local", "autoplay policy keeps the local preview loaded");
  assert.equal(f.nodes.get("showAudio").paused, true);
  assert.equal(status.dataset.state, "ready");
  assert.match(status.textContent, /press Play to listen/);
  assert.equal(f.nodes.get("dreamweaverSoundUnlock").dataset.soundUnlock, "blocked");
  assert.equal(f.nodes.get("songLobbyPlayerStatePill").textContent, "Local preview ready");
}
{
  const f = fixture(`?song=${songId}`);
  await f.initializeDreamweaver();
  const audio = f.nodes.get("showAudio");
  audio.play = async () => { throw Object.assign(new Error("Undecodable"), { name: "NotSupportedError" }); };
  await f.activateLocalMixFile(Object.assign(new Blob(["bad"], { type: "audio/wav" }), { name: "Broken.wav" }));
  const failedUrl = audio.src;
  assert.equal(f.state.audioSourceMode, "error");
  assert.equal(f.state.localAudioUrl, "");
  assert.equal(resolveObjectURL(failedUrl), undefined, "failed local previews release their object URL");
  assert.equal(f.nodes.get("mixFileStatus").dataset.state, "error");
  assert.match(f.nodes.get("mixFileStatus").textContent, /could not play that file/);
  assert.equal(f.shouldPromptLocalUpload(), true);
}

console.log("Dreamweaver playback contracts: canonical binding, route semantics, click-only warm handoff, policy recovery, mute preservation, and same-song site proxy, local-only song lobby preview passed (mocked media).");
