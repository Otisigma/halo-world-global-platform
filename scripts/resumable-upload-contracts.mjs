import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { verifyRequestOrigin } from "@netlify/identity";
import { getStore } from "@netlify/blobs";
import { appendUploadChunk, confirmedUploadBytes, ensureUploadSession, readUploadChunk } from "../netlify/lib/resumable-upload.mjs";
import * as resumable from "../netlify/lib/resumable-upload.mjs";
import * as multipart from "../netlify/lib/multipart-master-upload.mjs";
import * as storage from "../netlify/lib/direct-upload-storage.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
class MemoryStore {
  entries = new Map();
  revision = 0;
  async get(key) { return this.entries.get(key)?.data ?? null; }
  async getMetadata(key) {
    const entry = this.entries.get(key);
    return entry ? { metadata: entry.metadata, etag: entry.etag } : null;
  }
  async getWithMetadata(key) {
    const entry = this.entries.get(key);
    return entry ? { ...entry } : null;
  }
  async set(key, data, options = {}) {
    if (options.onlyIfNew && this.entries.has(key)) return { modified: false };
    if (options.onlyIfMatch && this.entries.get(key)?.etag !== options.onlyIfMatch) return { modified: false };
    this.entries.set(key, { data, metadata: options.metadata, etag: String(++this.revision) });
    return { modified: true };
  }
  async setJSON(key, data, options) { return this.set(key, data, options); }
  async list({ prefix }) { return { blobs: [...this.entries.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; }
  async delete(key) { this.entries.delete(key); }
}

const store = new MemoryStore();
const prefix = "owner/version/file/";
const details = { byteSize: 10, chunkSize: 4, filename: "master.wav", contentType: "audio/wav" };
const session = await ensureUploadSession(store, prefix, details);
const bytes = (...values) => Uint8Array.from(values).buffer;
// Exercise the installed SDK instead of assuming our MemoryStore matches its response shape.
const sdkEntries = new Map();
let sdkRevision = 0;
let sdkDenied = false;
const sdkStore = getStore({ name: "upload-contract", siteID: "contract-site", token: "contract-fixture",
  edgeURL: "https://blobs.test", uncachedEdgeURL: "https://blobs.test", consistency: "strong",
  async fetch(url, options) {
    const key = new URL(url).pathname;
    const entry = sdkEntries.get(key);
    if (options.method === "put") {
      if (sdkDenied) return new Response(null, { status: 403 });
      if (options.headers["if-none-match"] === "*" && entry
        || options.headers["if-match"] && options.headers["if-match"] !== entry?.etag) {
        return new Response(null, { status: 412 });
      }
      const etag = String(++sdkRevision);
      sdkEntries.set(key, { data: options.body, etag });
      return new Response(null, { headers: { etag } });
    }
    return entry ? new Response(entry.data, { headers: { etag: entry.etag } }) : new Response(null, { status: 404 });
  },
});
assert.deepEqual(await sdkStore.setJSON("shape", { fixture: true }, { onlyIfNew: true }), { modified: true, etag: "1" });
assert.deepEqual(await sdkStore.setJSON("shape", {}, { onlyIfNew: true }), { modified: false });
assert.deepEqual((await sdkStore.getWithMetadata("shape", { type: "json" })).data, { fixture: true });
const sdkSession = await ensureUploadSession(sdkStore, "sdk/", details);
assert.equal((await resumable.saveUploadPhase(sdkStore, "sdk/", sdkSession, "completing")).phase, "completing");
sdkDenied = true;
await assert.rejects(ensureUploadSession(sdkStore, "denied/", details), { status: 503 });
await assert.rejects(resumable.saveUploadPhase(sdkStore, "sdk/", sdkSession, "completing", null,
  { catalogBefore: { blobPrefix: "", storageKey: "" } }), { status: 503 });
sdkDenied = false;
assert.equal(await confirmedUploadBytes(store, prefix, session), 0);
await assert.rejects(appendUploadChunk(store, prefix, session, 4, bytes(5, 6, 7, 8)), { status: 409 });
await assert.rejects(appendUploadChunk(store, prefix, session, -1, bytes(1, 2, 3, 4)), { status: 400 });
await assert.rejects(appendUploadChunk(store, prefix, session, 0, bytes(1, 2)), { status: 400 });
assert.deepEqual(await Promise.all([
  appendUploadChunk(store, prefix, session, 0, bytes(1, 2, 3, 4)),
  appendUploadChunk(store, prefix, session, 0, bytes(1, 2, 3, 4)),
]), [4, 4]);
await assert.rejects(appendUploadChunk(store, prefix, session, 0, bytes(9, 9, 9, 9)), { status: 409 });
await assert.rejects(ensureUploadSession(store, prefix, { ...details, byteSize: 12 }), { status: 409 });
assert.equal(await confirmedUploadBytes(store, prefix, await ensureUploadSession(store, prefix, details)), 4);
assert.equal(await appendUploadChunk(store, prefix, session, 4, bytes(5, 6, 7, 8)), 8);
assert.equal(await appendUploadChunk(store, prefix, session, 8, bytes(9, 10)), 10);
assert.deepEqual([...new Uint8Array(await store.get(`${prefix}parts/002`))], [9, 10]);
await assert.rejects(readUploadChunk(new Request("https://halo.test/audio", { method: "POST", body: bytes(1, 2, 3) }), 2), { status: 413 });

const context = { window: {}, crypto: webcrypto, TextEncoder, URLSearchParams, setTimeout, console };
vm.runInNewContext(await read("upload-progress.js"), context);
const helper = context.window.HaloUploadProgress;
const file = Object.assign(new Blob([Uint8Array.from({ length: 10 }, (_, index) => index)]), { name: "master.wav" });
const id = await helper.fileUploadId(file, "version", 4);
assert.equal(await helper.fileUploadId(file, "version", 4), id);
assert.notEqual(await helper.fileUploadId(Object.assign(new Blob([bytes(9, 9, 9, 9, 9, 9, 9, 9, 9, 9)]), { name: file.name }), "version", 4), id);
assert.notEqual(await helper.fileUploadId(file, "other-version", 4), id);
assert.match(id, /^[a-f0-9]{64}$/);

let confirmed = 4;
const sent = [];
const progress = [];
await helper.uploadResumableFile({
  file, chunkSize: 4, retryDelays: [0],
  async getStatus() { return { uploadedBytes: confirmed }; },
  async sendChunk(chunk, start) {
    sent.push(start);
    confirmed += chunk.size;
    if (start === 4) throw new Error("Response lost after the server saved the chunk");
  },
  onProgress(percent) { progress.push(percent); },
});
assert.deepEqual(sent, [4, 8]);
assert.equal(progress[0], 40);
assert.equal(progress.at(-1), 100);
assert.ok(progress.every(percent => percent >= 40 && percent <= 100));
// A separate attempt resumes after a failed request that did not reach storage.
confirmed = 4;
await assert.rejects(helper.uploadResumableFile({
  file, chunkSize: 4, retryDelays: [],
  async getStatus() { return { uploadedBytes: confirmed }; },
  async sendChunk() { throw new Error("Disconnected"); },
}), /Disconnected/);
const restarted = [];
await helper.uploadResumableFile({
  file, chunkSize: 4,
  async getStatus() { return { uploadedBytes: confirmed }; },
  async sendChunk(chunk, start) { restarted.push(start); confirmed += chunk.size; },
});
assert.deepEqual(restarted, [4, 8]);
for (const uploadedBytes of [-1, 3, 11, NaN]) {
  await assert.rejects(helper.uploadResumableFile({
    file, chunkSize: 4, retryDelays: [],
    async getStatus() { return { uploadedBytes }; },
    async sendChunk() { assert.fail("Must not send at an invalid offset"); },
  }), /invalid upload offset/);
}
let attempts = 0;
await assert.rejects(helper.uploadResumableFile({
  file, chunkSize: 4, retryDelays: [0, 0],
  async getStatus() { attempts += 1; throw new Error("Offline"); },
  async sendChunk() { assert.fail("No status confirmation"); },
}), /Offline/);
assert.equal(attempts, 3);
await assert.rejects(helper.uploadResumableFile({
  file, chunkSize: 4,
  async getStatus() { helper.requireUploadResponse({ ok: false, status: 403, data: { message: "Forbidden" } }); },
}), /Forbidden/);

// Legacy multipart callers remain supported, with byte-weighted progress for a short final chunk.
const legacyProgress = [];
context.XMLHttpRequest = class {
  upload = {};
  status = 200;
  responseText = "{}";
  open() {}
  setRequestHeader() {}
  send(body) { this.upload.onprogress({ lengthComputable: true, loaded: body.size / 2, total: body.size }); this.onload(); }
};
await helper.uploadChunkedFile({
  url: "/legacy", file, chunkSize: 4,
  buildBody({ start, end }) { return file.slice(start, end); },
  onProgress(percent) { legacyProgress.push(percent); },
});
assert.deepEqual(legacyProgress, [20, 40, 60, 80, 90, 100]);

const config = { bucket: "test", region: "us-east-1", accessKeyId: "example", secretAccessKey: "example", endpoint: "https://storage.test", forcePathStyle: true };
assert.equal(await storage.headStoredObject(config, "missing", async () => new Response(null, { status: 404 })), 0);
for (const status of [403, 429, 500, 503]) {
  await assert.rejects(storage.headStoredObject(config, "diagnostic", async () => new Response(null, { status })), { status: 503, storageStatus: status });
}
await assert.rejects(storage.headStoredObject(config, "invalid", async () => new Response(null)), { storageCode: "InvalidResponse" });
await assert.rejects(storage.headStoredObject(config, "empty", async () => new Response(null, { headers: { "content-length": "0" } })), { storageCode: "InvalidResponse" });
assert.equal(await storage.headStoredObject(config, "present", async () => new Response(null, { headers: { "content-length": "5" } })), 5);
let timedOutSignal;
await assert.rejects(storage.boundedStorageRequest("https://storage.test", {}, async (url, options) => {
  timedOutSignal = options.signal;
  return new Promise(() => {});
}, response => response, 5), { storageCode: "Timeout", status: 503 });
assert.equal(timedOutSignal.aborted, true);
await assert.rejects(storage.headStoredObject(config, "offline", async () => { throw new Error("Offline"); }), { storageCode: "NetworkError", status: 503 });
for (const document of ["", "<html>Bad gateway</html>", "<Wrong><UploadId>misleading</UploadId></Wrong>", "<InitiateMultipartUploadResult>",
  "<InitiateMultipartUploadResult><UploadId>id</UploadId><Unclosed></InitiateMultipartUploadResult>"]) {
  await assert.rejects(multipart.masterUploadStatus({ store: new MemoryStore(), prefix: "invalid/", storage: config,
    scope: {}, uploadId: id, upload: { byteSize: 5, filename: "master.wav", contentType: "audio/wav" },
    fetchImpl: async () => new Response(document) }), { storageCode: "InvalidResponse" });
}
const masterStore = new MemoryStore();
const masterBytes = 8 * 1024 * 1024 + 2;
const upload = { byteSize: masterBytes, filename: "master.wav", contentType: "audio/wav" };
const masterOptions = { store: masterStore, prefix, storage: config, scope: { ownerMemberId: "owner", songId: "song", versionId: "version" }, uploadId: id, upload };
let objectBytes = 0;
let parts = [];
let completed = false;
let completionBody = "";
let createdCount = 0;
let discarded = 0;
async function storageFetch(url, options) {
  const query = new URL(url).searchParams;
  if (options.method === "HEAD") return new Response(null, { status: objectBytes ? 200 : 404, headers: { "Content-Length": String(objectBytes) } });
  if (options.method === "POST" && query.has("uploads")) {
    createdCount += 1;
    return new Response(`<InitiateMultipartUploadResult><UploadId>storage-${createdCount}</UploadId></InitiateMultipartUploadResult>`);
  }
  if (options.method === "DELETE") { discarded += 1; return new Response(null, { status: 204 }); }
  if (options.method === "GET") return new Response(`<ListPartsResult><IsTruncated>false</IsTruncated>${parts.map(part => `<Part><PartNumber>${part.number}</PartNumber><ETag>&quot;part-${part.number}&quot;</ETag><Size>${part.size}</Size></Part>`).join("")}</ListPartsResult>`);
  if (options.method === "POST") {
    completionBody = options.body;
    completed = true;
    objectBytes = masterBytes;
    const objectKey = decodeURIComponent(new URL(url).pathname).replace(/^\/test\//, "");
    return new Response(`<CompleteMultipartUploadResult><Key>${objectKey}</Key><ETag>&quot;complete&quot;</ETag></CompleteMultipartUploadResult>`);
  }
  assert.fail(`Unexpected storage request: ${options.method}`);
}
masterOptions.fetchImpl = storageFetch;
const simultaneous = await Promise.all([multipart.masterUploadStatus(masterOptions), multipart.masterUploadStatus(masterOptions)]);
assert.equal(simultaneous[0].session.storageUploadId, simultaneous[1].session.storageUploadId);
assert.equal(createdCount, 2);
assert.equal(discarded, 1);
assert.equal(simultaneous[0].uploadedBytes, 0);
for (const document of ["<html/>", "<ListPartsResult/>",
  "<ListPartsResult><IsTruncated>false</IsTruncated><Part></ListPartsResult>"]) {
  await assert.rejects(multipart.masterUploadProgress(config, simultaneous[0].session, async (url, options) =>
    options.method === "HEAD" ? new Response(null, { status: 404 }) : new Response(document)), { status: 503 });
}
await assert.rejects(multipart.masterPartUrl({ ...masterOptions, start: 8 * 1024 * 1024 }), { status: 409 });
const part = await multipart.masterPartUrl({ ...masterOptions, start: 0 });
const signed = new URL(part.uploadUrl);
assert.equal(signed.searchParams.get("partNumber"), "1");
assert.ok(signed.searchParams.get("uploadId"));
assert.equal(signed.searchParams.get("X-Amz-SignedHeaders"), "content-type;host");
parts = [{ number: 1, size: 8 * 1024 * 1024 }];
assert.equal((await multipart.masterUploadStatus(masterOptions)).uploadedBytes, 8 * 1024 * 1024);
await assert.rejects(multipart.completeMasterUpload(masterOptions), { status: 409 });
parts.push({ number: 2, size: 2 });
const fileKey = await multipart.completeMasterUpload(masterOptions);
assert.ok(completed);
assert.match(completionBody, /<PartNumber>2<\/PartNumber>/);
assert.match(completionBody, /&quot;part-1&quot;/);
assert.equal((await multipart.masterUploadStatus(masterOptions)).uploadedBytes, masterBytes);
assert.equal(await multipart.completeMasterUpload(masterOptions), fileKey);
objectBytes = 0;
parts = [{ number: 2, size: 2 }];
await assert.rejects(multipart.masterUploadStatus(masterOptions), { status: 409 });
parts = [{ number: 1, size: 1 }];
await assert.rejects(multipart.masterUploadStatus(masterOptions), { status: 409 });
parts = [{ number: 1, size: 8 * 1024 * 1024 }, { number: 2, size: 2 }];
await assert.rejects(multipart.completeMasterUpload({ ...masterOptions, fetchImpl: async (url, options) =>
  options.method === "POST" ? new Response("<Error><Code>InternalError</Code></Error>") : storageFetch(url, options) }), { status: 503 });
// NoSuchUpload alone is insufficient: recheck HEAD after a racing completion.
let recoveryHeads = 0;
const racingCompletion = await multipart.masterUploadStatus({ ...masterOptions, fetchImpl: async (url, options) => {
  if (options.method === "HEAD") {
    recoveryHeads += 1;
    return recoveryHeads === 1 ? new Response(null, { status: 404 })
      : new Response(null, { headers: { "content-length": String(masterBytes) } });
  }
  if (options.method === "GET") return new Response("<Error><Code>NoSuchUpload</Code></Error>", { status: 404 });
  assert.fail("A racing completed object must not create another multipart session.");
} });
assert.equal(racingCompletion.uploadedBytes, masterBytes);
assert.equal(racingCompletion.session.generation, simultaneous[0].session.generation);
const expiringOptions = { ...masterOptions, prefix: "expiring/" };
parts = [];
const expiring = await multipart.masterUploadStatus(expiringOptions);
await resumable.saveUploadPhase(masterStore, expiringOptions.prefix, expiring.session, "completing");
const expiredId = expiring.session.storageUploadId;
parts = [];
const renewed = await multipart.masterUploadStatus({ ...expiringOptions, fetchImpl: async (url, options) => {
  if (options.method === "GET" && new URL(url).searchParams.get("uploadId") === expiredId) {
    return new Response("<Error><Code>NoSuchUpload</Code></Error>", { status: 404 });
  }
  return storageFetch(url, options);
} });
assert.notEqual(renewed.session.storageUploadId, expiredId);
assert.equal(renewed.uploadedBytes, 0);
assert.notEqual(renewed.session.generation, expiring.session.generation);
assert.equal(renewed.session.resetReason, "storage_session_expired");
parts = [{ number: 1, size: 8 * 1024 * 1024 }, { number: 2, size: 2 }];
assert.equal(await multipart.completeMasterUpload({ ...expiringOptions, fetchImpl: async (url, options) => {
  const response = await storageFetch(url, options);
  if (options.method === "POST" && !new URL(url).searchParams.has("uploads")) throw new Error("Completion response lost");
  return response;
} }), renewed.session.key);
const completedStatus = await multipart.masterUploadStatus({ ...expiringOptions, fetchImpl: async (url, options) => {
  if (options.method === "GET") assert.fail("Completed object must not query expired multipart session");
  return storageFetch(url, options);
} });
assert.equal(completedStatus.uploadedBytes, masterBytes);
assert.equal(completedStatus.session.generation, renewed.session.generation);

// The intake page must retain the target version after a failed transfer, not create a new song.
const musicSource = await read("music-upload/music-upload.js");
const packageFunction = /async function processPackage\([\s\S]*?\n}\n/.exec(musicSource)?.[0];
assert.ok(packageFunction);
const storedTargets = new Map();
let projectsCreated = 0;
let transfers = 0;
const packageContext = {
  uploadHelper: helper, AUDIO_CHUNK_BYTES: 4, pendingPackageUploads: new Map(),
  sessionStorage: { getItem: key => storedTargets.get(key), setItem: (key, value) => storedTargets.set(key, value), removeItem: key => storedTargets.delete(key) },
  buildNotes: () => "notes", setControllerPhase() {}, setMessage() {},
  async apiJson(url, payload) {
    if (payload.action === "create_project") { projectsCreated += 1; return { songId: "song", masterVersionId: "version" }; }
    return { pipelineStatus: payload.toStage };
  },
  async loadCatalogSong() { return { metadataIssues: [], versions: [{ id: "version" }] }; },
  async uploadAudio(song, version) {
    assert.equal(song, "song");
    assert.equal(version, "version");
    if (++transfers === 1) throw new Error("Connection interrupted");
  },
};
const processPackage = vm.runInNewContext(`${packageFunction}\nprocessPackage;`, packageContext);
const packageInput = { file, title: "Master", artistName: "Artist", position: 1, total: 1 };
await assert.rejects(processPackage(packageInput), /Connection interrupted/);
assert.equal(storedTargets.size, 1);
// Simulate page reload: only sessionStorage survives.
packageContext.pendingPackageUploads.clear();
assert.equal((await processPackage(packageInput)).songId, "song");
assert.equal(projectsCreated, 1);
assert.equal(storedTargets.size, 1);

// Exercise the real handler with injected platform adapters, including access controls.
const endpointStore = new MemoryStore();
const songId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
let user = { id: "user" };
let ownsVersion = true;
let rejectOrigin = false;
let versionRow = { id: versionId, song_id: songId, audio_blob_prefix: "", audio_storage_key: "" };
let updates = 0;
let loseDatabaseResponse = false;
let reviewFails = false;
const db = { async sql(strings, ...values) {
  if (!ownsVersion) return [];
  if (strings.join("").includes("UPDATE halo_song_versions")) {
    updates += 1;
    if (strings.join("").includes("audio_blob_prefix = ''")) {
      versionRow = { ...versionRow, audio_storage_key: values[1], audio_blob_prefix: "" };
    } else {
      versionRow = { ...versionRow, audio_blob_prefix: values[1], audio_storage_key: "" };
    }
    if (loseDatabaseResponse) { loseDatabaseResponse = false; throw new Error("Database response lost"); }
  }
  return [{ ...versionRow }];
} };
const audioSource = stripTypeScriptTypes(await read("netlify/functions/song-catalog-audio.ts"))
  .replace(/^import .*?;\n/gm, "")
  .replace("export default async function", "async function")
  .replace("export const config", "const config");
const endpoint = vm.runInNewContext(`${audioSource}\nsongCatalogAudioHandler;`, {
  ...resumable, ...storage, Response, Blob, URL, Request, Uint8Array, ReadableStream, Error, console,
  getStore: () => endpointStore, getDatabase: async () => db, getUser: async () => user,
  ensureMembership: async () => ({ member_id: "owner" }),
  cleanText: (value, max) => String(value || "").trim().slice(0, max),
  verifyRequestOrigin: request => { if (rejectOrigin) throw new Error("origin"); verifyRequestOrigin(request); },
  runDreamweaverReview: async () => { if (reviewFails) throw new Error("Review offline"); },
});
const params = new URLSearchParams({ uploadStatus: "1", songId, versionId, uploadId: id, byteSize: "5", chunkSize: String(4 * 1024 * 1024), filename: "master.wav", contentType: "audio/wav" });
const statusRequest = (headers = { "X-Upload-Status": "1" }) => new Request(`https://halo.test/api/song-catalog/audio?${params}`, { headers });
const initialStatus = await (await endpoint(statusRequest())).json();
assert.equal(initialStatus.uploadedBytes, 0);
assert.equal(initialStatus.protocolVersion, 2);
assert.equal(typeof initialStatus.generation, "string");
assert.equal(initialStatus.phase, "transferring");
assert.equal(initialStatus.result, null);
assert.equal(initialStatus.resetReason, null);
const rawRequest = (offset = "0", body = bytes(1, 2, 3, 4, 5)) => new Request("https://halo.test/api/song-catalog/audio", {
  method: "POST", headers: { Origin: "https://halo.test", "Content-Type": "application/octet-stream", "X-SongId": songId, "X-VersionId": versionId, "X-UploadId": id, "X-Start-Byte": offset }, body,
});
assert.equal((await endpoint(rawRequest("1"))).status, 400);
assert.equal((await endpoint(rawRequest("0", bytes(1)))).status, 400);
assert.equal((await (await endpoint(rawRequest())).json()).uploadedBytes, 5);
assert.equal((await (await endpoint(statusRequest())).json()).uploadedBytes, 5);
const finalize = (uploadIdentifier = id) => new Request("https://halo.test/api/song-catalog/audio", {
  method: "POST", headers: { Origin: "https://halo.test", "Content-Type": "application/json" },
  body: JSON.stringify({ action: "finalize_upload", songId, versionId, uploadId: uploadIdentifier, chunkCount: 1, byteSize: 5, filename: "master.wav", contentType: "audio/wav" }),
});
loseDatabaseResponse = true;
assert.equal((await endpoint(finalize())).status, 500);
const reconciled = await (await endpoint(statusRequest())).json();
assert.equal(reconciled.result.persisted, true);
assert.equal(reconciled.phase, "review_pending");
const updateCount = updates;
assert.equal((await endpoint(finalize())).status, 200);
assert.equal(updates, updateCount);
versionRow.audio_blob_prefix = "replacement/parts/";
assert.equal((await endpoint(finalize())).status, 409);
assert.equal((await endpoint(statusRequest())).status, 409);
versionRow.audio_blob_prefix = `owner/${versionId}/${id}/parts/`;
ownsVersion = false;
assert.equal((await endpoint(statusRequest())).status, 404);
ownsVersion = true;
rejectOrigin = true;
assert.equal((await endpoint(rawRequest())).status, 403);
assert.equal((await endpoint(statusRequest({ Origin: "https://halo.test" }))).status, 403);
rejectOrigin = false;
assert.equal((await endpoint(statusRequest({}))).status, 403);
assert.equal((await endpoint(statusRequest({ Origin: "https://other.test" }))).status, 403);
assert.equal((await endpoint(statusRequest({ "X-Upload-Status": "1", "Sec-Fetch-Site": "cross-site" }))).status, 403);
assert.equal((await endpoint(statusRequest())).status, 200);
user = null;
assert.equal((await endpoint(statusRequest())).status, 401);
const masterEndpointStore = new MemoryStore();
const masterSource = stripTypeScriptTypes(await read("netlify/functions/song-catalog-master-upload.ts"))
  .replace(/^import[\s\S]*?;\n/gm, "")
  .replace("export default async function", "async function")
  .replace("export const config", "const config");
let configured = true;
const masterEndpoint = vm.runInNewContext(`${masterSource}\nsongCatalogMasterUploadHandler;`, {
  ...resumable, ...storage, Response, Error, console,
  MASTER_VERSION_TYPE: "sale_master",
  directUploadConfig: () => configured ? config : null,
  headStoredObject: (config, key) => storage.headStoredObject(config, key, storageFetch),
  masterUploadStatus: options => multipart.masterUploadStatus({ ...options, fetchImpl: storageFetch }),
  masterPartUrl: options => multipart.masterPartUrl({ ...options, fetchImpl: storageFetch }),
  completeMasterUpload: options => multipart.completeMasterUpload({ ...options, fetchImpl: storageFetch }),
  getStore: ({ name }) => name === "halo-master-upload-sessions" ? masterEndpointStore : endpointStore,
  getDatabase: async () => db, getUser: async () => user,
  ensureMembership: async () => ({ member_id: "owner" }),
  cleanText: (value, max) => String(value || "").trim().slice(0, max),
  verifyRequestOrigin: request => { if (rejectOrigin) throw new Error("origin"); verifyRequestOrigin(request); },
  runDreamweaverReview: async () => { if (reviewFails) throw new Error("Review offline"); },
});
const masterRequest = (action, extra = {}) => new Request("https://halo.test/api/song-catalog/master-upload", {
  method: "POST", headers: { Origin: "https://halo.test", "Content-Type": "application/json" },
  body: JSON.stringify({ action, songId, versionId, uploadId: id, fileName: "master.wav", fileType: "audio/wav", fileSize: masterBytes, ...extra }),
});
user = { id: "user" };
objectBytes = 0;
parts = [];
assert.equal((await (await masterEndpoint(masterRequest("status"))).json()).uploadedBytes, 0);
assert.equal((await masterEndpoint(masterRequest("part", { startByte: 0 }))).status, 200);
assert.equal((await masterEndpoint(masterRequest("part", { startByte: 1 }))).status, 409);
assert.equal((await masterEndpoint(masterRequest("complete"))).status, 409);
parts = [{ number: 1, size: 8 * 1024 * 1024 }, { number: 2, size: 2 }];
reviewFails = true;
const registered = await masterEndpoint(masterRequest("complete"));
assert.equal(registered.status, 200);
const registeredResult = await registered.json();
assert.equal(registeredResult.persisted, true);
assert.equal(registeredResult.phase, "review_pending");
assert.equal((await masterEndpoint(masterRequest("complete"))).status, 200);
const registeredStatus = await (await masterEndpoint(masterRequest("status"))).json();
assert.equal(registeredStatus.phase, "review_pending");
assert.equal(registeredStatus.result.persisted, true);
versionRow.audio_storage_key = "replacement.wav";
assert.equal((await masterEndpoint(masterRequest("complete"))).status, 409);
assert.equal((await masterEndpoint(masterRequest("status"))).status, 409);
versionRow.audio_storage_key = (await masterEndpointStore.get(resumable.uploadSessionKey(`owner/${versionId}/${id}/`))).key;
reviewFails = false;
ownsVersion = false;
assert.equal((await masterEndpoint(masterRequest("status"))).status, 404);
ownsVersion = true;
rejectOrigin = true;
assert.equal((await masterEndpoint(masterRequest("status"))).status, 403);
rejectOrigin = false;
user = null;
assert.equal((await masterEndpoint(masterRequest("status"))).status, 401);
user = { id: "user" };
configured = false;
const fallback = await masterEndpoint(masterRequest("status"));
assert.equal(fallback.status, 503);
assert.equal((await fallback.json()).directUpload, false);
// Audio review failures also preserve the catalog commit and expose the durable result.
const pendingAudioId = "c".repeat(64);
params.set("uploadId", pendingAudioId);
await endpoint(statusRequest());
const pendingChunk = rawRequest();
pendingChunk.headers.set("x-uploadid", pendingAudioId);
assert.equal((await endpoint(pendingChunk)).status, 200);
reviewFails = true;
const pendingAudio = await (await endpoint(finalize(pendingAudioId))).json();
assert.equal(pendingAudio.persisted, true);
assert.equal(pendingAudio.phase, "review_pending");
const pendingAudioStatus = await (await endpoint(statusRequest())).json();
assert.deepEqual(pendingAudioStatus.result, pendingAudio);
const pendingUpdateCount = updates;
assert.deepEqual(await (await endpoint(finalize(pendingAudioId))).json(), pendingAudio);
assert.equal(updates, pendingUpdateCount);
const incompatibleRequest = statusRequest();
incompatibleRequest.headers.set("x-upload-protocol", "1");
assert.equal((await endpoint(incompatibleRequest)).status, 409);
assert.equal((await (await endpoint(incompatibleRequest)).json()).protocolVersion, 2);
console.log("Resumable upload contracts passed (recovery, ordering, concurrency, multipart storage, progress, and access controls).");
