import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import {
  evaluateUploadPreflight,
  loadUploadPreflight,
  loadUploadReadiness,
  safeUploadReadiness,
  summarizeUploadReadiness,
} from "../netlify/lib/upload-readiness.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const results = [];
async function check(label, fn) {
  try {
    await fn();
    results.push([true, label]);
  } catch (error) {
    results.push([false, `${label}: ${error.message}`]);
  }
}

function fakeDb(responses) {
  const queries = [];
  return {
    queries,
    async sql(strings, ...values) {
      const text = strings.join("?");
      queries.push({ text, values });
      const match = responses.find(([pattern]) => pattern.test(text));
      if (!match) return [];
      if (match[1] instanceof Error) throw match[1];
      return typeof match[1] === "function" ? match[1](values) : match[1];
    },
  };
}

const clearedSong = { title: "Quiet Heart", artist_name: "HALO", rights_status: "cleared", version_type: "sale_master" };

await check("partial chunks report preflight progress but never mark the catalog or stream ready", () => {
  const preflight = evaluateUploadPreflight(clearedSong, { receivedChunks: 2, chunkCount: 4 });
  assert.equal(preflight.progress, 50);
  assert.equal(preflight.status, "INGESTING");
  assert.equal(preflight.catalogReady, false);
  assert.equal(preflight.streamReady, false);
  assert.equal(preflight.clearsOnFinalize, true);
  assert.deepEqual(preflight.blockers, []);
  assert.equal(preflight.checks.saleMasterRole, true);
  const last = evaluateUploadPreflight(clearedSong, { receivedChunks: 4, chunkCount: 4 });
  assert.equal(last.progress, 100);
  assert.equal(last.catalogReady, false, "the final chunk still waits for verified finalize");
});

await check("preflight surfaces rights and metadata blockers while bytes are still landing", () => {
  const blocked = evaluateUploadPreflight({ title: "", artist_name: "HALO", rights_status: "needs_review", version_type: "radio_edit" }, { receivedChunks: 1, chunkCount: 3 });
  assert.deepEqual(blocked.blockers.map(item => item.field), ["metadata", "rightsStatus"]);
  assert.equal(blocked.clearsOnFinalize, false);
  assert.equal(blocked.checks.rights, false);
  assert.equal(evaluateUploadPreflight(null).ownership, false);
});

await check("preflight query is owner-scoped and clamps out-of-range progress", async () => {
  const db = fakeDb([[/FROM halo_song_versions/, [clearedSong]]]);
  const preflight = await loadUploadPreflight(db, "member-1", "song-1", "version-1", { receivedChunks: 9, chunkCount: 3 });
  assert.equal(preflight.progress, 100);
  assert.match(db.queries[0].text, /song\.owner_member_id = \?/);
  assert.deepEqual(db.queries[0].values, ["version-1", "song-1", "member-1"]);
});

await check("finalized audio flips straight to catalog-ready, released, and live from stored state", () => {
  const ready = summarizeUploadReadiness({
    song: { metadata_status: "reviewed", metadata_issues: [{ field: "isrc", level: "warning" }] },
    sync: { release_status: "published", dreamweaver_status: "ready", details: {} },
    persisted: true,
  });
  assert.equal(ready.status, "LIVE");
  assert.equal(ready.catalogReady && ready.streamReady && ready.published && ready.dreamweaverReady, true);
  const confirming = summarizeUploadReadiness({
    song: { metadata_status: "ready", metadata_issues: [] },
    sync: { release_status: "published", dreamweaver_status: "pending", details: { shareVerification: { reason: "deployment_origin_unavailable" } } },
    persisted: true,
  });
  assert.equal(confirming.status, "CATALOG_READY");
  assert.equal(confirming.dreamweaverReady, false);
  assert.equal(confirming.shareReason, "deployment_origin_unavailable");
  const conveyor = summarizeUploadReadiness({ song: { metadata_status: "ready", metadata_issues: [] }, sync: null, persisted: true });
  assert.equal(conveyor.status, "CATALOG_READY");
  assert.equal(conveyor.releaseStatus, "pending");
});

await check("required review issues keep finalized audio out of catalog readiness", () => {
  const blocked = summarizeUploadReadiness({
    song: { metadata_status: "needs_attention", metadata_issues: [{ field: "rightsStatus", level: "required", message: "Confirm rights" }, { field: "genre", level: "warning" }] },
    sync: { release_status: "published", dreamweaver_status: "ready" },
    persisted: true,
  });
  assert.equal(blocked.status, "NEEDS_ATTENTION");
  assert.equal(blocked.catalogReady, false);
  assert.deepEqual(blocked.blockers.map(item => item.field), ["rightsStatus"]);
  assert.equal(summarizeUploadReadiness({ song: { metadata_status: "ready" }, persisted: false }).streamReady, false);
});

await check("readiness receipts read owner-scoped review and publication rows", async () => {
  const db = fakeDb([
    [/FROM halo_song_catalog/, [{ id: "song-1", metadata_status: "ready", metadata_issues: [] }]],
    [/FROM halo_song_publication_sync/, [{ release_status: "published", dreamweaver_status: "ready", details: {} }]],
  ]);
  const readiness = await loadUploadReadiness(db, "member-1", "song-1");
  assert.equal(readiness.status, "LIVE");
  assert.ok(db.queries.every(query => /owner_member_id = \?/.test(query.text)));
});

await check("a readiness lookup outage never undoes a locked-in upload", async () => {
  const db = fakeDb([[/FROM halo_song_catalog/, new Error("database offline")]]);
  const readiness = await safeUploadReadiness(db, "member-1", "song-1", { persisted: true });
  assert.equal(readiness.status, "PENDING_RECHECK");
  assert.equal(readiness.streamReady, true);
  assert.equal(readiness.catalogReady, false);
});

// Browser helper: per-chunk telemetry is delivered live and cannot break the transfer.
const uploadProgressSource = await read("upload-progress.js");
function loadUploadHelper(script) {
  class FakeXhr {
    constructor() { this.upload = {}; this.status = 0; this.responseText = ""; }
    open() {}
    setRequestHeader() {}
    send() {
      const step = script.shift() || { status: 200, body: {} };
      queueMicrotask(() => {
        if (step.network) return this.onerror();
        this.status = step.status;
        this.responseText = JSON.stringify(step.body || {});
        this.onload();
      });
    }
  }
  const window = { addEventListener() {}, removeEventListener() {} };
  runInNewContext(uploadProgressSource, {
    window, navigator: { onLine: true }, XMLHttpRequest: FakeXhr, console,
    setTimeout: fn => { queueMicrotask(fn); return 0; }, clearTimeout: () => {},
    Math, Number, Set, Promise, Object, Error, JSON,
  });
  return window.HaloUploadProgress;
}

await check("uploadChunkedFile streams each chunk's readiness to onChunk, including after retries", async () => {
  const helper = loadUploadHelper([
    { status: 200, body: { chunkIndex: 0, readiness: { status: "INGESTING", progress: 50 } } },
    { status: 502, body: { message: "gateway" } },
    { status: 200, body: { chunkIndex: 1, readiness: { status: "INGESTING", progress: 100 } } },
  ]);
  const seen = [];
  const file = { size: 8, slice: () => ({}) };
  await helper.uploadChunkedFile({ url: "/x", file, chunkSize: 4, retryDelays: [0], buildBody: () => ({}), onChunk(data, info) { seen.push([info.chunkIndex, data.readiness.progress]); } });
  assert.deepEqual(seen, [[0, 50], [1, 100]]);
});

await check("a throwing telemetry consumer does not interrupt the upload", async () => {
  const helper = loadUploadHelper([{ status: 200, body: {} }, { status: 200, body: {} }]);
  const file = { size: 8, slice: () => ({}) };
  const result = await helper.uploadChunkedFile({ url: "/x", file, chunkSize: 4, buildBody: () => ({}), onChunk() { throw new Error("ui crashed"); } });
  assert.equal(result.chunkCount, 2);
});

await check("upload endpoints and catalog UI are wired to live readiness", async () => {
  const [audioApi, masterApi, client] = await Promise.all([
    read("netlify/functions/song-catalog-audio.ts"),
    read("netlify/functions/song-catalog-master-upload.ts"),
    read("song-catalog/song-catalog.js"),
  ]);
  assert.match(audioApi, /loadUploadPreflight\(db, ownerMemberId, songId, versionId, \{ receivedChunks: chunkIndex \+ 1, chunkCount \}\)\.catch\(\(\) => null\)/);
  assert.match(audioApi, /chunkSha256: stored\.sha256, readiness \}/);
  const finalizeBody = audioApi.slice(audioApi.indexOf("async function finalizeUpload"));
  assert.ok(finalizeBody.indexOf("await runDreamweaverReview(songId, ownerMemberId)") < finalizeBody.lastIndexOf("safeUploadReadiness(db, ownerMemberId, songId"), "finalize reads readiness after review/conveyor/publication ran");
  assert.match(audioApi, /alreadyFinalized: true, readiness \}/);
  assert.ok(masterApi.indexOf("await runDreamweaverReview(songId, ownerMemberId)") < masterApi.indexOf("safeUploadReadiness(db, ownerMemberId, songId"));
  assert.match(client, /onChunk\(data\)\{if\(data\.readiness\)/);
  assert.match(client, /halo:upload-readiness/);
  assert.doesNotMatch(client, /localStorage\.setItem\(`halo_override_/);
});

for (const [ok, label] of results) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (results.some(([ok]) => !ok)) process.exit(1);
