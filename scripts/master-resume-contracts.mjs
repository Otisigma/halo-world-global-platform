import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import * as storageHelpers from "../netlify/lib/direct-upload-storage.mjs";
import {
  directUploadConfig, masterMultipartAction, masterSessionKey, MASTER_MULTIPART_CHUNK_BYTES,
  presignObjectUrl, validateMasterUpload,
} from "../netlify/lib/direct-upload-storage.mjs";

const storage = directUploadConfig({
  HALO_MASTER_STORAGE_BUCKET: "private-masters", HALO_MASTER_STORAGE_ACCESS_KEY_ID: "fixture-key",
  HALO_MASTER_STORAGE_SECRET_ACCESS_KEY: "fixture-not-a-secret", HALO_MASTER_STORAGE_ENDPOINT: "https://storage.example",
});
const scope = { ownerMemberId: "member-1", songId: "song-1", versionId: "version-1" };
const fingerprint = "a".repeat(64);
const CHUNK = MASTER_MULTIPART_CHUNK_BYTES;
const upload = validateMasterUpload({ filename: "master.wav", contentType: "audio/wav", fileSize: CHUNK + 123 });
const checksum = async blob => Buffer.from(await webcrypto.subtle.digest("SHA-256", await blob.arrayBuffer())).toString("base64");

function fixture() {
  const blobs = new Map(), multipart = new Map(), objects = new Map(), writes = [], requests = [];
  let sequence = 0, lostWrite = false, lostComplete = false, badHead = false, listPartsHook;
  const store = {
    async getWithMetadata(key) { return structuredClone(blobs.get(key) || null); },
    async get(key) { return structuredClone(blobs.get(key)?.data || null); },
    async setJSON(key, data, condition) {
      writes.push(condition);
      const current = blobs.get(key);
      if (condition.onlyIfNew && current || condition.onlyIfMatch && condition.onlyIfMatch !== current?.etag) return { modified: false };
      const etag = `revision-${++sequence}`;
      blobs.set(key, { data: structuredClone(data), etag });
      if (lostWrite) { lostWrite = false; throw new TypeError("Lost blob write response"); }
      return { modified: true, etag };
    },
  };
  const fetchImpl = async (value, init = {}) => {
    const url = new URL(value), method = init.method || "GET", key = url.pathname;
    const uploadId = url.searchParams.get("uploadId");
    requests.push({ url, method, init });
    if (method === "HEAD") {
      const object = objects.get(key);
      return object ? new Response(null, { headers: {
        "content-length": String(badHead ? object.size + 1 : object.size),
        "content-type": object.contentType, "x-amz-meta-halo-session": object.token,
      } }) : new Response(null, { status: 404 });
    }
    if (method === "POST" && url.searchParams.has("uploads")) {
      const id = `s3-${++sequence}`;
      multipart.set(id, { key, contentType: init.headers["Content-Type"], token: init.headers["x-amz-meta-halo-session"], parts: [] });
      return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    const session = multipart.get(uploadId);
    if (!session) return new Response("<Error><Code>NoSuchUpload</Code></Error>", { status: 404 });
    if (method === "DELETE") { multipart.delete(uploadId); return new Response(null, { status: 204 }); }
    if (method === "PUT") {
      const number = Number(url.searchParams.get("partNumber"));
      assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-type;host;x-amz-checksum-sha256");
      if (init.headers["x-amz-checksum-sha256"] !== await checksum(init.body)) return new Response("<Error><Code>BadDigest</Code></Error>", { status: 400 });
      session.parts = session.parts.filter(part => part.number !== number);
      session.parts.push({ number, size: init.body.size, etag: `&quot;etag-${number}&quot;`, checksum: init.headers["x-amz-checksum-sha256"] });
      session.parts.sort((a, b) => a.number - b.number);
      return new Response(null);
    }
    if (method === "GET") {
      const hook = listPartsHook;
      listPartsHook = null;
      await hook?.();
      return new Response(`<ListPartsResult><IsTruncated>false</IsTruncated>${session.parts.map(part =>
        `<Part><PartNumber>${part.number}</PartNumber><Size>${part.size}</Size><ETag>${part.etag}</ETag><ChecksumSHA256>${part.checksum}</ChecksumSHA256></Part>`).join("")}</ListPartsResult>`);
    }
    assert.equal(method, "POST");
    assert.match(init.body, /<CompleteMultipartUpload>/);
    assert.match(init.body, /&quot;etag-1&quot;/);
    objects.set(key, { size: session.parts.reduce((sum, part) => sum + part.size, 0), contentType: session.contentType, token: session.token });
    multipart.delete(uploadId);
    if (lostComplete) { lostComplete = false; throw new TypeError("Lost S3 completion response"); }
    return new Response("<CompleteMultipartUploadResult/>");
  };
  const action = async (action, extra = {}) => {
    const saved = await store.get(masterSessionKey(extra.scope || scope, extra.fingerprint || fingerprint));
    return masterMultipartAction({ action, store, storage, scope, fingerprint, upload, fetchImpl, generationId: saved?.objectToken, ...extra });
  };
  const addPart = async startByte => {
    const body = new Blob([new Uint8Array(Math.min(CHUNK, upload.byteSize - startByte))]);
    const part = await action("part", { startByte, partChecksum: await checksum(body) });
    await fetchImpl(part.uploadUrl, { method: "PUT", headers: part.headers, body });
    return part;
  };
  return { store, blobs, multipart, objects, writes, requests, action, addPart, fetchImpl,
    loseWrite: () => { lostWrite = true; }, loseComplete: () => { lostComplete = true; }, corruptHead: () => { badHead = true; },
    interleaveListParts: hook => { listPartsHook = hook; } };
}

assert.notEqual(masterSessionKey(scope, fingerprint), masterSessionKey({ ...scope, ownerMemberId: "member-2" }, fingerprint));
assert.notEqual(masterSessionKey(scope, fingerprint), masterSessionKey({ ...scope, versionId: "version-2" }, fingerprint));
assert.throws(() => masterSessionKey(scope, "filename-only"), /SHA-256/);
const signed = new URL(presignObjectUrl({ config: storage, method: "POST", key: "key", queryParams: { uploads: "" }, requestHeaders: { "x-amz-meta-halo-session": "identity" }, contentType: "audio/wav" }));
assert.equal(signed.searchParams.get("X-Amz-SignedHeaders"), "content-type;host;x-amz-meta-halo-session");
assert.equal(signed.searchParams.get("uploads"), "");
assert.equal(await storageHelpers.headStoredObject(storage, "key", async () => new Response(null, { status: 503 })), 0, "legacy HEAD behavior remains compatible");
for (const status of [429, 503]) {
  await assert.rejects(storageHelpers.headStoredObjectStrict(storage, "key", async () => new Response(null, { status })), error => error.status === 503);
}
assert.equal(await storageHelpers.headStoredObjectStrict(storage, "key", async () => new Response(null, { status: 404 })), 0);

{
  const f = fixture();
  await assert.rejects(f.action("status"), error => error.status === 404);
  const statuses = await Promise.all([f.action("create"), f.action("create"), f.action("create")]);
  assert.ok(statuses.every(status => status.uploadedBytes === 0));
  assert.equal(f.blobs.size, 1, "concurrent creates retain one durable session");
  assert.equal(f.multipart.size, 1, "losing S3 sessions are aborted");
  assert.ok(f.writes.every(write => write.onlyIfNew));
  const session = [...f.blobs.values()][0].data;
  await assert.rejects(f.action("status", { upload: { ...upload, byteSize: upload.byteSize - 1 } }), /metadata/);
  await assert.rejects(f.action("status", { scope: { ...scope, ownerMemberId: "other" } }), error => error.status === 404);
  await assert.rejects(f.action("part", { startByte: 1 }), /offset/);
  const firstBody = new Blob([new Uint8Array(CHUNK)]);
  const firstChecksum = await checksum(firstBody);
  await assert.rejects(f.action("part", { startByte: 0, partChecksum: "not-base64" }), error => error.status === 400);
  const boundPart = await f.action("part", { startByte: 0, partChecksum: firstChecksum });
  await assert.rejects(f.action("part", { startByte: 0, partChecksum: Buffer.alloc(32, 1).toString("base64") }), /different file bytes/);
  const wrongBody = new Blob([new Uint8Array(CHUNK).fill(1)]);
  assert.equal((await f.fetchImpl(boundPart.uploadUrl, { method: "PUT", headers: boundPart.headers, body: wrongBody })).status, 400,
    "storage rejects corrupted bytes even when a signed URL is reused");
  await assert.rejects(f.action("complete"), /incomplete/);
  await f.addPart(0);
  assert.equal((await f.action("status")).uploadedBytes, CHUNK);
  await assert.rejects(f.action("part", { startByte: 0 }), /offset/);
  const stored = f.multipart.get(session.storageUploadId);
  stored.parts[0].size--;
  await assert.rejects(f.action("status"), /invalid sizes/);
  stored.parts[0].size++;
  stored.parts[0].number = 2;
  await assert.rejects(f.action("status"), /non-contiguous/);
  stored.parts[0].number = 1;
  await f.addPart(CHUNK);
  f.loseComplete();
  const results = await Promise.all([f.action("complete"), f.action("complete")]);
  assert.equal(results[0].fileKey, results[1].fileKey);
  assert.equal((await f.action("status")).complete, true);
  assert.equal([...f.blobs.values()][0].data.state, "completed");
  assert.ok(f.writes.some(write => write.onlyIfMatch), "completion transitions use CAS");
  assert.equal((await f.action("complete")).fileKey, results[0].fileKey, "completion retries are idempotent");
  f.corruptHead();
  await assert.rejects(f.action("complete"), /does not match/);
}
{
  const f = fixture();
  f.loseWrite();
  await f.action("create");
  assert.equal(f.multipart.size, 1, "a persisted create with a lost write response is reused");
  const session = [...f.blobs.values()][0].data;
  f.multipart.delete(session.storageUploadId);
  await assert.rejects(f.action("status"), error => error.status === 410);
  await Promise.all([f.action("create"), f.action("create")]);
  assert.equal(f.multipart.size, 1, "expired sessions renew atomically");
  assert.equal((await f.action("status")).uploadedBytes, 0);
}
{
  const f = fixture();
  await f.action("create");
  await f.addPart(0);
  await f.addPart(CHUNK);
  f.loseWrite();
  const completed = await f.action("complete");
  assert.equal(completed.complete, true, "lost completion-state writes are resolved by durable readback");
}
{
  const f = fixture();
  await f.action("create");
  f.interleaveListParts(() => f.addPart(0));
  assert.equal((await f.action("status")).uploadedBytes, CHUNK,
    "status refreshes checksum bindings when a concurrent upload wins between the session snapshot and ListParts");
  const body = new Blob([new Uint8Array(123)]), partChecksum = await checksum(body);
  f.interleaveListParts(() => f.action("part", { startByte: CHUNK, partChecksum }));
  const part = await f.action("part", { startByte: CHUNK, partChecksum });
  assert.equal((await f.fetchImpl(part.uploadUrl, { method: "PUT", headers: part.headers, body })).status, 200,
    "a concurrent identical checksum binding does not cause a stale-etag presign failure");
  assert.equal((await f.action("complete")).complete, true);
}

// Execute the real browser adapter against server actions + storage, including a lost part reply.
const source = await readFile(new URL("../master-upload.js", import.meta.url), "utf8");
{
  const f = fixture(), progress = [];
  let losePart = true, putCount = 0, loseRegister = true;
  const context = {
    crypto: webcrypto, btoa, AbortController, DOMException, Uint8Array, Blob, setTimeout: (fn, ms) => setTimeout(fn, ms === 180000 ? ms : 0), clearTimeout,
    fetch: async (url, init) => {
      if (String(url).startsWith("https:")) {
        putCount++;
        const response = await f.fetchImpl(url, init);
        if (losePart) { losePart = false; throw new TypeError("Lost successful part response"); }
        return response;
      }
      const body = JSON.parse(init.body);
      assert.equal(body.fileType, "audio/wav", "normalized catalog content type is preserved in master metadata");
      const result = await f.action(body.action, { startByte: body.startByte, partChecksum: body.partChecksum });
      if (body.action === "complete") {
        if (loseRegister) { loseRegister = false; throw new TypeError("Lost registration response"); }
        return Response.json({ ...result, persisted: true, lockedIn: true, audioUrl: "/api/song-catalog/audio?versionId=version-1" });
      }
      return Response.json(result);
    },
  };
  context.window = context;
  vm.runInNewContext(source, context);
  const file = new File([new Uint8Array(upload.byteSize)], "master.wav", { type: "audio/x-wav" });
  const options = { ...scope, fingerprint, contentType: "audio/wav", onProgress: bytes => progress.push(bytes) };
  const result = await context.HaloMasterUpload.upload(file, options);
  assert.equal(result.persisted, true);
  assert.equal(putCount, 2, "lost PUT reply resumes at server-confirmed next part, never resends acknowledged bytes");
  assert.equal(progress.at(-1), file.size);
  await context.HaloMasterUpload.upload(file, options);
  assert.equal(putCount, 2, "a new invocation uses durable completed state without uploading again");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(context.HaloMasterUpload.upload(file, { ...options, signal: controller.signal }), error => error.name === "AbortError");
}
function browser(fetchImpl) {
  const context = { crypto: webcrypto, btoa, AbortController, DOMException, Uint8Array, Blob, clearTimeout,
    setTimeout: (fn, ms) => setTimeout(fn, ms < 100 || ms >= 180000 ? ms : 0), fetch: fetchImpl };
  context.window = context;
  vm.runInNewContext(source, context);
  return context.HaloMasterUpload;
}
const browserFile = new File([new Uint8Array(upload.byteSize)], "master.wav", { type: "audio/wav" });
const browserOptions = { ...scope, fingerprint };
function registration(result) {
  return { ...result, persisted: true, lockedIn: true, audioUrl: "/api/song-catalog/audio?versionId=version-1" };
}
{
  const f = fixture();
  let creates = 0, puts = 0, completes = 0, registered = false, finalReconciliations = 0;
  const adapter = browser(async (url, init) => {
    if (String(url).startsWith("https:")) {
      puts++;
      if (puts < 5) throw new TypeError("Unavailable before PUT");
      const reply = await f.fetchImpl(url, init);
      if (puts === 5) throw new TypeError("Lost final successful PUT reply");
      return reply;
    }
    const body = JSON.parse(init.body);
    if (body.action === "create" && ++creates < 5) throw new TypeError("Unavailable before create");
    const result = await f.action(body.action, { startByte: body.startByte, partChecksum: body.partChecksum });
    if (body.action === "create" && creates === 5) throw new TypeError("Lost final successful create reply");
    if (body.action === "complete") {
      completes++;
      registered = true;
      throw new TypeError("Lost every registration response");
    }
    if (registered && body.action === "status") { finalReconciliations++; return Response.json(registration(result)); }
    return Response.json(result);
  });
  const result = await adapter.upload(browserFile, browserOptions);
  assert.equal(result.persisted, true);
  assert.equal(creates, 5);
  assert.equal(puts, 6, "final PUT timeout/lost response reconciles storage before deciding failure");
  assert.equal(completes, 5);
  assert.equal(finalReconciliations, 1, "status recovers a registered master even when every completion reply was lost");
}
{
  const f = fixture();
  let creates = 0, completes = 0, puts = 0;
  const adapter = browser(async (url, init) => {
    if (String(url).startsWith("https:")) { puts++; return f.fetchImpl(url, init); }
    const body = JSON.parse(init.body);
    const result = await f.action(body.action, { startByte: body.startByte, partChecksum: body.partChecksum });
    if (body.action === "create") {
      creates++;
      if (creates === 1) return new Response("<html>proxy interruption</html>");
      if (creates === 2) return Response.json({});
    }
    if (body.action === "complete") {
      completes++;
      if (completes === 1) return new Response("not JSON");
      return Response.json(registration(result));
    }
    return Response.json(result);
  });
  assert.equal((await adapter.upload(browserFile, browserOptions)).persisted, true);
  assert.equal(creates, 3, "malformed JSON and malformed success schemas are retried");
  assert.equal(completes, 2);
  assert.equal(puts, 2);
}
{
  const f = fixture();
  let puts = 0;
  const adapter = browser(async (url, init) => {
    if (String(url).startsWith("https:")) {
      if (++puts === 1) return new Promise(() => {});
      return f.fetchImpl(url, init);
    }
    const body = JSON.parse(init.body);
    const result = await f.action(body.action, { startByte: body.startByte, partChecksum: body.partChecksum });
    return Response.json(body.action === "complete" ? registration(result) : result);
  });
  assert.equal((await adapter.upload(browserFile, { ...browserOptions, requestTimeoutMs: 25 })).persisted, true);
  assert.equal(puts, 3, "a stalled fetch has a bounded timeout and resumes safely");
}
{
  const f = fixture(), controller = new AbortController();
  let puts = 0;
  const adapter = browser(async (url, init) => {
    if (String(url).startsWith("https:")) {
      puts++;
      setTimeout(() => controller.abort(), 1);
      return new Promise(() => {});
    }
    const body = JSON.parse(init.body);
    return Response.json(await f.action(body.action, { startByte: body.startByte, partChecksum: body.partChecksum }));
  });
  await assert.rejects(adapter.upload(browserFile, { ...browserOptions, signal: controller.signal }), error => error.name === "AbortError");
  assert.equal(puts, 1, "caller cancellation is not retried as a timeout");
  assert.equal(f.multipart.size, 1, "Pause retains the durable upload session");
}
{
  const f = fixture(), cache = new Map();
  let puts = 0, cachedHint;
  const progressStorage = {
    getItem: key => cache.get(key) || null,
    setItem: (key, value) => cache.set(key, value),
  };
  const cacheId = JSON.stringify([scope.ownerMemberId, scope.songId, scope.versionId, fingerprint]);
  cache.set(`halo:master-resume:v1:${cacheId}`, JSON.stringify({ fingerprint, fileSize: upload.byteSize, confirmedBytes: upload.byteSize }));
  const adapter = browser(async (url, init) => {
    if (String(url).startsWith("https:")) { puts++; return f.fetchImpl(url, init); }
    const body = JSON.parse(init.body);
    const result = await f.action(body.action, { startByte: body.startByte, partChecksum: body.partChecksum });
    return Response.json(body.action === "complete" ? registration(result) : result);
  });
  await adapter.upload(browserFile, { ...browserOptions, progressStorage, onCachedProgress: value => { cachedHint = value; } });
  assert.equal(cachedHint.confirmedBytes, upload.byteSize);
  assert.equal(puts, 2, "a stale cache claiming completion cannot skip server-confirmed parts");
  const saved = JSON.parse([...cache.values()][0]);
  assert.equal(saved.confirmedBytes, upload.byteSize);
  assert.equal(saved.registered, true);
  assert.equal(saved.fingerprint, fingerprint);
  assert.ok(!/uploadUrl|storageUploadId|fileKey|token|credential|signature/i.test([...cache.values()][0]), "progress cache contains no credentials or storage capabilities");
}
for (const status of [401, 403]) {
  for (const hanging of [false, true]) {
    let requests = 0;
    const adapter = browser(async () => {
      requests++;
      return hanging ? { status, ok: false, json: () => new Promise(() => {}) } : new Response("<html>Access denied</html>", { status });
    });
    await assert.rejects(adapter.upload(browserFile, { ...browserOptions, requestTimeoutMs: 25 }), error => error.status === status);
    assert.equal(requests, 1, "malformed or hanging error bodies cannot turn known authorization failures into retryable timeouts");
  }
}
const endpoint = await readFile(new URL("../netlify/functions/song-catalog-master-upload.ts", import.meta.url), "utf8");
assert.match(endpoint, /name: "halo-master-upload-sessions", consistency: "strong"/);
assert.match(endpoint, /verifyRequestOrigin\(request\)/);
assert.match(endpoint, /version_type = \$\{MASTER_VERSION_TYPE\}/);
assert.match(endpoint, /audio_storage_key IS NOT DISTINCT FROM/);
assert.match(endpoint, /audio_blob_prefix IS NOT DISTINCT FROM/);
assert.match(endpoint, /updated_at::text IS NOT DISTINCT FROM/);
assert.ok(!endpoint.includes("audioStore.delete"), "master registration retains immutable fallback chunks for finalization retries");
assert.match(endpoint, /payload\.action === "presign"/);
assert.match(endpoint, /payload\.action === "register"/);
{
  const f = fixture();
  const songId = "11111111-1111-4111-8111-111111111111", versionId = "22222222-2222-4222-8222-222222222222";
  let authorized = true, originAllowed = true, ownerAllowed = true, updateCount = 0;
  const registrationHeadFailures = [503, 429];
  let currentKey = null, currentPrefix = "", currentRevision = "2026-10-14 23:00:00.123456+00", revision = 0, changeRevisionAfterHead = false;
  const db = { sql: async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("SELECT version.id")) return ownerAllowed ? [{ id: versionId, song_id: songId, audio_storage_key: currentKey, audio_blob_prefix: currentPrefix, audio_revision: currentRevision }] : [];
    assert.match(query, /UPDATE halo_song_versions/);
    assert.match(query, /version_type = \?/);
    assert.match(query, /owner_member_id = \?/);
    const revisionIndex = strings.findIndex(part => part.includes("AND updated_at::text IS NOT DISTINCT FROM"));
    assert.ok(revisionIndex >= 0);
    if (values[revisionIndex] !== currentRevision) return [];
    currentKey = values[1];
    currentRevision = `revision-${++revision}`;
    updateCount++;
    return [{ id: versionId }];
  } };
  const context = {
    ...storageHelpers, Response, Date, Error, console, randomUUID: () => "33333333-3333-4333-8333-333333333333",
    MASTER_VERSION_TYPE: "sale_master", cleanText: value => String(value || ""),
    getStore: options => options.name === "halo-master-upload-sessions" ? f.store : { list: async () => ({ blobs: [] }) },
    getDatabase: async () => db, getUser: async () => authorized ? { id: "identity-1" } : null,
    ensureMembership: async () => ({ member_id: scope.ownerMemberId }),
    verifyRequestOrigin: () => { if (!originAllowed) throw new Error("Origin denied"); },
    runDreamweaverReview: async () => {},
    directUploadConfig: () => storage,
    headStoredObject: (config, key) => storageHelpers.headStoredObject(config, key, f.fetchImpl),
    headStoredObjectStrict: async (config, key) => {
      const bytes = await storageHelpers.headStoredObjectStrict(config, key, (...args) =>
        registrationHeadFailures.length ? Promise.resolve(new Response(null, { status: registrationHeadFailures.shift() })) : f.fetchImpl(...args));
      if (changeRevisionAfterHead) { changeRevisionAfterHead = false; currentRevision = `retired-${++revision}`; }
      return bytes;
    },
    masterMultipartAction: options => storageHelpers.masterMultipartAction({ ...options, fetchImpl: f.fetchImpl }),
  };
  const runnable = endpoint.replace(/^import[\s\S]*?from "[^"]+";\n/gm, "")
    .replace("export default async function", "async function").replace("export const config", "const config")
    .replace(/ as Record<string, unknown> \| null/g, "")
    .replace(/: Awaited<ReturnType<typeof getDatabase>>/g, "")
    .replace(/: Record<string, unknown>/g, "")
    .replace(/: (?:unknown|string|Request)(?=[,)])/g, "");
  vm.runInNewContext(runnable, context);
  const metadata = { songId, versionId, fingerprint, fileName: "master.wav", fileType: "audio/wav", fileSize: upload.byteSize };
  const call = (action, extra = {}) => context.songCatalogMasterUploadHandler(new Request("https://halo.example/api/song-catalog/master-upload", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://halo.example" }, body: JSON.stringify({ ...metadata, ...extra, action }),
  }));
  authorized = false;
  assert.equal((await call("create")).status, 401);
  authorized = true; originAllowed = false;
  assert.equal((await call("create")).status, 403);
  originAllowed = true; ownerAllowed = false;
  assert.equal((await call("create")).status, 404);
  ownerAllowed = true;
  const created = await call("create");
  assert.equal(created.status, 200);
  metadata.generationId = (await created.json()).generationId;
  const params = { scope: { ownerMemberId: scope.ownerMemberId, songId, versionId } };
  for (const startByte of [0, CHUNK]) {
    const body = new Blob([new Uint8Array(Math.min(CHUNK, upload.byteSize - startByte))]);
    const part = await f.action("part", { ...params, startByte, partChecksum: await checksum(body) });
    await f.fetchImpl(part.uploadUrl, { method: "PUT", headers: part.headers, body });
  }
  f.loseComplete();
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal((await call("complete")).status, 503, "registration HEAD throttling/outage stays retryable after successful multipart completion");
    assert.equal(updateCount, 0, "a transient registration HEAD does not publish or discard the completed object");
  }
  const completed = await call("complete");
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).persisted, true);
  const firstKey = currentKey;
  assert.equal((await (await call("status")).json()).persisted, true, "status confirms canonical registration after a lost completion response");
  assert.equal(updateCount, 1);
  assert.equal((await call("complete")).status, 200, "lost endpoint responses are safe to retry after registration");
  assert.equal(updateCount, 1, "an already canonical session confirms as a no-op without changing the audio revision");
  currentKey = "masters/a/newer-master.wav";
  assert.equal((await call("complete")).status, 409, "an old completed session cannot replace a newer canonical master");
  assert.equal(updateCount, 1);
  currentKey = null; currentPrefix = "immutable/newer-chunked-master/";
  assert.equal((await call("complete")).status, 409, "a newer blob prefix is pinned even when the direct storage key remains null");
  assert.equal(updateCount, 1);
  const oldGeneration = metadata.generationId;
  currentKey = firstKey; currentPrefix = "";
  const fingerprintB = "b".repeat(64);
  const createdB = await call("create", { fingerprint: fingerprintB });
  assert.equal(createdB.status, 200);
  const generationB = (await createdB.json()).generationId;
  for (const startByte of [0, CHUNK]) {
    const body = new Blob([new Uint8Array(Math.min(CHUNK, upload.byteSize - startByte)).fill(1)]);
    const part = await f.action("part", { ...params, fingerprint: fingerprintB, generationId: generationB, startByte, partChecksum: await checksum(body) });
    await f.fetchImpl(part.uploadUrl, { method: "PUT", headers: part.headers, body });
  }
  assert.equal((await call("complete", { fingerprint: fingerprintB, generationId: generationB })).status, 200);
  assert.notEqual(currentKey, firstKey);
  currentKey = ""; currentRevision = `deleted-B-${++revision}`;
  f.blobs.get(masterSessionKey(params.scope, fingerprint)).data.registered = false;
  assert.equal((await call("complete", { generationId: oldGeneration })).status, 409,
    "A -> B -> DELETE -> retry A cannot resurrect retained A even if its post-SQL receipt write was lost");
  assert.equal(updateCount, 2);
  currentKey = ""; currentPrefix = ""; currentRevision = `deleted-${++revision}`;
  f.objects.clear(); // DELETE clears the canonical pointers and removes the old object.
  assert.equal((await call("complete", { generationId: oldGeneration })).status, 410, "completion cannot resurrect an intentionally deleted master");
  const reupload = await call("create");
  assert.equal(reupload.status, 200, "the exact same file can be uploaded again after removal");
  metadata.generationId = (await reupload.json()).generationId;
  assert.notEqual(metadata.generationId, oldGeneration);
  for (const startByte of [0, CHUNK]) {
    const body = new Blob([new Uint8Array(Math.min(CHUNK, upload.byteSize - startByte))]);
    const part = await f.action("part", { ...params, generationId: metadata.generationId, startByte, partChecksum: await checksum(body) });
    await f.fetchImpl(part.uploadUrl, { method: "PUT", headers: part.headers, body });
  }
  assert.equal((await call("complete")).status, 200);
  const latestKey = currentKey;
  assert.equal((await call("complete", { generationId: oldGeneration })).status, 410, "a delayed old completion cannot publish a new generation");
  assert.equal((await call("status", { generationId: oldGeneration })).status, 410);
  assert.equal(currentKey, latestKey);
  assert.equal(f.blobs.size, 3, "the prior generation receipt and replacement session remain preserved when the session pointer renews");
  const secondGeneration = metadata.generationId;
  currentKey = ""; currentPrefix = ""; currentRevision = `deleted-${++revision}`;
  const secondSessionKey = masterSessionKey(params.scope, fingerprint);
  const savedSecond = f.blobs.get(secondSessionKey);
  savedSecond.data.registered = false; // The canonical DB write succeeded but its receipt response was lost.
  assert.equal((await call("complete", { generationId: secondGeneration })).status, 409,
    "exact prior audio revision blocks DELETE pointer-ABA even when the registration marker was lost and object cleanup failed");
  const retainedObjectReupload = await call("create");
  assert.equal(retainedObjectReupload.status, 200, "intentional pointer removal renews even when physical object cleanup failed");
  const thirdGeneration = (await retainedObjectReupload.json()).generationId;
  assert.notEqual(thirdGeneration, secondGeneration);
  assert.equal((await call("complete", { generationId: secondGeneration })).status, 410, "retained old objects cannot be republished by an archived receipt");
  assert.equal((await call("complete", { generationId: undefined })).status, 400, "publication requires an explicit generation");
  metadata.generationId = thirdGeneration;
  for (const startByte of [0, CHUNK]) {
    const body = new Blob([new Uint8Array(Math.min(CHUNK, upload.byteSize - startByte))]);
    const part = await f.action("part", { ...params, generationId: thirdGeneration, startByte, partChecksum: await checksum(body) });
    await f.fetchImpl(part.uploadUrl, { method: "PUT", headers: part.headers, body });
  }
  changeRevisionAfterHead = true;
  const updatesBeforeRace = updateCount;
  assert.equal((await call("complete")).status, 409, "DB revision CAS blocks DELETE/edit after storage verification and before publication");
  assert.equal(updateCount, updatesBeforeRace);
  assert.equal(currentKey, "", "a racing revision change cannot resurrect the removed audio pointer");
}
console.log("Master multipart resume contracts passed.");
