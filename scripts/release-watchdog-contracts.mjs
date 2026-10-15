import assert from "node:assert/strict";
import { RELEASE_AGENT_INTENT, RELEASE_STAGES } from "../lib/release-conveyor-stages.js";
import { metadataTemplate, planReleaseRepairs, inspectReleaseAssets, createInfrastructureChecker,
  healCatalogRelease, releaseWatchdogDiagnostics, WATCHDOG_ROUTES } from "../netlify/lib/release-conveyor-watchdog.mjs";
import { processCatalogRelease } from "../netlify/lib/release-conveyor-service.mjs";
import { serveMedia } from "../netlify/functions/videos.mjs";

const song = { id: "song", owner_member_id: "creator", title: "Signal", artist_name: "Artist", genre: "Soul",
  isrc: "GB-AAA-26-00001", rights_status: "cleared", artwork_url: "/cover.jpg",
  lyrics_text: "[00:15] The room goes quiet", updated_at: "2026-10-15T10:00:00Z", metadata_issues: [] };
const master = { id: "master", song_id: song.id, version_type: "sale_master", audio_url: "/master.wav",
  mastering_status: "approved", duration_seconds: 180, video_url: "/loop.mp4", audio_byte_size: 123,
  audio_blob_prefix: "creator/master/upload/parts/", updated_at: song.updated_at };
const radio = { id: "radio", song_id: song.id, version_type: "radio_edit", audio_url: "",
  mastering_status: "not_started", updated_at: song.updated_at };
const versions = [master, radio];
const template = metadataTemplate(song, versions);
assert.equal(template.isrc, "GBAAA2600001");
assert.deepEqual(RELEASE_AGENT_INTENT.stages, RELEASE_STAGES);
assert(RELEASE_AGENT_INTENT.guards.includes("never_infer_rights"));
assert.deepEqual(planReleaseRepairs(song, versions).actions, [{ type: "auto_queue_radio", versionId: radio.id,
  targetLufs: -16, targetTruePeak: -1, sourceVersionId: master.id, sourceAudioUrl: master.audio_url }]);
assert.match(planReleaseRepairs(song, [master]).actions[0].versionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
for (const changes of [{ mastering_status: "queued" }, { mastering_status: "in_progress" },
  { mastering_status: "review" }, { mastering_status: "approved" }, { audio_url: "/existing.wav" }]) {
  assert.equal(planReleaseRepairs(song, [master, { ...radio, ...changes }]).actions.length, 0,
    "never overwrite a started radio lane or uploaded edit");
}
for (const changes of [{ mastering_status: "review" }, { duration_seconds: 0 }, { audio_url: "" }, { song_id: "foreign" }]) {
  assert.equal(planReleaseRepairs(song, [{ ...master, ...changes }, radio]).actions.length, 0);
}
assert.equal(planReleaseRepairs(song, [master, { ...master, id: "duplicate" }, radio]).actions.length, 0);
const missing = { ...song, isrc: "", rights_status: "needs_review" };
const metadataPlan = planReleaseRepairs(missing, versions, template);
assert.equal(metadataPlan.actions.find(action => action.type === "apply_metadata_template").isrc, template.isrc);
assert.equal(metadataPlan.rightsSuggestion.requiresCreatorConfirmation, true);
for (const change of [{ songId: "foreign" }, { ownerMemberId: "foreign" }, { masterVersionId: "foreign" },
  { sourceAudioUrl: "/different.wav" }, { sourceKey: "different-upload" }, { byteSize: 124 },
  { title: "Other" }, { artistName: "Other" }, { rightsStatus: "disputed" }, { isrc: "invented" }]) {
  assert(!planReleaseRepairs(missing, versions, { ...template, ...change }).actions.some(action => action.type === "apply_metadata_template"));
}
for (const rights of ["disputed", "cleared"]) {
  assert.equal(planReleaseRepairs({ ...song, rights_status: rights }, versions, template).rightsSuggestion, null);
}
assert(planReleaseRepairs({ ...song, rights_status: "" }, versions, template).rightsSuggestion.requiresCreatorConfirmation);
assert(!planReleaseRepairs({ ...song, isrc: "invalid-but-not-missing" }, versions, template).actions
  .some(action => action.type === "apply_metadata_template"));
assert.equal(metadataTemplate({ ...song, rights_status: "needs_review" }, versions), null);

const probes = [];
const fetcher = async (url, options) => {
  probes.push({ url, options });
  assert.equal(options.method, "HEAD");
  assert.equal(options.redirect, "manual");
  assert(options.signal);
  return { ok: !url.includes("missing") && !url.includes("finish-house"),
    status: url.includes("finish-house") ? 500 : url.includes("missing") ? 404 : 200 };
};
const check = createInfrastructureChecker("https://halo.test", fetcher);
const assets = await inspectReleaseAssets(song, versions, check);
assert.equal(assets.graph.locked, true);
assert(assets.graph.nodes.every(node => node.artworkUrl === "/cover.jpg" && node.videoUrl === "/loop.mp4"));
assert.equal(assets.graph.lyricsText, song.lyrics_text);
await inspectReleaseAssets(song, versions, check);
assert.equal(probes.length, 2, "each pulse deduplicates inherited visual checks");
const uploadedVideo = await inspectReleaseAssets(song, [{ ...master,
  video_url: "/api/videos?media=12345678-1234-4123-8123-123456789012" }, radio], check);
assert.equal(uploadedVideo.graph.locked, true, "native catalog video uploads use the read-only media endpoint");
let metadataReads = 0, mediaReads = 0;
const videoDb = { sql: async () => [{ blob_key: "video", content_type: "video/mp4", source_filename: "loop.mp4" }] };
const videoStore = () => ({
  getMetadata: async () => { metadataReads++; return { etag: "verified" }; },
  get: async () => { mediaReads++; return new Blob(["video"], { type: "video/mp4" }); },
});
const videoId = "12345678-1234-4123-8123-123456789012";
const videoHead = await serveMedia(videoDb, videoId, "HEAD", videoStore);
assert.equal(videoHead.status, 200);
assert.equal(await videoHead.text(), "");
assert.equal(videoHead.headers.get("content-type"), "video/mp4");
assert.equal(metadataReads, 1);
assert.equal(mediaReads, 0, "HEAD must not download video bytes");
const videoGet = await serveMedia(videoDb, videoId, "GET", videoStore);
assert.equal(await videoGet.text(), "video");
assert.equal(mediaReads, 1);
assert.equal((await serveMedia(videoDb, videoId, "HEAD", () => ({ getMetadata: async () => null }))).status, 404);
assert.equal((await serveMedia({ sql: async () => [] }, videoId, "HEAD", videoStore)).status, 404);
assert.equal((await inspectReleaseAssets(song, versions)).graph.locked, false, "availability must be verified");
const missingAssets = await inspectReleaseAssets({ ...song, artwork_url: "" }, [{ ...master, video_url: "" }], check);
assert.equal(missingAssets.graph.locked, false);
assert(missingAssets.issues.some(issue => issue.field === "artwork"));
assert(missingAssets.issues.some(issue => issue.field === "video"));
const brokenAssets = await inspectReleaseAssets({ ...song, artwork_url: "/missing.jpg" }, versions, check);
assert.equal(brokenAssets.graph.locked, false);
assert(brokenAssets.issues.some(issue => issue.message.includes("missing.jpg")));
const invalidAssets = await inspectReleaseAssets(song, [master, { ...radio, artwork_url: "javascript:alert(1)" }], check);
assert.equal(invalidAssets.graph.locked, false);
assert(invalidAssets.issues.some(issue => issue.field === "asset"));
for (const changes of [{ mastering_status: "review" }, { audio_blob_prefix: "replaced/parts/" }]) {
  const changed = await inspectReleaseAssets(song, [{ ...master, ...changes }, radio], check);
  assert.notEqual(changed.graph.revision, assets.graph.revision, "master changes invalidate verified graph revisions");
}
const beforeUnsafe = probes.length;
for (const path of ["https://attacker.test/a.jpg", "//attacker.test/a.jpg", "http://127.0.0.1/a.jpg",
  "javascript:alert(1)", "/api/song-publication-reconcile", "/api/unified-upload", "/not-a-media-handler",
  "/api/videos", "/api/videos?media=not-an-id"]) {
  assert.notEqual((await check(path)).status, "passed");
}
assert.equal(probes.length, beforeUnsafe, "untrusted hosts and mutation endpoints must never be probed");
for (const origin of ["http://halo.test", "not a URL", "https://user@halo.test"]) {
  assert.equal(createInfrastructureChecker(origin), null);
}
const redirected = createInfrastructureChecker("https://halo.test", async () => ({ ok: false, status: 302 }));
assert.equal((await redirected("/cover.jpg")).status, "broken");
const unavailable = createInfrastructureChecker("https://halo.test", async () => { throw new Error("private network detail"); });
assert.deepEqual(await unavailable("/cover.jpg"), { url: "/cover.jpg", status: "unavailable" });
const deferred = createInfrastructureChecker("https://halo.test", fetcher, { deadline: Date.now() });
assert.equal((await deferred("/cover.jpg")).status, "deferred");
const routes = await Promise.all(WATCHDOG_ROUTES.map(check));
const diagnostics = await releaseWatchdogDiagnostics({ song, versions }, { repairs: [], rightsSuggestion: null }, check, routes);
assert(diagnostics.issues.some(issue => issue.field === "route" && issue.message.includes("/finish-house/")));
assert.equal(diagnostics.intent, RELEASE_AGENT_INTENT);

let currentSong, currentVersions, stored, events, leaseValid, allowMutation;
function reset({ metadataMissing = false, readyRadio = false } = {}) {
  currentSong = structuredClone(metadataMissing ? missing : song);
  currentVersions = structuredClone([master, readyRadio ? { ...radio, audio_url: "/radio.wav", mastering_status: "approved", duration_seconds: 180 } : radio]);
  stored = null; events = []; leaseValid = true; allowMutation = true;
}
reset();
const db = { async sql(strings, ...values) {
  const query = strings.join("?");
  if (query.includes("SELECT details->'template'")) return [{ template }];
  if (query.includes("WITH guarded")) {
    assert.match(query, /FOR UPDATE OF song, conveyor/);
    assert.match(query, /conveyor\.owner_member_id = \?/);
    assert.match(query, /conveyor\.lease_token = \? AND conveyor\.locked_until > NOW\(\)/);
    assert.match(query, /INSERT INTO halo_release_conveyor_events/);
    if (!leaseValid || !allowMutation || values[1] !== currentSong.owner_member_id) return [];
    const details = JSON.parse(values.find(value => typeof value === "string" && value.startsWith('{"type":')));
    if (details.type === "auto_queue_radio") {
      assert.match(query, /audio_url <> '' OR mastering_status <> 'not_started'/);
      let lane = currentVersions.find(version => version.id === details.versionId);
      if (!lane) {
        lane = { ...radio, id: details.versionId };
        currentVersions.push(lane);
      }
      if (lane.mastering_status !== "not_started") return [];
      Object.assign(lane, { mastering_status: "queued", target_lufs: -16, true_peak_dbtp_tenths: -10 });
    } else {
      assert.match(query, /song\.isrc = ''/);
      assert.doesNotMatch(query, /SET[^;]*rights_status\s*=/);
      if (currentSong.isrc) return [];
      currentSong.isrc = details.isrc;
    }
    events.push({ stage: "watchdog_repair", details });
    return [{ id: "audit" }];
  }
  if (query.includes("FROM halo_song_catalog")) return values[0] === currentSong.id && values[1] === currentSong.owner_member_id ? [structuredClone(currentSong)] : [];
  if (query.includes("FROM halo_song_versions")) return structuredClone(currentVersions);
  if (query.includes("INSERT INTO halo_release_conveyor (")) {
    if (stored?.lease_token) return [];
    stored = { state: stored?.state || {}, lease_token: values[2] };
    return [{ state: structuredClone(stored.state) }];
  }
  if (query.includes("WITH checkpoint")) {
    stored.state = JSON.parse(values[1]);
    if (values[2]) stored.lease_token = null;
    events.push({ stage: values[10], details: JSON.parse(values[11]) });
    return [{ id: values[7] }];
  }
  if (query.includes("SELECT song_id FROM halo_release_conveyor")) return leaseValid ? [{ song_id: song.id }] : [];
  if (query.includes("SET lease_token = NULL")) { stored.lease_token = null; return []; }
  throw new Error(`Unexpected watchdog query: ${query}`);
} };
const repaired = await healCatalogRelease(db, song.owner_member_id, song.id, "lease", { song: currentSong, versions: currentVersions }, {});
assert.deepEqual(repaired.repairs, ["auto_queue_radio"]);
assert.equal(currentVersions[1].mastering_status, "queued");
assert.equal(currentVersions[1].audio_url, "");
assert.equal(events[0].details.targetTruePeak, -1);
assert.equal(events[0].details.originalPreserved, true);
assert.deepEqual((await healCatalogRelease(db, song.owner_member_id, song.id, "lease",
  { song: currentSong, versions: currentVersions }, {})).repairs, [], "repeated pulses are idempotent");
reset({ metadataMissing: true });
await healCatalogRelease(db, song.owner_member_id, song.id, "lease", { song: currentSong, versions: currentVersions }, {});
assert.equal(currentSong.isrc, template.isrc);
assert.equal(currentSong.rights_status, "needs_review");
assert(events.some(event => event.details.type === "apply_metadata_template" && event.details.source.masterVersionId === master.id));
reset(); leaseValid = false;
assert.deepEqual((await healCatalogRelease(db, song.owner_member_id, song.id, "expired", { song: currentSong, versions: currentVersions }, {})).repairs, []);
reset(); allowMutation = false;
assert.deepEqual((await healCatalogRelease(db, song.owner_member_id, song.id, "lease", { song: currentSong, versions: currentVersions }, {})).repairs, []);
assert.equal(events.length, 0, "stale inputs or lost leases cannot append successful repair events");
reset(); currentVersions = [structuredClone(master)];
await healCatalogRelease(db, song.owner_member_id, song.id, "lease", { song: currentSong, versions: currentVersions }, {});
assert.match(currentVersions[1].id, /^[0-9a-f-]{36}$/);
assert.equal(currentVersions[1].mastering_status, "queued");
const createdLane = currentVersions[1].id;
await healCatalogRelease(db, song.owner_member_id, song.id, "lease", { song: currentSong, versions: currentVersions }, {});
assert.equal(currentVersions.length, 2);
assert.equal(currentVersions[1].id, createdLane);

reset();
const prepareAudio = async () => ({ summary: "Approved original preserved.", issues: [], repairs: [], originalPreserved: true });
let state = await processCatalogRelease(db, song.owner_member_id, song.id, prepareAudio, undefined, { check, routes });
assert.equal(state.status, "escalated", "queued radio is not approved or broadcast-ready");
assert.equal(state.watchdog.graph.locked, true, "visuals bind even while Council waits for mastering");
assert(state.watchdog.repairs.includes("lock_dreamweaver_graph"));
assert(state.receipt.blocked.some(issue => issue.field === "radio_master"));
assert.equal(stored.lease_token, null);
const eventCount = events.length;
await processCatalogRelease(db, song.owner_member_id, song.id, prepareAudio);
assert.equal(events.length, eventCount, "incidental unchanged calls do not duplicate checkpoints");
reset({ readyRadio: true });
state = await processCatalogRelease(db, song.owner_member_id, song.id, prepareAudio, undefined, { check, routes });
assert.equal(state.status, "ready");
assert.equal(state.package.dreamweaver.assetGraph.locked, true);
assert.equal(state.package.documents.dreamweaver.assetGraph.locked, true);
assert(events.some(event => event.stage === "metadata_rights" && event.details.template.isrc === template.isrc));
currentSong.notes = "Updated release note";
state = await processCatalogRelease(db, song.owner_member_id, song.id, prepareAudio);
assert(state.watchdog.issues.some(issue => issue.field === "route"), "catalog edits without network checks cannot clear a known broken route");
assert.equal(state.watchdog.graph.locked, true, "metadata edits can reuse verified, unchanged visuals");
currentVersions[1].artwork_url = "javascript:alert(1)";
state = await processCatalogRelease(db, song.owner_member_id, song.id, prepareAudio);
assert.equal(state.watchdog.graph.locked, false, "invalid new version URLs cannot reuse a locked graph through inheritance");
delete currentVersions[1].artwork_url;
stored.state.watchdog.checkedAt = "2026-01-01T00:00:00Z";
const healthyCheck = createInfrastructureChecker("https://halo.test", async () => ({ ok: true, status: 200 }));
state = await processCatalogRelease(db, song.owner_member_id, song.id, prepareAudio, undefined,
  { check: healthyCheck, routes: await Promise.all(WATCHDOG_ROUTES.map(healthyCheck)) });
assert.equal(state.watchdog.issues.length, 0, "later pulses clear recovered infrastructure alerts");
assert.equal(state.package.dreamweaver.assetGraph.locked, true);
currentVersions[0].mastering_status = "review";
state = await processCatalogRelease(db, song.owner_member_id, song.id, prepareAudio);
assert.equal(state.watchdog.graph.locked, false, "withdrawing mastering approval cannot reuse a locked graph");
assert.equal(state.receipt.ready, false);
console.log("Release watchdog radio, trusted metadata, immersive graph, route safety and durable pulse contracts passed");
