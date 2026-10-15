import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import {
  RESILIENCE_TIERS,
  bestEffort,
  createCircuitBreaker,
  failover,
  isTransientError,
  retryWithBackoff,
  withTimeout,
} from "../netlify/lib/resilience.mjs";
import { headStoredObject, masterStorageAvailable } from "../netlify/lib/direct-upload-storage.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const noSleep = async () => {};
const delay = ms => new Promise(done => setTimeout(done, ms));
const transient = (message = "blip") => Object.assign(new Error(message), { status: 503 });
const rejected = (message = "bad input") => Object.assign(new Error(message), { status: 400 });
let passed = 0;
async function check(name, run) {
  await run();
  passed += 1;
  console.log(`PASS: ${name}`);
}

await check("classifies transient vs. permanent failures", () => {
  for (const error of [transient(), { code: "ECONNRESET" }, { name: "TimeoutError" }, new TypeError("fetch failed"), { status: 429 }]) assert.equal(isTransientError(error), true);
  for (const error of [rejected(), { status: 404 }, { status: 409 }, { circuitOpen: true }, null]) assert.equal(isTransientError(error), false);
});

await check("every tier is bounded with a timeout and finite retries", () => {
  for (const [tier, profile] of Object.entries(RESILIENCE_TIERS)) {
    assert.ok(profile.timeoutMs > 0 && Number.isFinite(profile.timeoutMs), `${tier} has a timeout`);
    assert.ok(Number.isInteger(profile.retries) && profile.retries <= 3, `${tier} has bounded retries`);
  }
  assert.equal(RESILIENCE_TIERS.observability.retries, 0, "telemetry is never retried");
});

await check("timeouts abort the underlying work instead of leaving it running", async () => {
  let aborted = false;
  await assert.rejects(withTimeout(signal => new Promise(() => { signal.addEventListener("abort", () => { aborted = true; }); }), { timeoutMs: 15 }), { name: "TimeoutError" });
  assert.equal(aborted, true);
  assert.equal(await withTimeout(async () => "fast", { timeoutMs: 50 }), "fast");
});

await check("retries only transient failures, with a hard attempt bound", async () => {
  let calls = 0;
  const retries = [];
  assert.equal(await retryWithBackoff(() => { calls += 1; if (calls < 3) throw transient(); return "stored"; }, { retries: 3, sleep: noSleep, onRetry: info => retries.push(info.attempt) }), "stored");
  assert.deepEqual(retries, [1, 2]);
  calls = 0;
  await assert.rejects(retryWithBackoff(() => { calls += 1; throw rejected(); }, { retries: 3, sleep: noSleep }), /bad input/);
  assert.equal(calls, 1, "validation errors are never retried");
  calls = 0;
  await assert.rejects(retryWithBackoff(() => { calls += 1; throw transient(); }, { retries: 2, sleep: noSleep }), /blip/);
  assert.equal(calls, 3, "gives up after the retry budget");
  calls = 0;
  let clock = 0;
  await assert.rejects(retryWithBackoff(() => { calls += 1; clock += 1_400; throw transient(); }, { retries: 5, baseDelayMs: 400, deadline: 1_500, now: () => clock, sleep: noSleep }));
  assert.equal(calls, 1, "a retry that would exceed the deadline is not attempted");
});

await check("circuit breaker opens on dependency failures, fails fast, and recovers via half-open", async () => {
  let clock = 0;
  const transitions = [];
  const breaker = createCircuitBreaker({ name: "storage", failureThreshold: 2, resetTimeoutMs: 1_000, now: () => clock, onStateChange: change => transitions.push(change.to) });
  await assert.rejects(breaker.execute(async () => { throw rejected(); }));
  await assert.rejects(breaker.execute(async () => { throw rejected(); }));
  assert.equal(breaker.state, "closed", "caller mistakes never trip the breaker");
  await assert.rejects(breaker.execute(async () => { throw transient(); }));
  await assert.rejects(breaker.execute(async () => { throw transient(); }));
  assert.equal(breaker.state, "open");
  let called = false;
  await assert.rejects(breaker.execute(async () => { called = true; }), { code: "CIRCUIT_OPEN" });
  assert.equal(called, false, "open breaker fails fast without touching the dependency");
  clock = 1_000;
  assert.equal(breaker.state, "half_open");
  await assert.rejects(breaker.execute(async () => { throw transient(); }));
  assert.equal(breaker.state, "open", "a failed probe re-opens the breaker");
  clock = 2_000;
  assert.equal(await breaker.execute(async () => "ok"), "ok");
  assert.equal(breaker.state, "closed");
  assert.deepEqual(transitions, ["open", "half_open", "open", "half_open", "closed"]);
});

await check("failover never lets the backup win while the primary is healthy (no Promise.race)", async () => {
  let backupCalls = 0;
  const result = await failover([
    { name: "primary", timeoutMs: 200, run: async () => { await delay(20); return "primary-write"; } },
    { name: "backup", run: async () => { backupCalls += 1; return "backup-write"; } },
  ]);
  assert.deepEqual([result.value, result.target, result.failedOver], ["primary-write", "primary", false]);
  assert.equal(backupCalls, 0, "a slower but healthy primary is not raced against the backup");
});

await check("failover moves to the backup only after a real primary failure and reports it", async () => {
  const events = [];
  const order = [];
  const timedOut = await failover([
    { name: "primary", timeoutMs: 15, run: signal => new Promise((_, reject) => { order.push("primary"); signal.addEventListener("abort", () => reject(signal.reason)); }) },
    { name: "backup", run: async () => { order.push("backup"); return "backup-write"; } },
  ], { onFailover: event => events.push(`${event.from}->${event.to}:${event.reason}`) });
  assert.deepEqual(order, ["primary", "backup"], "targets run strictly in sequence");
  assert.deepEqual([timedOut.value, timedOut.target, timedOut.failedOver], ["backup-write", "backup", true]);
  assert.deepEqual(events, ["primary->backup:error"]);
  assert.equal(timedOut.failures[0].target, "primary");

  let backupCalls = 0;
  await assert.rejects(failover([
    { name: "primary", run: async () => { throw rejected("invalid master"); } },
    { name: "backup", run: async () => { backupCalls += 1; } },
  ]), /invalid master/);
  assert.equal(backupCalls, 0, "permanent errors surface instead of being replayed on the backup");
});

await check("failover honours health checks and open breakers before sending traffic", async () => {
  let primaryCalls = 0;
  const unhealthy = await failover([
    { name: "primary", healthCheck: async () => false, run: async () => { primaryCalls += 1; } },
    { name: "backup", run: async () => "backup" },
  ]);
  const hanging = await failover([
    { name: "primary", healthCheck: () => new Promise(() => {}), healthCheckTimeoutMs: 10, run: async () => { primaryCalls += 1; } },
    { name: "backup", run: async () => "backup" },
  ]);
  assert.equal(primaryCalls, 0);
  assert.equal(unhealthy.failures[0].reason, "unhealthy");
  assert.equal(hanging.target, "backup", "a hung health check is bounded and treated as unhealthy");
  const breaker = createCircuitBreaker({ failureThreshold: 1 });
  await assert.rejects(breaker.execute(async () => { throw transient(); }));
  const skipped = await failover([{ name: "primary", breaker, run: async () => { primaryCalls += 1; } }, { name: "backup", run: async () => "backup" }]);
  assert.equal(primaryCalls, 0);
  assert.equal(skipped.failures[0].reason, "circuit_open");
  await assert.rejects(failover([{ name: "a", run: async () => { throw transient(); } }, { name: "b", run: async () => { throw transient(); } }]), { name: "FailoverExhaustedError" });
});

await check("observability work is best-effort and never throws or blocks", async () => {
  const errors = [];
  assert.equal(await bestEffort(async () => { throw new Error("collector down"); }, { onError: error => errors.push(error.message) }), undefined);
  assert.equal(await bestEffort(() => new Promise(() => {}), { timeoutMs: 10 }), undefined);
  assert.deepEqual(errors, ["collector down"]);
});

await check("master storage verification distinguishes an outage from a missing object", async () => {
  const config = { bucket: "halo-masters", region: "us-east-1", accessKeyId: "test-key-id", secretAccessKey: "test-signing-value", endpoint: "", forcePathStyle: false };
  const respond = (status, length = 0) => ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-length": String(length) }) });
  const breaker = createCircuitBreaker({ name: "test-storage", failureThreshold: 2 });
  const statuses = [503, 200];
  const methods = [];
  assert.equal(await headStoredObject(config, "masters/a.wav", async (_url, init) => { methods.push(init.method); assert.ok(init.signal, "storage calls carry an abort signal"); return respond(statuses.shift(), 2048); }, { breaker, sleep: noSleep }), 2048);
  assert.deepEqual(methods, ["HEAD", "HEAD"], "transient storage errors are retried");
  assert.equal(await headStoredObject(config, "masters/missing.wav", async () => respond(404), { breaker, sleep: noSleep }), 0, "missing objects are reported as missing");
  for (let outage = 0; outage < 2; outage += 1) {
    await assert.rejects(headStoredObject(config, "masters/a.wav", async () => respond(503), { breaker, sleep: noSleep }), error => isTransientError(error));
  }
  assert.equal(masterStorageAvailable(breaker), false, "repeated outages open the storage breaker");
  await assert.rejects(headStoredObject(config, "masters/a.wav", async () => { throw new Error("should not be called"); }, { breaker, sleep: noSleep }), { code: "CIRCUIT_OPEN" });
});

// Browser upload helper: exercised in a sandbox with a scripted XMLHttpRequest.
const uploadProgressSource = await read("upload-progress.js");
function loadUploadHelper(script) {
  const sent = [];
  class FakeXhr {
    constructor() { this.upload = {}; this.status = 0; this.responseText = ""; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send(body) {
      sent.push(body);
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
    window,
    navigator: { onLine: true },
    XMLHttpRequest: FakeXhr,
    console,
    setTimeout: fn => { queueMicrotask(fn); return 0; },
    clearTimeout: () => {},
    Math,
    Number,
    Set,
    Promise,
    Object,
    Error,
    JSON,
  });
  return { helper: window.HaloUploadProgress, sent };
}

await check("chunk uploads retry network drops and 5xx responses because chunk writes are idempotent", async () => {
  const { helper, sent } = loadUploadHelper([{ network: true }, { status: 503 }, { status: 200 }, { status: 200 }]);
  const retries = [];
  const progress = [];
  const result = await helper.uploadChunkedFile({
    url: "/api/song-catalog/audio",
    file: { size: 8 },
    chunkSize: 4,
    buildBody: ({ chunkIndex }) => `chunk-${chunkIndex}`,
    onRetry: info => retries.push(`${info.chunkIndex}:${info.attempt}`),
    onProgress: percent => progress.push(percent),
  });
  assert.equal(result.chunkCount, 2);
  assert.deepEqual(sent, ["chunk-0", "chunk-0", "chunk-0", "chunk-1"], "the same chunk body is replayed, never a different part");
  assert.deepEqual(retries, ["0:1", "0:2"]);
  assert.equal(progress.at(-1), 100);
});

await check("chunk uploads surface permanent rejections immediately with a clear error", async () => {
  const { helper, sent } = loadUploadHelper([{ status: 413, body: { message: "Chunk too large" } }]);
  await assert.rejects(helper.uploadChunkedFile({ url: "/x", file: { size: 4 }, chunkSize: 4, buildBody: () => "c" }), error => error.message === "Chunk too large" && error.status === 413 && error.retryable === false);
  assert.equal(sent.length, 1);
});

await check("non-idempotent form posts do not replay on HTTP errors unless explicitly opted in", async () => {
  const { helper, sent } = loadUploadHelper([{ status: 503 }]);
  const response = await helper.sendFormDataWithRetry("/api/radio/submissions", "form", { retryDelays: [700, 1400] });
  assert.equal(response.status, 503);
  assert.equal(sent.length, 1, "a submission that may have committed is not silently duplicated");
});

await check("client failover runs the backup path only after a transient primary failure", async () => {
  const { helper } = loadUploadHelper([]);
  let fallbackCalls = 0;
  const fallback = async () => { fallbackCalls += 1; return "chunked"; };
  const healthy = await helper.runWithFailover({ primary: async () => "direct", fallback });
  assert.deepEqual([healthy.value, healthy.path, healthy.failedOver, fallbackCalls], ["direct", "primary", false, 0]);
  const notices = [];
  const switched = await helper.runWithFailover({ primary: async () => { throw Object.assign(new Error("dropped"), { retryable: true }); }, fallback, onFailover: error => notices.push(error.message) });
  assert.deepEqual([switched.value, switched.path, switched.failedOver, fallbackCalls], ["chunked", "fallback", true, 1]);
  assert.deepEqual(notices, ["dropped"]);
  await assert.rejects(helper.runWithFailover({ primary: async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }); }, fallback }), /Forbidden/);
  assert.equal(fallbackCalls, 1, "permanent failures are reported, not masked by the backup");
  let attempts = 0;
  assert.equal(await helper.retryTransient(async () => { attempts += 1; if (attempts < 2) throw Object.assign(new Error("verify later"), { status: 503, retryable: true }); return "registered"; }), "registered");
});

const [masterUpload, client, doc, packageText, resilienceSource] = await Promise.all([
  read("netlify/functions/song-catalog-master-upload.ts"),
  read("song-catalog/song-catalog.js"),
  read("RESILIENCE.md"),
  read("package.json"),
  read("netlify/lib/resilience.mjs"),
]);

await check("master upload endpoint health-gates direct storage and reports outages as retryable", () => {
  assert.ok(masterUpload.includes("if (!masterStorageAvailable())") && masterUpload.includes("degraded: true"), "presign steers new uploads to the backup path while storage is degraded");
  assert.ok(masterUpload.includes("isTransientError(error)") && masterUpload.includes("retryable: true"), "register returns a retryable 503 instead of a misleading 'not found'");
});

await check("song catalog master uploads fail over sequentially with informative UI states", () => {
  assert.ok(client.includes("uploadHelper.runWithFailover({primary:"));
  assert.ok(client.includes("fallback:file.size<=MAX_AUDIO_BYTES?()=>uploadAudioToVersion({file,songId,versionId,ui}):null"));
  assert.ok(client.includes("shouldFailover:error=>!error?.registration"), "a stored-but-unverified master is retried, not re-uploaded elsewhere");
  assert.ok(client.includes("switched to the backup upload path") && client.includes("Connection blip on part") && client.includes("You appear to be offline"));
});

await check("resilience strategy is documented and wired into the upload watchdog", () => {
  assert.doesNotMatch(resilienceSource, /Promise\.race\(/, "failover never uses Promise.race");
  for (const heading of ["User-facing requests", "Uploads and ingest", "Background jobs", "Storage", "Observability", "Promise.race"]) assert.ok(doc.includes(heading), `RESILIENCE.md covers ${heading}`);
  assert.ok(JSON.parse(packageText).scripts["upload-experience:watchdog"].includes("scripts/resilience-contracts.mjs"));
});

console.log(`Resilience contracts: ${passed} checks passed.`);
