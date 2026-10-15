import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

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
console.log("Upload progress contracts passed: 100 DOM writes for 100 progress events (previously 700); retries, recovery, and chunk ordering preserved.");
