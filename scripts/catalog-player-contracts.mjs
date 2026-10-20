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
const disclosureKey = "halo:dreamweaver-curator-expanded";
const toggleCurator = f => f.nodes.get("catalogCuratorToggle").dispatchEvent(new Event("click"));
const playCatalogSlot = async (f, slot = 0) => {
  const click = new Event("click");
  Object.defineProperty(click, "target", { value: { closest: () => ({ dataset: { catalogSlot: String(slot) } }) } });
  f.nodes.get("catalogSetlist").dispatchEvent(click);
  await new Promise(resolve => setImmediate(resolve));
};
const assertDisclosure = (f, expanded) => {
  assert.equal(f.nodes.get("catalogCuratorContent").hidden, !expanded);
  assert.equal(f.nodes.get("catalogCuratorToggle").getAttribute("aria-expanded"), String(expanded));
  assert.equal(f.nodes.get("catalogCuratorToggle").getAttribute("aria-label"), `${expanded ? "Collapse" : "Expand"} Dreamweaver Catalog Curator`);
  assert.equal(f.nodes.get("catalogCuratorToggleLabel").textContent, expanded ? "Collapse curator" : "Expand curator");
  assert.equal(f.nodes.get("catalogCuratorToggleIcon").textContent, expanded ? "−" : "+");
};
for (const saved of [null, "false", "true", "invalid"]) {
  const preferences = new Map(saved === null ? [] : [[disclosureKey, saved]]);
  const storage = { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) };
  const f = fixture("", { storage });
  assertDisclosure(f, saved === "true");
  toggleCurator(f);
  assertDisclosure(f, saved !== "true");
  assert.equal(preferences.get(disclosureKey), String(saved !== "true"));
  assertDisclosure(fixture("", { storage }), saved !== "true");
  toggleCurator(f);
  assertDisclosure(f, saved === "true");
}
for (const options of [
  { storageGetterError: true },
  { storage: { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } } },
  { storage: { getItem: () => "true", setItem() { throw new Error("QuotaExceededError"); } } }
]) {
  const f = fixture("", options);
  const expanded = f.nodes.get("catalogCuratorToggle").getAttribute("aria-expanded") === "true";
  toggleCurator(f);
  assertDisclosure(f, !expanded);
  toggleCurator(f);
  assertDisclosure(f, expanded);
}
for (const [options, expected] of [
  [{ driveCatalog }, "CATALOG SYNCED"],
  [{ driveCatalog: { configured: true, version: 1, tracks: [] } }, "CATALOG EMPTY"],
  [{}, "CATALOG STANDBY"],
  [{ catalogError: true }, "CATALOG UNAVAILABLE"]
]) {
  const f = fixture("", options);
  const initialization = f.initializeDreamweaver();
  assert.equal(f.nodes.get("catalogSyncStatus").textContent, "CATALOG LOADING");
  assertDisclosure(f, false);
  await initialization;
  assert.equal(f.nodes.get("catalogSyncStatus").textContent, expected);
  assertDisclosure(f, false);
}
{
  const f = fixture("", { driveCatalog });
  await f.initializeDreamweaver();
  toggleCurator(f);
  const prompt = f.nodes.get("catalogMixPrompt");
  prompt.value = "Warm opening, deep-house build";
  f.nodes.get("catalogSetDuration").value = "20";
  await f.generateCatalogSet();
  const setlist = f.nodes.get("catalogSetlist");
  const results = setlist.innerHTML;
  const mix = f.state.mix;
  const audio = f.nodes.get("showAudio");
  const plays = audio.plays;
  assert.match(results, /Canonical/);
  toggleCurator(f);
  assertDisclosure(f, false);
  toggleCurator(f);
  assertDisclosure(f, true);
  assert.equal(f.nodes.get("catalogMixPrompt"), prompt);
  assert.equal(prompt.value, "Warm opening, deep-house build");
  assert.equal(f.nodes.get("catalogSetDuration").value, "20");
  assert.equal(f.nodes.get("catalogSetlist"), setlist);
  assert.equal(setlist.innerHTML, results);
  assert.equal(f.state.mix, mix);
  assert.equal(audio.plays, plays, "disclosure never starts or interrupts playback");
  assert.equal(audio.paused, true, "generating a set never starts audio");
  assert.equal(audio.loads, 0, "generation only renders canonical cards until a Play action");
}
for (const endpoint of ["song-catalog", "mixes", "radio", "stem-vault"]) {
  const primaryAudioPath = `/api/${endpoint}/audio?id=canonical-master`;
  const canonicalTrack = { ...tracks[0], primaryAudioPath, streamUrl: primaryAudioPath };
  const f = fixture("?curate=20", { driveCatalog: { configured: true, version: 1, tracks: [canonicalTrack] } });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").loads, 0, "curate query generates cards without autoplay");
  await playCatalogSlot(f);
  assert.equal(f.nodes.get("showAudio").src, `https://halo.test${primaryAudioPath}`, `${endpoint} extensionless canonical audio must play`);
  assert.equal(f.state.catalogSet.tracks.length, 1, "valid extensionless primaries cannot be silently dropped");
  assert.deepEqual(f.requests, ["/api/drive-catalog"], "extensionless canonical entries never use legacy UUID bindings");
}
{
  const f = fixture("", { driveCatalog, storage });
  await f.initializeDreamweaver();
  assert.equal(f.state.mix, null);
  assert.equal(f.nodes.get("catalogSyncStatus").textContent, "CATALOG SYNCED");
  assert.equal(f.nodes.get("catalogSyncStatus").dataset.state, "synced");
  assert.equal(records.size, 0, "loading or generating must not count as played");
  f.nodes.get("catalogSetDuration").value = "20";
  const generation = f.generateCatalogSet();
  assert.equal(f.nodes.get("catalogStepRequest").getAttribute("aria-current"), "step");
  assert.equal(f.nodes.get("catalogStepRequestStatus").textContent, "In progress");
  assert.equal(f.nodes.get("generateCatalogSet").disabled, true);
  await generation;
  for (const step of ["Request", "Catalog", "Rank", "Sequence"]) {
    assert.equal(f.nodes.get(`catalogStep${step}`).dataset.state, "done");
    assert.equal(f.nodes.get(`catalogStep${step}`).getAttribute("aria-current"), undefined);
    assert.equal(f.nodes.get(`catalogStep${step}Status`).textContent, "Done");
  }
  assert.ok(f.state.catalogSet.tracks.length > 1);
  assert.equal(f.state.mix, null, "curation does not select or play a track");
  assert.match(f.nodes.get("catalogSetlist").innerHTML, /Canonical/);
  assert.match(f.nodes.get("catalogSetlist").innerHTML, /120 BPM · opening · Warm-up Groove/);
  assert.match(f.nodes.get("catalogSetlist").innerHTML, /Scheduled 06:40 · starts 00:00/);
  assert.match(f.nodes.get("catalogSetlist").innerHTML, /Primary audio · scheduled/);
  assert.equal(f.nodes.get("catalogTrackRoute0").textContent, "Primary audio · scheduled", "optional proxy availability does not imply active fallback");
  assert.equal(f.nodes.get("catalogTrackPlay0").getAttribute("aria-current"), undefined);
  assert.equal(f.nodes.get("showAudio").plays, 0, "audio starts only after an explicit Play action");
  assert.equal(f.nodes.get("catalogUploadLocal").hidden, true);
  await playCatalogSlot(f);
  assert.equal(f.nodes.get("catalogTrackRoute0").textContent, "Primary audio · playing", "Play starts the selected stream audibly");
  assert.deepEqual(f.requests, ["/api/drive-catalog"], "canonical playback must not request DB assets or mixes");
  assert.deepEqual(readRecentTrackIds(storage), [f.state.mix.id]);
  const firstId = f.state.mix.id;
  f.nodes.get("showAudio").currentTime = f.state.catalogSet.tracks[0].playDurationSeconds;
  f.nodes.get("showAudio").dispatchEvent(new Event("timeupdate"));
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(f.state.mix.id, firstId, "slot duration advances the real audio");
  assert.equal(f.nodes.get("catalogTrackPlay0").getAttribute("aria-current"), undefined);
  assert.equal(f.nodes.get("catalogTrackPlay1").getAttribute("aria-current"), "true");
  const currentId = f.state.mix.id;
  f.nodes.get("showAudio").dispatchEvent(new Event("ended"));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.state.catalogIndex >= f.state.catalogSet.tracks.length || f.state.mix.id !== currentId, "ended advances or finishes a user-started sequence");
  await f.generateCatalogSet();
  assert.ok(!f.state.catalogSet.tracks.some(track => track.id === firstId), "played tracks must not repeat in a regenerated set");
  assert.equal(f.state.catalogPlaybackStarted, false, "a newly generated sequence waits for its own Play action");
  const generatedSetMix = f.state.mix;
  f.nodes.get("showAudio").dispatchEvent(new Event("ended"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.mix, generatedSetMix, "an old player's ended event cannot autoplay a newly generated set");
}
{
  const f = fixture("?curate=20", { driveCatalog, failingSources: ["https://halo.test/audio/canonical-0.mp3"] });
  await f.initializeDreamweaver();
  await playCatalogSlot(f);
  assert.match(f.nodes.get("showAudio").src, /\/api\/drive-catalog\/audio\?track=/, "primary failure must try proxy");
  assert.equal(f.state.audioSourceMode, "remote");
  assert.equal(f.nodes.get("catalogTrackRoute0").textContent, "HALO proxy fallback · playing");
  assert.match(f.nodes.get("catalogTrackStatus").textContent, /Slot 1: Canonical 0 — HALO proxy fallback/);
  assert.equal(f.nodes.get("catalogUploadLocal").hidden, true);
}
{
  const proxyOnly = { ...tracks[0], primaryAudioPath: "", streamUrl: tracks[0].fallbackUrl, fallbackUrl: "" };
  const f = fixture("?curate=20", { driveCatalog: { configured: true, version: 1, tracks: [proxyOnly] } });
  await f.initializeDreamweaver();
  await playCatalogSlot(f);
  assert.equal(f.nodes.get("catalogTrackRoute0").textContent, "HALO proxy · playing", "proxy-only sources are not described as fallback");
}
{
  const f = fixture("?curate=20", { driveCatalog, blocked: true });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").plays, 0, "catalog loading does not issue a play request");
  await playCatalogSlot(f);
  assert.equal(f.nodes.get("showAudio").plays, 1, "an explicit Play action may request playback");
  assert.equal(f.nodes.get("catalogTrackRoute0").textContent, "Primary audio · ready");
  assert.equal(f.nodes.get("catalogUploadLocal").hidden, true, "playback denial is not a stream failure");
}
for (const failure of ["load", "error", "watchdog"]) {
  const primary = "https://halo.test/audio/canonical-0.mp3";
  const proxy = `https://halo.test${tracks[0].fallbackUrl}`;
  const failedHistory = new Map();
  const f = fixture("?curate=20", {
    driveCatalog, failingSources: failure === "load" ? [primary, proxy] : [proxy],
    storage: { getItem: key => failedHistory.get(key) || null, setItem: (key, value) => failedHistory.set(key, value) }
  });
  await f.initializeDreamweaver();
  await playCatalogSlot(f);
  const audio = f.nodes.get("showAudio");
  if (failure === "error") audio.dispatchEvent(new Event("error"));
  if (failure === "watchdog") {
    audio.readyState = 0;
    f.armRemoteAudioWatchdog();
    f.timers.get(f.state.remoteAudioWatchdog)();
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(audio.src, proxy, `${failure}: primary failure tries only the existing proxy`);
  assert.equal(f.state.audioSourceMode, "error");
  assert.equal(f.shouldPromptLocalUpload(), true);
  assert.equal(f.nodes.get("catalogTrackRoute0").textContent, "HALO proxy fallback · unavailable");
  assert.match(f.nodes.get("catalogTrackStatus").textContent, /Upload a local mix or choose another track/);
  assert.equal(f.nodes.get("catalogUploadLocal").hidden, false);
  if (failure === "load") assert.deepEqual(readRecentTrackIds({ getItem: key => failedHistory.get(key) || null }), [], "failed primary and proxy attempts are never counted as played");
  f.nodes.get("catalogUploadLocal").dispatchEvent(new Event("click"));
  assert.equal(f.nodes.get("mixFileInput").clicks, 1, "card fallback opens the existing upload picker");
  const local = Object.assign(new Blob(["local audio"], { type: "audio/wav" }), { name: "Local mix.wav" });
  await f.activateLocalMixFile(local);
  assert.equal(f.state.audioSourceMode, "local");
  assert.match(audio.src, /^blob:/);
  assert.equal(f.state.catalogSet, null, "local playback cannot be advanced by catalog events");
  assert.equal(f.nodes.get("catalogSetlist").innerHTML, "", "stale stream actions are removed for a local upload");
  assert.equal(f.nodes.get("catalogUploadLocal").hidden, true);
  const localSource = audio.src;
  audio.dispatchEvent(new Event("ended"));
  audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(audio.src, localSource);
  assert.match(f.nodes.get("catalogTrackStatus").textContent, /Local mix selected/);
}
{
  const f = fixture("?curate=60", { driveCatalog: { configured: true, version: 1, tracks: [] } });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("showAudio").loads, 0);
  assert.match(f.nodes.get("catalogSetStatus").textContent, /Short by 1:00:00/);
  assert.equal(f.nodes.get("catalogSyncStatus").textContent, "CATALOG EMPTY");
  assert.equal(f.nodes.get("catalogStepSequenceStatus").textContent, "No eligible tracks");
  assert.notEqual(f.nodes.get("catalogStepSequence").dataset.state, "done");
  assert.deepEqual(f.requests, ["/api/drive-catalog"]);
}
{
  const f = fixture("", { catalogError: true });
  await f.initializeDreamweaver();
  assert.deepEqual(f.requests, ["/api/drive-catalog"]);
  assert.match(f.nodes.get("catalogSetStatus").textContent, /no substitute catalog/i);
  assert.equal(f.nodes.get("catalogSyncStatus").dataset.state, "error");
  assert.doesNotMatch(f.nodes.get("catalogSyncStatus").textContent, /SYNCED/);
  assert.equal(f.state.driveCatalog, null, "failed loading must not leave a configured catalog marker");
  assert.equal(f.state.releasePlaybackState, "unavailable", "initialization must not overwrite configured ingestion failure with ready");
  await f.generateCatalogSet();
  assert.deepEqual(f.requests, ["/api/drive-catalog", "/api/drive-catalog"], "generate retries failed ingestion");
  assert.equal(f.state.catalogSet, null, "a failed ingestion retry cannot be presented as an empty generated set");
  assert.equal(f.nodes.get("catalogStepCatalogStatus").textContent, "Unavailable");
  assert.equal(f.nodes.get("catalogStepRankStatus").textContent, "Waiting");
  assert.match(f.nodes.get("catalogSetStatus").textContent, /temporarily unavailable/i);
}
for (const payload of [{ configured: false, tracks: [] }, { configured: true }, { configured: true, tracks: null }]) {
  const f = fixture("", { driveCatalog: payload });
  await f.initializeDreamweaver();
  assert.equal(f.nodes.get("catalogSyncStatus").dataset.state, payload.configured ? "error" : "standby");
  assert.doesNotMatch(f.nodes.get("catalogSyncStatus").textContent, /SYNCED/);
  await f.generateCatalogSet();
  assert.equal(f.nodes.get("catalogStepCatalogStatus").textContent, payload.configured ? "Unavailable" : "Standby");
  assert.equal(f.nodes.get("catalogStepSequenceStatus").textContent, "Waiting");
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
  assert.equal(f.state.mix, null);
  await playCatalogSlot(f);
  assert.ok(f.state.mix);
}
{
  const f = fixture("?curate=20", { driveCatalog, storageGetterError: true });
  await f.initializeDreamweaver();
  assert.equal(f.state.mix, null);
  await playCatalogSlot(f);
  assert.ok(f.state.mix, "a SecurityError accessing the storage getter must not prevent generating or playing");
  assert.equal(f.state.releasePlaybackState, "playing");
}

{
  // Prompt-driven curation through the real Dreamweaver UI bindings.
  const promptRecords = new Map();
  const promptStorage = { getItem: key => promptRecords.get(key) ?? null, setItem: (key, value) => promptRecords.set(key, value) };
  const styled = Array.from({ length: 12 }, (_, i) => ({
    ...tracks[i % 4], id: `styled-${i}`, title: `<img src=x onerror=alert(1)> Styled ${i}`, artist: 'Artist " <svg onload=alert(1)> & \'',
    genre: i % 2 ? "Deep House" : "Techno", bpm: 122 + (i % 4), durationSeconds: 300, streamUrl: `/audio/styled-${i}.mp3`,
    primaryAudioPath: `/audio/styled-${i}.mp3`, fallbackUrl: `/api/drive-catalog/audio?track=styled-${i}`
  }));
  const f = fixture("", { driveCatalog: { configured: true, version: 1, tracks: styled }, storage: promptStorage });
  await f.initializeDreamweaver();
  assert.match(f.nodes.get("catalogMixPreset").innerHTML, /HALO · Halo X/, "HALO presets are offered");
  assert.match(f.nodes.get("catalogMixPreset").innerHTML, /The French Connection \(Deep \/ Hypnotic\)/);
  assert.match(f.nodes.get("catalogMixPreset").innerHTML, /Halo X Club Anthem Sprint/);
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
  const setlist = f.nodes.get("catalogSetlist").innerHTML;
  assert.match(setlist, /#01/);
  assert.match(setlist, /&lt;img/);
  assert.match(setlist, /&quot; &lt;svg/);
  assert.match(setlist, /data-catalog-slot="0" aria-label="Play stream: &lt;img/);
  assert.match(setlist, /by Artist &quot; &lt;svg onload=alert\(1\)&gt; &amp; &#39;, slot 1" aria-describedby="catalogTrackRoute0"/, "accessible names escape quotes, markup, and ampersands");
  assert.doesNotMatch(setlist, /<img|<svg|drive\.google|drive-file-id|href=|https:\/\//, "metadata and playback labels are escaped; no raw media URLs are rendered");
  assert.doesNotMatch(setlist, /drive-track-|drive-file-id-|data-version-id|<iframe/i, "cards expose no raw catalog IDs, arbitrary version IDs, or Drive previews");
  assert.equal(f.nodes.get("generateCatalogSet").disabled, false, "generate re-enables after curation");
  assert.equal(f.nodes.get("catalogCurator").getAttribute("aria-busy"), "false");
  assert.equal(f.state.mix, null, "card rendering does not trigger playback");
  assert.equal(f.nodes.get("showAudio").plays, 0);
  const playSlot = slot => {
    const click = new Event("click");
    Object.defineProperty(click, "target", { value: { closest: () => ({ dataset: { catalogSlot: String(slot) } }) } });
    f.nodes.get("catalogSetlist").dispatchEvent(click);
  };
  playSlot(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.mix.id, f.state.catalogSet.tracks[0].id, "Play action selects the canonical card in the shared player");
  assert.equal(f.nodes.get("showAudio").plays, 1, "the card action initiates actual playback");
  assert.equal(f.nodes.get("catalogTrackPlay0").getAttribute("aria-current"), "true");
  playSlot(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.mix.id, f.state.catalogSet.tracks[1].id, "setlist actions use the existing sequential player");
  assert.equal(f.nodes.get("showAudio").src, `https://halo.test${f.state.catalogSet.tracks[1].streamUrl}`);
  assert.equal(f.nodes.get("catalogTrackPlay1").getAttribute("aria-current"), "true");
  assert.equal(f.nodes.get("catalogTrackPlay0").getAttribute("aria-current"), undefined);
  const currentId = f.state.mix.id;
  playSlot(-1);
  playSlot(1.5);
  playSlot(9999);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.mix.id, currentId, "invalid slot actions cannot change playback");
  for (let i = f.state.catalogIndex; i < f.state.catalogSet.tracks.length; i++) {
    f.nodes.get("showAudio").dispatchEvent(new Event("ended"));
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.match(f.nodes.get("catalogSetStatus").textContent, /Playback finished/);
  assert.equal(f.nodes.get("showAudio").paused, true);
  assert.match(f.nodes.get("catalogTrackStatus").textContent, /Playback finished.*replay/);
  assert.equal(f.nodes.get(`catalogTrackPlay${f.state.catalogSet.tracks.length - 1}`).getAttribute("aria-current"), undefined);
  playSlot(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.mix.id, f.state.catalogSet.tracks[0].id, "stream actions can replay a completed set");
  assert.equal(f.nodes.get("catalogTrackPlay0").getAttribute("aria-current"), "true");
  const firstOrder = f.state.catalogSet.tracks.map(track => track.id).join();
  promptRecords.clear();
  await f.generateCatalogSet();
  assert.equal(f.state.catalogSet.tracks.map(track => track.id).join(), firstOrder, "the same variation code and history replay the same set");
  f.nodes.get("catalogMixSeed").value = "";
  await f.generateCatalogSet();
  assert.match(f.state.catalogSet.seed, /^[0-9a-f]{8}$/, "an empty code draws a fresh session nonce");
  f.nodes.get("catalogPresetName").value = " Night <Drive> ";
  f.nodes.get("saveCatalogPreset").dispatchEvent(new Event("click"));
  assert.match(f.nodes.get("catalogPresetStatus").textContent, /Saved “Night Drive”/);
  assert.match(f.nodes.get("catalogMixPreset").innerHTML, /My preset · Night Drive/);
  assert.equal(f.nodes.get("catalogMixPreset").value, "user-night-drive");
  f.nodes.get("catalogPresetName").value = "Halo X Club Anthem Sprint";
  f.nodes.get("saveCatalogPreset").dispatchEvent(new Event("click"));
  assert.match(f.nodes.get("catalogPresetStatus").textContent, /not a HALO preset name/);
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
  assert.equal(f.nodes.get("catalogStepRankStatus").textContent, "Could not curate");
  assert.equal(f.nodes.get("catalogStepSequenceStatus").textContent, "Waiting");
}

const html = await readFile(new URL("../music-world.html", import.meta.url), "utf8");
const dreamweaverHtml = await readFile(new URL("../dreamweaver/index.html", import.meta.url), "utf8");
assert.ok(dreamweaverHtml.indexOf('id="generateCatalogSet"') > dreamweaverHtml.indexOf("</noscript>", dreamweaverHtml.indexOf("<body")), "curator controls must be visible script-enabled DOM, not noscript content");
assert.match(dreamweaverHtml, /<select id="catalogSetDuration"><option value="20">20 minutes<\/option><option value="60" selected>60 minutes<\/option><\/select>/);
assert.match(dreamweaverHtml, /<button[^>]*id="generateCatalogSet"[^>]*type="button"/);
assert.match(dreamweaverHtml, /<label for="catalogMixPrompt">[^<]+<\/label>\s*<textarea id="catalogMixPrompt"[^>]*maxlength="500"/, "the mix request field is labelled and bounded");
assert.match(dreamweaverHtml, /<label for="catalogMixPreset">[^<]+<\/label>\s*<select id="catalogMixPreset"[^>]*aria-describedby="catalogMixPresetDescription"/);
assert.match(dreamweaverHtml, /id="catalogSetStatus" role="status" aria-live="polite"/);
assert.match(dreamweaverHtml, /id="catalogTrackStatus" role="status" aria-live="polite"/);
assert.match(dreamweaverHtml, /<button id="catalogUploadLocal" type="button" hidden>/);
assert.match(dreamweaverHtml, /Curated Sequence &amp; Vault Players/);
assert.equal((dreamweaverHtml.match(/<audio\b/g) || []).length, 1, "cards retain a single shared audio instance");
assert.match(dreamweaverHtml, /curated sequence \(not a rendered, beatmatched DJ mix\)/, "the UI never claims a rendered DJ mix");
assert.match(dreamweaverHtml, /id="catalogCuratorTitle">Dreamweaver Catalog Curator/);
assert.match(dreamweaverHtml, /Natural prompt curation linked to Google Drive Master Vault/);
assert.match(dreamweaverHtml, /<label for="catalogMixPreset">HALO profile preset<\/label>/);
assert.match(dreamweaverHtml, /<label for="catalogMixSeed">Variation code \(optional\)<\/label>/);
assert.match(dreamweaverHtml, /Your linked song or mix remains active until you choose a track from a generated set\./);
assert.match(dreamweaverHtml, /<button[^>]+id="generateCatalogSet"[^>]*>Generate set<\/button>/);
assert.match(dreamweaverHtml, /<ol class="catalog-curator__steps" aria-label="Set generation progress">/);
for (const step of ["Request", "Catalog", "Rank", "Sequence"]) {
  assert.match(dreamweaverHtml, new RegExp(`<li id="catalogStep${step}" data-state="pending">`));
  assert.match(dreamweaverHtml, new RegExp(`id="catalogStep${step}Status">Waiting</small>`));
}
assert.doesNotMatch(dreamweaverHtml.slice(dreamweaverHtml.indexOf('id="catalogCurator"'), dreamweaverHtml.indexOf('id="dreamweaverSatellite"')), /<iframe|masterVaultCatalog|onclick=|<details[^>]*id="catalogCurator"/);
assert.match(dreamweaverHtml, /id="catalogSyncStatus" role="status" aria-live="polite" data-state="loading">CATALOG LOADING/);
assert.match(dreamweaverHtml, /<button id="catalogCuratorToggle" type="button" aria-expanded="false" aria-controls="catalogCuratorContent" aria-label="Expand Dreamweaver Catalog Curator">/);
assert.match(dreamweaverHtml, /id="catalogCuratorToggleIcon" aria-hidden="true">\+<\/span>/);
assert.match(dreamweaverHtml, /<div class="catalog-curator__workspace" id="catalogCuratorContent" hidden>/);
const curatorHeader = dreamweaverHtml.slice(dreamweaverHtml.indexOf('<section class="catalog-curator"'), dreamweaverHtml.indexOf('id="catalogCuratorContent"'));
assert.match(curatorHeader, /id="catalogCuratorTitle"/);
assert.match(curatorHeader, /id="catalogSyncStatus" role="status" aria-live="polite"/);
assert.doesNotMatch(curatorHeader, /\bhidden(?:\s|>)/, "the heading, toggle and live catalog status stay outside the hidden workspace");
for (const id of ["catalogSetDuration", "catalogMixSeed", "catalogPresetName"]) {
  assert.match(dreamweaverHtml, new RegExp(`<label for="${id}">`), `${id} has an explicit accessible label`);
}
assert.match(dreamweaverHtml, /<label><input id="catalogAllowRecent" type="checkbox">/);
assert.match(dreamweaverHtml, /<summary>Save this request as my preset<\/summary>/);
assert.match(dreamweaverHtml, /id="catalogMixPrompt"[^>]+aria-describedby="catalogMixPromptHelp"/);
assert.match(dreamweaverHtml, /id="catalogMixSeed"[^>]+aria-describedby="catalogReplayHelp"/);
assert.match(dreamweaverHtml, /id="generateCatalogSet"[^>]+aria-describedby="catalogPlaybackHelp catalogLinkedNotice"/);
const curatorCss = await readFile(new URL("../dreamweaver/dreamweaver.css", import.meta.url), "utf8");
assert.match(curatorCss, /@media \(max-width: 760px\)/);
assert.match(curatorCss, /\.catalog-curator :is\(button, input, select, textarea, summary\):focus-visible/);
assert.match(curatorCss, /prefers-reduced-motion: reduce[^}]+\.catalog-curator/s);
assert.match(curatorCss, /\.catalog-curator h2[^}]+var\(--serif\)/);
assert.match(curatorCss, /\.catalog-curator__workspace[^}]+grid-template-columns/);
assert.match(curatorCss, /\.catalog-curator__workspace\[hidden\]\s*\{\s*display: none;/, "hidden must override the workspace grid display");
assert.match(curatorCss, /@media \(max-width: 1100px\)[^}]+\.catalog-curator__workspace[^}]+grid-template-columns: 1fr/s);
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
  assert.equal(f.nodes.get("catalogSyncStatus").dataset.state, "standby");
  assert.equal(f.nodes.get("catalogLinkedNotice").hidden, false);
  const linkedMix = f.state.mix;
  const linkedSource = f.nodes.get("showAudio").src;
  await f.generateCatalogSet();
  assert.equal(f.state.mix, linkedMix, "generating cards alone preserves linked playback");
  assert.equal(f.nodes.get("showAudio").src, linkedSource);
  assert.equal(f.nodes.get("catalogLinkedNotice").hidden, false);
  await playCatalogSlot(f);
  assert.notEqual(f.state.mix, linkedMix);
  assert.equal(f.state.mix.isDriveCatalogPlayback, true, "choosing a track explicitly replaces a linked item");
  assert.equal(f.nodes.get("catalogLinkedNotice").hidden, true);
}
for (const search of ["?song=11111111-1111-4111-8111-111111111111", "?mix=linked-mix-id"]) {
  for (const options of [
    { catalogError: true },
    { driveCatalog: { configured: true, version: 1, tracks: [] } },
    { driveCatalog: { configured: false, tracks: [] } }
  ]) {
    const f = fixture(search, options);
    await f.initializeDreamweaver();
    const linkedMix = f.state.mix;
    const linkedSource = f.nodes.get("showAudio").src;
    await f.generateCatalogSet();
    assert.equal(f.state.mix, linkedMix, "unavailable, empty or standby catalogs cannot replace linked playback");
    assert.equal(f.nodes.get("showAudio").src, linkedSource);
    assert.equal(f.nodes.get("catalogLinkedNotice").hidden, false);
    assert.notEqual(f.nodes.get("catalogStepSequence").dataset.state, "done");
    assert.equal(f.nodes.get("catalogCurator").getAttribute("aria-busy"), "false");
    assert.equal(f.nodes.get("generateCatalogSet").disabled, false);
  }
}
console.log("Catalog player contracts: canonical routing, real playback, advancement, proxy fallback, shortage, safe played history, and storefront selection passed.");
