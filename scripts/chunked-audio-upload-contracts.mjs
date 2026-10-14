import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import vm from "node:vm";
import * as chunkRules from "../netlify/lib/chunked-audio-upload.mjs";
import {
  AUDIO_CHUNK_MAX_BYTES,
  AUDIO_UPLOAD_MAX_CHUNKS,
  audioChunkKey,
  audioUploadPrefix,
  audioSessionKey,
  audioFinalizationKey,
  inspectAudioUpload,
  parseUploadInteger,
  sealAudioUpload,
  storeAudioChunk,
  validateChunkSequence,
} from "../netlify/lib/chunked-audio-upload.mjs";
import {
  createAudioApiClient,
  isCandidateAudioFile,
  resolveBaseUrl,
  uploadAudioFile,
  watchFolder,
} from "./halo-chunk-upload.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const sha256 = data => createHash("sha256").update(data).digest("hex");
const SONG_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "test-access-token";

function memoryStore(blobs = new Map()) {
  return {
    blobs,
    async list({ prefix }) { return { blobs: [...blobs.keys()].filter(key => key.startsWith(prefix)).sort().map(key => ({ key })) }; },
    async getMetadata(key) { return blobs.has(key) ? { metadata: structuredClone(blobs.get(key).metadata) } : null; },
    async set(key, data, { metadata, onlyIfNew } = {}) {
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data);
      // Conversion may yield, but the existence check and mutation are one atomic operation.
      if (onlyIfNew && blobs.has(key)) return { modified: false };
      blobs.set(key, { data: bytes, metadata: structuredClone(metadata) });
      return { modified: true };
    },
    async setJSON(key, data, { onlyIfNew } = {}) {
      await Promise.resolve();
      if (onlyIfNew && blobs.has(key)) return { modified: false };
      blobs.set(key, { json: structuredClone(data) });
      return { modified: true };
    },
    async get(key, { type } = {}) {
      const blob = blobs.get(key);
      return type === "json" ? structuredClone(blob?.json ?? null) : blob?.data || null;
    },
    async delete() { throw new Error("Immutable upload sessions must not delete chunks"); },
  };
}

// Library rules: sequence validation, session consistency, checksums, out-of-order completeness.
{
  assert.equal(AUDIO_UPLOAD_MAX_CHUNKS, 32);
  assert.equal(validateChunkSequence({ chunkIndex: 0, chunkCount: 3, byteSize: 10, chunkBytes: 4 }).ok, true);
  assert.equal(validateChunkSequence({ chunkIndex: 2, chunkCount: 3, byteSize: 10, chunkBytes: 2 }).ok, true);
  assert.equal(validateChunkSequence({ chunkIndex: 3, chunkCount: 3, byteSize: 10, chunkBytes: 4 }).status, 400, "rejects an index outside the session");
  assert.equal(validateChunkSequence({ chunkIndex: 0, chunkCount: 3, byteSize: 10, chunkBytes: 2 }).status, 400, "rejects a full-size chunk that does not match the declared count");
  assert.equal(validateChunkSequence({ chunkIndex: 0, chunkCount: 1, byteSize: 10, chunkBytes: AUDIO_CHUNK_MAX_BYTES + 1 }).status, 413);
  assert.equal(validateChunkSequence({ chunkIndex: 0, chunkCount: 99, byteSize: 10, chunkBytes: 1 }).status, 400);

  const store = memoryStore();
  const prefix = audioUploadPrefix("member", VERSION_ID, "upload-session-1");
  const bytes = randomBytes(10);
  const parts = [bytes.subarray(0, 4), bytes.subarray(4, 8), bytes.subarray(8)];
  const put = (index, data = parts[index], extra = {}) => storeAudioChunk(store, { prefix, chunkIndex: index, chunkCount: 3, byteSize: 10, chunk: new Blob([data]), ...extra });

  assert.equal((await put(2)).ok, true, "accepts chunks out of order");
  let status = await inspectAudioUpload(store, { prefix, chunkCount: 3, byteSize: 10 });
  assert.deepEqual(status.missingChunks, [0, 1]);
  assert.equal(status.complete, false);
  assert.equal(status.storedBytes, 2);
  assert.equal(status.confirmedBytes, 0, "out-of-order stored bytes are not a resumable offset");
  assert.equal((await put(0, parts[0], { checksum: sha256(Buffer.from("tampered")) })).status, 422, "rejects chunks whose bytes do not match the client checksum");
  assert.equal((await put(0, parts[0], { checksum: sha256(parts[0]) })).ok, true);
  assert.equal((await storeAudioChunk(store, { prefix, chunkIndex: 1, chunkCount: 4, byteSize: 13, chunk: new Blob([parts[1]]) })).status, 409, "refuses parts from a differently shaped upload under the same session");
  assert.equal((await put(1)).ok, true);
  assert.equal((await put(1)).ok, true, "identical retries reuse the immutable deterministic key");
  assert.equal((await put(1, Buffer.from("xxxx"))).status, 409, "conflicting retry never overwrites accepted bytes");
  status = await inspectAudioUpload(store, { prefix, chunkCount: 3, byteSize: 10 });
  assert.equal(status.complete, true);
  assert.deepEqual(status.receivedChunks, [0, 1, 2]);
  assert.equal(status.chunkChecksums[1], sha256(parts[1]));
  assert.equal(status.confirmedBytes, 10);
  assert.equal(store.blobs.size, 4, "three immutable chunks and a durable manifest");
  const assembled = Buffer.concat([0, 1, 2].map(index => store.blobs.get(audioChunkKey(prefix, index)).data));
  assert.equal(Buffer.compare(assembled, bytes), 0, "parts reassemble in index order to the original bytes");

  store.blobs.get(audioChunkKey(prefix, 1)).metadata.size = 3;
  status = await inspectAudioUpload(store, { prefix, chunkCount: 3, byteSize: 10 });
  assert.equal(status.complete, false);
  assert.deepEqual(status.invalidChunks, [1], "flags parts whose size breaks the uniform chunk layout");
  assert.equal(status.confirmedBytes, 4, "confirmed offset stops before invalid data");
  assert.equal(store.blobs.has(audioChunkKey(prefix, 1)), true, "invalid chunks are retained, not deleted under concurrent readers");
}

// Separate server instances share only durable storage, with adversarial first-writer races.
{
  const backing = new Map();
  const a = memoryStore(backing);
  const b = memoryStore(backing);
  const prefix = audioUploadPrefix("member", VERSION_ID, "concurrent-session");
  const put = (store, data, extra = {}) => storeAudioChunk(store, {
    prefix, chunkIndex: 0, chunkCount: 3, byteSize: 10, chunk: new Blob([data]), ...extra,
  });
  let results = await Promise.all([put(a, "aaaa"), put(b, "aaaa")]);
  assert.ok(results.every(result => result.ok), "concurrent identical first chunks are accepted");
  assert.equal(backing.size, 2);
  const original = backing.get(audioChunkKey(prefix, 0));
  results = await Promise.all([put(a, "bbbb"), put(b, "cccc")]);
  assert.ok(results.every(result => result.status === 409));
  assert.equal(backing.get(audioChunkKey(prefix, 0)), original, "conflicting writes leave bytes and metadata untouched");

  backing.clear();
  results = await Promise.all([put(a, "aaaa"), put(b, "bbbb")]);
  assert.equal(results.filter(result => result.ok).length, 1, "one conflicting first chunk wins atomically");
  assert.equal(results.filter(result => result.status === 409).length, 1);
  backing.clear();
  results = await Promise.all([
    put(a, "aaaa"),
    put(b, "bbb", { byteSize: 8, chunkIndex: 1 }),
  ]);
  assert.equal(results.filter(result => result.ok).length, 1, "different indexes cannot pin competing session shapes");
  assert.equal(results.filter(result => result.status === 409).length, 1);
  const manifest = backing.get(audioSessionKey(prefix)).json;
  assert.equal([...backing.values()].filter(blob => blob.metadata).length, 1);
  assert.equal((await inspectAudioUpload(a, { prefix, chunkCount: 3, byteSize: manifest.byteSize === 10 ? 8 : 10 })).status, 409);

  backing.clear();
  results = await Promise.all([
    put(a, "aaaa", { chunkCount: 1, byteSize: 4, chunkSize: 4 }),
    put(b, "aaaa", { chunkCount: 1, byteSize: 4, chunkSize: 8 }),
  ]);
  assert.equal(results.filter(result => result.ok).length, 1, "optional chunkSize is pinned atomically even for a single part");
  assert.equal(results.filter(result => result.status === 409).length, 1);
  const seals = await Promise.all([
    sealAudioUpload(a, { prefix, chunkCount: 1, byteSize: 4, filename: "first.wav" }),
    sealAudioUpload(b, { prefix, chunkCount: 1, byteSize: 4, filename: "second.wav" }),
  ]);
  assert.ok(seals.every(result => result.ok));
  assert.deepEqual(seals[0].receipt, seals[1].receipt, "finalize metadata is immutable across concurrent instances");
  assert.equal((await put(a, "aaaa", { chunkCount: 1, byteSize: 4 })).finalized, true);
  assert.ok(backing.has(audioChunkKey(prefix, 0)), "sealed chunks remain available for playback and finalize retries");
}

// Sessions accepted by the previous implementation remain resumable without adding chunkSize.
{
  const store = memoryStore();
  const prefix = audioUploadPrefix("member", VERSION_ID, "legacy-session");
  await store.set(audioChunkKey(prefix, 0), new Blob(["aaaa"]), {
    metadata: { size: 4, byteSize: 6, chunkCount: 2, sha256: sha256("aaaa") },
  });
  assert.equal((await storeAudioChunk(store, { prefix, chunkIndex: 1, chunkCount: 2, byteSize: 5, chunk: new Blob(["x"]) })).status, 409);
  assert.equal(store.blobs.has(audioSessionKey(prefix)), false, "incompatible retries cannot poison a legacy session manifest");
  assert.equal((await storeAudioChunk(store, { prefix, chunkIndex: 0, chunkCount: 2, byteSize: 6, chunk: new Blob(["aaaa"]) })).ok, true);
  assert.equal((await storeAudioChunk(store, { prefix, chunkIndex: 1, chunkCount: 2, byteSize: 6, chunk: new Blob(["zz"]) })).ok, true);
  assert.equal((await inspectAudioUpload(store, { prefix, chunkCount: 2, byteSize: 6 })).complete, true);
  assert.equal((await sealAudioUpload(store, { prefix, chunkCount: 2, byteSize: 6 })).ok, true);
  const singlePrefix = audioUploadPrefix("member", VERSION_ID, "single-session");
  assert.equal((await storeAudioChunk(store, { prefix: singlePrefix, chunkIndex: 0, chunkCount: 1, byteSize: 4, chunkSize: 8, chunk: new Blob(["aaaa"]) })).ok, true);
  assert.equal((await storeAudioChunk(store, { prefix: singlePrefix, chunkIndex: 0, chunkCount: 1, byteSize: 4, chunk: new Blob(["aaaa"]) })).ok, true, "old clients may omit an explicitly pinned chunkSize");
}

{
  for (const value of [null, undefined, "", "1x", "1.0", "1e2", " 1", "-1", "+1", true, {}, "9007199254740992"]) {
    assert.ok(Number.isNaN(parseUploadInteger(value)), `rejects numeric coercion of ${String(value)}`);
  }
  assert.equal(parseUploadInteger("0"), 0);
  assert.equal(parseUploadInteger(10), 10);
  assert.equal(validateChunkSequence({ chunkIndex: 1, chunkCount: 3, byteSize: 10, chunkBytes: 4, chunkSize: 4, offset: 4 }).ok, true);
  for (const extra of [{ offset: 3 }, { offset: NaN }, { chunkSize: 3 }, { chunkSize: NaN }, { chunkSize: 0 }]) {
    assert.equal(validateChunkSequence({ chunkIndex: 1, chunkCount: 3, byteSize: 10, chunkBytes: 4, ...extra }).status, 400);
  }
}

// Execute the deployed handler itself, using independent instances and a shared atomic backing store.
{
  const store = memoryStore();
  const version = { id: VERSION_ID, song_id: SONG_ID, audio_blob_prefix: null, audio_storage_key: "", audio_revision: "revision-0" };
  let databaseWrites = 0;
  let storeUnavailable = false;
  const handlerErrors = [];
  const db = {
    async sql(strings, ...values) {
      const query = strings.join("?");
      if (query.includes("SELECT version.id")) {
        const snapshot = structuredClone(version);
        await Promise.resolve();
        return [snapshot];
      }
      if (query.includes("UPDATE halo_song_versions")) {
        await Promise.resolve();
        if (version.audio_blob_prefix !== values.at(-3) || version.audio_storage_key !== values.at(-2)
          || version.audio_revision !== values.at(-1)) return [];
        databaseWrites += 1;
        Object.assign(version, query.includes("SET audio_url = NULL") ? {
          audio_blob_prefix: null, audio_chunk_count: null, audio_byte_size: null, audio_storage_key: "",
        } : {
          audio_blob_prefix: values[1], audio_chunk_count: values[2], audio_content_type: values[3],
          audio_byte_size: values[4], audio_filename: values[5], audio_storage_key: "",
        });
        version.audio_revision = `revision-${databaseWrites}`;
        return [{ id: VERSION_ID }];
      }
      throw new Error(`Unexpected query: ${query}`);
    },
  };
  // Remove only this handler's known annotations; the contract runner must support CI's Node 20.
  const source = (await read("netlify/functions/song-catalog-audio.ts"))
    .replace(/^import[\s\S]*?;\n/gm, "")
    .replace("export default async function", "globalThis.handler = async function")
    .replace("export const config", "const config")
    .replaceAll(": Awaited<ReturnType<typeof getDatabase>>", "")
    .replaceAll(": Record<string, string>", "")
    .replaceAll(": Record<string, unknown>", "")
    .replaceAll(": { start: number; end: number }", "")
    .replaceAll(": Uint8Array[]", "")
    .replaceAll(": string | null", "")
    .replaceAll(": Request", "")
    .replaceAll(": unknown", "")
    .replaceAll(": string", "")
    .replaceAll(": number", "")
    .replaceAll(" as Record<string, unknown> | null", "");
  const createHandler = () => {
    const context = {
      ...chunkRules, Blob, Request, Response, ReadableStream, URL, Uint8Array, randomUUID,
      console: { ...console, error: (...args) => handlerErrors.push(args) },
      getStore: () => {
        const facade = memoryStore(store.blobs);
        return {
          ...facade,
          async get(...args) {
            if (storeUnavailable) throw new Error("Durable upload store unavailable");
            return facade.get(...args);
          },
        };
      },
      getDatabase: async () => db, getUser: async () => ({ id: "user" }),
      ensureMembership: async () => ({ member_id: "member" }), cleanText: (value, max) => String(value ?? "").trim().slice(0, max),
      verifyRequestOrigin: request => { assert.equal(request.headers.get("origin"), new URL(request.url).origin); },
      runDreamweaverReview: async () => {}, deleteStoredObject: async () => {}, directUploadConfig: () => null,
    };
    vm.runInNewContext(source, context);
    return context.handler;
  };
  const a = createHandler();
  const b = createHandler();
  const base = { songId: SONG_ID, versionId: VERSION_ID, uploadId: "handler-session-1", chunkCount: 3, byteSize: 10 };
  const request = (body, isForm = false, method = "POST") => new Request("https://halo.example/api/song-catalog/audio", {
    method, headers: { origin: "https://halo.example", ...(isForm ? {} : { "content-type": "application/json" }) },
    body: isForm ? body : JSON.stringify(body),
  });
  const chunkRequest = (index, data, extra = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...base, chunkIndex: index, filename: "test.wav", contentType: "audio/wav", ...extra })) form.set(key, value);
    form.set("chunk", new Blob([data], { type: "audio/wav" }), "part.wav");
    return request(form, true);
  };
  const statusRequest = extra => request({ ...base, action: "upload_status", ...extra });
  const finalizeRequest = extra => request({ ...base, action: "finalize_upload", filename: "test.wav", contentType: "audio/wav", ...extra });
  const fresh = await (await a(statusRequest())).json();
  assert.equal(fresh.finalized, false);
  assert.equal(fresh.confirmedBytes, 0);
  assert.equal(fresh.storedBytes, 0);
  assert.deepEqual(fresh.receivedChunks, []);
  assert.deepEqual(fresh.invalidChunks, []);
  assert.deepEqual(fresh.chunkChecksums, {});
  for (const field of ["chunkIndex", "chunkCount", "byteSize", "chunkSize", "offset"]) {
    for (const value of ["", "1garbage", "1.2", "1e2", " 1", "-1"]) {
      const response = await a(chunkRequest(0, "aaaa", { [field]: value }));
      assert.equal(response.status, field === "byteSize" ? 413 : 400, `${field} must be parsed strictly`);
    }
  }
  assert.equal(store.blobs.size, 0, "invalid forms never allocate a manifest or write a chunk");
  for (const action of ["upload_status", "finalize_upload"]) {
    for (const field of ["chunkCount", "byteSize", "chunkSize"]) {
      const response = await a(request({ ...base, action, contentType: "audio/wav", [field]: "3garbage" }));
      assert.equal(response.status, field === "byteSize" ? 413 : 400);
    }
  }
  storeUnavailable = true;
  for (const outageRequest of [chunkRequest(0, "aaaa"), statusRequest(), finalizeRequest()]) {
    const outage = await a(outageRequest);
    assert.equal(outage.status, 500, "durable store rejections are handled inside the endpoint catch");
    assert.match(outage.headers.get("content-type"), /application\/json/);
    assert.equal((await outage.json()).message, "Song audio is temporarily unavailable");
  }
  assert.equal(handlerErrors.length, 3);
  assert.equal(store.blobs.size, 0);
  storeUnavailable = false;
  assert.equal((await a(chunkRequest(2, "zz", { offset: 8, chunkSize: 4 }))).status, 200);
  let status = await (await a(statusRequest())).json();
  assert.equal(status.confirmedBytes, 0);
  assert.equal(status.storedBytes, 2);
  assert.equal(status.chunkSize, 4);
  assert.deepEqual(status.receivedChunks, [2]);
  assert.equal(status.chunkChecksums[2], sha256("zz"));
  assert.equal(status.finalized, false);
  const firsts = await Promise.all([a(chunkRequest(0, "aaaa")), b(chunkRequest(0, "bbbb"))]);
  assert.deepEqual(firsts.map(response => response.status).sort(), [200, 409]);
  assert.equal((await a(chunkRequest(1, "cccc", { offset: 5 }))).status, 400);
  assert.equal((await a(chunkRequest(1, "cccc", { chunkSize: 3 }))).status, 400);
  status = await (await a(statusRequest())).json();
  assert.equal(status.confirmedBytes, 4);
  assert.equal(status.storedBytes, 6);
  const partial = await a(finalizeRequest());
  assert.equal(partial.status, 409);
  assert.deepEqual((await partial.json()).missingChunks, [1]);
  assert.equal((await a(chunkRequest(1, "cccc"))).status, 200);
  assert.equal((await a(statusRequest({ chunkCount: 4, byteSize: 13 }))).status, 409);
  const finals = await Promise.all([a(finalizeRequest({ filename: "one.wav" })), b(finalizeRequest({ filename: "two.wav" }))]);
  assert.ok(finals.every(response => response.status === 200), "same-session concurrent finalize is idempotent");
  assert.equal(databaseWrites, 1, "only the winning compare-and-swap publishes audio");
  const prefix = audioUploadPrefix("member", VERSION_ID, base.uploadId);
  assert.equal(version.audio_filename, store.blobs.get(audioFinalizationKey(prefix)).json.filename);
  const writesBeforeRetry = [...store.blobs.values()];
  assert.equal((await b(chunkRequest(0, "xxxx"))).status, 409);
  assert.deepEqual([...store.blobs.values()], writesBeforeRetry, "finalized uploads do not write anything");
  status = await (await a(statusRequest())).json();
  assert.equal(status.finalized, true);
  assert.equal(status.persisted, true);
  assert.equal(status.lockedIn, true);
  assert.equal(status.audioUrl, `/api/song-catalog/audio?versionId=${VERSION_ID}`);
  assert.equal(status.message, "Audio is persisted and locked into HALO storage.");
  assert.equal(status.confirmedBytes, 10);
  assert.deepEqual(status.receivedChunks, [0, 1, 2]);
  assert.equal((await a(finalizeRequest())).status, 200);

  // Competing sessions must not clean up each other's chunks or blindly publish stale pointers.
  for (const uploadId of ["handler-session-2", "handler-session-3"]) {
    assert.equal((await a(chunkRequest(0, "new!", { uploadId, chunkCount: 1, byteSize: 4 }))).status, 200);
  }
  const competing = await Promise.all([
    a(finalizeRequest({ uploadId: "handler-session-2", chunkCount: 1, byteSize: 4 })),
    b(finalizeRequest({ uploadId: "handler-session-3", chunkCount: 1, byteSize: 4 })),
  ]);
  assert.deepEqual(competing.map(response => response.status).sort(), [200, 409]);
  assert.ok(store.blobs.has(audioChunkKey(prefix, 0)), "prior finalized playback is never deleted by replacement");
  assert.equal((await a(chunkRequest(0, "aaaa"))).status, 409, "the durable seal rejects writes even after another session replaces the version");
  const currentPrefix = version.audio_blob_prefix;
  const writesBeforeSupersededRetry = databaseWrites;
  const superseded = await a(finalizeRequest());
  assert.equal(superseded.status, 409, "retrying an older finalized session cannot replace the newer session");
  assert.equal(version.audio_blob_prefix, currentPrefix);
  assert.equal(databaseWrites, writesBeforeSupersededRetry, "superseded finalize only compares against its originally pinned prior pointer");
  for (const uploadId of ["handler-session-2", "handler-session-3"]) {
    const sessionPrefix = audioUploadPrefix("member", VERSION_ID, uploadId);
    assert.ok(store.blobs.has(audioChunkKey(sessionPrefix, 0)));
    if (sessionPrefix !== version.audio_blob_prefix) {
      assert.ok(store.blobs.has(audioFinalizationKey(sessionPrefix)));
      const unpublished = await (await a(statusRequest({ uploadId, chunkCount: 1, byteSize: 4 }))).json();
      assert.equal(unpublished.finalized, false, "a sealed but unpublished session is not finalized");
      assert.equal(unpublished.persisted, undefined);
      assert.equal(unpublished.audioUrl, undefined);
    }
  }
  const deletedUploadId = version.audio_blob_prefix.split("/").at(-3);
  const deletedPrefix = version.audio_blob_prefix;
  const deleted = await a(request({ songId: SONG_ID, versionId: VERSION_ID }, false, "DELETE"));
  assert.equal(deleted.status, 200);
  assert.equal(version.audio_blob_prefix, null);
  assert.equal(version.audio_storage_key, "");
  const writesAfterDelete = databaseWrites;
  assert.equal((await a(finalizeRequest({ uploadId: deletedUploadId, chunkCount: 1, byteSize: 4 }))).status, 409, "a deleted session is durably retired");
  assert.equal((await a(finalizeRequest())).status, 409, "ABA pointer reset cannot resurrect an older session whose original pointers were empty");
  assert.equal(databaseWrites, writesAfterDelete);
  assert.equal(version.audio_blob_prefix, null);
  assert.ok(store.blobs.has(audioChunkKey(deletedPrefix, 0)), "deletion retains immutable chunks for in-flight readers");
  const retiredStatus = await (await a(statusRequest({ uploadId: deletedUploadId, chunkCount: 1, byteSize: 4 }))).json();
  assert.equal(retiredStatus.retired, true);
  assert.equal(retiredStatus.finalized, false);
  assert.match(retiredStatus.successorUploadId, /^next-[a-f0-9-]{36}$/);
  const retryStatus = await (await b(statusRequest({ uploadId: deletedUploadId, chunkCount: 1, byteSize: 4 }))).json();
  assert.equal(retryStatus.successorUploadId, retiredStatus.successorUploadId, "the replacement generation is durable across server instances");
  const replacement = { uploadId: retiredStatus.successorUploadId, chunkCount: 1, byteSize: 4 };
  assert.equal((await a(chunkRequest(0, "new!", replacement))).status, 200);
  assert.equal((await a(finalizeRequest(replacement))).status, 200, "explicit same-file upload succeeds under a fresh successor generation");
  const replacementStatus = await (await a(statusRequest(replacement))).json();
  assert.equal(replacementStatus.persisted, true);
  assert.equal(replacementStatus.finalized, true);
}

// A fake /api/song-catalog/audio that mirrors the function's auth, origin, chunk, status, and finalize rules.
function fakeAudioApi({ failures = {}, statusTransform = status => status, competingChunks = [] } = {}) {
  const store = memoryStore();
  const finalized = new Map();
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  async function fetchImpl(url, init) {
    const headers = new Headers(init.headers);
    const isForm = init.body instanceof FormData;
    const label = isForm ? `chunk:${init.body.get("chunkIndex")}` : JSON.parse(init.body).action;
    calls.push(label);
    const failure = failures[label]?.shift();
    if (failure === "network") throw new TypeError("fetch failed");
    if (failure && !["lost", "bad-json", "finalized-race"].includes(failure)) return json({ message: "Temporary failure" }, failure);
    const acknowledge = body => {
      if (failure === "lost") {
        if (failures.afterLostStatus) {
          failures.upload_status = [...failures.afterLostStatus];
          delete failures.afterLostStatus;
        }
        throw new TypeError("acknowledgement lost after commit");
      }
      if (failure === "bad-json") return new Response("{broken-json", { status: 200 });
      return json(body);
    };
    assert.equal(new URL(url).pathname, "/api/song-catalog/audio");
    if (headers.get("authorization") !== ["Bearer", TOKEN].join(" ")) return json({ message: "Join or sign in to use song audio" }, 401);
    if (headers.get("origin") !== new URL(url).origin) return json({ message: "Cross-origin audio uploads are not accepted" }, 403);
    if (isForm) {
      const form = init.body;
      const prefix = audioUploadPrefix("member", form.get("versionId"), form.get("uploadId"));
      if (failure === "finalized-race") {
        for (const [chunkIndex, bytes] of competingChunks.entries()) {
          const stored = await storeAudioChunk(store, {
            prefix, chunkIndex, chunkCount: parseUploadInteger(form.get("chunkCount")),
            byteSize: parseUploadInteger(form.get("byteSize")), chunkSize: parseUploadInteger(form.get("chunkSize")),
            chunk: new Blob([bytes]), checksum: sha256(bytes),
          });
          assert.equal(stored.ok, true, "competing client commits the same upload");
        }
        finalized.set(form.get("versionId"), prefix);
      }
      if (finalized.get(form.get("versionId")) === prefix) return json({ message: "This upload is already finalized", finalized: true }, 409);
      let chunk = form.get("chunk");
      if (failures.corrupt?.includes(Number(form.get("chunkIndex")))) {
        failures.corrupt = failures.corrupt.filter(index => index !== Number(form.get("chunkIndex")));
        const flipped = new Uint8Array(await chunk.arrayBuffer());
        flipped[0] ^= 0xff;
        chunk = new Blob([flipped]);
      }
      const result = await storeAudioChunk(store, {
        prefix, chunk, checksum: form.get("chunkSha256"),
        chunkIndex: parseUploadInteger(form.get("chunkIndex")), chunkCount: parseUploadInteger(form.get("chunkCount")), byteSize: parseUploadInteger(form.get("byteSize")),
        chunkSize: form.has("chunkSize") ? parseUploadInteger(form.get("chunkSize")) : undefined,
        offset: form.has("offset") ? parseUploadInteger(form.get("offset")) : undefined,
      });
      return result.ok ? acknowledge({ message: "Audio chunk uploaded", chunkIndex: result.chunkIndex }) : json({ message: result.message }, result.status);
    }
    const payload = JSON.parse(init.body);
    const prefix = audioUploadPrefix("member", payload.versionId, payload.uploadId);
    const status = await inspectAudioUpload(store, { prefix, chunkCount: payload.chunkCount, byteSize: payload.byteSize, chunkSize: payload.chunkSize });
    if (!status.ok) return json({ message: status.message }, status.status);
    if (payload.action === "upload_status") {
      const isFinalized = finalized.get(payload.versionId) === prefix;
      return json(statusTransform({
        finalized: isFinalized, ...status,
        ...(isFinalized ? { persisted: true, lockedIn: true, audioUrl: `/api/song-catalog/audio?versionId=${payload.versionId}`, message: "Audio is persisted and locked into HALO storage." } : {}),
      }));
    }
    if (payload.action === "finalize_upload") {
      if (finalized.get(payload.versionId) === prefix) return json({
        message: "Audio is persisted and locked into HALO storage.", alreadyFinalized: true,
        persisted: true, lockedIn: true, audioUrl: `/api/song-catalog/audio?versionId=${payload.versionId}`,
      });
      if (!status.complete) {
        return json({ message: "The audio upload is incomplete.", missingChunks: status.missingChunks, invalidChunks: status.invalidChunks }, 409);
      }
      finalized.set(payload.versionId, prefix);
      return acknowledge({ message: "Audio is persisted and locked into HALO storage.", audioUrl: `/api/song-catalog/audio?versionId=${payload.versionId}`, persisted: true });
    }
    return json({ message: "Choose a supported audio action" }, 400);
  }
  const assembled = versionId => {
    const prefix = finalized.get(versionId);
    const keys = [...store.blobs.keys()].filter(key => key.startsWith(prefix) && store.blobs.get(key).data).sort();
    return Buffer.concat(keys.map(key => store.blobs.get(key).data));
  };
  return { fetchImpl, calls, store, assembled };
}

const workDir = await mkdtemp(join(root, ".halo-chunk-upload-contracts-"));
try {
  const audio = Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVEfmt "), randomBytes(25_000)]);
  const audioPath = join(workDir, "track_spanish_mix.wav");
  await writeFile(audioPath, audio);
  const noSleep = async () => {};

  // CLI helper: auth required, retries transient failures, re-sends corrupted chunks, and reassembles byte-for-byte.
  {
    assert.throws(() => resolveBaseUrl("http://example.com"), /https/);
    assert.equal(resolveBaseUrl("http://localhost:8888/anything"), "http://localhost:8888");
    assert.throws(() => createAudioApiClient({ baseUrl: "https://halo.example", token: "" }), /HALO_UPLOAD_TOKEN/);

    const api = fakeAudioApi({ failures: { "chunk:1": [503, "network"], "chunk:2": [504], finalize_upload: [502], corrupt: [3] } });
    const unauthenticated = createAudioApiClient({ baseUrl: "https://halo.example", token: "wrong-token", fetchImpl: api.fetchImpl, sleepImpl: noSleep });
    await assert.rejects(
      uploadAudioFile({ filePath: audioPath, songId: SONG_ID, versionId: VERSION_ID, client: unauthenticated, chunkSize: 4096 }),
      error => error.status === 401,
      "rejects unauthenticated uploads without retrying them",
    );

    const client = createAudioApiClient({ baseUrl: "https://halo.example", token: TOKEN, fetchImpl: api.fetchImpl, sleepImpl: noSleep });
    const result = await uploadAudioFile({ filePath: audioPath, songId: SONG_ID, versionId: VERSION_ID, client, chunkSize: 4096 });
    assert.equal(result.chunkCount, Math.ceil(audio.length / 4096));
    assert.equal(result.persisted, true);
    assert.equal(Buffer.compare(api.assembled(VERSION_ID), audio), 0, "finalized parts reassemble to the original file");
    assert.equal(api.calls.filter(call => call === "chunk:1").length, 3, "retries a chunk after 503 and a dropped connection");
    assert.equal(api.calls.filter(call => call === "chunk:3").length, 2, "re-sends a chunk the server rejected as corrupted");

    const again = await uploadAudioFile({ filePath: audioPath, songId: SONG_ID, versionId: VERSION_ID, client, chunkSize: 4096 });
    assert.equal(again.alreadyFinalized, true, "re-running the same file is a no-op once finalized");
  }

  // Committed writes with lost/malformed acknowledgements are reconciled, never blindly repeated.
  for (const failure of ["lost", "bad-json"]) {
    for (const retryDelays of [[], [0, 0]]) {
      const api = fakeAudioApi({ failures: { "chunk:0": [failure], finalize_upload: [failure] } });
      const client = createAudioApiClient({ baseUrl: "https://halo.example", token: TOKEN, fetchImpl: api.fetchImpl, sleepImpl: noSleep, retryDelays });
      const result = await uploadAudioFile({ filePath: audioPath, songId: SONG_ID, versionId: VERSION_ID, client, chunkSize: 4096 });
      assert.equal(result.persisted, true);
      assert.equal(result.alreadyFinalized, true, `${failure} finalize acknowledgement is recovered from durable status`);
      assert.equal(api.calls.filter(call => call === "chunk:0").length, 1, `${failure} acknowledgement must not duplicate a committed chunk, even with exhausted retries`);
      assert.equal(api.calls.filter(call => call === "finalize_upload").length, 1, `${failure} acknowledgement must not duplicate a committed finalize`);
      assert.equal(api.calls[api.calls.indexOf("chunk:0") + 1], "upload_status", "reads status before deciding whether to resend an ambiguous chunk");
      assert.equal(api.calls.at(-1), "upload_status", "reads finalization status after an ambiguous finalize");
      assert.equal(Buffer.compare(api.assembled(VERSION_ID), audio), 0);
    }
  }

  // Another client can finish between our status read and write; only finalized conflicts reconcile.
  {
    const competingChunks = Array.from({ length: Math.ceil(audio.length / 4096) }, (_, index) => audio.subarray(index * 4096, (index + 1) * 4096));
    const api = fakeAudioApi({ failures: { "chunk:0": ["finalized-race"] }, competingChunks });
    const client = createAudioApiClient({ baseUrl: "https://halo.example", token: TOKEN, fetchImpl: api.fetchImpl, sleepImpl: noSleep, retryDelays: [] });
    const result = await uploadAudioFile({ filePath: audioPath, songId: SONG_ID, versionId: VERSION_ID, client, chunkSize: 4096 });
    assert.equal(result.alreadyFinalized, true);
    assert.equal(result.persisted, true);
    assert.equal(api.calls.filter(call => call.startsWith("chunk:")).length, 1, "a finalized 409 is reconciled without resending chunks");
    assert.equal(api.calls[api.calls.indexOf("chunk:0") + 1], "upload_status");
    assert.equal(Buffer.compare(api.assembled(VERSION_ID), audio), 0);
  }
  {
    const api = fakeAudioApi({ failures: { "chunk:0": [409] } });
    const client = createAudioApiClient({ baseUrl: "https://halo.example", token: TOKEN, fetchImpl: api.fetchImpl, sleepImpl: noSleep, retryDelays: [] });
    await assert.rejects(
      uploadAudioFile({ filePath: audioPath, songId: SONG_ID, versionId: VERSION_ID, client, chunkSize: 4096 }),
      error => error.status === 409,
    );
    assert.equal(api.calls.at(-1), "chunk:0", "genuine conflicts are not retried or converted into success");
    assert.equal(api.calls.filter(call => call.startsWith("chunk:")).length, 1);
  }

  // An unavailable progress endpoint blocks writes rather than treating unknown progress as zero.
  for (const statusTransform of [
    status => ({ ...status, finalized: undefined }),
    status => ({ ...status, receivedChunks: undefined }),
    status => ({ ...status, invalidChunks: false }),
    status => ({ ...status, chunkChecksums: null }),
    status => ({ ...status, chunkCount: status.chunkCount + 1 }),
    status => ({ ...status, byteSize: status.byteSize + 1 }),
  ]) {
    const api = fakeAudioApi({ statusTransform });
    const client = createAudioApiClient({ baseUrl: "https://halo.example", token: TOKEN, fetchImpl: api.fetchImpl, sleepImpl: noSleep, retryDelays: [] });
    await assert.rejects(
      uploadAudioFile({ filePath: audioPath, songId: SONG_ID, versionId: VERSION_ID, client, chunkSize: 4096 }),
      /invalid upload progress/,
    );
    assert.deepEqual(api.calls, ["upload_status"], "malformed successful status cannot cause chunks to be sent");
    assert.equal(api.store.blobs.size, 0);
  }
  {
    const api = fakeAudioApi({ failures: { upload_status: [503, 503] } });
    const client = createAudioApiClient({ baseUrl: "https://halo.example", token: TOKEN, fetchImpl: api.fetchImpl, sleepImpl: noSleep, retryDelays: [0] });
    await assert.rejects(
      uploadAudioFile({ filePath: audioPath, songId: SONG_ID, versionId: VERSION_ID, client, chunkSize: 4096 }),
      error => error.status === 503,
    );
    assert.ok(api.calls.every(call => call === "upload_status"));
    assert.equal(api.store.blobs.size, 0);
  }
  {
    const api = fakeAudioApi({ failures: { "chunk:0": ["lost"], afterLostStatus: [503] } });
    const client = createAudioApiClient({ baseUrl: "https://halo.example", token: TOKEN, fetchImpl: api.fetchImpl, sleepImpl: noSleep, retryDelays: [] });
    await assert.rejects(
      uploadAudioFile({ filePath: audioPath, songId: SONG_ID, versionId: VERSION_ID, client, chunkSize: 4096 }),
      error => error.status === 503,
    );
    assert.equal(api.calls.filter(call => call === "chunk:0").length, 1, "failed reconciliation cannot trigger an unsafe chunk resend");
    assert.equal(api.calls.filter(call => call.startsWith("chunk:")).length, 1, "no later chunks are sent without authoritative status");
    const resumed = await uploadAudioFile({ filePath: audioPath, songId: SONG_ID, versionId: VERSION_ID, client, chunkSize: 4096 });
    assert.equal(resumed.skippedChunks, 1, "a later run resumes the committed chunk once status is available");
    assert.equal(api.calls.filter(call => call === "chunk:0").length, 1);
    assert.equal(Buffer.compare(api.assembled(VERSION_ID), audio), 0);
  }

  // Resume: chunks already on the server with matching checksums are skipped; missing ones are sent.
  {
    const api = fakeAudioApi({ failures: { "chunk:4": [400] } });
    const client = createAudioApiClient({ baseUrl: "https://halo.example", token: TOKEN, fetchImpl: api.fetchImpl, sleepImpl: noSleep });
    await assert.rejects(uploadAudioFile({ filePath: audioPath, songId: SONG_ID, versionId: VERSION_ID, client, chunkSize: 4096 }), error => error.status === 400);
    const resumed = await uploadAudioFile({ filePath: audioPath, songId: SONG_ID, versionId: VERSION_ID, client, chunkSize: 4096 });
    assert.equal(resumed.skippedChunks, 4, "skips the four chunks already stored before the interruption");
    assert.equal(Buffer.compare(api.assembled(VERSION_ID), audio), 0);
  }

  // Watcher: only finished audio files are uploaded; partial downloads are ignored; results are filed away.
  {
    const dropDir = join(workDir, "staging_uploads");
    const uploaded = [];
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dropDir);
    await writeFile(join(dropDir, "alt_mix.wav"), audio);
    await writeFile(join(dropDir, "still_copying.wav.part"), audio);
    await writeFile(join(dropDir, "broken.flac"), audio);
    assert.equal(isCandidateAudioFile("still_copying.wav.part"), false);
    assert.equal(isCandidateAudioFile(".hidden.wav"), false);
    assert.equal(isCandidateAudioFile("notes.txt"), false);
    const watcher = await watchFolder({
      dir: dropDir,
      log: () => {},
      stableOptions: { intervalMs: 1, stableChecks: 1 },
      upload: async filePath => { uploaded.push(filePath); if (filePath.endsWith(".flac")) throw new Error("rejected"); },
    });
    await watcher.idle();
    watcher.stop();
    assert.deepEqual(uploaded.map(path => path.split(/[\\/]/).pop()).sort(), ["alt_mix.wav", "broken.flac"]);
    assert.deepEqual(await readdir(join(dropDir, "uploaded")), ["alt_mix.wav"]);
    assert.deepEqual(await readdir(join(dropDir, "failed")), ["broken.flac"]);
    assert.ok((await readdir(dropDir)).includes("still_copying.wav.part"));
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}

// The deployed function wires the shared rules in behind authentication and same-origin checks.
{
  const [audioApi, packageText] = await Promise.all([read("netlify/functions/song-catalog-audio.ts"), read("package.json")]);
  const packageJson = JSON.parse(packageText);
  const checks = [
    [audioApi.includes('from "../lib/chunked-audio-upload.mjs"') && audioApi.includes("storeAudioChunk(audioStore") && audioApi.includes("inspectAudioUpload(audioStore"), "song audio uploads use the shared chunk-session rules"],
    [audioApi.includes('if (!user?.id) return json({ message: "Join or sign in to use song audio" }, 401)') && audioApi.includes("verifyRequestOrigin(request)"), "rejects anonymous and cross-origin uploads"],
    [audioApi.includes('payload.action === "upload_status"') && audioApi.includes("finalized: version.audio_blob_prefix === prefix"), "exposes resumable upload status"],
    [audioApi.includes('"This upload is already finalized"') && audioApi.includes("alreadyFinalized: true"), "never rewrites finalized parts and keeps finalize idempotent"],
    [audioApi.includes("missingChunks: status.missingChunks") && audioApi.includes("invalidChunks: status.invalidChunks"), "reports which chunks must be re-sent before finalizing"],
    [audioApi.includes('form.get("chunkSha256")'), "verifies optional per-chunk SHA-256 checksums"],
    [audioApi.includes('form.get("offset")') && audioApi.includes('form.get("chunkSize")') && !audioApi.includes("Number.parseInt"), "validates optional byte offsets and chunk sizes without partial numeric parsing"],
    [audioApi.includes("sealAudioUpload(audioStore") && audioApi.includes("IS NOT DISTINCT FROM") && !audioApi.includes("discardAudioChunks") && !audioApi.includes("removeUpload("), "seals finalization durably and retains chunks for concurrent playback"],
    [packageJson.scripts["upload:audio"] === "node scripts/halo-chunk-upload.mjs", "ships an npm entry point for local chunked uploads"],
    [String(packageJson.scripts["upload-experience:watchdog"]).includes("scripts/chunked-audio-upload-contracts.mjs"), "runs chunked audio upload contracts with the upload watchdog"],
  ];
  const failed = checks.filter(([ok]) => !ok);
  for (const [ok, label] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (failed.length) process.exit(1);
}

console.log("✓ chunked audio upload contracts passed");
