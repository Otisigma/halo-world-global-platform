import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import vm from "node:vm";
import {
  AUDIO_CHUNK_MAX_BYTES,
  AUDIO_UPLOAD_MAX_CHUNKS,
  audioChunkKey,
  audioUploadPrefix,
  discardAudioChunks,
  inspectAudioUpload,
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

// Shared browser transport: bounded, non-overlapping numbered parts; drain failures before retry.
{
  const pending = [];
  const requests = [];
  let active = 0;
  let peak = 0;
  class FakeXHR {
    upload = {};
    open() {}
    setRequestHeader() {}
    send(body) {
      active++;
      peak = Math.max(peak, active);
      requests.push(body);
      pending.push(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
        active--;
        this.status = body.fail ? 500 : 200;
        this.responseText = body.fail ? '{"message":"Temporary failure"}' : "{}";
        this.onload();
      });
    }
  }
  const context = { window: {}, XMLHttpRequest: FakeXHR, console, setTimeout };
  vm.runInNewContext(await read("upload-progress.js"), context);
  const helper = context.window.HaloUploadProgress;
  const progress = [];
  const options = {
    url: "/api/song-catalog/audio", file: { size: 10 }, chunkSize: 4, concurrency: 2,
    buildBody: part => part, onProgress: value => progress.push(value),
  };
  const uploading = helper.uploadChunkedFile(options);
  assert.equal(requests.length, 2);
  pending.pop()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 3, "a confirmed part frees one worker slot");
  pending.pop()();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(progress.every(value => value < 100), "100% waits for all acknowledgements");
  pending.pop()();
  assert.equal((await uploading).chunkCount, 3);
  assert.equal(peak, 2);
  assert.deepEqual(requests.map(({ start, end }) => [start, end]), [[0, 4], [4, 8], [8, 10]]);
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));
  assert.equal(progress.at(-1), 100);

  requests.length = 0;
  let rejected = false;
  const failed = helper.uploadChunkedFile({
    ...options, buildBody: part => ({ ...part, fail: part.chunkIndex === 0 }),
  }).catch(() => { rejected = true; });
  pending.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rejected, false, "failure waits for already-started requests to settle");
  assert.equal(requests.length, 2, "no new parts start after failure");
  pending.shift()();
  await failed;
  assert.equal(rejected, true);
  requests.length = 0;
  const sequential = helper.uploadChunkedFile({ ...options, url: "/api/song-catalog/artwork", concurrency: undefined });
  assert.equal(requests.length, 1, "other transports stay sequential unless explicitly enabled");
  for (let index = 0; index < 3; index++) {
    pending.shift()();
    await new Promise(resolve => setImmediate(resolve));
  }
  await sequential;
  assert.equal(requests.length, 3);
  await assert.rejects(helper.uploadChunkedFile({ ...options, concurrency: 4 }), /concurrency/);
  await assert.rejects(helper.uploadChunkedFile({ ...options, chunkSize: 0 }), /chunk size/);

  let renders = 0;
  const ui = helper.createUploadUi({
    panel: { classList: { toggle() { renders++; } }, setAttribute() {}, dataset: {} },
    status: {}, track: { setAttribute() {} }, fill: { style: {} },
  });
  ui.start();
  ui.progress(20.1, "Uploading 20%");
  const before = renders;
  ui.progress(20.4, "Uploading 20%");
  assert.equal(renders, before, "same-percent progress avoids redundant DOM updates");
  ui.success("Saved");
  assert.equal(ui.state.uploading, false);
}

function memoryStore() {
  const blobs = new Map();
  return {
    blobs,
    async list({ prefix }) { return { blobs: [...blobs.keys()].filter(key => key.startsWith(prefix)).sort().map(key => ({ key })) }; },
    async getMetadata(key) { return blobs.has(key) ? { metadata: blobs.get(key).metadata } : null; },
    async set(key, data, { metadata } = {}) { blobs.set(key, { data: new Uint8Array(await data.arrayBuffer()), metadata }); },
    async get(key) { return blobs.get(key)?.data || null; },
    async delete(key) { blobs.delete(key); },
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
  assert.equal((await put(0, parts[0], { checksum: sha256(Buffer.from("tampered")) })).status, 422, "rejects chunks whose bytes do not match the client checksum");
  assert.equal((await put(0, parts[0], { checksum: sha256(parts[0]) })).ok, true);
  assert.equal((await storeAudioChunk(store, { prefix, chunkIndex: 1, chunkCount: 4, byteSize: 13, chunk: new Blob([parts[1]]) })).status, 409, "refuses parts from a differently shaped upload under the same session");
  assert.equal((await put(1)).ok, true);
  assert.equal((await put(1)).ok, true, "retrying a chunk overwrites its deterministic key");
  status = await inspectAudioUpload(store, { prefix, chunkCount: 3, byteSize: 10 });
  assert.equal(status.complete, true);
  assert.deepEqual(status.receivedChunks, [0, 1, 2]);
  assert.equal(status.chunkChecksums[1], sha256(parts[1]));
  assert.equal(store.blobs.size, 3);
  const assembled = Buffer.concat([0, 1, 2].map(index => store.blobs.get(audioChunkKey(prefix, index)).data));
  assert.equal(Buffer.compare(assembled, bytes), 0, "parts reassemble in index order to the original bytes");

  store.blobs.get(audioChunkKey(prefix, 1)).metadata.size = 3;
  status = await inspectAudioUpload(store, { prefix, chunkCount: 3, byteSize: 10 });
  assert.equal(status.complete, false);
  assert.deepEqual(status.invalidChunks, [1], "flags parts whose size breaks the uniform chunk layout");
  await discardAudioChunks(store, prefix, status.invalidChunks);
  assert.equal(store.blobs.has(audioChunkKey(prefix, 1)), false);
}

// A fake /api/song-catalog/audio that mirrors the function's auth, origin, chunk, status, and finalize rules.
function fakeAudioApi({ failures = {} } = {}) {
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
    if (failure) return json({ message: "Temporary failure" }, failure);
    assert.equal(new URL(url).pathname, "/api/song-catalog/audio");
    if (headers.get("authorization") !== ["Bearer", TOKEN].join(" ")) return json({ message: "Join or sign in to use song audio" }, 401);
    if (headers.get("origin") !== new URL(url).origin) return json({ message: "Cross-origin audio uploads are not accepted" }, 403);
    if (isForm) {
      const form = init.body;
      const prefix = audioUploadPrefix("member", form.get("versionId"), form.get("uploadId"));
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
        chunkIndex: Number(form.get("chunkIndex")), chunkCount: Number(form.get("chunkCount")), byteSize: Number(form.get("byteSize")),
      });
      return result.ok ? json({ message: "Audio chunk uploaded", chunkIndex: result.chunkIndex }) : json({ message: result.message }, result.status);
    }
    const payload = JSON.parse(init.body);
    const prefix = audioUploadPrefix("member", payload.versionId, payload.uploadId);
    const status = await inspectAudioUpload(store, { prefix, chunkCount: payload.chunkCount, byteSize: payload.byteSize });
    if (payload.action === "upload_status") return json({ finalized: finalized.get(payload.versionId) === prefix, ...status });
    if (payload.action === "finalize_upload") {
      if (finalized.get(payload.versionId) === prefix) return json({ message: "Audio is persisted and locked into HALO storage.", alreadyFinalized: true });
      if (!status.complete) {
        await discardAudioChunks(store, prefix, status.invalidChunks);
        return json({ message: "The audio upload is incomplete.", missingChunks: status.missingChunks, invalidChunks: status.invalidChunks }, 409);
      }
      finalized.set(payload.versionId, prefix);
      return json({ message: "Audio is persisted and locked into HALO storage.", audioUrl: `/api/song-catalog/audio?versionId=${payload.versionId}`, persisted: true });
    }
    return json({ message: "Choose a supported audio action" }, 400);
  }
  const assembled = versionId => {
    const prefix = finalized.get(versionId);
    const keys = [...store.blobs.keys()].filter(key => key.startsWith(prefix)).sort();
    return Buffer.concat(keys.map(key => store.blobs.get(key).data));
  };
  return { fetchImpl, calls, store, assembled };
}

const workDir = await mkdtemp(join(tmpdir(), "halo-chunk-upload-"));
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
    [packageJson.scripts["upload:audio"] === "node scripts/halo-chunk-upload.mjs", "ships an npm entry point for local chunked uploads"],
    [String(packageJson.scripts["upload-experience:watchdog"]).includes("scripts/chunked-audio-upload-contracts.mjs"), "runs chunked audio upload contracts with the upload watchdog"],
  ];
  const failed = checks.filter(([ok]) => !ok);
  for (const [ok, label] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (failed.length) process.exit(1);
}

console.log("✓ chunked audio upload contracts passed");
