import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const id = "22222222-2222-4222-8222-222222222222";
const owner = "job-owner";
const copy = { sonicSummary: "Saved original copy", visualDirection: { coverPrompt: "An original signal", palette: ["blue"] } };
const projects = new Map(), blobs = new Map(), background = [], queries = [];
let identity = { id: owner }, trusted = true, copyCalls = 0, imageCalls = 0;
let copyProvider, imageProvider, failCheckpoint = false, holdArtwork, holdClaim, failReady = false;
const clone = value => structuredClone(value);
const now = () => new Date().toISOString();
function seed(overrides = {}) {
  const row = {
    id, member_id: owner, title: "Private fixture", artist_name: "Artist", file_name: "fixture.wav",
    rights_attested: true, status: "queued", creative_package: {}, analysis_evidence: {},
    blob_prefix: `${owner}/${id}/parts/`, artwork_key: "", artwork_content_type: "", model: "",
    created_at: now(), updated_at: now(), ...overrides,
  };
  projects.set(id, row);
  return row;
}
function owns(row, memberId) { return row && row.member_id === memberId; }
function fenced(row, memberId, token) {
  return owns(row, memberId) && row.status === "analyzing" && row.creative_package?._songLabJob?.token === token;
}
const db = {
  async sql(strings, ...values) {
    const query = strings.join("?");
    queries.push(query);
    if (query.includes("INSERT INTO halo_dreamweaver_songs")) {
      const [projectId, memberId, title, artist, fileName, prefix, count, type, byteSize, duration, brief, lyrics, evidence] = values;
      const row = {
        id: projectId, member_id: memberId, title, artist_name: artist, file_name: fileName,
        blob_prefix: prefix, chunk_count: count, content_type: type, byte_size: byteSize,
        duration_seconds: duration, creative_brief: brief, lyrics, analysis_evidence: JSON.parse(evidence),
        rights_attested: true, creative_package: {}, status: "queued", created_at: now(), updated_at: now(),
      };
      projects.set(projectId, row);
      return [clone(row)];
    }
    if (query.includes("SELECT *")) {
      const row = projects.get(values[0]);
      return owns(row, values[1]) ? [clone(row)] : [];
    }
    if (query.includes("jsonb_set")) {
      if (holdClaim) await holdClaim;
      const [leaseJson, projectId, memberId] = values;
      const row = projects.get(projectId);
      const expiry = row?.creative_package?._songLabJob?.leaseUntil
        || new Date(new Date(row?.updated_at).valueOf() + 90000).toISOString();
      if (!owns(row, memberId) || !row.rights_attested
        || !(["queued", "failed"].includes(row.status) || (row.status === "analyzing" && new Date(expiry).valueOf() <= Date.now()))) return [];
      row.status = "analyzing";
      row.error_message = "";
      row.updated_at = now();
      row.creative_package._songLabJob = JSON.parse(leaseJson);
      return [clone(row)];
    }
    if (query.includes("SET creative_package = ?")) {
      const [packageJson, model, projectId, memberId, token] = values;
      if (failCheckpoint) throw new Error("Controlled interrupted checkpoint");
      const row = projects.get(projectId);
      if (fenced(row, memberId, token)) {
        row.creative_package = JSON.parse(packageJson);
        row.model = model; row.status = "queued"; row.error_message = ""; row.updated_at = now();
      }
      return [];
    }
    if (query.includes("SET artwork_key")) {
      if (holdArtwork) await holdArtwork;
      const [key, type, projectId, memberId, token] = values;
      const row = projects.get(projectId);
      if (fenced(row, memberId, token)) {
        row.artwork_key = key; row.artwork_content_type = type;
        row.updated_at = now();
      }
      return [];
    }
    if (query.includes("SET status = 'ready'")) {
      if (failReady) throw new Error("Controlled interruption after artwork checkpoint");
      const [projectId, memberId, token] = values;
      const row = projects.get(projectId);
      if (fenced(row, memberId, token)) {
        delete row.creative_package._songLabJob;
        row.status = "ready"; row.error_message = ""; row.updated_at = now();
      }
      return [];
    }
    if (query.includes("SET status = 'queued'")) {
      const [projectId, memberId, token] = values;
      const row = projects.get(projectId);
      if (fenced(row, memberId, token)) {
        row.status = "queued"; delete row.creative_package._songLabJob;
        row.error_message = "The build paused"; row.updated_at = now();
      }
      return [];
    }
    throw new Error(`Unhandled recovery fixture SQL: ${query}`);
  },
};
const fixture = {
  db,
  store: {
    async set(key, bytes) { blobs.set(key, bytes); },
    async list({ prefix }) { return { blobs: [{ key: `${prefix}000` }] }; },
  },
  getUser: async () => identity,
  verify: async () => trusted,
  cleanText: (value, max) => String(value || "").slice(0, max),
  ensureMembership: async (_db, user) => ({ member_id: user.id }),
  OpenAI: class {
    constructor(options) {
      assert.equal(options.maxRetries, 0, "SDK retries cannot extend the job");
      assert.equal(options.timeout, 40);
    }
    chat = { completions: { create: async (_input, options) => {
      copyCalls++;
      assert.ok(options.signal instanceof AbortSignal);
      return copyProvider ? copyProvider(options.signal) : { choices: [{ message: { content: JSON.stringify(copy) } }] };
    } } };
    images = { generate: async (_input, options) => {
      imageCalls++;
      assert.ok(options.signal instanceof AbortSignal);
      return imageProvider ? imageProvider(options.signal) : { data: [{ b64_json: Buffer.from("fixture-png").toString("base64") }] };
    } };
  },
};
globalThis.__songLabJobFixture = fixture;
let source = await readFile(new URL("../netlify/functions/dreamweaver-song-lab.mjs", import.meta.url), "utf8");
assert.match(source, /const jobDeadlineMs = 25 \* 1000/);
assert.match(source, /const jobLeaseMs = 90 \* 1000/);
source = source
  .replace('import { getStore } from "@netlify/blobs";', "const getStore = () => globalThis.__songLabJobFixture.store;")
  .replace('import { getDatabase } from "@netlify/database";', "const getDatabase = () => globalThis.__songLabJobFixture.db;")
  .replace('import { getUser, verifyRequestOrigin } from "@netlify/identity";', "const { getUser, verify: verifyRequestOrigin } = globalThis.__songLabJobFixture;")
  .replace('import OpenAI from "openai";', "const { OpenAI } = globalThis.__songLabJobFixture;")
  .replace('import { cleanText, ensureMembership } from "../lib/halo-x.mjs";', "const { cleanText, ensureMembership } = globalThis.__songLabJobFixture;")
  .replace('"../lib/chunked-audio-upload.mjs"', JSON.stringify(new URL("../netlify/lib/chunked-audio-upload.mjs", import.meta.url).href))
  .replace("const jobDeadlineMs = 25 * 1000;", "const jobDeadlineMs = 40;");
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
let workerSource = await readFile(new URL("../netlify/functions/dreamweaver-song-lab-background.mjs", import.meta.url), "utf8");
assert.match(workerSource, /background: true/);
assert.match(workerSource, /path: "\/api\/dreamweaver-song-lab-background"/);
workerSource = workerSource.replace('"./dreamweaver-song-lab.mjs"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`));
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`);
const context = { waitUntil(promise) { background.push(promise); } };
async function resume(overrides = {}, executionContext = context) {
  return handler(new Request("https://halo.test/api/dreamweaver-song-lab", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://halo.test" },
    body: JSON.stringify({ action: "resume_project", projectId: id, ...overrides }),
  }), executionContext);
}
async function drain() { await Promise.all(background.splice(0)); }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// The response does not await AI. Parallel owner calls atomically exclude duplicates.
seed();
const writing = deferred();
copyProvider = () => writing.promise;
const responses = await Promise.all([resume(), resume(), resume()]);
assert.deepEqual(responses.map(response => response.status).sort(), [200, 200, 202]);
assert.equal(copyCalls, 1);
assert.equal(imageCalls, 0);
const publicProject = (await responses.find(response => response.status === 202).json()).project;
assert.equal(publicProject.jobStage, "creative_package");
assert.equal(publicProject.creativePackage._songLabJob, undefined, "private lease tokens are never serialized");
writing.resolve({ choices: [{ message: { content: JSON.stringify(copy) } }] });
await drain();
assert.equal(projects.get(id).status, "queued");
assert.deepEqual(projects.get(id).creative_package, copy, "copy is durable before artwork starts");
copyProvider = null;
assert.equal((await resume()).status, 202);
await drain();
assert.equal(projects.get(id).status, "ready");
assert.equal(imageCalls, 1);
assert.ok(blobs.has(projects.get(id).artwork_key));
const counts = [copyCalls, imageCalls];
assert.equal((await resume()).status, 200);
await drain();
assert.deepEqual([copyCalls, imageCalls], counts, "ready projects are no-ops");

// Legacy stale analyzing jobs retain copy/model and only generate the missing stage.
seed({ status: "analyzing", updated_at: new Date(Date.now() - 91000).toISOString(), creative_package: clone(copy), model: "fallback" });
assert.equal((await resume()).status, 202);
await drain();
assert.equal(copyCalls, counts[0]);
assert.deepEqual(projects.get(id).creative_package, copy);
assert.equal(projects.get(id).model, "fallback");
assert.equal(projects.get(id).status, "ready");
seed({ creative_package: { ...clone(copy), sonicSummary: "" } });
const beforeEmptySummary = copyCalls;
assert.equal((await resume()).status, 202);
await drain();
assert.equal(copyCalls, beforeEmptySummary, "schema-valid empty copy fields do not discard a checkpoint");
seed({ status: "analyzing", creative_package: clone(copy) });
assert.equal((await resume()).status, 200, "fresh legacy jobs cannot be reclaimed");
seed({ status: "analyzing", creative_package: { ...clone(copy), _songLabJob: { token: "old", leaseUntil: new Date(Date.now() - 1).toISOString() } } });
assert.equal((await resume()).status, 202, "expired explicit leases can be reclaimed");
await drain();
seed({ status: "failed", creative_package: clone(copy), artwork_key: "saved-artwork", artwork_content_type: "image/png" });
const beforeExisting = imageCalls;
assert.equal((await resume()).status, 202);
await drain();
assert.equal(imageCalls, beforeExisting, "an existing artwork checkpoint is not regenerated");
assert.equal(projects.get(id).artwork_key, "saved-artwork");

// A deadline retains the successful stage; late provider responses cannot write.
seed({ creative_package: clone(copy) });
const delayedImage = deferred();
let imageSignal;
imageProvider = signal => { imageSignal = signal; return delayedImage.promise; };
const blobCount = blobs.size;
assert.equal((await resume()).status, 202);
await drain();
assert.equal(imageSignal.aborted, true);
assert.equal(projects.get(id).status, "queued");
assert.deepEqual(projects.get(id).creative_package, copy);
imageProvider = null;
assert.equal((await resume()).status, 202);
await drain();
const recovered = clone(projects.get(id));
delayedImage.resolve({ data: [{ b64_json: Buffer.from("late-png").toString("base64") }] });
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(projects.get(id), recovered);
assert.equal(blobs.size, blobCount + 1, "late timed-out artwork does not overwrite recovered artwork");
assert.equal(recovered.status, "ready");

// A hanging checkpoint is bounded and its late write is fenced after a new claim.
seed({ creative_package: clone(copy) });
const blockedWrite = deferred();
holdArtwork = blockedWrite.promise;
assert.equal((await resume()).status, 202);
await drain();
assert.equal(projects.get(id).status, "queued");
holdArtwork = null;
assert.equal((await resume()).status, 202);
await drain();
const newer = clone(projects.get(id));
blockedWrite.resolve();
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(projects.get(id), newer, "late SQL is fenced against newer lease");

seed({ creative_package: clone(copy) });
failReady = true;
assert.equal((await resume()).status, 202);
await drain();
assert.equal(projects.get(id).status, "queued");
const durableArtwork = projects.get(id).artwork_key;
assert.ok(durableArtwork);
const callsAtArtworkCheckpoint = imageCalls;
failReady = false;
assert.equal((await resume()).status, 202);
await drain();
assert.equal(projects.get(id).status, "ready");
assert.equal(projects.get(id).artwork_key, durableArtwork);
assert.equal(imageCalls, callsAtArtworkCheckpoint, "recovery reuses durable artwork after a failed ready transition");

// Missing copy timeouts and interrupted checkpoints also leave recoverable uploads.
seed();
const neverCopy = deferred();
copyProvider = () => neverCopy.promise;
assert.equal((await resume()).status, 202);
await drain();
assert.equal(projects.get(id).status, "queued");
assert.equal(projects.get(id).blob_prefix, `${owner}/${id}/parts/`);
copyProvider = null;
failCheckpoint = true;
assert.equal((await resume()).status, 202);
await drain();
assert.equal(projects.get(id).status, "queued");
failCheckpoint = false;
assert.equal((await resume()).status, 202);
await drain();
assert.deepEqual(projects.get(id).creative_package, copy);

// Authorization, rights, and async capability are enforced before generation.
const deniedCounts = [copyCalls, imageCalls];
identity = { id: "other-owner" };
assert.equal((await resume()).status, 404);
identity = null;
assert.equal((await resume()).status, 401);
identity = { id: owner }; trusted = false;
assert.equal((await resume()).status, 403);
trusted = true;
assert.equal((await resume({ projectId: "not-a-uuid" })).status, 400);
seed({ rights_attested: false });
assert.equal((await resume()).status, 422);
seed();
assert.equal((await resume({}, {})).status, 200);
assert.equal(projects.get(id).status, "queued");
assert.deepEqual([copyCalls, imageCalls], deniedCounts);
assert.equal(background.length, 0);
const withoutWaiter = await resume({
  action: "analyze", uploadId: id, title: "Fixture", fileName: "fixture.wav", contentType: "audio/wav",
  chunkCount: 1, byteSize: 32, rightsAttested: true, analysis: {},
}, {});
assert.equal(withoutWaiter.status, 202);
assert.equal((await withoutWaiter.json()).project.status, "queued");
assert.deepEqual([copyCalls, imageCalls], deniedCounts, "finalization without waitUntil never awaits or starts AI");

async function runWorker(body = { projectId: id }, options = {}) {
  return worker(new Request("https://halo.test/api/dreamweaver-song-lab-background", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://halo.test" },
    body: JSON.stringify(body), ...options,
  }));
}
// The native background entrypoint executes and awaits a stage without waitUntil.
seed();
assert.equal((await resume({ backgroundWorker: true }, {})).status, 200);
assert.deepEqual([copyCalls, imageCalls], deniedCounts, "client flags cannot select worker execution");
assert.equal((await runWorker()).status, 202);
assert.equal(projects.get(id).status, "queued");
assert.deepEqual(projects.get(id).creative_package, copy);
assert.equal((await runWorker()).status, 202);
assert.equal(projects.get(id).status, "ready");
const nativeCounts = [copyCalls, imageCalls];
assert.equal((await runWorker()).status, 200);
assert.deepEqual([copyCalls, imageCalls], nativeCounts);
seed({ status: "analyzing", creative_package: clone(copy), updated_at: new Date(Date.now() - 91000).toISOString() });
assert.equal((await runWorker()).status, 202);
assert.equal(projects.get(id).status, "ready");
seed();
const nativeWriting = deferred();
copyProvider = () => nativeWriting.promise;
const pendingNative = runWorker();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal((await runWorker()).status, 200);
assert.equal(projects.get(id).status, "analyzing");
nativeWriting.resolve({ choices: [{ message: { content: JSON.stringify(copy) } }] });
assert.equal((await pendingNative).status, 202);
copyProvider = null;
seed({ creative_package: clone(copy) });
const nativeTimeout = deferred();
imageProvider = () => nativeTimeout.promise;
assert.equal((await runWorker()).status, 503);
assert.equal(projects.get(id).status, "queued");
assert.deepEqual(projects.get(id).creative_package, copy);
imageProvider = null;
seed();
const delayedClaim = deferred();
holdClaim = delayedClaim.promise;
const callsBeforeClaim = [copyCalls, imageCalls];
assert.equal((await runWorker()).status, 503, "the worker bounds authorization, claim, and generation together");
assert.equal(projects.get(id).status, "queued");
holdClaim = null;
delayedClaim.resolve();
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual([copyCalls, imageCalls], callsBeforeClaim, "a claim completing after the worker deadline never starts AI");
assert.equal(projects.get(id).status, "analyzing", "an uncancellable late SQL claim remains lease-recoverable");
projects.get(id).creative_package._songLabJob.leaseUntil = new Date(Date.now() - 1).toISOString();
assert.equal((await runWorker()).status, 202);
assert.equal(projects.get(id).status, "queued");
const nativeDeniedCounts = [copyCalls, imageCalls];
identity = null;
assert.equal((await runWorker()).status, 401);
identity = { id: "wrong-owner" };
assert.equal((await runWorker()).status, 404);
identity = { id: owner }; trusted = false;
assert.equal((await runWorker()).status, 403);
trusted = true;
seed({ rights_attested: false });
assert.equal((await runWorker()).status, 422);
assert.equal((await worker(new Request("https://halo.test/api/dreamweaver-song-lab-background"))).status, 405);
assert.equal((await runWorker({}, { headers: { "Content-Type": "multipart/form-data" } })).status, 400);
assert.deepEqual([copyCalls, imageCalls], nativeDeniedCounts);
for (const query of queries.filter(query => query.includes("UPDATE halo_dreamweaver_songs"))) {
  assert.match(query, /member_id = \?/);
  if (!query.includes("jsonb_set")) assert.match(query, /creative_package->'_songLabJob'->>'token' = \?/);
}
delete globalThis.__songLabJobFixture;
console.log("Song Lab job recovery contracts passed: actual handler stages, atomic lease/fencing, stale recovery, privacy/rights, bounded deadlines and late completions.");
