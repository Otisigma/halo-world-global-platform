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
{
  const f = fixture("", { driveCatalog, storage });
  await f.initializeDreamweaver();
  assert.equal(f.state.mix, null);
  assert.equal(records.size, 0, "loading or generating must not count as played");
  f.nodes.get("catalogSetDuration").value = "20";
  await f.generateCatalogSet();
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

const html = await readFile(new URL("../music-world.html", import.meta.url), "utf8");
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
  const audio = { src: "https://halo.test/audio/canonical.mp3", currentTime: 12, paused: false,
    pause() { this.paused = true; }, load() {}, async play() { this.paused = false; } };
  const track = { id: "canonical", canonical: true, previewUrl: audio.src, fallbackUrl: "https://halo.test/api/drive-catalog/audio?track=canonical" };
  const context = vm.createContext({
    playerTrack: track, audioSourceMode: "remote", playerAudio: () => audio,
    clearRemoteAudioWatchdog() {}, armRemoteAudioWatchdog() {}, setDeck() {},
    handleStreamUnavailable() { throw new Error("unexpected failure"); }
  });
  vm.runInContext(section("function retryCanonicalStream()", "async function loadPublishedCatalog()"), context);
  assert.equal(context.retryCanonicalStream(), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(audio.src, track.fallbackUrl, "Music World retries the same track's proxy before local standby");
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
