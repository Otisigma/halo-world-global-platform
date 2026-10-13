import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  analyzeFanPreferences,
  generateOptimizedVisualManifest,
  recordEngagementMetric,
  loadVisualManifests,
  getVisualManifestForRelease,
  DEFAULT_DESIGN_CUES,
  TAG_DESIGN_MAP
} from "../lib/halo-creative-engine.js";
import rootCreativeEngine from "../halo-creative-engine.js";
import { buildReleasePromotion, runReleaseConveyor, RELEASE_STAGES } from "../netlify/lib/release-conveyor.mjs";
import { createReleaseConveyorHandler } from "../netlify/lib/release-conveyor-http.mjs";
import { createCreativeManifestHandler } from "../netlify/functions/creative-manifest.mjs";

console.log("[Test] Running HALO Creative Engine Contract Suite...");

// 1. Root and lib export compatibility
assert.equal(typeof rootCreativeEngine.generateOptimizedVisualManifest, "function");
assert.equal(typeof rootCreativeEngine.analyzeFanPreferences, "function");
assert.equal(typeof rootCreativeEngine.recordEngagementMetric, "function");
assert.equal(typeof generateOptimizedVisualManifest, "function");
assert.equal(typeof analyzeFanPreferences, "function");

// 2. Default baseline fallback
const nonExistentPath = path.join(os.tmpdir(), `non-existent-${Date.now()}.json`);
const fallbackCues = analyzeFanPreferences({ metricsPath: nonExistentPath });
assert.deepEqual(fallbackCues, DEFAULT_DESIGN_CUES);
assert.equal(fallbackCues.dominant_mood, "atmospheric deep house");
assert.equal(fallbackCues.top_tag, "Resonance");
assert.equal(fallbackCues.color_palette, "dark amber and obsidian");

// 3. Winning design cues from metric file
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "halo-creative-test-"));
const testMetricsPath = path.join(tempDir, "fan_engagement_metrics.json");
const testManifestPath = path.join(tempDir, "visual_manifests.json");

try {
  // Test winning_design_cues override
  fs.writeFileSync(testMetricsPath, JSON.stringify({
    winning_design_cues: {
      dominant_mood: "underground club pulse",
      top_tag: "Tension",
      color_palette: "deep bronze and matte black"
    }
  }));
  const loadedCues = analyzeFanPreferences({ metricsPath: testMetricsPath });
  assert.equal(loadedCues.dominant_mood, "underground club pulse");
  assert.equal(loadedCues.top_tag, "Tension");
  assert.equal(loadedCues.color_palette, "deep bronze and matte black");

  // Test tag frequency analysis
  fs.writeFileSync(testMetricsPath, JSON.stringify({
    signal_tags: ["Release", "Release", "Clarity", "Resonance"]
  }));
  const tagCues = analyzeFanPreferences({ metricsPath: testMetricsPath });
  assert.equal(tagCues.top_tag, "Release");
  assert.equal(tagCues.dominant_mood, TAG_DESIGN_MAP.Release.dominant_mood);
  assert.equal(tagCues.color_palette, TAG_DESIGN_MAP.Release.color_palette);

  // Test per-track metric analysis
  fs.writeFileSync(testMetricsPath, JSON.stringify({
    tracks: [
      {
        id: "track-123",
        title: "Night Resonance",
        signal_tags: ["Shift", "Shift", "Shift"],
        listening_duration_seconds: 450
      },
      {
        id: "track-456",
        title: "Club Pulse",
        signal_tags: ["Tension", "Tension"],
        listening_duration_seconds: 220
      }
    ]
  }));
  const track1Cues = analyzeFanPreferences({ trackId: "track-123", metricsPath: testMetricsPath });
  assert.equal(track1Cues.top_tag, "Shift");
  assert.equal(track1Cues.dominant_mood, TAG_DESIGN_MAP.Shift.dominant_mood);

  // 4. Visual manifest generation
  const deterministicDate = "2026-10-13T12:00:00.000Z";
  const genResult = generateOptimizedVisualManifest({
    trackTitle: "Something Real",
    artistName: "Owen Anthony",
    trackId: "track-123",
    versionType: "club_mix",
    manifestPath: testManifestPath,
    metricsPath: testMetricsPath,
    createdAt: deterministicDate,
    persist: true
  });

  assert.equal(genResult.success, true);
  const pkg = genResult.assetPackage;
  assert.equal(pkg.release_title, "Something Real");
  assert.equal(pkg.artist, "Owen Anthony");
  assert.equal(pkg.version_type, "club_mix");
  assert.equal(pkg.track_id, "track-123");
  assert.equal(pkg.status, "READY_FOR_GENERATION");
  assert.equal(pkg.created_at, deterministicDate);
  assert.equal(pkg.design_cues_used.top_tag, "Shift");
  assert.match(pkg.generated_prompt, /^Cinematic single cover art for 'Something Real' by Owen Anthony/);
  assert.match(pkg.generated_prompt, /High-end luxury vinyl aesthetic/);
  assert.match(pkg.generated_prompt, /8k resolution/);

  // 5. Persistence and Retrieval
  const manifests = loadVisualManifests(testManifestPath);
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].release_title, "Something Real");

  const retrieved = getVisualManifestForRelease("track-123", testManifestPath);
  assert.equal(retrieved.release_title, "Something Real");

  // 6. Record Engagement Metric
  const recordResult = recordEngagementMetric({
    trackId: "track-789",
    trackTitle: "Read The Room",
    signalTag: "Focus",
    listenDurationMs: 185000,
    replays: 2,
    metricsPath: testMetricsPath
  });
  assert.equal(recordResult.success, true);
  assert.equal(recordResult.recorded.tag, "Focus");

  const afterRecord = analyzeFanPreferences({ trackId: "track-789", metricsPath: testMetricsPath });
  assert.equal(afterRecord.top_tag, "Focus");
  assert.equal(afterRecord.color_palette, TAG_DESIGN_MAP.Focus.color_palette);

  // 7. Release Conveyor Integration
  const sampleSong = {
    id: "98765432-1234-4123-8123-123456789012",
    title: "Read The Room",
    artist_name: "DJ Halo X",
    genre: "Electronic",
    source_updated_at: "2026-10-13T00:00:00.000Z",
    updated_at: "2026-10-13T00:00:00.000Z"
  };
  const sampleVersions = [
    { id: "v-master", song_id: sampleSong.id, version_type: "sale_master", artwork_url: "/art.jpg" },
    { id: "v-club", song_id: sampleSong.id, name: "DJ Mix", version_type: "club_mix" }
  ];
  const promo = buildReleasePromotion(sampleSong, { experienceUrl: "/halo/read-the-room" }, sampleVersions);
  assert.ok(promo.visualManifest, "Promotion must include visualManifest");
  assert.equal(promo.visualManifest.release_title, "Read The Room");
  assert.equal(promo.visualManifest.artist, "DJ Halo X");
  assert.equal(promo.visualManifest.status, "READY_FOR_GENERATION");
  assert.equal(promo.alternateVisualManifests.length, 1);
  assert.equal(promo.alternateVisualManifests[0].release_title, "Read The Room (DJ Mix)");
  assert.equal(promo.alternateVisualManifests[0].version_type, "club_mix");

  // 8. Creative Manifest HTTP API Handler
  let crossOrigin = false;
  const handler = createCreativeManifestHandler({
    manifestPath: testManifestPath,
    metricsPath: testMetricsPath,
    verifyRequestOrigin: () => {
      if (crossOrigin) throw new Error("cross origin");
    }
  });

  // GET preferences
  const getPrefReq = new Request("https://halo.test/api/creative-manifest?action=preferences&trackTitle=Something%20Real");
  const getPrefRes = await handler(getPrefReq);
  assert.equal(getPrefRes.status, 200);
  const getPrefBody = await getPrefRes.json();
  assert.equal(getPrefBody.success, true);
  assert.ok(getPrefBody.preferences.dominant_mood);

  // GET manifest preview
  const getGenReq = new Request("https://halo.test/api/creative-manifest?trackTitle=A%20Signal&artistName=Owen%20Anthony");
  const getGenRes = await handler(getGenReq);
  assert.equal(getGenRes.status, 200);
  const getGenBody = await getGenRes.json();
  assert.equal(getGenBody.success, true);
  assert.equal(getGenBody.assetPackage.release_title, "A Signal");

  // GET list
  const getListReq = new Request("https://halo.test/api/creative-manifest?action=list");
  const getListRes = await handler(getListReq);
  assert.equal(getListRes.status, 200);
  const getListBody = await getListRes.json();
  assert.equal(getListBody.success, true);
  assert.ok(Array.isArray(getListBody.manifests));

  // POST generate_manifest
  const postGenReq = new Request("https://halo.test/api/creative-manifest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "generate_manifest",
      trackTitle: "Uniting The Room",
      artistName: "DJ Halo X",
      versionType: "radio_edit"
    })
  });
  const postGenRes = await handler(postGenReq);
  assert.equal(postGenRes.status, 200);
  const postGenBody = await postGenRes.json();
  assert.equal(postGenBody.success, true);
  assert.equal(postGenBody.assetPackage.release_title, "Uniting The Room");
  assert.equal(postGenBody.assetPackage.artist, "DJ Halo X");

  // POST record_metric
  const postRecordReq = new Request("https://halo.test/api/creative-manifest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "record_metric",
      trackTitle: "Uniting The Room",
      signalTag: "Resonance",
      listenDurationMs: 240000,
      replays: 3
    })
  });
  const postRecordRes = await handler(postRecordReq);
  assert.equal(postRecordRes.status, 200);
  const postRecordBody = await postRecordRes.json();
  assert.equal(postRecordBody.success, true);

  // POST method validation and errors
  const deleteReq = new Request("https://halo.test/api/creative-manifest", { method: "DELETE" });
  assert.equal((await handler(deleteReq)).status, 405);

  const badJsonReq = new Request("https://halo.test/api/creative-manifest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "bad json"
  });
  assert.equal((await handler(badJsonReq)).status, 400);

  const crossOriginHandler = createCreativeManifestHandler({
    verifyRequestOrigin: () => { throw new Error("cross origin"); }
  });
  const crossReq = new Request("https://halo.test/api/creative-manifest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "generate_manifest" })
  });
  assert.equal((await crossOriginHandler(crossReq)).status, 403);

} finally {
  // Cleanup test temporary directory
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("[Test] HALO Creative Engine Contract Suite passed successfully.");
