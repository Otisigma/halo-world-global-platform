import assert from "node:assert/strict";
import { catalogAudioUrl, generateAutomatedSet, normalizeCatalog } from "../lib/catalog-curator.js";

const track = (id, overrides = {}) => ({
  id, title: `Track ${id}`, artist: "HALO", bpm: 124, durationSeconds: 300,
  energyLevel: "Build-up", rotationStatus: "Fresh", driveFileId: `DriveFile_${id.padStart(10, "0")}`,
  public: true, ...overrides
});
const catalog = tracks => ({ version: 1, tracks });
const now = Date.parse("2026-10-19T12:00:00Z");
const tracks = [
  track("opening", { energyLevel: "Warm-up Groove", bpm: 120 }),
  ...Array.from({ length: 14 }, (_, i) => track(`build_${i}`, { bpm: 122 + i % 3, releasedAt: `2026-10-${String(i + 1).padStart(2, "0")}` })),
  track("lifter", { energyLevel: "Crowd-Lifter", bpm: 125 }),
  track("closer", { energyLevel: "Peak Anthemic", bpm: 128 })
];
const normalized = normalizeCatalog(catalog([track("test", {
  title: "  Satellite  ", bpm: "124", durationSeconds: "310", energyLevel: "warm-up groove",
  primaryAudioPath: "/audio/satellite.mp3"
})])).tracks[0];
assert.equal(normalized.title, "Satellite");
assert.equal(normalized.bpm, 124);
assert.equal(normalized.energyLevel, "Warm-up Groove");
assert.equal(normalized.streamUrl, "/audio/satellite.mp3");
assert.equal(normalized.fallbackUrl, "/api/drive-catalog/audio?track=test");
assert.equal(normalizeCatalog(catalog([track("test")])).tracks[0].streamUrl, "/api/drive-catalog/audio?track=test");
assert.equal(normalizeCatalog(catalog([{ ...track("test"), driveFileId: undefined, googleDriveFallbackUrl: "https://drive.google.com/file/d/DriveFile_1234567890/preview" }])).tracks[0].driveFileId, "DriveFile_1234567890");
for (const input of [
  null, {}, { version: 2, tracks: [] }, catalog([track("same"), track("same")]),
  catalog([track("../escape")]), catalog([track("x", { bpm: 400 })]),
  catalog([track("x", { durationSeconds: 0 })]), catalog([track("x", { durationSeconds: true })]),
  catalog([track("x", { energyLevel: "mystery" })]), catalog([track("x", { rotationStatus: "unknown" })]),
  catalog([track("x", { driveFileId: "short" })]), catalog([track("x", { lastPlayedAt: "yesterday" })]),
  catalog([track("x", { primaryAudioPath: "https://drive.google.com/file/d/DriveFile_12345/preview" })]),
  catalog([track("x", { primaryAudioPath: "javascript:alert(1)" })])
]) assert.throws(() => normalizeCatalog(input));
for (const value of [
  "//evil.test/audio.mp3", "javascript:alert(1)", "data:audio/mp3,abc", "http://evil.test/a.mp3",
  "******halo.test/a.mp3", "/audio/a\\b.mp3", "/audio/a%2fb.mp3", "/api/admin",
  "https://halo.test/not-audio", "/audio/a.mp3#fragment"
]) assert.equal(catalogAudioUrl(value), "", value);
assert.equal(catalogAudioUrl("https://cdn.example/master.flac?version=1"), "https://cdn.example/master.flac?version=1");

for (const minutes of [20, 60]) {
  const before = JSON.stringify(tracks);
  const result = generateAutomatedSet(catalog(tracks), minutes, { now });
  assert.equal(result.complete, true);
  assert.equal(result.durationSeconds, minutes * 60);
  assert.equal(result.shortfallSeconds, 0);
  assert.equal(result.tracks[0].role, "opening");
  assert.equal(result.tracks[0].id, "opening");
  assert.equal(result.tracks.at(-1).id, "closer");
  assert.equal(new Set(result.tracks.map(t => t.id)).size, result.tracks.length);
  assert.equal(result.tracks.reduce((sum, t) => sum + t.playDurationSeconds, 0), minutes * 60);
  for (let i = 0; i < result.tracks.length; i++) {
    const t = result.tracks[i];
    assert.equal(t.slot, i + 1);
    assert.equal(t.startSeconds, result.tracks.slice(0, i).reduce((sum, t) => sum + t.playDurationSeconds, 0));
    assert.ok(t.playDurationSeconds > 0 && t.playDurationSeconds <= t.durationSeconds);
    assert.ok(t.streamUrl.startsWith("/api/drive-catalog/audio?track="));
    if (i) assert.ok(Math.abs(t.bpm - result.tracks[i - 1].bpm) <= 8);
  }
  assert.deepEqual(result, generateAutomatedSet([...tracks].reverse(), minutes, { now }), "catalog ordering must not affect a deterministic set");
  assert.equal(JSON.stringify(tracks), before, "curation never mutates the canonical catalog");
  assert.equal(result.tracks[1].id, "build_13", "newest fresh build wins");
}
const recentTracks = [
  track("rotation", { rotationStatus: "Used-Recently" }),
  track("history"), track("timestamp", { lastPlayedAt: "2026-10-18T12:00:00Z" }),
  track("private", { public: false }), track("eligible", { rotationStatus: "Active" })
];
const excluded = generateAutomatedSet(recentTracks, 20, { now, recentTrackIds: ["history"] });
assert.deepEqual(excluded.tracks.map(t => t.id), ["eligible"]);
assert.equal(excluded.complete, false);
assert.equal(excluded.shortfallSeconds, 900);
const reused = generateAutomatedSet(recentTracks, 20, { now, recentTrackIds: ["history"], allowRecent: true });
assert.equal(reused.complete, true);
assert.equal(reused.tracks.some(t => t.id === "private"), false);
assert.equal(reused.tracks[0].id, "eligible", "explicit reuse still prefers unused tracks");
assert.equal(generateAutomatedSet([], 60, { now }).shortfallSeconds, 3600);
assert.equal(generateAutomatedSet([track("long", { durationSeconds: 2000 })], 20, { now }).tracks[0].playDurationSeconds, 1200);
const disconnected = generateAutomatedSet([
  track("opener", { bpm: 100, energyLevel: "Warm-up Groove" }),
  track("fast", { bpm: 140, energyLevel: "Peak Anthemic" })
], 20, { now });
assert.equal(disconnected.complete, false, "never hide a BPM-disconnected catalog behind unsafe transitions");
assert.equal(disconnected.tracks.length, 1);
assert.throws(() => generateAutomatedSet(tracks, 30));
console.log("Catalog curator contracts passed: validation, safe media, duration, sequence, freshness, history, and shortages.");
