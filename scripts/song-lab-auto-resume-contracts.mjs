import assert from "node:assert/strict";
import { runCheckpointedUpload, requestUploadJson, isTransientUploadError, dispatchSongLabBuild } from "../dreamweaver-lab/resumable-upload.js";
import { initializeDreamweaverUploadPanel } from "../song-catalog/dreamweaver-upload-panel.js";

const session = { autoResume: true };
const delays = [], checkpoints = [];
let calls = 0;
const result = await runCheckpointedUpload(async () => {
  if (++calls < 4) throw Object.assign(new Error("Gateway"), { status: 502 });
  return "complete";
}, { session, wait: async ms => delays.push(ms), checkpoint: async () => checkpoints.push(session.autoRestarts) });
assert.equal(result, "complete");
assert.equal(calls, 4);
assert.deepEqual(delays, [2000, 4000, 8000]);
assert.deepEqual(checkpoints, [1, 2, 3]);
calls = 0;
await assert.rejects(runCheckpointedUpload(async () => {
  calls++; throw Object.assign(new Error("Still unavailable"), { status: 502 });
}, { session, wait: async () => {} }), /Still unavailable/);
assert.equal(calls, 1, "persisted exhausted recovery budget does not reset on reload");

const transient = Object.assign(new Error("Gateway"), { status: 502 });
for (const code of [401, 403, 409, 413, 422]) {
  calls = 0;
  await assert.rejects(runCheckpointedUpload(async () => { calls++; throw Object.assign(new Error("Invalid"), { status: code }); }, {
    session: { autoResume: true }, wait: async () => {},
  }));
  assert.equal(calls, 1, "auth and validation failures require user action");
}
assert.equal(isTransientUploadError(Object.assign(new Error("Paused"), { name: "PausedUploadError" })), false);
let continuing = true;
await assert.rejects(runCheckpointedUpload(async () => { throw transient; }, {
  session: { autoResume: true }, wait: async () => { continuing = false; }, canContinue: () => continuing,
}), /Upload paused/);
await assert.rejects(runCheckpointedUpload(async () => { throw transient; }, {
  session: { autoResume: true }, wait: async () => {}, online: () => false,
}), /Offline/);
await assert.rejects(runCheckpointedUpload(async () => { throw transient; }, {
  session: { autoResume: false }, wait: async () => { assert.fail("Disabled recovery must not wait"); },
}), /Gateway/);
await assert.rejects(requestUploadJson({}, {}, async () => new Response("<html>Bad Gateway</html>", { status: 502 })), error => {
  assert.equal(error.status, 502); assert.equal(isTransientUploadError(error), true); return true;
});
await assert.rejects(requestUploadJson({}, {}, async () => new Response("<html>Unauthorized</html>", { status: 401 })), error => {
  assert.equal(error.status, 401); assert.equal(isTransientUploadError(error), false); return true;
});
assert.equal(await dispatchSongLabBuild("fixture-project", {}, async (url, options) => {
  assert.equal(url, "/api/dreamweaver-song-lab-background");
  assert.equal(options.credentials, "same-origin");
  assert.equal(JSON.parse(options.body).projectId, "fixture-project");
  return new Response(null, { status: 202 });
}), undefined, "empty gateway acknowledgment is not a project readiness result");
await assert.rejects(dispatchSongLabBuild("fixture-project", {}, async () => new Response("gateway", { status: 502 })), error => {
  assert.equal(isTransientUploadError(error), true); return true;
});

// Iframe workflow status is origin/source checked and never substitutes for audio readiness.
const listeners = new Map();
const host = { location: { origin: "https://halo.test" }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
const disclosure = { open: false, addEventListener() {} }, status = { textContent: "" };
const frame = { contentWindow: {}, ownerDocument: { defaultView: host }, addEventListener() {}, removeAttribute() {} };
const panel = initializeDreamweaverUploadPanel({ disclosure, status, frame });
panel.show();
const message = { origin: host.location.origin, source: frame.contentWindow, data: { type: "halo:song-lab-progress", stage: "uploading", percent: 67 } };
listeners.get("message")(message);
assert.equal(status.textContent, "Song Lab private upload: 67%.");
for (const invalid of [
  { ...message, origin: "https://attacker.test" },
  { ...message, source: {} },
  { ...message, data: { ...message.data, percent: 500 } },
  { ...message, data: { ...message.data, stage: "<script>" } },
]) {
  listeners.get("message")(invalid);
  assert.equal(status.textContent, "Song Lab private upload: 67%.");
}
listeners.get("message")({ ...message, data: { ...message.data, stage: "ready" } });
assert.match(status.textContent, /does not approve a catalog master/);
assert.equal(host.HALO_STREAM_READY, undefined);
panel.reset();
listeners.get("message")(message);
assert.match(status.textContent, /Sign in and expand/);
panel.dispose();
assert.equal(listeners.size, 0);
console.log("Song Lab automatic recovery contracts passed: bounded persisted budget, 502 HTML handling, pause/offline/auth safety, and iframe status isolation.");
