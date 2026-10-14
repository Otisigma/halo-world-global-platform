#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../upload-progress.js", import.meta.url), "utf8");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const file = (bytes = "abcdefghij", name = "audio.wav") => Object.assign(new Blob([bytes], { type: "audio/wav" }), { name });
function storage() {
  const entries = new Map();
  return {
    entries,
    getItem: key => entries.get(key) || null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key),
  };
}
function browser(api, cache = storage(), requestTimeoutMs = 120000) {
  const delays = [];
  const window = {};
  Object.defineProperty(window, "localStorage", { get() {
    if (cache === null) throw new Error("Storage disabled");
    return cache;
  } });
  const context = vm.createContext({
    window, crypto: webcrypto, TextEncoder, FormData, Blob, AbortController, console,
    fetch: api.fetch,
    setTimeout: (callback, delay) => {
      if (delay === 120000) return null;
      if (delay === requestTimeoutMs) return setImmediate(callback);
      delays.push(delay); callback(); return null;
    },
    clearTimeout: timer => clearImmediate(timer),
  });
  vm.runInContext(source, context);
  return { helper: window.HaloUploadProgress, delays, cache };
}
function server(failures = {}, { finalizedReceipt = true } = {}) {
  const chunks = new Map(), calls = [], ids = [];
  let finalized = false;
  const fail = (label, when) => {
    const failure = failures[label]?.[0];
    if (!failure || failure.when !== when) return null;
    failures[label].shift();
    if (failure.code === "network") throw new TypeError("Connection lost");
    if (failure.code === "truncated") return new Response('{"incomplete":');
    return new Response(failure.plain ? "Unavailable" : JSON.stringify({ message: "Rejected" }), { status: failure.code });
  };
  return {
    chunks, calls, ids,
    async fetch(url, options) {
      assert.equal(url, "/api/song-catalog/audio");
      assert.equal(options.credentials, "same-origin");
      const form = options.body instanceof FormData;
      const body = form ? Object.fromEntries(options.body) : JSON.parse(options.body);
      const label = form ? `chunk:${body.chunkIndex}` : body.action;
      calls.push(label);
      ids.push(body.uploadId);
      const early = fail(label, "before");
      if (early) return early;
      let data;
      if (form) {
        if (finalized) return new Response(JSON.stringify({ message: "Already finalized", finalized: true }), { status: 409 });
        assert.equal(body.chunkSha256, sha256(Buffer.from(await body.chunk.arrayBuffer())));
        chunks.set(Number(body.chunkIndex), { checksum: body.chunkSha256, size: body.chunk.size });
        data = { chunkIndex: Number(body.chunkIndex) };
      } else if (body.action === "upload_status") {
        const confirmedBytes = [...chunks.values()].reduce((sum, chunk) => sum + chunk.size, 0);
        data = {
          receivedChunks: [...chunks.keys()],
          chunkChecksums: Object.fromEntries([...chunks].map(([index, chunk]) => [index, chunk.checksum])),
          storedBytes: confirmedBytes, confirmedBytes, finalized,
          ...(finalized && finalizedReceipt ? { persisted: true, lockedIn: true, audioUrl: "/audio.wav", message: "Saved" } : {}),
        };
      } else {
        assert.equal(body.action, "finalize_upload");
        assert.equal(chunks.size, body.chunkCount);
        finalized = true;
        data = { persisted: true, lockedIn: true, audioUrl: "/audio.wav", message: "Saved" };
      }
      const late = fail(label, "after");
      if (late) return late;
      return new Response(JSON.stringify(data));
    },
  };
}
const options = { file: file(), songId: "song-a", versionId: "version-a", chunkSize: 4 };
const failure = (code, when = "before", plain = false) => ({ code, when, plain });
const count = (api, label) => api.calls.filter(call => call === label).length;

// Native Web Crypto provides the full-file SHA-256 used by browser and master adapters.
{
  const { helper } = browser(server());
  for (const length of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1024 * 1024 + 17]) {
    const bytes = Buffer.alloc(length, 0xa7), audio = file(bytes);
    assert.equal(await helper.fileSha256(audio), sha256(bytes));
  }
  const id = await helper.fileUploadId(options.file, ["song-a", "version-a"], 4);
  assert.equal(id, await helper.fileUploadId(file("abcdefghij", "renamed.wav"), ["song-a", "version-a"], 4));
  assert.notEqual(id, await helper.fileUploadId(file("abcdefghiX"), ["song-a", "version-a"], 4));
  assert.notEqual(id, await helper.fileUploadId(options.file, ["song-a", "version-b"], 4));
}

// Ambiguous chunk and finalize responses reconcile without blindly replaying writes.
for (const code of ["network", "truncated", 408, 429, 503]) {
  const api = server({ "chunk:0": [failure(code, "after")], finalize_upload: [failure(code, "after")] });
  const { helper, cache } = browser(api);
  const result = await helper.uploadResumableAudio(options);
  assert.equal(result.audioUrl, "/audio.wav");
  assert.equal(result.persisted, true);
  assert.equal(count(api, "chunk:0"), 1);
  assert.equal(count(api, "finalize_upload"), 1);
  assert.equal(cache.entries.size, 0);
  for (let index = 0; index < api.calls.length; index++) {
    if (api.calls[index].startsWith("chunk:")) assert.equal(api.calls[index - 1], "upload_status");
  }
}
{
  // Existing status API shape omits the receipt URL even after the version
  // pointer is committed. Finalized is authoritative; the playback URL is deterministic.
  const api = server({ finalize_upload: [failure("network", "after")] }, { finalizedReceipt: false });
  const first = await browser(api).helper.uploadResumableAudio(options);
  assert.equal(first.audioUrl, "/api/song-catalog/audio?versionId=version-a");
  assert.equal(first.persisted, true);
  assert.equal(first.lockedIn, true);
  assert.ok(first.message);
  assert.equal(count(api, "finalize_upload"), 1);
  const before = api.calls.length;
  const reloaded = await browser(api).helper.uploadResumableAudio({ ...options, file: file() });
  assert.equal(reloaded.audioUrl, first.audioUrl);
  assert.equal(reloaded.persisted, true);
  assert.equal(reloaded.lockedIn, true);
  assert.deepEqual(api.calls.slice(before), ["upload_status"], "reselected finalized audio is not resent or refinalized");
}
{
  const intake = await readFile(new URL("../music-upload/music-upload.js", import.meta.url), "utf8");
  const fn = intake.slice(intake.indexOf("async function uploadAudio("), intake.indexOf("async function loadCatalogSong("));
  const api = server({ finalize_upload: [failure("network", "after")] }, { finalizedReceipt: false });
  let confirmed = 0, successes = 0;
  const context = vm.createContext({
    MAX_AUDIO_BYTES: 128 * 1024 * 1024, AUDIO_CHUNK_BYTES: 4,
    normalizeAudioType: () => "audio/wav", audioDuration: async () => 0,
    uploadHelper: browser(api).helper,
    audioUploadUi: { start() {}, progress() {}, success() { successes++; } },
    async confirmPersistedAsset(url, label) {
      assert.equal(url, "/api/song-catalog/audio?versionId=version-a");
      assert.equal(label, "audio");
      confirmed++;
    },
  });
  vm.runInContext(`${fn};globalThis.upload = uploadAudio;`, context);
  assert.equal(await context.upload(options.songId, options.versionId, options.file, 1, 1), "/api/song-catalog/audio?versionId=version-a");
  context.uploadHelper = browser(api).helper;
  assert.equal(await context.upload(options.songId, options.versionId, file(), 1, 1), "/api/song-catalog/audio?versionId=version-a");
  assert.equal(confirmed, 2, "real caller confirms the recovered canonical playback URL");
  assert.equal(successes, 2);
}
{
  const api = server({}, { finalizedReceipt: false });
  let release, arrived, paused = false;
  const waiting = new Promise(resolve => { arrived = resolve; });
  const firstApi = {
    async fetch(url, settings) {
      const response = await api.fetch(url, settings);
      if (!(settings.body instanceof FormData) && JSON.parse(settings.body).action === "upload_status" && !paused) {
        paused = true;
        await new Promise(resolve => { release = resolve; arrived(); });
      }
      return response;
    },
  };
  // Tab A holds a stale "not finalized" response while tab B completes the same file.
  const first = browser(firstApi).helper.uploadResumableAudio(options);
  await waiting;
  const second = await browser(api).helper.uploadResumableAudio({ ...options, file: file() });
  assert.equal(second.persisted, true);
  const beforeRelease = api.calls.length;
  release();
  const recovered = await first;
  assert.equal(recovered.persisted, true);
  assert.equal(recovered.alreadyFinalized, true);
  assert.deepEqual(api.calls.slice(beforeRelease), ["chunk:0", "upload_status"], "a finalized 409 hint reconciles once without retrying the write");
  assert.equal(count(api, "finalize_upload"), 1);
  assert.equal(new Set(api.ids).size, 1);
}
{
  const api = server(), fetch = api.fetch;
  let writes = 0;
  api.fetch = async (url, settings) => {
    if (settings.body instanceof FormData) {
      writes++;
      return new Response(JSON.stringify({ finalized: true, message: "Finalized elsewhere" }), { status: 409 });
    }
    return fetch(url, settings);
  };
  const { helper, delays } = browser(api);
  await assert.rejects(helper.uploadResumableAudio(options), error => error.status === 409);
  assert.equal(writes, 1);
  assert.equal(count(api, "upload_status"), 2);
  assert.equal(delays.length, 0, "unconfirmed finalized hints are never retried or claimed successful");
}

// Status failures never permit blind sends, including after a lost chunk response.
{
  const api = server({ upload_status: Array.from({ length: 4 }, () => failure(503)) });
  const { helper, delays } = browser(api);
  await assert.rejects(helper.uploadResumableAudio(options), /Rejected/);
  assert.equal(count(api, "upload_status"), 4);
  assert.equal(count(api, "chunk:0"), 0);
  assert.equal(delays.length, 3);
}
{
  const api = server({ "chunk:0": [failure("network", "after")] });
  const fetch = api.fetch;
  api.fetch = async (...args) => {
    if (api.chunks.size) return new Response(JSON.stringify({ message: "Status unavailable" }), { status: 403 });
    return fetch(...args);
  };
  const { helper, cache } = browser(api);
  await assert.rejects(helper.uploadResumableAudio(options), /Status unavailable/);
  assert.equal(count(api, "chunk:0"), 1);
  assert.equal(cache.entries.size, 1);
}

// Cache is optional, untrusted and credential-free. Reload requires explicit reselection.
{
  const api = server();
  assert.equal((await browser(api, null).helper.uploadResumableAudio(options)).persisted, true);
}
{
  const api = server({ "chunk:1": [failure(403)] });
  await assert.rejects(browser(api, null).helper.uploadResumableAudio(options));
  assert.equal((await browser(api, null).helper.uploadResumableAudio({ ...options, file: file() })).persisted, true);
  assert.equal(count(api, "chunk:0"), 1, "reselection resumes even without any browser cache");
}
{
  const api = server();
  api.fetch = async () => new Response(JSON.stringify({ finalized: false, receivedChunks: [], chunkChecksums: {}, confirmedBytes: -1 }));
  await assert.rejects(browser(api).helper.uploadResumableAudio(options), /invalid upload status/);
  assert.equal(api.chunks.size, 0);
}
{
  const cache = storage();
  const api = server({ "chunk:1": [failure(400)] });
  const first = browser(api, cache);
  await assert.rejects(first.helper.uploadResumableAudio(options), /Rejected/);
  assert.equal(cache.entries.size, 1);
  assert.ok(![...cache.entries.values()].join("").includes("Bearer"));
  const uploadId = api.ids[0];
  for (const key of cache.entries.keys()) cache.setItem(key, '{"confirmedBytes":999999,"finalized":true}');
  const reload = browser(api, cache);
  const before = api.calls.length;
  await assert.rejects(reload.helper.uploadResumableAudio({ ...options, file: undefined }), /Reselect/);
  assert.equal(api.calls.length, before, "reload cannot automatically recover file bytes");
  const resumed = await reload.helper.uploadResumableAudio({ ...options, file: file() });
  assert.equal(resumed.uploadId, uploadId);
  assert.equal(count(api, "chunk:0"), 1, "matching stored chunks are not resent");
  assert.equal(count(api, "chunk:1"), 2);
}
{
  const api = server({ "chunk:1": [failure(400)] });
  await assert.rejects(browser(api).helper.uploadResumableAudio(options));
  api.chunks.get(0).checksum = "conflicting";
  const before = api.calls.length;
  await assert.rejects(browser(api).helper.uploadResumableAudio(options), /conflicts/);
  assert.deepEqual(api.calls.slice(before), ["upload_status"]);
}

// Only network, 408, 429 and 5xx are retried; retries and backoff are bounded.
for (const code of [400, 401, 403, 409, 413, 422]) {
  const api = server({ "chunk:0": [failure(code)] });
  const { helper, delays } = browser(api);
  await assert.rejects(helper.uploadResumableAudio(options), error => error.status === code);
  assert.equal(count(api, "chunk:0"), 1);
  assert.equal(delays.length, 0);
}
for (const code of [401, 403]) {
  const api = server({ "chunk:0": [failure(code, "before", true)] });
  const { helper, delays } = browser(api);
  await assert.rejects(helper.uploadResumableAudio(options), error => error.status === code);
  assert.equal(count(api, "chunk:0"), 1, "invalid error JSON never retries auth failures");
  assert.equal(delays.length, 0);
}
{
  const api = server({ "chunk:0": [failure("truncated", "before")] });
  assert.equal((await browser(api).helper.uploadResumableAudio(options)).persisted, true);
  assert.equal(count(api, "chunk:0"), 2, "malformed successful JSON reconciles before retrying");
}
{
  const api = server(), fetch = api.fetch;
  let stalled = false, aborted = false;
  api.fetch = async (...args) => {
    if (args[1].body instanceof FormData && !stalled) {
      stalled = true;
      args[1].signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      return new Promise(() => {});
    }
    return fetch(...args);
  };
  const { helper } = browser(api, storage(), 25);
  assert.equal((await helper.uploadResumableAudio({ ...options, requestOptions: { timeoutMs: 25 } })).persisted, true);
  assert.equal(aborted, true, "stalled fetch is aborted and reconciled instead of hanging");
}
{
  const api = server();
  let requests = 0;
  api.fetch = async (url, settings) => {
    requests++;
    if (settings.signal.aborted) throw new TypeError("Aborted");
    return { ok: false, status: 401, json: () => new Promise(() => {}) };
  };
  const { helper, delays } = browser(api, storage(), 25);
  await assert.rejects(helper.uploadResumableAudio({ ...options, requestOptions: { timeoutMs: 25 } }), error => error.status === 401);
  assert.equal(requests, 1, "timed-out auth error bodies do not change nonretryable status");
  assert.equal(delays.length, 0);
}
for (const label of ["chunk:0", "finalize_upload"]) {
  const api = server({ [label]: Array.from({ length: 4 }, () => failure(503)) });
  const { helper, delays, cache } = browser(api);
  await assert.rejects(helper.uploadResumableAudio(options), error => error.status === 503);
  assert.equal(count(api, label), 4);
  assert.equal(delays.length, 3);
  delays.forEach((delay, attempt) => assert.ok(delay >= 375 * 2 ** attempt && delay <= 625 * 2 ** attempt));
  assert.equal(cache.entries.size, 1);
}
for (const code of ["network", 408, 429, 500]) {
  const api = server({ "chunk:0": [failure(code)], finalize_upload: [failure(code)] });
  assert.equal((await browser(api).helper.uploadResumableAudio(options)).persisted, true);
  assert.equal(count(api, "chunk:0"), 2);
  assert.equal(count(api, "finalize_upload"), 2);
}
{
  const api = server({ "chunk:0": [failure(503, "before", true)] });
  assert.equal((await browser(api).helper.uploadResumableAudio(options)).persisted, true, "plain-text 5xx responses remain retryable");
  assert.equal(count(api, "chunk:0"), 2);
}

// Intake retries retain the owner-verified song/version instead of creating new songs.
{
  const intake = await readFile(new URL("../music-upload/music-upload.js", import.meta.url), "utf8");
  const fn = intake.slice(intake.indexOf("async function processPackage("), intake.indexOf("async function handleRuntimeRetry("));
  const cache = storage(), songs = new Map();
  let creations = 0, transfers = 0, lookupFailure = false;
  const context = vm.createContext({
    pendingPackageUploads: new Map(), sessionStorage: cache, AUDIO_CHUNK_BYTES: 4,
    uploadHelper: browser(server()).helper,
    setControllerPhase() {}, setMessage() {}, buildNotes: () => "notes",
    async loadCatalogSong(id) {
      if (lookupFailure) throw new Error("Owner catalog unavailable");
      return songs.get(id);
    },
    async apiJson(url, payload) {
      if (payload.action === "create_project") {
        creations++;
        songs.set("song-a", { id: "song-a", versions: [{ id: "version-a" }] });
        return { songId: "song-a", masterVersionId: "version-a" };
      }
      return {};
    },
    async uploadAudio() {
      if (++transfers === 1) throw new Error("interrupted");
    },
  });
  vm.runInContext(`${fn};globalThis.process = processPackage;`, context);
  const input = { file: file(), title: "Track", artistName: "Artist", position: 1, total: 1 };
  await assert.rejects(context.process(input), /interrupted/);
  assert.equal(cache.entries.size, 1);
  // A fresh module after reload still needs a reselected File and an owned target.
  context.pendingPackageUploads.clear();
  lookupFailure = true;
  await assert.rejects(context.process({ ...input, file: file() }), /Owner catalog unavailable/);
  assert.equal(creations, 1, "failed ownership revalidation never creates a replacement project");
  assert.equal(transfers, 1, "failed ownership revalidation never blindly uploads");
  assert.equal(cache.entries.size, 1);
  lookupFailure = false;
  const result = await context.process({ ...input, file: file("abcdefghij", "reselected.wav"), title: "Corrected title after reload" });
  assert.equal(result.songId, "song-a");
  assert.equal(creations, 1);
  assert.equal(cache.entries.size, 0);
}

// Catalog master transfers delegate to the configured multipart adapter, never
// silently switch storage after auth, transport, or conflicting-session failures.
{
  const catalog = await readFile(new URL("../song-catalog/song-catalog.js", import.meta.url), "utf8");
  const fn = catalog.slice(catalog.indexOf("async function uploadMasterToVersion("), catalog.indexOf("const isMasterVersion="));
  const progress = [];
  let fallbacks = 0, transfers = 0;
  const adapter = {
    async upload(audio, settings) {
      transfers++;
      assert.equal(audio, options.file);
      assert.equal(settings.songId, options.songId);
      assert.equal(settings.versionId, options.versionId);
      assert.equal(settings.fingerprint, "a".repeat(64));
      assert.equal(settings.contentType, "audio/wav");
      assert.equal(settings.durationSeconds, 123);
      settings.onProgress(4, 10);
      return { persisted: true, lockedIn: true, audioUrl: "/master.wav" };
    },
  };
  const context = vm.createContext({
    window: { HaloMasterUpload: adapter }, MAX_AUDIO_BYTES: 128 * 1024 * 1024,
    uploadHelper: { fileSha256: async () => "a".repeat(64) },
    audioContentType: () => "audio/wav", audioDuration: async () => 123,
    async uploadAudioToVersion() { fallbacks++; return { audioUrl: "/fallback.wav" }; },
  });
  vm.runInContext(`${fn};globalThis.upload = uploadMasterToVersion;`, context);
  const input = { ...options, ui: { start() {}, progress: percent => progress.push(percent) } };
  assert.equal((await context.upload(input)).audioUrl, "/master.wav");
  assert.equal(transfers, 1);
  assert.deepEqual(progress, [40]);
  for (const error of [
    Object.assign(new Error("Unauthorized"), { status: 401 }),
    Object.assign(new Error("Forbidden"), { status: 403 }),
    Object.assign(new Error("Conflict"), { status: 409 }),
    Object.assign(new Error("Storage unavailable"), { status: 503 }),
    new TypeError("Connection lost"),
  ]) {
    adapter.upload = async () => { throw error; };
    await assert.rejects(context.upload(input), candidate => candidate === error);
  }
  assert.equal(fallbacks, 0);
  adapter.upload = async () => { throw Object.assign(new Error("Unconfigured"), { status: 503, directUpload: false }); };
  assert.equal((await context.upload(input)).audioUrl, "/fallback.wav");
  assert.equal(fallbacks, 1);
  await assert.rejects(context.upload({ ...input, file: { name: "large.wav", size: 129 * 1024 * 1024 } }), /limited to 128 MB/);
  assert.equal(fallbacks, 1);
  context.window.HaloMasterUpload = undefined;
  await assert.rejects(context.upload(input), /runtime is unavailable/);
}
console.log("✓ resumable browser audio contracts passed");
