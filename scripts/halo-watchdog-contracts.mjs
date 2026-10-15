import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { HALO_SHARED_INTENT, WATCHDOG_ROUTES, inspectHaloRelease, auditHaloInfrastructure,
  auditHaloAssets, masterSourceIdentity, safeAssetUrl } from "../netlify/lib/halo-watchdog.mjs";
import { runReleaseConveyor, RELEASE_STAGES } from "../netlify/lib/release-conveyor.mjs";
import { persistWatchdog } from "../netlify/lib/release-conveyor-store.mjs";
import { processCatalogRelease } from "../netlify/lib/release-conveyor-service.mjs";

const song = { id: "12345678-1234-4123-8123-123456789012", owner_member_id: "creator",
  title: "Signal", artist_name: "Artist", genre: "Soul", isrc: "GBAAA2600001",
  rights_status: "cleared", artwork_url: "/cover.jpg", lyrics_text: "[00:01] Signal",
  source_updated_at: "2026-10-15T10:00:00.000000Z" };
const master = { id: "master", song_id: song.id, version_type: "sale_master",
  audio_url: "/master.wav", audio_blob_prefix: "creator/master/revision/parts/",
  mastering_status: "approved", duration_seconds: 180, video_url: "/video.mp4" };
const radio = { id: "radio", song_id: song.id, version_type: "radio_edit",
  mastering_status: "not_started", audio_url: "" };
const versions = [master, radio];
const assetChecks = [{ url: "/cover.jpg", type: "image/", status: "passed" },
  { url: "/video.mp4", type: "video/", status: "passed" }];
const inspect = changes => inspectHaloRelease({ song, versions, assetChecks, ...changes });
const initial = inspect();
assert.deepEqual(initial.intent, HALO_SHARED_INTENT);
assert.deepEqual(initial.departments.map(department => department.name), RELEASE_STAGES);
assert.deepEqual(initial.actions.find(action => action.type === "auto_queue_radio"), {
  type: "auto_queue_radio", versionId: "radio", sourceVersionId: "master",
  sourceAudioUrl: "/master.wav", targetLufs: -16, targetTruePeak: -1,
  approvalRequired: true, originalPreserved: true,
});
for (const changes of [
  { versions: [{ ...master, mastering_status: "review" }, radio] },
  { versions: [{ ...master, audio_url: "" }, radio] },
  { versions: [master, { ...master, id: "duplicate" }, radio] },
  { versions: [master, { ...radio, mastering_status: "queued" }] },
  { versions: [master, { ...radio, audio_url: "/dedicated-edit.wav" }] },
  { versions: [master, radio, { ...radio, id: "clean", version_type: "clean", mastering_status: "review" }] },
]) assert(!inspect(changes).actions.some(action => action.type === "auto_queue_radio"));
assert(initial.assetGraph.locked);
assert.equal(initial.assetGraph.versions[1].artworkUrl, "/cover.jpg");
assert.equal(initial.assetGraph.versions[1].videoUrl, "/video.mp4");
assert.equal(initial.assetGraph.lyrics.lines[0].time, 1);
assert(initial.actions.some(action => action.type === "lock_dreamweaver_graph"));
const repeat = inspect({ previous: { watchdog: initial }, versions: [master, { ...radio, mastering_status: "queued" }] });
assert.equal(repeat.actions.length, 0, "completed safe actions are idempotent");
assert(!inspect({ assetChecks: [] }).assetGraph.locked, "linked URLs alone do not prove availability");
assert(!inspect({ assetChecks: [{ url: "/cover.jpg", status: "broken" }] }).assetGraph.locked);
assert(!inspect({ versions: [{ ...master, video_url: "" }, radio] }).assetGraph.locked);
assert(!inspect({ versions: [master, { ...radio, artwork_url: "javascript:alert(1)" }] }).assetGraph.locked,
  "unsafe explicit assets must not inherit verified defaults");
assert(!inspect({ versions: [{ ...master, mastering_status: "review" }, radio] }).assetGraph.locked,
  "withdrawing master approval invalidates the locked graph");
assert.notEqual(inspect({ versions: [{ ...master, audio_blob_prefix: "replacement/parts/" }, radio] }).assetGraph.revision,
  initial.assetGraph.revision, "replacement masters invalidate the graph revision");
assert(inspect({ versions: [] }).findings.some(finding => finding.field === "radio_master"));
const custom = inspect({ versions: [master, { ...radio, artwork_url: "/custom.jpg", video_url: "/custom.mp4" }] });
assert.equal(custom.assetGraph.versions[1].artworkUrl, "/custom.jpg", "custom assets are not overwritten");
assert.equal(custom.assetGraph.versions[1].videoUrl, "/custom.mp4");
for (const value of ["javascript:alert(1)", "//evil.example/file", "/\\evil.example", "data:image/png;base64,AA", "******example.com/a"]) {
  assert.equal(safeAssetUrl(value), "");
}

const history = { status: "ready", inputHash: "reviewed-revision", package: {
  council: { passed: true }, documents: { releaseId: song.id, isrc: song.isrc, rightsStatus: "cleared" },
  audio: { sourceVersionId: master.id, sourceAudioUrl: master.audio_url, sourceIdentity: masterSourceIdentity(master) },
} };
const missing = { ...song, isrc: "", rights_status: "needs_review" };
const repaired = inspect({ song: missing, previous: history });
assert.deepEqual(repaired.actions.find(action => action.type === "restore_isrc"),
  { type: "restore_isrc", isrc: song.isrc, sourceRevision: "reviewed-revision" });
assert.equal(repaired.metadataPrefill.reviewRequired, true);
assert.equal(repaired.metadataPrefill.appliedRightsClearance, false);
assert.equal(missing.rights_status, "needs_review");
const corrected = inspect({ song: missing, previous: { ...history, watchdog: repaired,
  package: { ...history.package, documents: { ...history.package.documents, isrc: "GBAAA2600099" } } } });
assert.equal(corrected.metadataHistory.isrc, "GBAAA2600099", "latest reviewed metadata supersedes saved history");
assert(inspect({ song: missing, previous: { status: "blocked", watchdog: repaired } })
  .actions.some(action => action.type === "restore_isrc"), "trusted history survives blocked inspections");
assert(!inspect({ song: missing, versions: [{ ...master, audio_blob_prefix: "replacement/parts/" }, radio],
  previous: { watchdog: repaired } }).metadataPrefill, "a replacement upload cannot inherit recording identifiers");
for (const previous of [undefined, { ...history, status: "blocked" },
  { ...history, package: { ...history.package, documents: { ...history.package.documents, releaseId: "foreign" } } },
  { ...history, package: { ...history.package, audio: { ...history.package.audio, sourceIdentity: "other-recording" } } },
]) assert(!inspect({ song: missing, previous }).actions.some(action => action.type === "restore_isrc"));
assert(!inspect({ song: { ...song, isrc: "invalid" }, previous: history }).actions.some(action => action.type === "restore_isrc"),
  "explicit values are not overwritten");
assert.equal(inspect({ song: { ...missing, rights_status: "disputed" }, previous: history }).metadataPrefill, null);

let calls = [];
const infrastructure = await auditHaloInfrastructure("https://halo.example", { fetcher: async (url, options) => {
  calls.push([url.href, options]);
  if (url.pathname === "/radio/") return new Response(null, { status: 404 });
  if (url.pathname === "/finish-house/") throw new Error("offline");
  if (url.pathname === "/dreamweaver/" && options.method === "HEAD") return new Response(null, { status: 405 });
  return new Response(null, { status: 200 });
} });
assert.equal(infrastructure.find(route => route.path === "/radio/").status, "broken");
assert.equal(infrastructure.find(route => route.path === "/finish-house/").status, "unavailable");
assert(calls.some(([url, options]) => url.endsWith("/dreamweaver/") && options.method === "GET"));
assert(calls.every(([url, options]) => url.startsWith("https://halo.example/") && options.redirect === "manual"));
assert(inspect({ infrastructure }).findings.some(finding => finding.field === "infrastructure"));
assert((await auditHaloInfrastructure(undefined)).every(route => route.status === "unavailable"));
assert.deepEqual(WATCHDOG_ROUTES.map(route => route.route).sort(),
  ["/dreamweaver/", "/finish-house/", "/radio/", "/release-house/", "/song-catalog/"]);
for (const route of WATCHDOG_ROUTES) await access(new URL(`../${route.file}`, import.meta.url));

calls = [];
const assets = await auditHaloAssets({ song, versions }, "https://halo.example", { fetcher: async (url, options) => {
  calls.push([url, options]);
  return new Response(null, { headers: { "Content-Type": url.pathname.endsWith(".jpg") ? "image/jpeg" : "video/mp4" } });
} });
assert(assets.every(asset => asset.status === "passed"));
assert.equal(calls.length, 2);
const external = await auditHaloAssets({ song: { ...song, artwork_url: "https://external.example/a.jpg" },
  versions: [{ ...master, video_url: "https://external.example/v.mp4" }] }, "https://halo.example",
{ fetcher: async () => { throw new Error("External URLs must never be fetched"); } });
assert(external.every(asset => asset.status === "unverified"));
const soft404 = await auditHaloAssets({ song, versions }, "https://halo.example", {
  fetcher: async () => new Response(null, { headers: { "Content-Type": "text/html" } }),
});
assert(soft404.every(asset => asset.status === "broken"), "HTML fallbacks are not valid assets");
const imageAsVideo = await auditHaloAssets({ song, versions: [{ ...master, video_url: "/cover.jpg" }, radio] },
  "https://halo.example", { fetcher: async () => new Response(null, { headers: { "Content-Type": "image/jpeg" } }) });
assert(!inspect({ versions: [{ ...master, video_url: "/cover.jpg" }, radio], assetChecks: imageAsVideo }).assetGraph.locked,
  "a passing image check cannot satisfy a failing video check at the same URL");

const ports = { prepareAudio: async () => ({ sourceVersionId: master.id, sourceAudioUrl: master.audio_url, issues: [] }),
  checkpoint: async () => {}, assertCurrent: async () => {}, finish: async () => {},
  handoff: async () => ({ status: "ready_for_publication", externalDistribution: "not_submitted" }) };
const approvedVersions = [master, { ...radio, audio_url: "/radio.wav", mastering_status: "approved", duration_seconds: 180 }];
const ready = await runReleaseConveyor({ song, versions: approvedVersions, ports, watchdog: initial });
assert(ready.package.dreamweaver.assetGraph.locked);
assert.equal(ready.package.documents.dreamweaver.assetGraph, ready.watchdog.assetGraph);
const unlocked = inspect({ versions: approvedVersions, previous: ready, assetChecks: soft404 });
const refreshed = await runReleaseConveyor({ song, versions: approvedVersions, ports, previous: ready, watchdog: unlocked, automatic: true });
assert(!refreshed.package.dreamweaver.assetGraph.locked, "new failures invalidate previously locked packages");
assert.equal(refreshed.receipt.watchdog, refreshed.watchdog, "reused receipts carry the latest watchdog findings");
const failedHandoff = await runReleaseConveyor({ song, versions: approvedVersions, watchdog: initial,
  ports: { ...ports, handoff: async () => { throw new Error("interrupted handoff"); } } });
assert.equal(failedHandoff.status, "retryable");
const resumed = await runReleaseConveyor({ song, versions: approvedVersions, ports,
  previous: { ...failedHandoff, nextRetryAt: "2026-01-01T00:00:00Z" }, watchdog: unlocked, automatic: true });
assert.equal(resumed.status, "ready");
assert(!resumed.package.dreamweaver.assetGraph.locked, "resumed stages cannot preserve an invalidated graph");
assert(!resumed.package.documents.dreamweaver.assetGraph.locked);
const blocked = await runReleaseConveyor({ song: missing, versions, ports, watchdog: repaired });
assert.equal(blocked.receipt.ready, false, "watchdog prefill cannot bypass Council or mastering approval");

let query;
const db = { sql: async (strings, ...values) => {
  query = strings.join("?");
  assert(values.includes(song.owner_member_id));
  assert(values.includes(song.source_updated_at));
  return [{ id: "audit-event" }];
} };
await persistWatchdog(db, song.owner_member_id, song.id, "lease", { song, versions }, initial);
for (const contract of ["FOR UPDATE", "lease_token =", "locked_until > NOW()", "radio_update AS", "metadata_update AS",
  "INSERT INTO halo_release_conveyor_events", "'watchdog_pulse'", "'{receipt,watchdog}'",
  "mastering_status = 'not_started'", "BTRIM(isrc) = ''"]) assert(query.includes(contract));
assert(!query.includes("rights_status ="), "the repair writer cannot grant clearance");
assert(!query.includes("audio_url ="), "queueing cannot replace audio");
await assert.rejects(persistWatchdog({ sql: async () => [] }, song.owner_member_id, song.id, "lost", { song, versions }, initial));
let reads = 0, prepared = false;
const racingDb = { sql: async strings => {
  const query = strings.join("?");
  if (query.includes("WITH lease AS")) return [{ id: "event" }];
  if (query.includes("INSERT INTO halo_release_conveyor (")) return [{ state: ready }];
  if (query.includes("FROM halo_song_catalog")) return [{ ...song, title: ++reads >= 3 ? "Concurrent edit" : song.title }];
  if (query.includes("FROM halo_song_versions")) return approvedVersions;
  if (query.includes("SET lease_token = NULL")) return [];
  throw new Error(`Unexpected query: ${query}`);
} };
await assert.rejects(processCatalogRelease(racingDb, song.owner_member_id, song.id, async () => { prepared = true; }),
  /Submission changed during watchdog repair/);
assert.equal(prepared, false, "a post-repair concurrent edit requires fresh inspection, not stale graph reuse");
const service = await readFile(new URL("../netlify/lib/release-conveyor-service.mjs", import.meta.url), "utf8");
assert.match(service, /INTERVAL '5 minutes'/);
assert.match(service, /persistWatchdog/);
console.log("HALO shared intent, guarded radio/metadata repairs, asset graph and infrastructure watchdog contracts passed");
