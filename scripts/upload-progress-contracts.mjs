import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";

const source = await readFile(new URL("../upload-progress.js", import.meta.url), "utf8");
const writes = [];
const tracked = (name, value) => new Proxy(value, {
  set(target, key, next) {
    writes.push(`${name}.${String(key)}`);
    target[key] = next;
    return true;
  },
});
function element(name) {
  const attributes = new Map();
  const classes = new Set();
  return tracked(name, {
    hidden: false,
    textContent: "",
    dataset: tracked(`${name}.dataset`, {}),
    style: tracked(`${name}.style`, {}),
    getAttribute: key => attributes.get(key) ?? null,
    setAttribute(key, value) {
      writes.push(`${name}.${key}`);
      attributes.set(key, value);
    },
    classList: {
      contains: key => classes.has(key),
      toggle(key, enabled) {
        writes.push(`${name}.classList`);
        if (enabled) classes.add(key);
        else classes.delete(key);
      },
    },
  });
}

const requests = [];
const outcomes = [];
const delays = [];
class XMLHttpRequest {
  upload = {};
  headers = {};
  open(method, url, async) { Object.assign(this, { method, url, async }); }
  setRequestHeader(key, value) { this.headers[key] = value; }
  send(body) {
    this.body = body;
    requests.push(this);
    const outcome = outcomes.shift();
    assert.ok(outcome, "each request must have a scripted outcome");
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
      if (outcome === "error") return this.onerror();
      if (outcome === "timeout") return this.ontimeout();
      this.status = outcome.status;
      this.responseText = JSON.stringify(outcome.data);
      this.onload();
    });
  }
}
const window = {};
runInNewContext(source, {
  window, console, XMLHttpRequest,
  setTimeout(callback, delay) { delays.push(delay); callback(); },
});
const helper = window.HaloUploadProgress;
const panel = element("panel");
const status = element("status");
const track = element("track");
const fill = element("fill");
const ui = helper.createUploadUi({ panel, status, track, fill, idleMessage: "Ready" });
assert.equal(panel.dataset.uploadState, "idle");
assert.equal(panel.getAttribute("aria-busy"), "false");
assert.equal(track.hidden, true);
assert.equal(status.textContent, "Ready");
ui.start("Uploading");
assert.equal(fill.style.width, "3%");
assert.equal(panel.classList.contains("is-uploading"), true);
assert.equal(panel.getAttribute("aria-busy"), "true");
assert.equal(track.getAttribute("aria-hidden"), "false");

writes.length = 0;
for (let percent = 1; percent <= 100; percent += 1) ui.progress(percent);
assert.equal(writes.length, 100, "100 progress events should write only 100 bar widths, not 700 DOM fields");
assert.ok(writes.every(key => key === "fill.style.width"));
assert.equal(ui.state.progress, 100, "state updates must remain synchronous");
writes.length = 0;
ui.progress(100);
assert.equal(writes.length, 0, "duplicate progress events should not mutate the DOM");
ui.progress(150, "Finalizing");
assert.equal(fill.style.width, "100%");
assert.equal(status.textContent, "Finalizing");
ui.progress(-1);
assert.equal(fill.style.width, "3%", "keep the zero-progress visual indicator");
ui.fail("Connection stopped");
assert.equal(panel.dataset.uploadState, "error");
assert.equal(panel.getAttribute("aria-busy"), "false");
assert.equal(track.hidden, false);
assert.equal(status.textContent, "Connection stopped");
ui.start("Retrying");
assert.equal(ui.state.error, "");
assert.equal(panel.dataset.uploadState, "uploading");
ui.success("Saved");
assert.equal(fill.style.width, "100%");
assert.equal(panel.dataset.uploadState, "success");
assert.equal(track.hidden, true);
ui.success("Saved", true);
assert.equal(track.hidden, false);
ui.idle();
assert.equal(status.textContent, "Ready");
assert.equal(panel.classList.contains("is-uploading"), false);
ui.set({ message: "" });
assert.equal(status.textContent, "Ready", "empty messages must preserve existing copy");

// Check the actual DOM so external UI resets are repaired on the next update.
ui.progress(20, "Uploading");
fill.style.width = "0%";
panel.setAttribute("aria-busy", "false");
ui.progress(20);
assert.equal(fill.style.width, "20%");
assert.equal(panel.getAttribute("aria-busy"), "true");
const idleVisibleUi = helper.createUploadUi({ panel, status, track, fill, showTrackWhenIdle: true });
idleVisibleUi.idle();
assert.equal(track.hidden, false);

const body = {};
outcomes.push("error", "timeout", { status: 200, data: { saved: true } });
const response = await helper.sendFormDataWithRetry("/upload", body, {
  retryDelays: [10, 20], credentials: "include", headers: { Authorization: "test-only" }, timeoutMs: 500,
});
assert.equal(response.ok, true);
assert.deepEqual(delays, [10, 20]);
assert.ok(requests.every(request => request.body === body && request.withCredentials === true && request.timeout === 500));
assert.ok(requests.every(request => request.headers.Authorization === "test-only"));
outcomes.push({ status: 403, data: { message: "Not permitted" } });
const denied = await helper.sendFormDataWithRetry("/upload", body, { retryDelays: [10] });
assert.equal(denied.status, 403, "HTTP rejections must not be retried");
assert.equal(requests.length, 4);

const chunks = [];
const progress = [];
outcomes.push("error", { status: 200, data: {} }, { status: 200, data: {} });
const result = await helper.uploadChunkedFile({
  url: "/upload", file: { size: 5 }, chunkSize: 3, retryDelays: [30],
  buildBody(chunk) { chunks.push(chunk); return chunk; },
  onProgress(percent, chunk) { progress.push([percent, chunk.chunkIndex]); ui.progress(percent); },
});
assert.equal(result.chunkCount, 2);
assert.deepEqual(chunks.map(chunk => [chunk.chunkIndex, chunk.chunkCount, chunk.start, chunk.end]), [[0, 2, 0, 3], [1, 2, 3, 5]]);
assert.equal(requests[4].body, requests[5].body, "retries must reuse the same chunk body");
assert.deepEqual(progress, [[30, 0], [30, 0], [60, 0], [80, 1], [100, 1]]);
outcomes.push({ status: 400, data: { message: "Invalid file" } });
await assert.rejects(helper.uploadChunkedFile({
  url: "/upload", file: { size: 5 }, chunkSize: 3,
  buildBody: chunk => chunk,
}), /Invalid file/);
outcomes.push("timeout");
await assert.rejects(helper.sendFormData("/upload", body), /took too long/);
assert.equal(outcomes.length, 0);
assert.equal(helper.protocolVersion, 2);
const file = { size: 8, slice: (start, end) => ({ start, end }) };
const v2 = (uploadedBytes, extra = {}) => ({ protocolVersion: 2, generation: "initial", chunkSize: 4, uploadedBytes, phase: "uploading", ...extra });
const statusSequence = (...statuses) => async () => {
  assert.ok(statuses.length, "status reconciliation must stay bounded");
  return statuses.shift();
};
let sends = [];
const chunkGenerations = [];
const transferEvents = [];
await helper.uploadResumableFile({
  file, chunkSize: 4, retryDelays: [0, 0],
  getStatus: statusSequence(v2(0), v2(4), v2(4, { generation: "renewed", resetReason: "Storage session expired" }), v2(8, { generation: "renewed" })),
  sendChunk: async (chunk, start, end, onSent, generation) => { sends.push([start, end]); chunkGenerations.push(generation); onSent(1); },
  onProgress: (percent, detail) => transferEvents.push(detail),
});
assert.deepEqual(sends, [[0, 4], [4, 8]], "active-loop session renewal must retain confirmed bytes");
assert.deepEqual(chunkGenerations, ["initial", "renewed"], "chunks must carry the generation confirmed by their status read");
assert.ok(transferEvents.some(event => event.sentBytes > event.confirmedBytes), "sent bytes must not be represented as confirmed bytes");
sends = [];
await helper.uploadResumableFile({
  file, chunkSize: 4, retryDelays: [0, 0],
  getStatus: statusSequence(v2(4), v2(0, { generation: "reset", resetReason: "Object was evicted" }), v2(0, { generation: "reset" }), v2(4, { generation: "reset" }), v2(4, { generation: "reset" }), v2(8, { generation: "reset" })),
  sendChunk: async (chunk, start) => { sends.push(start); },
});
assert.deepEqual(sends, [4, 0, 4], "explicit new-generation reset must replay from the server's offset");
await assert.rejects(helper.uploadResumableFile({
  file, chunkSize: 4, getStatus: statusSequence(v2(4), v2(0)), sendChunk: async () => {},
}), /unexplained generation regression/);
await assert.rejects(helper.uploadResumableFile({
  file, chunkSize: 4, getStatus: async () => v2(0, { protocolVersion: 1, revision: "diagnostic-only" }), sendChunk: async () => {},
}), /protocol\/runtime mismatch.*diagnostic-only/);
await assert.rejects(helper.uploadResumableFile({
  file, chunkSize: 4, getStatus: async () => v2(0, { generation: null }), sendChunk: async () => {},
}), /protocol\/runtime mismatch/);
const transientProgress = [];
sends = [];
await helper.uploadResumableFile({
  file: { size: 4, slice: file.slice }, chunkSize: 4, retryDelays: [0],
  getStatus: statusSequence({ uploadedBytes: 0 }, { uploadedBytes: 0 }, { uploadedBytes: 4 }),
  sendChunk: async (chunk, start) => sends.push(start),
  onProgress: (percent, detail) => transientProgress.push(detail.state),
});
assert.deepEqual(sends, [0], "transient unconfirmed status must be reconciled before replaying bytes");
assert.ok(transientProgress.includes("reconnecting"));
const paused = [];
await assert.rejects(helper.uploadResumableFile({
  file, chunkSize: 4, retryDelays: [0], getStatus: async () => { throw new Error("Offline"); }, sendChunk: async () => {},
  onProgress: (percent, detail) => paused.push(detail.state),
}), /Reselect the same file and retry/);
assert.equal(paused.at(-1), "paused");
let replacedReads = 0;
await assert.rejects(helper.uploadResumableFile({
  file, chunkSize: 4, retryDelays: [0, 0],
  getStatus: async () => {
    replacedReads++;
    return helper.requireUploadResponse({ ok: false, status: 409, data: v2(0, { resetReason: "upload_replaced", replacementToken: "current-reference", message: "This upload was replaced." }) });
  },
  sendChunk: async () => assert.fail("replaced uploads must not replay chunks automatically"),
}), error => error.retryable === false && error.status === 409 && error.data.replacementToken === "current-reference");
assert.equal(replacedReads, 1, "replaced status requires explicit intent, not transient retry polling");
let completions = 0;
const registered = { persisted: true, audioUrl: "/saved" };
assert.equal(await helper.completeResumableUpload({
  getStatus: statusSequence(v2(8), v2(8, { phase: "complete", result: registered })),
  complete: async () => { completions++; throw new Error("Acknowledgement lost"); },
  retryDelays: [0],
}), registered);
assert.equal(completions, 1, "lost finalization acknowledgement must reconcile instead of registering twice");
assert.equal(await helper.completeResumableUpload({
  getStatus: statusSequence(v2(8), v2(8, { phase: "complete", result: registered })),
  complete: async () => { throw new Error("Last acknowledgement lost"); }, retryDelays: [],
}), registered, "the exhausted retry budget must still reconcile its last finalization request");
assert.equal(await helper.completeResumableUpload({
  getStatus: statusSequence(v2(8, { phase: "finalizing" }), v2(8, { phase: "complete", result: registered })),
  complete: async () => { throw new Error("must not finalize while already processing"); }, retryDelays: [0],
}), registered);
let completingRetries = 0;
assert.equal(await helper.completeResumableUpload({
  getStatus: statusSequence(v2(8, { phase: "completing" }), v2(8, { phase: "registered", result: registered })),
  complete: async () => { completingRetries++; throw new Error("Completing acknowledgement lost"); }, retryDelays: [0],
}), registered, "backend completing phase must retry completion idempotently and reconcile acknowledgement loss");
assert.equal(completingRetries, 1);
assert.equal(await helper.completeResumableUpload({
  getStatus: async () => v2(8, { phase: "completing" }),
  complete: async () => registered, retryDelays: [],
}), registered, "a stranded completing phase must recover through idempotent completion rather than polling forever");
let checkpointPhase = "completing";
let checkpointCompletions = 0;
assert.equal(await helper.completeResumableUpload({
  getStatus: async () => ({ phase: "completing" }),
  complete: async () => { checkpointCompletions++; checkpointPhase = "registered"; return registered; },
  retryDelays: [],
}), registered, "a persistent completing checkpoint must invoke the idempotent registration operation");
assert.equal(checkpointCompletions, 1);
assert.equal(checkpointPhase, "registered");
let resetTransfers = 0;
let resetCompletions = 0;
assert.equal(await helper.completeResumableUpload({
  byteSize: 8, generation: "initial",
  getStatus: statusSequence(v2(0, { generation: "renewed", resetReason: "storage_session_expired" }), v2(8, { generation: "renewed", phase: "completing" })),
  resume: async generation => { assert.equal(generation, "renewed"); resetTransfers++; return { uploadedBytes: 8, generation: "renewed" }; },
  complete: async generation => { assert.equal(generation, "renewed"); resetCompletions++; return registered; }, retryDelays: [0],
}), registered, "an explicit expiry reset during finalization must resume transfer before registration");
assert.equal(resetTransfers, 1);
assert.equal(resetCompletions, 1);
await assert.rejects(helper.completeResumableUpload({
  byteSize: 8, generation: "initial", getStatus: async () => v2(0),
  resume: async () => { throw new Error("must not resume an unexplained regression"); },
  complete: async () => registered, retryDelays: [],
}), /unexplained upload regression/);
let renewalCount = 0;
await assert.rejects(helper.completeResumableUpload({
  byteSize: 8, generation: "initial",
  getStatus: async () => v2(0, { generation: `reset-${++renewalCount}`, resetReason: "storage_session_expired" }),
  resume: async () => ({ uploadedBytes: 8, generation: `reset-${renewalCount}` }),
  complete: async () => { throw new Error("must not finalize while reset bytes are missing"); }, retryDelays: [],
}), /Reselect the same file and retry/);
assert.equal(renewalCount, 2, "active finalization resets must have a bounded renewal budget");
assert.equal(await helper.completeResumableUpload({
  getStatus: async () => v2(8, { phase: "review_pending", result: registered }),
  complete: async () => { throw new Error("must not re-register a persisted review-pending upload"); }, retryDelays: [],
}), registered);
await assert.rejects(helper.completeResumableUpload({
  getStatus: async () => v2(8, { phase: "review_pending", result: { persisted: false } }),
  complete: async () => { throw new Error("must not claim unpersisted review-pending success"); }, retryDelays: [],
}), /protocol\/runtime mismatch/);
await assert.rejects(helper.completeResumableUpload({
  getStatus: async () => v2(8), complete: async () => ({ protocolVersion: 2, persisted: false }), retryDelays: [],
}), /protocol\/runtime mismatch/);
const legacyCompleted = { saved: true };
assert.equal(await helper.completeResumableUpload({
  getStatus: async () => ({ phase: "transferring" }), complete: async () => legacyCompleted,
}), legacyCompleted, "generic completion helpers that omit protocol remain compatible");
for (const httpStatus of [408, 429, 503]) {
  const before = delays.length;
  let attempts = 0;
  await helper.completeResumableUpload({
    getStatus: async () => v2(8),
    complete: async () => {
      if (!attempts++) helper.requireUploadResponse({ ok: false, status: httpStatus, retryAfterMs: 999999 });
      return registered;
    }, retryDelays: [10],
  });
  assert.equal(attempts, 2);
  assert.equal(delays[before], 30000, "Retry-After must be bounded");
}
const jitterStart = delays.length;
let jitterAttempts = 0;
await helper.completeResumableUpload({
  getStatus: async () => v2(8), retryDelays: [100],
  complete: async () => { if (!jitterAttempts++) throw new Error("Offline"); return registered; },
});
assert.ok(delays[jitterStart] >= 75 && delays[jitterStart] <= 125, "resumable retries must use jitter");
ui.transfer(25, { confirmedPercent: 25, sentPercent: 50 });
assert.equal(fill.style.width, "25%");
assert.equal(status.textContent, "50% sent · 25% confirmed");
ui.transfer(25, { state: "reconnecting", confirmedPercent: 25 });
assert.equal(panel.dataset.uploadState, "reconnecting");
ui.transfer(25, { state: "paused", confirmedPercent: 25 });
assert.equal(panel.dataset.uploadState, "paused");
assert.match(status.textContent, /Reselect the same file/);
ui.transfer(25, { state: "resuming", confirmedPercent: 25 });
assert.equal(panel.dataset.uploadState, "resuming");
assert.match(status.textContent, /Resuming saved upload/);

const networkWindow = {};
const fetchRequests = [];
let fetchStatuses = [v2(0, { chunkSize: 4 * 1024 * 1024 }), v2(4, { chunkSize: 4 * 1024 * 1024 })];
runInNewContext(source, {
  window: networkWindow, console, XMLHttpRequest, crypto: webcrypto, TextEncoder, URLSearchParams,
  AbortController, setTimeout, clearTimeout,
  fetch: async (url, options) => {
    fetchRequests.push({ url, options });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => fetchStatuses.shift() };
  },
});
outcomes.push({ status: 200, data: {} });
const audio = new Blob(["data"]);
Object.defineProperty(audio, "name", { value: "test.mp3" });
await networkWindow.HaloUploadProgress.uploadResumableAudio({ file: audio, songId: "song", versionId: "version", contentType: "audio/mpeg" });
assert.ok(fetchRequests.every(request => request.options.headers["X-Upload-Protocol"] === "2"));
assert.equal(requests.at(-1).headers["X-Upload-Protocol"], "2");
assert.equal(requests.at(-1).headers["X-Upload-Generation"], "initial");
assert.equal(fetchRequests.at(-1).options.headers["X-Upload-Generation"], "initial");
assert.equal(requests.at(-1).timeout, 600000, "slow audio chunks must have a ten-minute timeout");
const buildRevision = "1234567890abcdef1234567890abcdef12345678";
networkWindow.HaloUploadBuild = { protocolVersion: 2, revision: buildRevision };
fetchStatuses = [v2(0, { chunkSize: 4 * 1024 * 1024, revision: buildRevision }), v2(4, { chunkSize: 4 * 1024 * 1024, revision: buildRevision })];
outcomes.push({ status: 200, data: { protocolVersion: 2, revision: buildRevision } });
await networkWindow.HaloUploadProgress.uploadResumableAudio({ file: audio, songId: "song", versionId: "version", contentType: "audio/mpeg" });
assert.equal(requests.at(-1).headers["X-Upload-Revision"], buildRevision);
assert.equal(fetchRequests.at(-1).options.headers["X-Upload-Revision"], buildRevision);
assert.equal(fetchRequests.at(-1).options.headers["X-Upload-Protocol"], "2");
outcomes.push({ status: 200, data: {} });
await networkWindow.HaloUploadProgress.sendFormData("https://storage.example.test/presigned", audio, { method: "PUT", credentials: "omit" });
assert.equal(requests.at(-1).headers["X-Upload-Revision"], undefined, "build revision must never be sent to storage");
assert.equal(requests.at(-1).headers["X-Upload-Protocol"], undefined, "storage requests must not receive owned API protocol headers");
fetchStatuses = [v2(0, { chunkSize: 4 * 1024 * 1024, revision: "different-server-revision" })];
await assert.rejects(networkWindow.HaloUploadProgress.getAudioUploadStatus({ file: audio, songId: "song", versionId: "version", uploadId: "id", contentType: "audio/mpeg" }), /protocol\/runtime mismatch.*different-server-revision/);
fetchStatuses = [v2(0, { chunkSize: 4 * 1024 * 1024, revision: null })];
await assert.rejects(networkWindow.HaloUploadProgress.getAudioUploadStatus({ file: audio, songId: "song", versionId: "version", uploadId: "id", contentType: "audio/mpeg" }), /protocol\/runtime mismatch/);
assert.throws(() => networkWindow.HaloUploadProgress.requireUploadResponse({ ok: true, data: { protocolVersion: 2, revision: "other-result-revision" } }), /protocol\/runtime mismatch/);
networkWindow.HaloUploadBuild = { protocolVersion: 1, revision: buildRevision };
await assert.rejects(networkWindow.HaloUploadProgress.sendFormData("/api/song-catalog/audio", audio), /protocol\/runtime mismatch/);
const renamedAudio = new Blob(["data"]);
Object.defineProperty(renamedAudio, "name", { value: "renamed.mp3" });
assert.equal(await networkWindow.HaloUploadProgress.fileUploadId(audio, ["intake-audio"], 4),
  await networkWindow.HaloUploadProgress.fileUploadId(renamedAudio, ["intake-audio"], 4), "intake identity must depend on content, not editable names");
const timeoutWindow = {};
runInNewContext(source, {
  window: timeoutWindow, console, AbortController, setTimeout, clearTimeout,
  fetch: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })))),
});
await assert.rejects(timeoutWindow.HaloUploadProgress.fetchJsonWithTimeout("/status", {}, 5), /timed out/);
console.log("Upload progress contracts passed: 100 DOM writes for 100 progress events (previously 700); retries, recovery, and chunk ordering preserved.");
