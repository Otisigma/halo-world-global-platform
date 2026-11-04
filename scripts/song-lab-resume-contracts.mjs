import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";
import { resumeAudioUpload, CHUNK_BYTES } from "../dreamweaver-lab/resumable-upload.js";

const id = "11111111-1111-4111-8111-111111111111";
const ownerId = "fixture-owner";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const blobs = new Map(), projects = new Map(), background = [];
let user = { id: ownerId }, trusted = true, inserts = 0;
const store = {
  async list({ prefix }) { return { blobs: [...blobs.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
  async set(key, value, { metadata }) { blobs.set(key, { bytes: new Uint8Array(await value.arrayBuffer()), metadata }); },
  async getMetadata(key) { return blobs.has(key) ? { metadata: blobs.get(key).metadata } : null; },
};
const db = {
  async sql(strings, ...values) {
    const query = strings.join("?");
    if (query.includes("INSERT INTO halo_dreamweaver_songs")) {
      if (projects.has(values[0])) return [];
      inserts++;
      const row = {
        id: values[0], member_id: values[1], title: values[2], artist_name: values[3], file_name: values[4],
        blob_prefix: values[5], chunk_count: values[6], content_type: values[7], byte_size: values[8],
        duration_seconds: values[9], analysis_evidence: JSON.parse(values[12]), status: "queued",
        created_at: new Date(), updated_at: new Date(),
      };
      projects.set(row.id, row);
      return [{ ...row }];
    }
    if (query.includes("status = 'analyzing'")) {
      const row = projects.get(values[0]);
      if (!row || row.status !== "queued") return [];
      row.status = "analyzing"; return [{ ...row }];
    }
    if (query.includes("SET creative_package")) {
      const row = projects.get(values.at(-1));
      row.status = "ready"; row.creative_package = JSON.parse(values[0]); return [];
    }
    if (query.includes("SELECT *")) {
      const row = projects.get(values[0]);
      return row && (values.length < 2 || row.member_id === values[1]) ? [{ ...row }] : [];
    }
    throw new Error(`Unhandled fixture SQL: ${query}`);
  },
};
globalThis.__songLabResumeFixture = {
  store, db, getUser: async () => user, verify: async () => trusted,
  cleanText: (value, max) => String(value || "").slice(0, max),
  ensureMembership: async (_db, identity) => ({ member_id: identity.id }),
  OpenAI: class { constructor() { throw new Error("AI unavailable in fixture"); } },
};
let source = await readFile(new URL("../netlify/functions/dreamweaver-song-lab.mjs", import.meta.url), "utf8");
source = source
  .replace(/import \{ getStore \} from "@netlify\/blobs";/, 'const getStore = () => globalThis.__songLabResumeFixture.store;')
  .replace(/import \{ getDatabase \} from "@netlify\/database";/, 'const getDatabase = () => globalThis.__songLabResumeFixture.db;')
  .replace(/import \{ getUser, verifyRequestOrigin \} from "@netlify\/identity";/, 'const { getUser, verify: verifyRequestOrigin } = globalThis.__songLabResumeFixture;')
  .replace(/import OpenAI from "openai";/, 'const { OpenAI } = globalThis.__songLabResumeFixture;')
  .replace(/import \{ cleanText, ensureMembership \} from "..\/lib\/halo-x.mjs";/, 'const { cleanText, ensureMembership } = globalThis.__songLabResumeFixture;')
  .replace('"../lib/chunked-audio-upload.mjs"', JSON.stringify(new URL("../netlify/lib/chunked-audio-upload.mjs", import.meta.url).href));
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const context = { waitUntil(promise) { background.push(promise); } };
const shape = { uploadId: id, ownerId, resumeVersion: 1, byteSize: CHUNK_BYTES + 13, chunkCount: 2 };
const bytes = Buffer.alloc(shape.byteSize, 37);
const parts = [bytes.subarray(0, CHUNK_BYTES), bytes.subarray(CHUNK_BYTES)];
async function json(body) {
  return handler(new Request("https://halo.test/api/dreamweaver-song-lab", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://halo.test" }, body: JSON.stringify(body),
  }), context);
}
async function put(index, overrides = {}) {
  const data = new FormData();
  data.append("chunk", new Blob([parts[index]], { type: "audio/wav" }), "fixture.wav");
  for (const [key, value] of Object.entries({ ...shape, chunkIndex: index, checksum: digest(parts[index]), ...overrides })) data.set(key, String(value));
  return handler(new Request("https://halo.test/api/dreamweaver-song-lab", { method: "POST", headers: { Origin: "https://halo.test" }, body: data }), context);
}
assert.equal((await put(1)).status, 200);
assert.equal((await put(0, { checksum: "0".repeat(64) })).status, 422);
assert.equal((await put(0, { ownerId: "other-account" })).status, 403);
assert.equal((await json({ action: "upload_status", ...shape, chunkCount: 99 })).status, 400);
let status = await (await json({ action: "upload_status", ...shape })).json();
assert.deepEqual(status.missingChunks, [0]);
const analysis = { action: "analyze", ...shape, title: "Fixture", fileName: "fixture.wav", contentType: "audio/wav", rightsAttested: true, analysis: {} };
assert.equal((await json(analysis)).status, 409, "missing chunks cannot finalize");
assert.equal((await put(0)).status, 200);
assert.equal((await put(0)).status, 200, "chunk writes are idempotent");
assert.equal(blobs.size, 2);
status = await (await json({ action: "upload_status", ...shape })).json();
assert.equal(status.complete, true);
assert.equal(status.chunkChecksums[0], digest(parts[0]));
assert.deepEqual(Buffer.concat([...blobs.keys()].sort().map(key => Buffer.from(blobs.get(key).bytes))), bytes, "stored ordered chunks preserve the original audio");
blobs.get(`${ownerId}/${id}/parts/001`).metadata.size = 1;
assert.equal((await json(analysis)).status, 409, "inconsistent metadata cannot finalize");
await put(1);
assert.equal((await json({ ...analysis, rightsAttested: false })).status, 422);
const first = await (await json(analysis)).json();
await Promise.all(background);
const replay = await (await json(analysis)).json();
assert.equal(first.project.id, id);
assert.equal(replay.project.id, id);
assert.equal(inserts, 1, "a lost finalization response never creates another project");
assert.equal((await put(0)).status, 409, "finalized recordings cannot be overwritten by resumable chunk retries");
user = { id: "other-account" };
assert.equal((await json({ action: "upload_status", ...shape })).status, 403);
user = null;
assert.equal((await put(0)).status, 401);
user = { id: ownerId }; trusted = false;
assert.equal((await json({ action: "upload_status", ...shape })).status, 403, "resume does not bypass origin verification");
trusted = true;
const identity = await handler(new Request("https://halo.test/api/dreamweaver-song-lab"), context);
assert.equal((await identity.json()).uploadOwnerId, ownerId);

// Real client reconciliation: skip verified chunks, overwrite mismatches, retain one session ID.
const sent = [], acknowledged = [];
let probes = 0;
const file = new File([bytes], "fixture.wav", { type: "audio/wav" });
const result = await resumeAudioUpload({
  file, session: { id, ownerId }, checksum: async blob => digest(Buffer.from(await blob.arrayBuffer())),
  request: async body => {
    assert.equal(body.ownerId, ownerId); assert.equal(body.uploadId, id);
    return ++probes === 1 ? { chunkChecksums: { 0: digest(parts[0]), 1: "incorrect" }, invalidChunks: [] } : { complete: true };
  },
  transport: {
    async sendFormDataWithRetry(_url, body, options) {
      assert.deepEqual(options.retryDelays, [800, 2000, 4000]);
      assert.equal(options.retryOnStatus, true);
      sent.push(Number(body.get("chunkIndex")));
      return { ok: true, data: { sha256: body.get("checksum") } };
    },
  },
  onAcknowledged: async index => acknowledged.push(index),
});
assert.deepEqual(sent, [1]);
assert.deepEqual(acknowledged, [0, 1]);
assert.equal(result.uploadId, id);

// Exercise the existing XHR retry implementation, not just an assumed retry contract.
let attempts = 0, retryNotifications = 0;
class Xhr {
  upload = {};
  open() {}
  setRequestHeader() {}
  send() {
    attempts++;
    queueMicrotask(() => {
      this.status = attempts < 4 ? 503 : 200;
      this.responseText = JSON.stringify({ message: "fixture" });
      this.onload();
    });
  }
}
const uploadWindow = {};
const sandbox = { window: uploadWindow, XMLHttpRequest: Xhr, navigator: { onLine: true }, console, Math, setTimeout: callback => { queueMicrotask(callback); return 0; }, clearTimeout() {} };
vm.runInNewContext(await readFile(new URL("../upload-progress.js", import.meta.url), "utf8"), sandbox);
const retryResult = await uploadWindow.HaloUploadProgress.sendFormDataWithRetry("/fixture", new FormData(), { retryDelays: [1, 1, 1], retryOnStatus: true, onRetry: () => retryNotifications++ });
assert.equal(retryResult.ok, true);
assert.equal(attempts, 4); assert.equal(retryNotifications, 3);
attempts = 0;
Xhr.prototype.send = function () { attempts++; queueMicrotask(() => { this.status = 401; this.responseText = "{}"; this.onload(); }); };
assert.equal((await uploadWindow.HaloUploadProgress.sendFormDataWithRetry("/fixture", new FormData(), { retryDelays: [1, 1, 1], retryOnStatus: true })).status, 401);
assert.equal(attempts, 1, "authorization errors do not trigger automatic retries");
delete globalThis.__songLabResumeFixture;
assert.ok(webcrypto.subtle);
console.log("Song Lab resume contracts passed: real handler ownership/origin, verified chunks, exact finalization, idempotence, reconciliation, and bounded XHR retries.");
