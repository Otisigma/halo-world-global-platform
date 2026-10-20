import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fixture } from "./dreamweaver-playback-contracts.mjs";
import { CATALOG_HISTORY_KEY, readRecentTrackIds, recordPlayedTrack } from "../lib/catalog-session.js";

const records = new Map();
const storage = { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value) };
const tracks = Array.from({ length: 4 }, (_, i) => ({
  id: `drive-track-${i}`, title: `Canonical ${i}`, artist: "HALO artist",
  bpm: 120, durationSeconds: 400, energyLevel: ["Warm-up Groove", "Build-up", "Crowd-Lifter", "Peak Anthemic"][i],
  rotationStatus: "Active", releasedAt: "2026-01-01", lastPlayedAt: "",
  driveFileId: `drive-file-id-${i}`, public: true, primaryAudioPath: `/audio/canonical-${i}.mp3`,
  streamUrl: `/audio/canonical-${i}.mp3`, fallbackUrl: `/api/drive-catalog/audio?track=drive-track-${i}`
}));
const driveCatalog = { configured: true, version: 1, tracks };
for (const endpoint of ["song-catalog", "mixes", "radio", "stem-vault"]) {
  const primaryAudioPath = `/api/${endpoint}/audio?id=canonical-master`;
  const canonicalTrack = { ...tracks[0], primaryAudioPath, streamUrl: primaryAudioPath };
  const f = fixture("?curate=20", { driveCatalog: { configured: true, version: 1, tracks: [canonicalTrack] } });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").src, `https://halo.test${primaryAudioPath}`, `${endpoint} extensionless canonical audio must play`);
  assert.equal(f.state.catalogSet.tracks.length, 1, "valid extensionless primaries cannot be silently dropped");
  assert.deepEqual(f.requests, ["/api/drive-catalog"], "extensionless canonical entries never use legacy UUID bindings");
}
{
  const f = fixture("", { driveCatalog, storage });
  await f.initializeDreamweaver();
  assert.equal(f.state.mix, null);
  assert.equal(records.size, 0, "loading or generating must not count as played");
  f.nodes.get("catalogSetDuration").value = "20";
  f.nodes.get("generateCatalogSet").dispatchEvent(new Event("click"));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.state.catalogSet.tracks.length > 1);
  assert.equal(f.state.mix.isDriveCatalogPlayback, true);
  assert.match(f.nodes.get("catalogSetlist").innerHTML, /Canonical/);
  assert.deepEqual(f.requests, ["/api/drive-catalog"], "canonical playback must not request DB assets or mixes");
  assert.deepEqual(readRecentTrackIds(storage), [f.state.mix.id]);
  const firstId = f.state.mix.id;
  f.nodes.get("showAudio").currentTime = f.state.catalogSet.tracks[0].playDurationSeconds;
  f.nodes.get("showAudio").dispatchEvent(new Event("timeupdate"));
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(f.state.mix.id, firstId, "slot duration advances the real audio");
  await f.generateCatalogSet();
  assert.ok(!f.state.catalogSet.tracks.some(track => track.id === firstId), "played tracks must not repeat in a regenerated set");
  const currentId = f.state.mix.id;
  f.nodes.get("showAudio").dispatchEvent(new Event("ended"));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!f.state.catalogSet || f.state.mix.id !== currentId, "ended advances or finishes the canonical set");
}
{
  const f = fixture("?curate=20", { driveCatalog, failingSources: ["https://halo.test/audio/canonical-0.mp3"] });
  await f.initializeDreamweaver();
  assert.match(f.nodes.get("showAudio").src, /\/api\/drive-catalog\/audio\?track=/, "primary failure must try proxy");
  assert.equal(f.state.audioSourceMode, "remote");
}
{
  const f = fixture("?curate=60", { driveCatalog: { configured: true, version: 1, tracks: [] } });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").loads, 0);
  assert.match(f.nodes.get("catalogSetStatus").textContent, /Short by 1:00:00/);
  assert.deepEqual(f.requests, ["/api/drive-catalog"]);
}
{
  const f = fixture("", { catalogError: true });
  await f.initializeDreamweaver();
  assert.deepEqual(f.requests, ["/api/drive-catalog"]);
  assert.match(f.nodes.get("catalogSetStatus").textContent, /no substitute catalog/i);
  assert.equal(f.state.releasePlaybackState, "unavailable", "initialization must not overwrite configured ingestion failure with ready");
  await f.generateCatalogSet();
  assert.deepEqual(f.requests, ["/api/drive-catalog", "/api/drive-catalog"], "generate retries failed ingestion despite the truthy empty catalog marker");
  assert.equal(f.state.catalogSet, null, "a failed ingestion retry cannot be presented as an empty generated set");
  assert.match(f.nodes.get("catalogSetStatus").textContent, /temporarily unavailable/i);
}
{
  records.set(CATALOG_HISTORY_KEY, JSON.stringify(tracks.map(track => track.id)));
  const f = fixture("?curate=20", { driveCatalog, storage });
  await f.initializeDreamweaver();
  assert.equal(f.state.catalogSet.tracks.length, 0);
  f.nodes.get("catalogAllowRecent").checked = true;
  await f.generateCatalogSet();
  assert.ok(f.state.catalogSet.tracks.length);
}
const denied = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
assert.deepEqual(readRecentTrackIds(denied), []);
recordPlayedTrack("test", denied);
{
  const f = fixture("?curate=20", { driveCatalog, storage: denied });
  await f.initializeDreamweaver();
  assert.ok(f.state.mix);
}
{
  const f = fixture("?curate=20", { driveCatalog, storageGetterError: true });
  await f.initializeDreamweaver();
  assert.ok(f.state.mix, "a SecurityError accessing the storage getter must not prevent generating or playing");
  assert.equal(f.state.releasePlaybackState, "playing");
}

{
  // Prompt-driven curation through the real Dreamweaver UI bindings.
  const promptRecords = new Map();
  const promptStorage = { getItem: key => promptRecords.get(key) ?? null, setItem: (key, value) => promptRecords.set(key, value) };
  const styled = Array.from({ length: 12 }, (_, i) => ({
    ...tracks[i % 4], id: `styled-${i}`, title: i === 5 ? "<img src=x onerror=alert(1)>" : `Styled ${i}`,
    genre: i % 2 ? "Deep House" : "Techno", bpm: 122 + (i % 4), durationSeconds: 300, streamUrl: `/audio/styled-${i}.mp3`,
    primaryAudioPath: `/audio/styled-${i}.mp3`, fallbackUrl: `/api/drive-catalog/audio?track=styled-${i}`
  }));
  const f = fixture("", { driveCatalog: { configured: true, version: 1, tracks: styled }, storage: promptStorage });
  await f.initializeDreamweaver();
  assert.match(f.nodes.get("catalogMixPreset").innerHTML, /HALO · Halo X/, "HALO presets are offered");
  assert.equal(promptRecords.size, 0, "rendering presets and loading never records plays");
  f.nodes.get("catalogMixPrompt").value = "Create a 20-minute Halo X mix: warm cinematic opening, deep house build, finish with a big lifter, with a kazoo solo";
  f.nodes.get("catalogMixSeed").value = "Replay-1";
  f.nodes.get("catalogSetDuration").value = "60";
  f.nodes.get("generateCatalogSet").dispatchEvent(new Event("click"));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.nodes.get("catalogSetDuration").value, "20", "a supported duration in the request drives the selector");
  assert.equal(f.state.catalogSet.targetDurationSeconds, 1200);
  assert.equal(f.state.catalogSet.seed, "replay-1");
  assert.match(f.nodes.get("catalogMixIntent").textContent, /Profile: Halo X/);
  assert.match(f.nodes.get("catalogMixIntent").textContent, /Variation code: replay-1/);
  assert.match(f.nodes.get("catalogMixNotes").textContent, /Not understood, so ignored: “kazoo solo”/);
  assert.match(f.nodes.get("catalogSetStatus").textContent, /curated sequence/);
  assert.match(f.nodes.get("catalogSetlist").innerHTML, /BPM/);
  assert.doesNotMatch(f.nodes.get("catalogSetlist").innerHTML, /<img/, "track text is escaped");
  assert.equal(f.nodes.get("generateCatalogSet").disabled, false, "generate re-enables after curation");
  assert.equal(f.nodes.get("catalogCurator").getAttribute("aria-busy"), "false");
  assert.equal(f.state.mix.isDriveCatalogPlayback, true);
  const firstOrder = f.state.catalogSet.tracks.map(track => track.id).join();
  promptRecords.clear();
  await f.generateCatalogSet();
  assert.equal(f.state.catalogSet.tracks.map(track => track.id).join(), firstOrder, "the same variation code and history replay the same set");
  f.nodes.get("catalogMixSeed").value = "";
  await f.generateCatalogSet();
  assert.match(f.state.catalogSet.seed, /^[0-9a-f]{8}$/, "an empty code draws a fresh session nonce");
  f.nodes.get("catalogPresetName").value = "Night Drive";
  f.nodes.get("saveCatalogPreset").dispatchEvent(new Event("click"));
  assert.match(f.nodes.get("catalogPresetStatus").textContent, /Saved “Night Drive”/);
  assert.match(f.nodes.get("catalogMixPreset").innerHTML, /My preset · Night Drive/);
  assert.equal(f.nodes.get("catalogMixPreset").value, "user-night-drive");
  f.nodes.get("deleteCatalogPreset").dispatchEvent(new Event("click"));
  assert.doesNotMatch(f.nodes.get("catalogMixPreset").innerHTML, /Night Drive/);
}
{
  const f = fixture("", { driveCatalog: { configured: true, version: 1, tracks: [{ ...tracks[0], bpm: "fast" }] } });
  await f.initializeDreamweaver();
  await f.generateCatalogSet();
  assert.equal(f.state.catalogSet, null);
  assert.match(f.nodes.get("catalogSetStatus").textContent, /couldn't curate this set right now/, "invalid catalog data shows a friendly message, not raw errors");
  assert.equal(f.nodes.get("generateCatalogSet").disabled, false);
}

const html = await readFile(new URL("../music-world.html", import.meta.url), "utf8");
const dreamweaverHtml = await readFile(new URL("../dreamweaver/index.html", import.meta.url), "utf8");
assert.ok(dreamweaverHtml.indexOf('id="generateCatalogSet"') > dreamweaverHtml.indexOf("</noscript>", dreamweaverHtml.indexOf("<body")), "curator controls must be visible script-enabled DOM, not noscript content");
assert.match(dreamweaverHtml, /<select id="catalogSetDuration"><option value="20">20 minutes<\/option><option value="60" selected>60 minutes<\/option><\/select>/);
assert.match(dreamweaverHtml, /<button[^>]*id="generateCatalogSet"[^>]*type="button"/);
assert.match(dreamweaverHtml, /<label for="catalogMixPrompt">[^<]+<\/label>\s*<textarea id="catalogMixPrompt"[^>]*maxlength="500"/, "the mix request field is labelled and bounded");
assert.match(dreamweaverHtml, /<label for="catalogMixPreset">[^<]+<\/label>\s*<select id="catalogMixPreset">/);
assert.match(dreamweaverHtml, /id="catalogSetStatus" role="status" aria-live="polite"/);
assert.match(dreamweaverHtml, /curated sequence \(not a rendered, beatmatched DJ mix\)/, "the UI never claims a rendered DJ mix");
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
async function storefront(payload, ok = true) {
  const requests = [], nodes = new Map();
  const context = vm.createContext({
    catalog: [], catalogMode: "", audioSourceMode: "empty", playing: false, fallbackCatalog: [{ id: "legacy-preview" }],
    $: id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); },
    fetch: async url => { requests.push(url); return { ok, json: async () => url === "/api/drive-catalog" ? payload : { releases: [{ id: "legacy-db" }] } }; },
    canonicalToTrack: track => track, releaseToTrack: track => track,
    render() {}, toast() {}, setDeck() {}, deckStateFor() {}
  });
  vm.runInContext(section("async function loadPublishedCatalog()", "$('#watchdog').onclick="), context);
  await context.loadPublishedCatalog();
  return { context, requests, nodes };
}
assert.deepEqual((await storefront(driveCatalog)).requests, ["/api/drive-catalog"]);
assert.equal((await storefront(driveCatalog)).context.catalog[0].id, tracks[0].id);
assert.deepEqual((await storefront({ configured: false, tracks: [] })).requests, ["/api/drive-catalog", "/api/release-catalog"]);
assert.equal((await storefront({}, false)).context.catalog.length, 0, "configured failure cannot substitute legacy releases");
assert.equal((await storefront({ configured: true, tracks: [] })).context.catalog.length, 0);
{
  let mediaSrc = "https://halo.test/audio/canonical.mp3";
  const audio = { get src() { return mediaSrc; }, set src(value) { mediaSrc = new URL(value, "https://halo.test").href; }, currentTime: 12, paused: false,
    pause() { this.paused = true; }, load() {}, async play() { this.paused = false; } };
  const track = { id: "canonical", canonical: true, previewUrl: audio.src, fallbackUrl: "/api/drive-catalog/audio?track=canonical" };
  const context = vm.createContext({
    playerTrack: track, audioSourceMode: "remote", playerAudio: () => audio,
    safeHref: value => new URL(value, "https://halo.test").href,
    clearRemoteAudioWatchdog() {}, armRemoteAudioWatchdog() {}, setDeck() {},
    handleStreamUnavailable() { throw new Error("unexpected failure"); }
  });
  vm.runInContext(section("function retryCanonicalStream()", "async function loadPublishedCatalog()"), context);
  assert.equal(context.retryCanonicalStream(), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(audio.src, `https://halo.test${track.fallbackUrl}`, "Music World retries the same track's proxy before local standby");
  assert.equal(audio.currentTime, 12);
  assert.equal(context.retryCanonicalStream(), false, "the proxy must not retry itself");
  context.audioSourceMode = "local";
  audio.src = "blob:https://halo.test/local";
  assert.equal(context.retryCanonicalStream(), false, "catalog failures cannot replace a local upload");
}
{
  const f = fixture("?song=11111111-1111-4111-8111-111111111111", { driveCatalog });
  await f.initializeDreamweaver();
  assert.equal(f.requests.some(url => url === "/api/drive-catalog"), false, "explicit legacy links cannot be replaced by curator initialization");
}
console.log("Catalog player contracts: canonical routing, real playback, advancement, proxy fallback, shortage, safe played history, and storefront selection passed.");
