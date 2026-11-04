import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import {
  auditCatalogDrift,
  rotationSalt,
  storageDriftFingerprint,
  verifyStoredAudio,
} from "../netlify/lib/catalog-drift-sentinel.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const results = [];
async function check(label, fn) {
  try { await fn(); results.push([true, label]); } catch (error) { results.push([false, `${label}: ${error.stack || error.message}`]); }
}

function fakeDb({ stale = [], bound = [] } = {}) {
  const queries = [];
  return {
    queries,
    async sql(strings, ...values) {
      const text = strings.join("?");
      queries.push({ text, values });
      if (/song\.reviewed_at IS NULL OR version\.updated_at > song\.reviewed_at/.test(text)) return stale;
      if (/audio_url LIKE '\/api\/song-catalog\/audio%'/.test(text)) return bound;
      return [];
    },
  };
}

function harness(overrides = {}) {
  const calls = { reviews: [], reports: [], resolves: [] };
  return {
    calls,
    options: {
      audioStore: {},
      storageConfig: { bucket: "masters" },
      inspectChunks: async (_store, { chunkCount, byteSize }) => ({ complete: true, chunkCount, byteSize, storedBytes: byteSize, missingChunks: [], invalidChunks: [] }),
      headObject: async () => 100,
      repairReview: async (songId, owner) => { calls.reviews.push([songId, owner]); },
      report: async issue => { calls.reports.push(issue); },
      resolve: async (key, summary) => { calls.resolves.push([key, summary]); return true; },
      issueKey: fingerprint => `key:${fingerprint}`,
      ...overrides,
    },
  };
}

const chunked = { id: "v-chunk", song_id: "s1", owner_member_id: "m1", title: "Quiet Heart", version_type: "sale_master", audio_blob_prefix: "p/", audio_chunk_count: 2, audio_byte_size: 100, audio_storage_key: "", dreamweaver_status: "ready" };
const direct = { id: "v-direct", song_id: "s2", owner_member_id: "m2", title: "Night Drive", version_type: "sale_master", audio_blob_prefix: "", audio_chunk_count: 0, audio_byte_size: 100, audio_storage_key: "masters/m2/x.wav", dreamweaver_status: "pending" };

await check("stale reviews are repaired through the existing owner-scoped review path", async () => {
  const { calls, options } = harness();
  const db = fakeDb({ stale: [{ id: "s1", owner_member_id: "m1" }, { id: "s2", owner_member_id: "m2" }] });
  const summary = await auditCatalogDrift(db, options);
  assert.deepEqual(calls.reviews, [["s1", "m1"], ["s2", "m2"]]);
  assert.deepEqual(summary.reviews, { checked: 2, repaired: 2, failed: 0 });
  assert.match(db.queries[0].text, /make_interval\(mins => \?\)/, "a grace window avoids racing in-flight finalizes");
});

await check("one failing review does not stop the rest of the audit", async () => {
  const { options } = harness({ repairReview: async songId => { if (songId === "s1") throw new Error("db blip"); } });
  const summary = await auditCatalogDrift(fakeDb({ stale: [{ id: "s1", owner_member_id: "m1" }, { id: "s2", owner_member_id: "m2" }] }), options);
  assert.deepEqual(summary.reviews, { checked: 2, repaired: 1, failed: 1 });
  assert.equal(summary.drifts.find(drift => drift.songId === "s1").action, "review_failed");
});

await check("healthy stored audio auto-resolves any prior drift alert", async () => {
  const { calls, options } = harness();
  const summary = await auditCatalogDrift(fakeDb({ bound: [chunked, direct] }), options);
  assert.equal(summary.storage.healthy, 2);
  assert.deepEqual(calls.resolves.map(([key]) => key), [`key:${storageDriftFingerprint("v-chunk")}`, `key:${storageDriftFingerprint("v-direct")}`]);
  assert.equal(calls.reports.length, 0);
});

await check("missing bytes behind a 'ready' song raise a critical, deduplicated alert without touching the record", async () => {
  const { calls, options } = harness({
    inspectChunks: async () => ({ complete: false, storedBytes: 50, missingChunks: [1], invalidChunks: [] }),
    headObject: async () => 0,
  });
  const db = fakeDb({ bound: [chunked, direct] });
  const summary = await auditCatalogDrift(db, options);
  assert.equal(summary.storage.drifted, 2);
  assert.equal(calls.reports[0].severity, "critical", "a live 'ready' claim over missing bytes is critical");
  assert.equal(calls.reports[1].severity, "high");
  assert.equal(calls.reports[0].fingerprint, storageDriftFingerprint("v-chunk"), "fingerprints dedupe repeat alerts");
  assert.equal(calls.reports[0].metadata.kind, "chunks_incomplete");
  assert.equal(calls.reports[1].metadata.kind, "direct_object_missing");
  assert.ok(db.queries.every(query => !/^\s*(UPDATE|DELETE|INSERT)/i.test(query.text)), "the auditor never rewrites catalog records");
});

await check("storage outages are unverifiable, never reported as missing bytes", async () => {
  const { calls, options } = harness({ headObject: async () => { throw Object.assign(new Error("503"), { retryable: true }); } });
  const summary = await auditCatalogDrift(fakeDb({ bound: [direct] }), options);
  assert.equal(summary.storage.unverifiable, 1);
  assert.equal(calls.reports.length + calls.resolves.length, 0);
  assert.equal((await verifyStoredAudio(direct, { storageConfig: null })).kind, "direct_storage_unconfigured");
  assert.equal((await verifyStoredAudio({ ...direct, audio_storage_key: "" }, {})).kind, "storage_reference_missing");
  assert.equal((await verifyStoredAudio(direct, { storageConfig: {}, headObject: async () => 64 })).kind, "direct_size_mismatch");
});

await check("the audit stops at its time budget and rotates storage sampling", async () => {
  let tick = 0;
  const { calls, options } = harness({ budgetMilliseconds: 2, clock: () => tick++ });
  const summary = await auditCatalogDrift(fakeDb({ stale: [{ id: "a", owner_member_id: "m" }, { id: "b", owner_member_id: "m" }, { id: "c", owner_member_id: "m" }], bound: [chunked] }), options);
  assert.equal(summary.stoppedEarly, true);
  assert.ok(calls.reviews.length < 3);
  assert.equal(summary.storage.checked, 0);
  assert.notEqual(rotationSalt(new Date(0)), rotationSalt(new Date(10 * 60_000)));
});

// Browser uploader: resume skips verified parts and treats a throwing skip check as "send it".
const uploadProgressSource = await read("upload-progress.js");
function loadUploadHelper() {
  const sent = [];
  class FakeXhr {
    constructor() { this.upload = {}; }
    open() {}
    setRequestHeader() {}
    send(body) { sent.push(body); queueMicrotask(() => { this.status = 200; this.responseText = "{}"; this.onload(); }); }
  }
  const window = { addEventListener() {}, removeEventListener() {} };
  runInNewContext(uploadProgressSource, { window, navigator: { onLine: true }, XMLHttpRequest: FakeXhr, console, setTimeout: fn => { queueMicrotask(fn); return 0; }, clearTimeout() {}, Math, Number, Set, Promise, Object, Error, JSON });
  return { helper: window.HaloUploadProgress, sent };
}

await check("resumed uploads only send parts the server does not already hold", async () => {
  const { helper, sent } = loadUploadHelper();
  const progress = [];
  await helper.uploadChunkedFile({
    url: "/x", file: { size: 12 }, chunkSize: 4, buildBody: ({ chunkIndex }) => ({ chunkIndex }),
    shouldSkipChunk: async ({ chunkIndex }) => { if (chunkIndex === 2) throw new Error("digest failed"); return chunkIndex === 0; },
    onProgress: (percent, info) => progress.push([Math.round(percent), Boolean(info.skipped)]),
  });
  assert.deepEqual(sent.map(body => body.chunkIndex), [1, 2]);
  assert.deepEqual(progress[0], [33, true]);
});

await check("readiness actions are owner-scoped, throttled, and reuse the review path", async () => {
  const audioApi = await read("netlify/functions/song-catalog-audio.ts");
  assert.match(audioApi, /payload\.action === "upload_readiness"\) return readinessAction\(payload, db, membership\.member_id, false\)/);
  assert.match(audioApi, /payload\.action === "recheck_readiness"\) return readinessAction\(payload, db, membership\.member_id, true\)/);
  const action = audioApi.slice(audioApi.indexOf("async function readinessAction"), audioApi.indexOf("async function removeUpload"));
  assert.match(action, /owner_member_id = \$\{ownerMemberId\}/);
  assert.match(action, /if \(rerun && !throttled\) await runDreamweaverReview\(songId, ownerMemberId\)/);
  assert.doesNotMatch(action, /UPDATE|force/i, "rechecks cannot write readiness directly");
});

await check("scheduled drift sentinel is wired with heartbeat SLA and existing repair primitives", async () => {
  const [fn, heartbeats] = await Promise.all([read("netlify/functions/catalog-drift-sentinel.ts"), read("netlify/lib/scheduled-heartbeats.mjs")]);
  assert.match(fn, /schedule: "\*\/10 \* \* \* \*"/);
  assert.match(fn, /repairReview: runDreamweaverReview/);
  assert.match(fn, /report: reportIssue/);
  assert.match(fn, /recordScheduledHeartbeat\(db, "catalog-drift-sentinel"/);
  assert.match(heartbeats, /agentKey: "catalog-drift-sentinel", maxAgeMinutes: 35/);
});

// Catalog follow-up watcher: bounded passive reads, one active recheck, then owner control.
await check("readiness follow-up is bounded and ends with an owner recheck control", async () => {
  const client = await read("song-catalog/song-catalog.js");
  const source = client.slice(client.indexOf("const READINESS_FOLLOW_UP_SECONDS"), client.indexOf("async function recheckReadiness"));
  const timers = [];
  const requests = [];
  const messages = [];
  const recheckButton = { hidden: true };
  const context = {
    setTimeout: (fn, ms) => { timers.push([fn, ms]); return timers.length; },
    clearTimeout() {},
    $: selector => (selector === "#recheckReadinessButton" ? recheckButton : {}),
    audioApi: async options => { const body = JSON.parse(options.body); requests.push(body.action); return { readiness: { status: "CATALOG_READY" } }; },
    announceUploadReadiness() {},
    uploadReadinessNote: () => "",
    message: text => messages.push(text),
    loadCatalog: async () => {},
    JSON,
  };
  const api = runInNewContext(`${source}\n({watchUploadReadiness})`, context);
  api.watchUploadReadiness("song-1", { status: "LIVE" });
  assert.equal(timers.length, 0, "settled readiness is not polled");
  api.watchUploadReadiness("song-1", { status: "CATALOG_READY" });
  while (timers.length) { const [fn] = timers.shift(); await fn(); }
  assert.deepEqual(requests, ["upload_readiness", "upload_readiness", "upload_readiness", "recheck_readiness"]);
  assert.equal(recheckButton.hidden, false);
  assert.match(messages.at(-1), /Recheck readiness/);
  assert.doesNotMatch(client, /halo_forced_ready_state|force-advance/);
});

await check("re-uploading the same file after a failure resumes from verified saved parts", async () => {
  const { webcrypto, createHash } = await import("node:crypto");
  const client = await read("song-catalog/song-catalog.js");
  const source = client.slice(client.indexOf("let pendingAudioResume=null;"), client.indexOf("const READINESS_FOLLOW_UP_SECONDS"));
  const bytes = new Uint8Array(12).map((_, index) => index + 1);
  const file = new Blob([bytes], { type: "audio/wav" });
  Object.assign(file, { name: "master.wav", lastModified: 7 });
  const serverParts = new Map();
  let failAt = 2;
  const sentChunks = [];
  const actions = [];
  const helper = {
    async uploadChunkedFile({ file: upload, chunkSize, buildBody, shouldSkipChunk }) {
      const chunkCount = Math.ceil(upload.size / chunkSize);
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        const start = chunkIndex * chunkSize, end = Math.min(upload.size, start + chunkSize);
        if (shouldSkipChunk && await shouldSkipChunk({ chunkIndex, chunkCount, start, end })) continue;
        if (chunkIndex === failAt) throw new Error("The upload stopped early.");
        const form = buildBody({ chunkIndex, chunkCount, start, end });
        const data = new Uint8Array(await form.get("chunk").arrayBuffer());
        sentChunks.push(chunkIndex);
        serverParts.set(chunkIndex, createHash("sha256").update(data).digest("hex"));
      }
      return { chunkCount };
    },
  };
  const ui = { start() {}, progress() {}, state: { progress: 0 } };
  const api = runInNewContext(`${source}\n({uploadAudioToVersion,sameUploadFile,get pending(){return pendingAudioResume}})`, {
    AUDIO_CHUNK_BYTES: 4, uploadHelper: helper, FormData, Blob, Array, Object, Number, Boolean, Set, Uint8Array, JSON,
    announceCatalogUpload() {},
    crypto: { subtle: webcrypto.subtle, randomUUID: () => "upload-session-abc" },
    audioContentType: () => "audio/wav", audioDuration: async () => 3,
    uploadReadinessNote: () => "", announceUploadReadiness() {},
    audioApi: async options => {
      const body = JSON.parse(options.body);
      actions.push(body.action);
      if (body.action === "upload_status") return { chunkChecksums: Object.fromEntries([...serverParts, [1, "corrupted"]].map(([index, hash]) => [index, hash])), invalidChunks: [] };
      return { message: "ok", uploadId: body.uploadId, readiness: { status: "CATALOG_READY" } };
    },
  });
  await assert.rejects(api.uploadAudioToVersion({ file, songId: "s", versionId: "v", ui }), /stopped early/);
  assert.equal(api.sameUploadFile(api.pending, file, "v"), true, "the failed session is kept for resume");
  serverParts.set(1, "corrupted");
  failAt = -1;
  const data = await api.uploadAudioToVersion({ file, songId: "s", versionId: "v", ui });
  assert.equal(data.uploadId, "upload-session-abc", "finalize reuses the original upload session");
  assert.deepEqual(sentChunks, [0, 1, 1, 2], "only the corrupted and missing parts are re-sent");
  assert.deepEqual(actions, ["upload_status", "finalize_upload"]);
  assert.equal(api.pending, null);
  assert.equal(api.sameUploadFile({ versionId: "v", name: "master.wav", size: 12, lastModified: 7 }, file, "other"), false, "a different version never resumes");
});

for (const [ok, label] of results) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (results.some(([ok]) => !ok)) process.exit(1);
