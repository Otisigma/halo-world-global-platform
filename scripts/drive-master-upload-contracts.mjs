import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import {
  DRIVE_MASTER_MAX_BYTES,
  DRIVE_UPLOAD_CHUNK_BYTES,
  buildServiceAccountAssertion,
  cleanGoogleDriveUrl,
  createResumableUploadSession,
  googleDriveConfig,
  isGoogleUploadUrl,
  validateDriveMasterUpload,
  verifyDriveMasterFile,
  driveFetch,
  driveSessionKey,
  saveDriveSession,
} from "../netlify/lib/google-drive.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [uploaderSource, uiSource, sessionApi, catalogApi, page, schema, migration, packageText, envExample, songCatalogApi, songCatalogClient, songCatalogStyles, driveUrlMigration] = await Promise.all([
  read("public/js/chunkedUploader.js"),
  read("public/js/uploadUI.js"),
  read("netlify/functions/upload.mjs"),
  read("netlify/functions/catalog-tracks.mjs"),
  read("song-catalog/index.html"),
  read("db/schema.ts"),
  read("netlify/database/migrations/20260929200000_add_song_version_drive_master.sql"),
  read("package.json"),
  read(".env.example"),
  read("netlify/functions/song-catalog.ts"),
  read("song-catalog/song-catalog.js"),
  read("song-catalog/song-catalog.css"),
  read("netlify/database/migrations/20261002040000_add_song_version_drive_url.sql"),
]);

// ── Backend: service account config, JWT, session + verification ─────────────
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const folderId = "1MastersFolderId_abc";
assert.equal(googleDriveConfig({}), null, "Drive uploads stay disabled without credentials");
assert.equal(googleDriveConfig({ GOOGLE_SERVICE_ACCOUNT_JSON: "{bad", GOOGLE_DRIVE_MASTERS_FOLDER_ID: folderId }), null, "invalid key JSON is rejected");
const config = googleDriveConfig({ GOOGLE_SERVICE_ACCOUNT_EMAIL: "halo@example.iam.gserviceaccount.com", GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: pem.replace(/\n/g, "\\n"), GOOGLE_DRIVE_MASTERS_FOLDER_ID: folderId });
assert.ok(config && config.privateKey.includes("\n"), "escaped private key newlines are restored");
assert.deepEqual(googleDriveConfig({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: pem }), GOOGLE_DRIVE_MASTERS_FOLDER_ID: folderId })?.clientEmail, "a@b.iam.gserviceaccount.com");

const assertion = buildServiceAccountAssertion(config, 1_700_000_000);
const [header, claims, signature] = assertion.split(".");
const verifier = createVerify("RSA-SHA256");
verifier.update(`${header}.${claims}`);
assert.ok(verifier.verify(publicKey, Buffer.from(signature, "base64url")), "service account JWT is RS256-signed");
assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url")), { iss: config.clientEmail, scope: "https://www.googleapis.com/auth/drive", aud: "https://oauth2.googleapis.com/token", iat: 1_700_000_000, exp: 1_700_003_600 });

assert.equal(validateDriveMasterUpload({ fileSize: 10 }).status, 400, "fileName is required");
assert.equal(validateDriveMasterUpload({ fileName: "a.wav" }).status, 400, "fileSize is required");
assert.equal(validateDriveMasterUpload({ fileName: "a.wav", fileSize: DRIVE_MASTER_MAX_BYTES + 1 }).status, 413);
assert.equal(validateDriveMasterUpload({ fileName: "a.exe", fileType: "application/x-msdownload", fileSize: 10 }).status, 415);
assert.deepEqual(validateDriveMasterUpload({ fileName: "My Master.wav", fileType: "audio/x-wav", fileSize: 900 * 1024 * 1024 }), { ok: true, byteSize: 900 * 1024 * 1024, contentType: "audio/wav", fileName: "My-Master.wav" });
assert.equal(DRIVE_UPLOAD_CHUNK_BYTES % (256 * 1024), 0, "chunk size must be a multiple of 256 KiB for Drive");

const sessionUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=XYZ";
assert.ok(isGoogleUploadUrl(sessionUrl));
assert.ok(!isGoogleUploadUrl("https://evil.example/upload/drive/v3/files?upload_id=1"));
const calls = [];
const fakeFetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "token-1" });
  if (String(url).includes("/files/generateIds")) return Response.json({ ids: ["1GeneratedDriveFileId"] });
  return new Response(null, { status: 200, headers: { Location: sessionUrl } });
};
const session = await createResumableUploadSession(config, { fileName: "master.wav", contentType: "audio/wav", byteSize: 1234, origin: "https://halo.example", appProperties: { haloSongId: "s" } }, { fetchImpl: fakeFetch });
assert.deepEqual(session, { uploadUrl: sessionUrl, fileId: "1GeneratedDriveFileId" });
const sessionCall = calls.at(-1);
assert.match(sessionCall.url, /uploadType=resumable/);
assert.equal(sessionCall.init.headers.Origin, "https://halo.example", "session carries the browser origin so Drive answers chunk PUTs with CORS");
assert.equal(sessionCall.init.headers["X-Upload-Content-Length"], "1234");
assert.equal(sessionCall.init.headers["X-Upload-Content-Type"], "audio/wav");
assert.deepEqual(JSON.parse(sessionCall.init.body).parents, [folderId]);
assert.equal(JSON.parse(sessionCall.init.body).id, "1GeneratedDriveFileId");
await assert.rejects(createResumableUploadSession(config, { fileName: "m.wav", contentType: "audio/wav", byteSize: 1 }, { fetchImpl: async url => String(url).includes("token") ? Response.json({ access_token: "t" }) : String(url).includes("generateIds") ? Response.json({ ids: ["1GeneratedDriveFileId"] }) : Response.json({ error: { message: "denied" } }, { status: 403 }) }), /denied/);

const scope = { folderId, ownerMemberId: "member-1", songId: "song-1", byteSize: 100 };
const goodFile = { id: "1GeneratedDriveFileId", name: "master.wav", size: "100", mimeType: "audio/wav", parents: [folderId], trashed: false, appProperties: { haloOwnerMemberId: "member-1", haloSongId: "song-1" } };
assert.equal(verifyDriveMasterFile(goodFile, scope).ok, true);
assert.equal(verifyDriveMasterFile(null, scope).status, 404);
assert.equal(verifyDriveMasterFile({ ...goodFile, trashed: true }, scope).status, 404);
assert.equal(verifyDriveMasterFile({ ...goodFile, parents: ["other"] }, scope).status, 403);
assert.equal(verifyDriveMasterFile({ ...goodFile, appProperties: { haloOwnerMemberId: "member-2", haloSongId: "song-1" } }, scope).status, 403);
assert.equal(verifyDriveMasterFile({ ...goodFile, size: "99" }, scope).status, 409);

// ── Direct Google Drive master link (no API credentials) ──────────────────────
const shareLink = "https://drive.google.com/file/d/1A2b3C4d5E6f7G8h9/view?usp=sharing";
assert.equal(cleanGoogleDriveUrl(`  ${shareLink}  `), shareLink, "shareable Drive links are accepted and trimmed");
assert.equal(cleanGoogleDriveUrl("https://docs.google.com/uc?export=download&id=1A2b3C4d5E6f7G8h9"), "https://docs.google.com/uc?export=download&id=1A2b3C4d5E6f7G8h9");
assert.equal(cleanGoogleDriveUrl(""), "", "an empty link clears the stored master link");
assert.equal(cleanGoogleDriveUrl("http://drive.google.com/file/d/abc/view"), "", "plain http links are rejected");
assert.equal(cleanGoogleDriveUrl("https://drive.google.com.evil.example/file/d/abc/view"), "", "look-alike hosts are rejected");
assert.equal(cleanGoogleDriveUrl(`https://${"user"}@drive.google.com/file/d/abc/view`), "", "credentialed links are rejected");
assert.equal(cleanGoogleDriveUrl("javascript:alert(1)"), "", "script URLs are rejected");
assert.equal(cleanGoogleDriveUrl("not a url"), "");

// ── Frontend: chunked uploader against a simulated Drive resumable endpoint ───
function runUploader(script, extra = {}) {
  const puts = [];
  class FakeXhr {
    constructor() { this.headers = {}; this.upload = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    getResponseHeader(name) { return (this.responseHeaders || {})[name] ?? null; }
    abort() { this.onabort?.(); }
    send(body) {
      const request = { range: this.headers["Content-Range"], size: body ? body.size : 0 };
      puts.push(request);
      const reply = script.shift();
      assert.ok(reply, `unexpected PUT ${request.range}`);
      queueMicrotask(() => {
        if (reply.hang) return;
        if (reply.timeout) return this.ontimeout();
        if (reply.status === 0) return this.onerror();
        if (body) this.upload.onprogress?.({ lengthComputable: true, loaded: body.size });
        this.status = reply.status;
        this.responseText = reply.body || "";
        this.responseHeaders = reply.headers || {};
        this.onload();
      });
    }
  }
  const context = { XMLHttpRequest: FakeXhr, setTimeout, clearTimeout, JSON, Math, Number, String, Promise, Error, AbortController, TextEncoder, Uint8Array };
  context.fetch = async (url, init) => {
    context.sessionRequest = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ uploadUrl: sessionUrl, fileId: "1GeneratedDriveFileId", songId: "song-1", versionId: "v-1", fileName: "master.wav" }), { status: 200 });
  };
  Object.assign(context, extra);
  context.globalThis = context;
  vm.runInNewContext(uploaderSource, context);
  return { context, puts };
}

const MB = 1024 * 1024;
const bigFile = new File([new Uint8Array(12 * MB)], "master.wav", { type: "audio/wav" });
{
  const { context, puts } = runUploader([
    { status: 308, headers: { Range: "bytes=0-5242879" } },
    { status: 0 },
    { status: 308, headers: { Range: "bytes=0-10485759" } },
    { status: 200, body: "" },
  ]);
  assert.equal(typeof context.HaloMasterUploader?.upload, "function", "exposes window.HaloMasterUploader");
  const progress = [];
  const result = await context.HaloMasterUploader.upload(bigFile, { songId: "song-1", retryDelayMs: 0, onProgress: ratio => progress.push(ratio) });
  assert.equal(context.sessionRequest.url, "/api/upload/drive-session");
  assert.deepEqual({ ...context.sessionRequest.body }, { fileName: "master.wav", fileType: "audio/wav", fileSize: 12 * MB, songId: "song-1", title: "", artist: "" });
  assert.deepEqual(puts.map(put => put.range), [
    `bytes 0-${5 * MB - 1}/${12 * MB}`,
    `bytes ${5 * MB}-${10 * MB - 1}/${12 * MB}`,
    `bytes */${12 * MB}`,
    `bytes ${10 * MB}-${12 * MB - 1}/${12 * MB}`,
  ], "uploads 5 MB chunks, queries status after a network error, and resumes from the persisted Range");
  assert.equal(puts[0].size, 5 * MB);
  assert.equal(result.fileId, "1GeneratedDriveFileId", "empty final body still resolves with the session file id");
  assert.equal(result.fileSize, 12 * MB);
  assert.equal(progress.at(-1), 1);
}
{
  const { context } = runUploader([{ status: 201, body: "<html>not json</html>" }]);
  const result = await context.HaloMasterUploader.upload(new File([new Uint8Array(10)], "m.wav", { type: "audio/wav" }), { songId: "song-1" });
  assert.equal(result.fileId, "1GeneratedDriveFileId", "non-JSON final body resolves safely");
}
{
  const { context } = runUploader([{ status: 200, body: JSON.stringify({ id: "1DriveReturnedId", size: "10" }) }]);
  const result = await context.HaloMasterUploader.upload(new File([new Uint8Array(10)], "m.wav"), { songId: "song-1" });
  assert.equal(result.fileId, "1DriveReturnedId");
}
{
  const { context } = runUploader([{ status: 404 }]);
  await assert.rejects(context.HaloMasterUploader.upload(new File([new Uint8Array(10)], "m.wav"), { songId: "song-1" }), /expired/);
}
{
  const { context } = runUploader([{ status: 308 }, { status: 308 }, { status: 308 }]);
  await assert.rejects(context.HaloMasterUploader.upload(new File([new Uint8Array(10)], "m.wav"), { songId: "song-1", maxRetries: 2 }), /stopped accepting/, "a stalled session fails instead of looping forever");
}

// Partial acknowledgements align the next non-final end, not the start offset.
{
  const file = new File([new Uint8Array(6 * MB)], "partial.wav");
  const checkpoint = 1_000_001;
  const nextEnd = Math.floor((checkpoint + 5 * MB) / (256 * 1024)) * 256 * 1024;
  const { context, puts } = runUploader([
    { status: 308, headers: { Range: `bytes=0-${checkpoint - 1}` } },
    { status: 308, headers: { Range: `bytes=0-${nextEnd - 1}` } },
    { status: 200 },
  ]);
  const progress = [];
  await context.HaloMasterUploader.upload(file, { onProgress: (ratio, detail) => progress.push({ ratio, ...detail }) });
  assert.equal(puts[1].range, `bytes ${checkpoint}-${nextEnd - 1}/${file.size}`);
  assert.equal(puts[1].size, nextEnd - checkpoint);
  assert.ok(progress.some(detail => detail.sent > detail.confirmed && detail.ratio === detail.confirmed / file.size), "sent progress never masquerades as confirmed progress");
}
{
  const { context, puts } = runUploader([
    { status: 308, headers: { Range: `bytes=0-${5 * MB - 1}` } },
    { status: 308 }, { status: 308 }, { status: 308 },
  ]);
  await assert.rejects(context.HaloMasterUploader.upload(bigFile, { retryDelayMs: 0, maxRetries: 2 }), /CORS exposes Range/);
  assert.equal(puts.filter(put => put.range.startsWith("bytes 0-")).length, 1, "missing exposed Range never rewinds confirmed bytes");
  assert.ok(puts.slice(2).every(put => put.range.startsWith("bytes */")), "missing Range triggers bounded status recovery, not more data");
}
{
  const { context } = runUploader([]);
  const parse = context.HaloMasterUploader.nextOffsetFromRange;
  for (const range of ["bytes=1-10", "bytes=0--1", "bytes=0-9007199254740991", "bytes=0-100 trailing", "bytes=0-100, bytes=0-200"]) assert.throws(() => parse(range, 1000), /invalid|impossible/);
  assert.throws(() => parse("bytes=0-1000", 1000), /impossible/);
  assert.throws(() => parse("bytes=0-9", 1000, 20), /impossible/);
  assert.throws(() => parse("bytes=0-99", 1000, 0, 50), /impossible/);
  assert.throws(() => parse(null, 1000, 20), /CORS/);
  assert.equal(parse("bytes=0-99", 1000, 20, 100), 100);
}
{
  const { context, puts } = runUploader([
    { hang: true }, { timeout: true }, { status: 503, headers: { "Retry-After": "0" } },
    { status: 308, headers: { Range: `bytes=0-${5 * MB - 1}` } }, { status: 200 },
  ]);
  const states = [];
  await context.HaloMasterUploader.upload(new File([new Uint8Array(6 * MB)], "timeout.wav"), { requestTimeoutMs: 5, statusTimeoutMs: 5, retryDelayMs: 0, onState: state => states.push(state) });
  assert.equal(puts.length, 5);
  assert.ok(puts.slice(1, 4).every(put => put.range === `bytes */${6 * MB}`), "timeouts keep querying status until a valid checkpoint is recovered");
  assert.ok(states.includes("reconnecting"));
}
{
  const { context } = runUploader([], { fetch: () => new Promise(() => {}) });
  await assert.rejects(context.HaloMasterUploader.requestSession(bigFile, { requestTimeoutMs: 5, maxRetries: 0 }), /timed out/);
  const metadata = runUploader([], { fetch: async () => ({ ok: true, text: () => new Promise(() => {}) }) });
  await assert.rejects(metadata.context.HaloMasterUploader.requestSession(bigFile, { requestTimeoutMs: 5, maxRetries: 0 }), /timed out/, "response body reads are bounded too");
}
{
  const delays = [];
  let calls = 0;
  const { context } = runUploader([], {
    setTimeout: (callback, ms) => {
      if (ms < 30000) { delays.push(ms); return setTimeout(callback, 0); }
      return setTimeout(callback, ms);
    },
    fetch: async () => ++calls === 1 ? Response.json({ message: "Busy" }, { status: 429, headers: { "Retry-After": "2" } }) : Response.json({ uploadUrl: sessionUrl }),
  });
  await context.HaloMasterUploader.requestSession(bigFile, { retryDelayMs: 0 });
  assert.equal(calls, 2);
  assert.equal(delays[0], 2000, "Retry-After is a minimum wait even with zero base backoff");
}

// Reload recovers identity, target, file ID and checkpoint from the server, not a bearer URL in browser storage.
{
  const storage = new Map();
  const requests = [];
  let saved;
  const extra = {
    crypto: webcrypto,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async (_url, init) => {
      const payload = JSON.parse(init.body);
      requests.push(payload);
      saved ||= { uploadUrl: sessionUrl, fileId: "1GeneratedDriveFileId", songId: "song-1", versionId: "v-1", fileSize: bigFile.size, fileName: bigFile.name, protocolVersion: 2, confirmedOffset: 5 * MB, phase: "transferring", resumed: true };
      if (payload.action === "checkpoint") {
        saved.confirmedOffset = payload.confirmedOffset;
        if (saved.confirmedOffset === bigFile.size) saved.phase = "completing";
      }
      return Response.json(saved);
    },
  };
  const first = runUploader([{ status: 0 }], extra);
  await assert.rejects(first.context.HaloMasterUploader.upload(bigFile, { songId: "song-1", maxRetries: 0 }), /kept failing/);
  const reloaded = runUploader([
    { status: 308, headers: { Range: `bytes=0-${5 * MB - 1}` } },
    { status: 308, headers: { Range: `bytes=0-${10 * MB - 1}` } },
    { status: 200 },
  ], extra);
  const result = await reloaded.context.HaloMasterUploader.upload(bigFile, { songId: "song-1", retryDelayMs: 0 });
  assert.equal(reloaded.puts[0].range, `bytes */${bigFile.size}`);
  assert.equal(reloaded.puts[1].range, `bytes ${5 * MB}-${10 * MB - 1}/${bigFile.size}`);
  assert.equal(result.fileId, "1GeneratedDriveFileId");
  assert.equal(result.phase, "completing");
  assert.equal(requests[0].uploadId, requests[1].uploadId, "identity is stable across a fresh browser context");
  assert.equal(requests[1].versionId, "v-1");
  assert.ok(/^[a-f0-9]{64}$/.test(result.uploadId));
  assert.ok(!JSON.stringify([...storage]).includes("googleapis") && !JSON.stringify([...storage]).includes("uploadUrl"), "localStorage contains non-secret identity/target only");
  const completed = runUploader([], { ...extra, fetch: async () => Response.json({ ...saved, phase: "registered", registeredResult: { persisted: true } }) });
  assert.equal((await completed.context.HaloMasterUploader.upload(bigFile, { songId: "song-1" })).registeredResult.persisted, true);
  assert.equal(completed.puts.length, 0, "a registered reload skips transfer entirely");
}

// ── Frontend: upload form wiring against a minimal DOM stub ───────────────────
async function runUploadUi({ uploader, file, songId = "song-1", catalogStatus = 201, catalogFetch, repeat = false }) {
  const element = extra => ({ dataset: {}, textContent: "", style: {}, setAttribute() {}, ...extra });
  const listeners = {};
  const input = element({ files: file ? [file] : [], value: "x" });
  const submit = element({ disabled: false });
  const form = element({
    elements: { namedItem: () => null },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    querySelector: selector => (selector.includes("file") ? input : submit),
  });
  const nodes = {
    masterUploadForm: form,
    masterStatusLabel: element(),
    masterProgressBar: element({ tagName: "PROGRESS", value: 0 }),
    songId: { value: songId },
    title: { value: "Night Signal" },
    artistName: { value: "HALO" },
  };
  const events = [];
  const posts = [];
  const context = {
    document: { readyState: "complete", getElementById: id => nodes[id] || null, dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    fetch: async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return catalogFetch ? catalogFetch() : new Response(JSON.stringify({ message: catalogStatus < 300 ? "Saved." : "Nope" }), { status: catalogStatus }); },
    JSON, Math, String, Promise, Error, setTimeout, clearTimeout, AbortController,
  };
  context.window = context;
  if (uploader) context.HaloMasterUploader = uploader;
  vm.runInNewContext(uiSource, context);
  await listeners.submit({ preventDefault() {}, currentTarget: form });
  if (repeat) await listeners.submit({ preventDefault() {}, currentTarget: form });
  return { nodes, form, submit, posts, events };
}
{
  const missing = await runUploadUi({ uploader: null, file: bigFile });
  assert.match(missing.nodes.masterStatusLabel.textContent, /did not load/, "missing uploader script is reported");
  const noFile = await runUploadUi({ uploader: { upload: async () => assert.fail("must not upload") }, file: null });
  assert.equal(noFile.nodes.masterStatusLabel.textContent, "Choose a WAV master file first.");
  let options;
  const ok = await runUploadUi({
    file: bigFile,
    uploader: { upload: async (_file, opts) => { options = opts; opts.onProgress(0.5, { uploaded: 6 * MB, total: 12 * MB }); return { fileId: "1GeneratedDriveFileId", fileName: "master.wav", fileSize: 12 * MB, songId: "song-1" }; } },
  });
  assert.equal(options.songId, "song-1");
  assert.equal(options.title, "Night Signal");
  assert.equal(options.artist, "HALO");
  assert.deepEqual(ok.posts.map(post => ({ url: post.url, body: { ...post.body } })), [{ url: "/api/catalog/tracks", body: { songId: "song-1", masterFileId: "1GeneratedDriveFileId", fileName: "master.wav", fileSize: 12 * MB } }]);
  assert.equal(ok.nodes.masterProgressBar.value, 100);
  assert.equal(ok.nodes.masterStatusLabel.textContent, "Saved.");
  assert.equal(ok.form.dataset.uploadState, "success");
  assert.equal(ok.submit.disabled, false);
  assert.equal(ok.events[0]?.type, "halo:master-uploaded");
  const failed = await runUploadUi({ file: bigFile, catalogStatus: 403, uploader: { upload: async () => ({ fileId: "1GeneratedDriveFileId", fileName: "m.wav", fileSize: 1 }) } });
  assert.equal(failed.nodes.masterStatusLabel.textContent, "Nope");
  assert.equal(failed.form.dataset.uploadState, "error");
}
{
  let uploads = 0;
  let acknowledgements = 0;
  const recovered = await runUploadUi({
    file: bigFile, repeat: true,
    uploader: { upload: async () => { uploads++; return { fileId: "1GeneratedDriveFileId", fileName: "m.wav", fileSize: 12 * MB, songId: "song-1" }; } },
    catalogFetch: async () => {
      if (++acknowledgements === 1) throw new Error("Registration response lost");
      return Response.json({ message: "Saved." });
    },
  });
  assert.equal(uploads, 1, "retry after lost registration acknowledgement never reuploads");
  assert.equal(recovered.posts[0].body.masterFileId, recovered.posts[1].body.masterFileId);
  assert.equal(recovered.form.dataset.uploadState, "success");
}

// Durable server session and idempotent registration across function invocations.
{
  const records = new Map();
  let etag = 0;
  const store = {
    get: async key => records.has(key) ? structuredClone(records.get(key).data) : null,
    getWithMetadata: async key => records.has(key) ? structuredClone(records.get(key)) : null,
    setJSON: async (key, data, options = {}) => {
      const old = records.get(key);
      if ((options.onlyIfNew && old) || (options.onlyIfMatch && options.onlyIfMatch !== old?.etag)) return { modified: false };
      records.set(key, { data: structuredClone(data), etag: String(++etag) });
      return { modified: true };
    },
  };
  const songId = "11111111-1111-4111-8111-111111111111";
  const uploadId = "a".repeat(64);
  let master = { id: "version-1", title: "Master", artist_name: "Artist", drive_file_id: "1PreviousDriveFileId" };
  let file = null;
  let opens = 0;
  let updates = 0;
  let loseSqlAck = true;
  const dependencies = {
    Response, URL, console, process: { env: { COMMIT_REF: "revision-1" } },
    getUser: async () => ({ id: "user-1" }), verifyRequestOrigin: () => {},
    getDatabase: async () => ({ sql: async (_strings, ...values) => {
      updates++;
      master.drive_file_id = values[0];
      if (loseSqlAck) { loseSqlAck = false; throw new Error("SQL registration acknowledgement lost"); }
      return [];
    } }),
    ensureMembership: async () => ({ member_id: "member-1" }),
    cleanText: value => String(value || ""), cleanSongId: value => value === songId ? value : "",
    googleDriveConfig: () => config, validateDriveMasterUpload, DRIVE_MASTER_MAX_BYTES, DRIVE_UPLOAD_CHUNK_BYTES,
    findOwnedSaleMaster: async () => ({ ...master }),
    createResumableUploadSession: async () => { opens++; return { uploadUrl: sessionUrl, fileId: "1GeneratedDriveFileId" }; },
    driveSessionStore: () => store, driveSessionKey, saveDriveSession, getDriveFile: async () => file, verifyDriveMasterFile,
    isDriveId: value => /^[A-Za-z0-9_-]{10,200}$/.test(value),
  };
  function handler(source, name) {
    const context = { ...dependencies };
    const stripped = source.replace(/^import[\s\S]*?;\n/gm, "").replace("export default async function", "async function").replace(/^export const config.*$/m, "");
    vm.runInNewContext(stripped + `\nglobalThis.handler = ${name};`, context);
    return context.handler;
  }
  const open = () => handler(sessionApi, "uploadHandler");
  const register = () => handler(catalogApi, "catalogTracksHandler");
  const payload = { songId, uploadId, protocolVersion: 2, fileName: "master.wav", fileType: "audio/wav", fileSize: 100 };
  const request = body => new Request("https://halo.example/api/upload/drive-session", { method: "POST", body: JSON.stringify(body), headers: { Origin: "https://halo.example", "Content-Type": "application/json" } });
  const first = await (await open()(request(payload))).json();
  const second = await (await open()(request(payload))).json();
  assert.equal(opens, 1, "fresh function/reload returns the same durable session");
  assert.equal(first.fileId, second.fileId);
  assert.equal(second.protocolVersion, 2);
  assert.equal(second.revision, "revision-1");
  await open()(request({ ...payload, action: "checkpoint", confirmedOffset: 40 }));
  const key = driveSessionKey("member-1", songId, uploadId);
  assert.notEqual(key, driveSessionKey("member-2", songId, uploadId), "session identities are owner scoped");
  assert.equal((await store.get(key)).confirmedOffset, 40);
  assert.equal((await open()(request({ ...payload, action: "checkpoint", confirmedOffset: 39 }))).status, 400);
  assert.equal((await open()(request({ ...payload, action: "checkpoint", confirmedOffset: 101 }))).status, 400);
  assert.equal((await open()(request({ ...payload, versionId: "other" }))).status, 409);
  file = { ...goodFile, size: "40", appProperties: { haloOwnerMemberId: "member-1", haloSongId: songId, haloVersionId: "version-1", haloUploadId: uploadId } };
  assert.equal((await (await open()(request(payload))).json()).phase, "transferring", "partial metadata never masquerades as completion or prevents resuming");
  file.size = "100";
  const completion = await (await open()(request(payload))).json();
  assert.equal(completion.phase, "completing");
  const reference = { songId, masterFileId: first.fileId, uploadId, versionId: "version-1", protocolVersion: 2, fileSize: 100 };
  const interruptedRegistration = await register()(request(reference));
  assert.equal(interruptedRegistration.status, 502);
  assert.equal((await store.get(key)).phase, "completing");
  const lostAck = await (await register()(request(reference))).json();
  const retried = await (await register()(request(reference))).json();
  assert.deepEqual(retried, lostAck, "lost registration response returns the durable registered result");
  assert.equal(retried.replacedFileId, "1PreviousDriveFileId", "a lost SQL acknowledgement preserves the exact registration result");
  assert.equal(updates, 1);
  assert.equal((await store.get(key)).phase, "registered");
  await saveDriveSession(store, key, { phase: "transferring", confirmedOffset: 1 });
  assert.equal((await store.get(key)).phase, "registered", "late checkpoints cannot undo registration");
  assert.equal((await store.get(key)).confirmedOffset, 100);
  // Another session completed against a target that changed while transferring.
  const changedId = "b".repeat(64);
  await store.setJSON(driveSessionKey("member-1", songId, changedId), { ...completion, uploadId: changedId });
  file.appProperties.haloUploadId = changedId;
  master.id = "version-2";
  const review = await register()(request({ ...reference, uploadId: changedId }));
  assert.equal(review.status, 409);
  assert.equal((await review.json()).phase, "review_pending");
  assert.equal(updates, 1, "a changed target never silently receives the uploaded file");
  assert.equal(verifyDriveMasterFile(file, { ...scope, songId, versionId: "version-2", uploadId: changedId }).status, 409);
}
await assert.rejects(driveFetch("https://google.example", {}, () => new Promise(() => {}), 5), /timed out/);
await assert.rejects(driveFetch("https://google.example", {}, async () => ({ arrayBuffer: () => new Promise(() => {}) }), 5), /timed out/, "server metadata body reads are bounded");

// ── Wiring contracts ──────────────────────────────────────────────────────────
const checks = [
  [sessionApi.includes('export const config = { path: "/api/upload/drive-session" }') && sessionApi.includes("validateDriveMasterUpload") && sessionApi.includes("verifyRequestOrigin(request)") && sessionApi.includes("getUser()"), "session endpoint authenticates, validates, and is routed"],
  [sessionApi.includes("uploadUrl,") && sessionApi.includes("fileId,") && sessionApi.includes("}, 502);") && sessionApi.includes("}, 503);"), "session endpoint returns uploadUrl + fileId and JSON failures"],
  [catalogApi.includes('export const config = { path: "/api/catalog/tracks" }') && catalogApi.includes("verifyDriveMasterFile") && catalogApi.includes("UPDATE halo_song_versions") && catalogApi.includes("drive_file_id = ${fileId}"), "catalog endpoint verifies and stores the master reference on the sale master"],
  [uiSource.includes('byId("masterUploadForm")') && uiSource.includes("masterProgressBar") && uiSource.includes("masterStatusLabel") && uiSource.includes('"/api/catalog/tracks"'), "upload UI wires the form, progress, status, and catalog"],
  [uiSource.includes("window.HaloMasterUploader") && uiSource.includes("did not load") && uiSource.includes("Choose a WAV master file first."), "upload UI degrades when the uploader or file is missing"],
  [page.includes('id="masterUploadForm"') && page.includes('id="masterProgressBar"') && page.includes('id="masterStatusLabel"'), "song catalog renders the Drive master form"],
  [page.indexOf('src="/public/js/chunkedUploader.js" defer') > 0 && page.indexOf('src="/public/js/chunkedUploader.js" defer') < page.indexOf('src="/public/js/uploadUI.js" defer'), "uploader script loads before the UI wiring"],
  [schema.includes('driveFileId: text("drive_file_id")') && migration.includes("ADD COLUMN IF NOT EXISTS drive_file_id"), "Drive master reference columns are migrated"],
  [envExample.includes("GOOGLE_DRIVE_MASTERS_FOLDER_ID") && envExample.includes("GOOGLE_SERVICE_ACCOUNT_JSON"), "Drive configuration is documented"],
  [page.includes('id="driveLinkPanel"') && page.includes('id="googleDriveUrl" name="googleDriveUrl" form="songForm" type="url"') && page.includes('id="saveDriveUrlButton" form="songForm" type="submit"') && page.includes('id="googleDrivePreviewLink"') && page.includes('rel="noopener noreferrer"') && page.indexOf('id="driveLinkPanel"') < page.indexOf('id="songForm"'), "song editor renders the Google Drive master link input, save action, and preview link"],
  [songCatalogClient.includes('action:"save_song",googleDriveUrl,') && songCatalogClient.includes('setValue("#googleDriveUrl",song.googleDriveUrl)') && songCatalogClient.includes("function driveLinkHref(") && songCatalogClient.includes("Link saved ✓") && songCatalogClient.includes('$("#googleDriveUrl").addEventListener("input",renderDriveLink)'), "song editor saves googleDriveUrl with the song record and previews only Drive links"],
  [songCatalogApi.includes("cleanGoogleDriveUrl(payload.googleDriveUrl)") && songCatalogApi.includes('googleDriveUrl: canonicalMaster?.driveUrl || ""') && songCatalogApi.includes("set({ driveUrl: googleDriveUrl") && songCatalogApi.includes("eq(songVersions.versionType, MASTER_VERSION_TYPE)"), "save_song persists googleDriveUrl on the canonical sale master and returns it with the song"],
  [schema.includes('driveUrl: text("drive_url")') && driveUrlMigration.includes("ADD COLUMN IF NOT EXISTS drive_url"), "Drive master link column is migrated idempotently"],
  [songCatalogStyles.includes(".drive-link-panel{background:#111") && songCatalogStyles.includes("#d4af37"), "Drive master link keeps the gold-on-black archive styling"],
  [JSON.parse(packageText).scripts["upload-experience:watchdog"].includes("scripts/drive-master-upload-contracts.mjs"), "Drive master contracts run in the upload watchdog"],
];
const failures = checks.filter(([ok]) => !ok).map(([, label]) => label);
if (failures.length) {
  console.error(`Drive master upload contracts failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Drive master upload contracts passed.");
