import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { DREAMWEAVER_STOREFRONT_MIX_ID, buildDreamweaverStorefrontPath } from "../lib/dreamweaver-storefront.js";
import { createLyricInteractionRecorder } from "../lib/journey-interactions.js";
import * as playback from "../lib/dreamweaver-playback.js";
import { catalogAudioUrl, generateAutomatedSet } from "../lib/catalog-curator.js";
import { readRecentTrackIds, recordPlayedTrack } from "../lib/catalog-session.js";
import * as mixIntent from "../lib/mix-intent.js";

const script = await readFile(new URL("../dreamweaver/dreamweaver.js", import.meta.url), "utf8");
const declarations = script.slice(script.indexOf("(() => {"), script.indexOf('  if (document.readyState === "loading")'));
const catalogControlBindings = script.slice(script.indexOf('  elements.catalogGenerate?.addEventListener'), script.indexOf('  if (resumeUploadVerification()'));
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

export function fixture(search, { releases = [release], mixes = [mix], blocked = false, failed = false, failingSources = [], unlock = null, pathname = "/dreamweaver/", releaseArtwork = undefined, assetBinding = binding, driveCatalog = { configured: false, tracks: [] }, catalogError = false, storage = { getItem: () => null }, storageGetterError = false } = {}) {
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
    querySelectorAll() { return []; }
    pause() { this.paused = true; }
    load() {
      this.loads++;
      const failing = failed || failingSources.includes(this.src);
      this.readyState = failing ? 0 : 2;
      if (failing) queueMicrotask(() => {
        this.error = { code: 2 };
        this.dispatchEvent(new Event("error"));
      });
    }
    async play() {
      this.plays++;
      this.playLog.push({ src: this.src, muted: this.muted });
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
    URL, URLSearchParams, console, location, DREAMWEAVER_STOREFRONT_MIX_ID, buildDreamweaverStorefrontPath, createLyricInteractionRecorder, catalogAudioUrl, generateAutomatedSet, readRecentTrackIds, recordPlayedTrack, ...mixIntent, ...playback,
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
    window: { clearTimeout() {}, setTimeout: () => 1, requestAnimationFrame: callback => callback(), HaloReleaseArtwork: releaseArtwork },
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
    elements.audio.addEventListener("playing", () => setReleasePlaybackState("playing"));
    ${catalogControlBindings}
    elements.audio.addEventListener("ended", handleCatalogEnded);
    globalThis.player = { state, chapters, initializeDreamweaver, generateCatalogSet, advanceCatalogTrack, retryCatalogProxy, shouldPromptLocalUpload, resolvePrimaryPlaybackMix, resolvePrimaryAudio, handleSoundUnlock, togglePlayback, loadImage };
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
  assert.equal(f.nodes.get("showAudio").src, masterStream);
  assert.equal(f.nodes.get("showAudio").preload, "auto");
  assert.equal(f.nodes.get("showAudio").loads, 1);
  assert.equal(f.nodes.get("showAudio").plays, 1);
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
  const f = fixture(`?song=${songId}`, { releases, assetBinding: null });
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
  assert.deepEqual({ ...f.resolvePrimaryAudio({ audioUrl: `https://drive.google.com/file/d/${id}/view` }) }, { src: direct, source: "google-drive-fallback", isPlayable: true });
  assert.equal(f.resolvePrimaryAudio({ isCatalogPlayback: true, canonicalBinding: { audioSource: masterStream } }).src, masterStream);
  assert.equal(f.resolvePrimaryAudio({ isCatalogPlayback: true, canonicalBinding: { audioSource: `https://drive.google.com/file/d/${id}/view` } }).src, direct, "a Drive-hosted canonical master is normalized, never replaced");

  // A rejected gesture unlock restores the prior mute state rather than leaving a silent, unmuted element.
  const rejected = { muted: true, paused: true, play: async () => { throw Object.assign(new Error("blocked"), { name: "NotAllowedError" }); } };
  await assert.rejects(playback.unlockDreamweaverAudio(rejected), { name: "NotAllowedError" });
  assert.equal(rejected.muted, true);
}

// Autoplay starts muted, never unmutes on its own, and exposes an explicit unmute control.
{
  const f = fixture(`?song=${songId}`);
  await f.initializeDreamweaver();
  const audio = f.nodes.get("showAudio");
  const unlock = f.nodes.get("dreamweaverSoundUnlock");
  assert.deepEqual(audio.playLog, [{ src: masterStream, muted: true }], "autoplay must be attempted muted first");
  assert.equal(audio.muted, true, "Dreamweaver must not auto-unmute");
  assert.equal(f.state.autoplayMuted, true);
  assert.equal(unlock.hidden, false, "a visible unmute control is required while autoplay is muted");
  assert.equal(unlock.dataset.soundUnlock, "muted");
  assert.match(unlock.textContent, /unmute/i);
  assert.equal(f.nodes.get("songLobbyPlayerStatePill").textContent, "Playing muted");
  await f.handleSoundUnlock();
  assert.equal(audio.muted, false, "an explicit user gesture restores sound");
  assert.equal(unlock.hidden, true);
  assert.equal(f.state.autoplayMuted, false);
  assert.equal(f.nodes.get("songLobbyPlayerStatePill").textContent, "Playing now");
}

{
  const f = fixture(`?song=${songId}`, { blocked: true });
  await f.initializeDreamweaver();
  const audio = f.nodes.get("showAudio");
  const unlock = f.nodes.get("dreamweaverSoundUnlock");
  assert.equal(audio.plays, 1);
  assert.equal(audio.muted, false, "a blocked muted autoplay leaves the element ready for a gesture-driven start");
  assert.equal(unlock.hidden, false, "blocked autoplay must expose a play-with-sound fallback");
  assert.equal(unlock.dataset.soundUnlock, "blocked");
  assert.match(unlock.textContent, /play with sound/i);
  assert.equal(f.state.releasePlaybackState, "ready");
}

{
  const f = fixture(`?song=${songId}`);
  await f.initializeDreamweaver();
  await f.togglePlayback();
  assert.equal(f.nodes.get("showAudio").muted, false, "pressing play/pause while muted-autoplaying unmutes instead of pausing");
  assert.equal(f.nodes.get("showAudio").paused, false);
}

assert.doesNotMatch(script, /setTimeout\([^;]*muted\s*=\s*false/, "Dreamweaver must never unmute on a timer");
assert.match(await readFile(new URL("../dreamweaver/index.html", import.meta.url), "utf8"), /<button class="song-lobby__sound-unlock" id="dreamweaverSoundUnlock" type="button"[^>]*hidden>/);
assert.match(script, /soundUnlockButton: document\.getElementById\("dreamweaverSoundUnlock"\)/, "the unlock control targets a specific element");
assert.match(script, /audio: document\.getElementById\("showAudio"\)/, "Dreamweaver audio targets #showAudio, not a generic selector");

// Google Drive is a fallback only: used after the canonical master fails, and only for the same published song.
{
  const driveShare = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing";
  const driveDirect = "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz";
  const driveRelease = { ...release, streamUrl: driveShare, dreamweaverPayload: { ...release.dreamweaverPayload, audioStreamUrl: driveShare } };

  const healthy = fixture(`?song=${songId}`, { releases: [driveRelease] });
  await healthy.initializeDreamweaver();
  assert.equal(healthy.nodes.get("showAudio").src, masterStream, "the canonical master stays primary when Drive is available");
  assert.equal(healthy.state.audioSourceKind, "primary");

  const f = fixture(`?song=${songId}`, { releases: [driveRelease], failingSources: [masterStream] });
  await f.initializeDreamweaver();
  const audio = f.nodes.get("showAudio");
  assert.equal(audio.src, driveDirect, "a failed canonical master falls back to the normalized Drive stream");
  assert.equal(audio.loads, 2);
  assert.deepEqual(audio.playLog, [{ src: driveDirect, muted: true }]);
  assert.equal(f.state.audioSourceKind, "google-drive-fallback");
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

console.log("Dreamweaver playback contracts: canonical binding, four acts, CORS-safe images, deep links, preload, shells, upload fallback, muted autoplay, gesture unmute, and Google Drive fallback passed.");
