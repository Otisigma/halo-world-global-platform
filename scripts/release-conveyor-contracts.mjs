import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { RELEASE_STAGES, runReleaseConveyor, validateRelease, councilDecision, releaseFingerprint } from "../netlify/lib/release-conveyor.mjs";
import { conditionReleaseWav } from "../netlify/lib/release-audio.mjs";
import { createReleaseConveyorHandler } from "../netlify/lib/release-conveyor-http.mjs";
import { prepareReleaseAudio } from "../netlify/lib/release-conveyor-audio.mjs";
import { createReleaseConveyorConsole } from "../lib/release-conveyor-ui.js";
import "./halo-watchdog-contracts.mjs";

const packageScripts = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).scripts;
for (const [script, command] of [
  ["test", "node scripts/release-watchdog-contracts.mjs"],
  ["test", "node scripts/halo-master-orchestrator-contracts.mjs"],
  ["test:release-conveyor", "node scripts/release-watchdog-contracts.mjs"],
  ["test:release-conveyor", "node scripts/halo-master-orchestrator-contracts.mjs"],
]) {
  assert.equal(packageScripts[script].split(" && ").filter(step => step === command).length, 1,
    `${command} runs exactly once in ${script}`);
}
assert.doesNotMatch(packageScripts.posttest, /test:master-orchestrator/,
  "posttest must not duplicate the master-orchestrator contract from test");

const song = { id: "12345678-1234-4123-8123-123456789012", owner_member_id: "creator",
  title: "A Signal", artist_name: "Artist", genre: "Soul", isrc: "GB-AAA-26-00001",
  rights_status: "cleared", sale_status: "for_sale", sale_price_cents: 129,
  artwork_url: "/cover.jpg", lyrics_text: "[00:01] A signal || Written at dawn\nAn untimed line",
  metadata_issues: [], notes: "Recorded at dawn." };
const versions = [
  { id: "master", song_id: song.id, version_type: "sale_master", audio_url: "/master.wav", mastering_status: "approved", duration_seconds: 180 },
  { id: "radio", song_id: song.id, version_type: "radio_edit", audio_url: "/radio.wav", mastering_status: "approved", duration_seconds: 180 },
];
const approvedMasterStatus = { uploaded: true, durationValid: true, masteringStatus: "approved" };
const audio = { summary: "Original preserved.", originalPreserved: true, issues: [], repairs: ["5 ms micro-fade applied to a separate copy."] };
let checkpoints = [], handoffs = 0, attempts = 0;
const ports = {
  prepareAudio: async () => { attempts++; return structuredClone(audio); },
  checkpoint: async state => checkpoints.push(structuredClone(state)),
  finish: async () => {}, assertCurrent: async () => {},
  handoff: async () => { handoffs++; return { status: "ready_for_publication", externalDistribution: "not_submitted" }; },
};
const run = async (changes = {}) => runReleaseConveyor({ song, versions, ports, ...changes });
const success = await run();
assert.equal(success.status, "ready");
assert.deepEqual(success.receipt.passed, RELEASE_STAGES);
assert.equal(success.package.council.outcome, "repair");
assert.equal(success.package.dreamweaver.lyrics.lines[0].time, 1);
assert.equal(success.package.dreamweaver.lyrics.lines[0].insight, "Written at dawn");
assert.equal(success.package.dreamweaver.lyrics.untimedCount, 1);
assert.equal(success.package.documents.isrc, "GBAAA2600001");
assert.equal(success.package.documents.releaseId, song.id);
assert.match(success.package.promotion.socialCopy, /song=12345678/);
assert.doesNotMatch(success.package.promotion.socialCopy, /undefined/);
for (const field of ["visualManifest", "alternateVisualManifests"]) {
  assert.equal(Object.hasOwn(success.package, field), false);
  assert.equal(Object.hasOwn(success.package.promotion, field), false);
}
assert.equal(success.package.handoff.externalDistribution, "not_submitted");
const rerun = await run({ previous: success });
assert.deepEqual(rerun, success);
assert.equal(attempts, 1);
assert.equal(handoffs, 1);
const missing = await run({ song: { ...song, isrc: "", title: "" } });
assert.equal(missing.status, "blocked");
assert(missing.receipt.blocked.some(item => item.field === "isrc"));
assert.equal(missing.package.promotion, undefined);
assert.equal(handoffs, 1);
for (const [rights, status, outcome] of [["disputed", "blocked", "block"], ["needs_review", "escalated", "escalate"], ["", "escalated", "escalate"]]) {
  const result = await run({ song: { ...song, rights_status: rights } });
  assert.equal(result.status, status);
  assert.equal(result.package.council.outcome, outcome);
  assert.equal(result.receipt.ready, false);
}
assert.equal(councilDecision([]).outcome, "pass");
assert.equal(councilDecision([{ outcome: "repair" }]).passed, false);
assert(validateRelease(song, versions.map(version => ({ ...version, mastering_status: "review" }))).issues.some(item => item.field === "radio_master"));
const book = await run({ song: { ...song, lyrics_text: "Read my story || An insight" } });
assert.equal(book.package.dreamweaver.mode, "book");
checkpoints = [];
let failOnce = true;
const failingPorts = { ...ports, handoff: async () => { if (failOnce) { failOnce = false; throw new Error("private database detail"); } return ports.handoff(); } };
const failed = await run({ ports: failingPorts });
assert.equal(failed.status, "retryable");
assert.equal(failed.receipt.retryable, true);
assert.doesNotMatch(JSON.stringify(failed), /private database detail/);
const beforeRetry = attempts;
const recovered = await run({ previous: failed, ports: failingPorts });
assert.equal(recovered.status, "ready");
assert.equal(attempts, beforeRetry, "completed audio must not run again");
assert.deepEqual(recovered.package.promotion, success.package.promotion);
const changed = await run({ previous: success, song: { ...song, notes: "Updated story" } });
assert.notEqual(changed.inputHash, success.inputHash);
assert.equal(changed.package.documents.notes, "Updated story");
assert.doesNotMatch(changed.package.promotion.pressWriteup, /Updated story/, "internal notes are not public promotion");
assert.notEqual(releaseFingerprint(song, versions), releaseFingerprint(song, versions, { humHz: 50 }));
const stale = await run({ ports: { ...ports, assertCurrent: async () => { throw new Error("changed"); } } });
assert.equal(stale.status, "retryable");
assert.equal(stale.package.handoff, undefined);

function wav({ rate = 48000, bits = 16, channels = 2, hz = 440, amplitude = 0.8 } = {}) {
  const frames = rate / 5;
  const stride = bits / 8;
  const bytes = Buffer.alloc(44 + frames * channels * stride);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * stride, 28);
  bytes.writeUInt16LE(channels * stride, 32); bytes.writeUInt16LE(bits, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let frame = 0; frame < frames; frame++) {
    const sample = Math.round(Math.cos(2 * Math.PI * hz * frame / rate) * amplitude * (2 ** (bits - 1) - 1));
    for (let channel = 0; channel < channels; channel++) bytes.writeIntLE(sample, 44 + (frame * channels + channel) * stride, stride);
  }
  return bytes;
}
for (const bits of [16, 24, 32]) {
  const original = wav({ bits });
  const saved = Buffer.from(original);
  const conditioned = conditionReleaseWav(original);
  assert.deepEqual(original, saved, "the source must never be mutated");
  assert.equal(conditioned.bytes.length, original.length);
  assert.equal(conditioned.bytes.readIntLE(44, bits / 8), 0, "fade starts at zero");
  assert(conditioned.report.samplePeakDbfs <= -1.49);
  assert.equal(conditioned.report.originalPreserved, true);
  assert.equal(conditioned.report.humHz, 0, "notch filtering must be opt-in");
}
const hum = wav({ hz: 50, amplitude: 0.1, channels: 1 });
const filtered = conditionReleaseWav(hum, { humHz: 50 });
assert.equal(filtered.report.humHz, 50);
assert(filtered.report.rmsDbfs < conditionReleaseWav(hum).report.rmsDbfs);
assert.throws(() => conditionReleaseWav(wav({ amplitude: 0 })), /silent/);
assert.throws(() => conditionReleaseWav(Buffer.from("not audio")), /PCM WAV/);
assert.throws(() => conditionReleaseWav(wav(), { humHz: 70 }), /Hum filtering/);
const truncated = wav().subarray(0, 100);
assert.throws(() => conditionReleaseWav(truncated), /incomplete/);

const approvedExternal = await prepareReleaseAudio(song, versions, "revision", { humHz: 0 });
assert.equal(approvedExternal.conditioning, "external_master");
assert.deepEqual(approvedExternal.issues, []);
const pendingMaster = await prepareReleaseAudio(song, versions.map(version => ({ ...version, mastering_status: "review" })), "revision", { humHz: 0 });
assert(pendingMaster.issues.some(item => /approve sale-master/.test(item.message)));
const missingAudio = await prepareReleaseAudio(song, [], "revision", { humHz: 0 });
assert(missingAudio.issues.some(item => /exactly one active canonical/.test(item.message)));
const unsupportedHum = await prepareReleaseAudio(song, versions, "revision", { humHz: 60 });
assert(unsupportedHum.issues.some(item => /requires a stored PCM WAV/.test(item.message)));
for (const source of [{ audio_byte_size: 150 * 1024 * 1024, audio_storage_key: `masters/${song.owner_member_id}/${song.id}/master/upload/master.wav` }, { audio_byte_size: 0 }]) {
  const externalWavVersions = versions.map(version => ({ ...version, audio_content_type: "audio/wav", ...source }));
  const externalWav = await prepareReleaseAudio(song, externalWavVersions, "revision", { humHz: 0 });
  assert.equal(externalWav.conditioning, "external_master", "approved large/link-only WAVs can complete without automatic conditioning");
  assert.deepEqual(externalWav.issues, []);
  const needsFilter = await prepareReleaseAudio(song, externalWavVersions, "revision", { humHz: 50 });
  assert(needsFilter.issues.length > 0, "an unsatisfied filter request must still escalate");
}

class ConsoleElement extends EventTarget {
  constructor() { super(); this.children = []; this.value = "0"; this.hidden = false; this.disabled = false; this.textContent = ""; this.style = {}; this.attributes = new Map(); }
  replaceChildren() { this.children = []; }
  append(item) { this.children.push(item); }
  setAttribute(name, value) { this.attributes.set(name, value); }
}
const consoleNodes = new Map();
const consoleRoot = new ConsoleElement();
consoleRoot.querySelector = selector => {
  if (!consoleNodes.has(selector)) consoleNodes.set(selector, new ConsoleElement());
  return consoleNodes.get(selector);
};
let resolveConsoleRequest;
const consoleRequests = [];
const consoleFetch = (url, options) => {
  consoleRequests.push({ url, options });
  return new Promise(resolve => { resolveConsoleRequest = resolve; });
};
let consoleTimer;
const controller = createReleaseConveyorConsole({
  root: consoleRoot, doc: { createElement: () => new ConsoleElement() }, fetcher: consoleFetch,
  setTimer: callback => { consoleTimer = callback; return callback; },
  clearTimer: callback => { if (consoleTimer === callback) consoleTimer = null; },
});
const consoleNode = key => consoleNodes.get(`[data-conveyor-${key}]`);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
controller.select(song.id);
assert.equal(consoleNode("percent-text").textContent, "0% Completed (0/8 stages)");
assert.equal(consoleNode("stages").children.length, RELEASE_STAGES.length);
assert.equal(consoleNode("hum").disabled, true, "filter selection is disabled during a request");
resolveConsoleRequest({ ok: true, json: async () => ({ ...success, masterStatus: approvedMasterStatus, options: { humHz: 0 },
  orchestrator: {
    state: { status: "needs_review", lastPulseAt: "2026-10-15T00:00:00.000Z", departments: { metadata_rights: "needs_review" },
      actions: [{ action: "radio_lane_queued" }], findings: ["Rights clearance requires creator review."] },
    infrastructure: { status: "degraded", brokenRoutes: [{ name: "Radio", route: "/radio/", httpStatus: 404 }] },
  },
  watchdog: {
    issues: [{ field: "route", message: "/toolost/: unavailable" }],
    findings: [{ field: "infrastructure", message: "/radio/: broken <b>route</b>" }],
  },
  receipt: { ...success.receipt, blocked: [{ field: "isrc", message: "Creator review required" }] } }) });
await settle();
assert.equal(consoleNode("hum").disabled, false);
assert.equal(consoleNode("package").hidden, false);
assert.equal(consoleNode("percent-text").textContent, "100% Completed (8/8 stages)", "repaired stages count as passed");
assert.equal(consoleNode("progress-bar").style.width, "100%");
assert.equal(consoleNode("progress").attributes.get("aria-valuenow"), "100");
assert.equal(consoleNode("current-step").textContent, "Active Dept: Complete");
assert.equal(consoleNode("status-badge").textContent, "FULLY CLEARED");
assert.equal(consoleNode("master-status").textContent, "Sale master uploaded · Mastering approved (saved)");
assert.equal(consoleNode("master-status").attributes.get("data-state"), "passed");
assert.deepEqual(consoleNode("issues").children.map(item => item.textContent), [
  "isrc: Creator review required",
  "route: /toolost/: unavailable",
  "infrastructure: /radio/: broken <b>route</b>",
], "blocked issues and both watchdog diagnostic formats remain visible as text");
assert(consoleNode("stages").children.every(item => item.attributes.get("data-state") === "passed"));
assert.match(consoleNode("watchdog-status").textContent, /Shared watchdog: needs_review/);
assert(consoleNode("watchdog-findings").children.some(item => /Repair recorded: radio_lane_queued/.test(item.textContent)));
assert(consoleNode("watchdog-findings").children.some(item => /Broken route: Radio \(\/radio\/\) — HTTP 404/.test(item.textContent)));
let poll = consoleTimer();
resolveConsoleRequest({ ok: true, json: async () => missing });
await poll;
assert.equal(consoleNode("percent-text").textContent, "25% Completed (2/8 stages)");
assert.match(consoleNode("current-step").textContent, /METADATA RIGHTS \(blocked\)/);
assert.equal(consoleNode("status-badge").textContent, "ESCALATED / BLOCKED");
assert.deepEqual(consoleNode("stages").children.map(item => item.attributes.get("data-state")),
  ["passed", "passed", "blocked", "blocked", "pending", "pending", "pending", "pending"]);
poll = consoleTimer();
resolveConsoleRequest({ ok: true, json: async () => failed });
await poll;
assert.match(consoleNode("current-step").textContent, /DISTRIBUTION HANDOFF \(blocked\)/, "failed departments render as blocked");
assert.equal(consoleNode("progress-bar").style.width, "88%");
consoleNode("run").dispatchEvent(new Event("click"));
assert.equal(consoleNode("hum").disabled, true);
const resolveProcessing = resolveConsoleRequest;
poll = consoleTimer();
assert.equal(consoleRequests.at(-1).options.credentials, "same-origin");
assert.equal(consoleRequests.at(-1).options.method, undefined, "polling only reads status");
resolveConsoleRequest({ ok: true, json: async () => ({
  status: "processing", busy: true, stages: [{ name: "intake", status: "passed" }], options: { humHz: 60 },
}) });
await poll;
assert.equal(consoleNode("percent-text").textContent, "13% Completed (1/8 stages)", "partial checkpoints retain the full denominator");
assert.match(consoleNode("current-step").textContent, /AUDIO PREFLIGHT \(pending\)/);
assert.equal(consoleNode("status-badge").textContent, "PROCESSING");
assert.equal(consoleNode("hum").disabled, true, "live reads do not unlock processing controls");
assert.equal(consoleNode("hum").value, "0", "live reads cannot change the filter during a foreground request");
// Even a programmatic change cannot leave options mismatched with a returned package.
consoleNode("hum").value = "50";
poll = consoleTimer();
const resolveOlderPoll = resolveConsoleRequest;
resolveProcessing({ ok: true, json: async () => ({ ...success, options: { humHz: 0 } }) });
await settle();
resolveOlderPoll({ ok: true, json: async () => ({ status: "processing", stages: [] }) });
await poll;
assert.equal(consoleNode("status-badge").textContent, "FULLY CLEARED", "late checkpoints cannot overwrite a completed request");
assert.equal(consoleNode("hum").value, "0");
consoleNode("hum").value = "50";
consoleNode("hum").dispatchEvent(new Event("change"));
assert.equal(consoleNode("package").hidden, true);
assert.equal(consoleNode("audio").hidden, true);
assert.equal(consoleNode("percent-text").textContent, "0% Completed (0/8 stages)");
assert.equal(consoleNode("status-badge").textContent, "NEEDS RERUN");
assert.match(consoleNode("master-status").textContent, /needs refresh/);
assert.equal(consoleNode("master-status").attributes.get("data-state"), "pending");
assert.equal(consoleTimer, null, "automatic refresh cannot clear unsaved filter changes");
consoleNode("refresh").dispatchEvent(new Event("click"));
resolveConsoleRequest({ ok: false, json: async () => ({ message: "Connection interrupted." }) });
await settle();
assert.equal(consoleNode("package").hidden, true);
assert.equal(consoleNode("documents").hidden, true);
assert.equal(consoleNode("progress-bar").style.width, "0%");
assert.equal(consoleNode("status-badge").textContent, "RETRY SCHEDULED");
assert.match(consoleNode("master-status").textContent, /status unavailable/);
assert.equal(consoleNode("master-status").attributes.get("data-state"), "pending");
poll = consoleTimer();
resolveConsoleRequest({ ok: true, json: async () => ({
  status: "processing", stages: [null, { name: "intake", status: "unknown" },
    { name: "<img src=x onerror=alert(1)>", status: "passed" },
    { name: "audio_preflight", status: "pending", detail: "<b>Untrusted detail</b>" }],
}) });
await poll;
assert.equal(consoleNode("percent-text").textContent, "0% Completed (0/8 stages)");
assert.match(consoleNode("stages").children[1].textContent, /<b>Untrusted detail<\/b>/, "details remain text, never HTML");
poll = consoleTimer();
controller.select("");
resolveConsoleRequest({ ok: true, json: async () => ({ ...success, masterStatus: approvedMasterStatus }) });
await poll;
assert.equal(consoleNode("progress-bar").style.width, "0%", "late responses cannot leak another song's progress");
assert.equal(consoleNode("current-step").textContent, "Active Dept: Select a song");
assert.equal(consoleNode("master-status").textContent, "Sale master status: select a song.");
assert.equal(consoleTimer, null, "deselecting stops polling");
controller.select(song.id);
resolveConsoleRequest({ ok: true, json: async () => ({ status: "not_started", receipt: null }) });
await settle();
assert.equal(consoleNode("status-badge").textContent, "PENDING", "pending is not blocked");
assert.equal(consoleNode("percent-text").textContent, "0% Completed (0/8 stages)");
consoleNode("hum").value = "0";
consoleNode("refresh").dispatchEvent(new Event("click"));
resolveConsoleRequest({ ok: true, json: async () => ({ status: "processing", busy: true, options: { humHz: 50 } }) });
await settle();
assert.equal(consoleNode("hum").value, "0");
poll = consoleTimer();
resolveConsoleRequest({ ok: true, json: async () => ({ ...success, options: { humHz: 50 } }) });
await poll;
assert.equal(consoleNode("hum").value, "50", "completed background runs synchronize the filter with the displayed package");
for (const [masterStatus, text, color] of [
  [approvedMasterStatus, "Sale master uploaded · Mastering approved (saved)", "passed"],
  [{ ...approvedMasterStatus, masteringStatus: "review" }, "Sale master uploaded · Mastering in review (saved)", "blocked"],
  [{ ...approvedMasterStatus, masteringStatus: "not_started" }, "Sale master uploaded · Mastering unfinished (not started) (saved)", "blocked"],
  [{ ...approvedMasterStatus, masteringStatus: "queued" }, "Sale master uploaded · Mastering unfinished (queued) (saved)", "blocked"],
  [{ ...approvedMasterStatus, masteringStatus: "in_progress" }, "Sale master uploaded · Mastering unfinished (in progress) (saved)", "blocked"],
  [{ uploaded: false, durationValid: false, masteringStatus: "unknown" }, "Sale master missing · Mastering status unavailable", "blocked"],
  [{ ...approvedMasterStatus, durationValid: false }, "Sale master uploaded · Valid duration missing · Mastering approved (saved)", "blocked"],
  [{ ...approvedMasterStatus, uploaded: false }, "Sale master missing · Mastering approved (saved)", "blocked"],
  [{ ...approvedMasterStatus, masteringStatus: "<b>approved</b>" }, "Sale master uploaded · Mastering status unavailable", "pending"],
  [{ ...approvedMasterStatus, masteringStatus: "__proto__" }, "Sale master uploaded · Mastering status unavailable", "pending"],
  [undefined, "Sale master / mastering status unavailable · Refresh to check.", "pending"],
]) {
  poll = consoleTimer();
  resolveConsoleRequest({ ok: true, json: async () => ({ status: "not_started", masterStatus }) });
  await poll;
  assert.equal(consoleNode("master-status").textContent, text, "master status is accessible text, not color alone");
  assert.equal(consoleNode("master-status").attributes.get("data-state"), color);
  assert.equal(consoleNode("progress-bar").style.width, "0%", "master approval alone never completes pipeline stages");
  assert.equal(consoleNode("status-badge").textContent, "PENDING");
  assert.equal(consoleNode("package").hidden, true);
}
for (const response of [
  { ok: true, json: async () => ({ ...success, status: "stale", masterStatus: approvedMasterStatus }) },
  { ok: true, json: async () => ({ status: "retryable", masterStatus: approvedMasterStatus }) },
  { ok: false, json: async () => ({ ...success, masterStatus: approvedMasterStatus }) },
  { ok: true, json: async () => { throw new Error("Connection lost"); } },
]) {
  poll = consoleTimer();
  resolveConsoleRequest(response);
  await poll;
  assert.equal(consoleNode("master-status").attributes.get("data-state"), "pending", "stale/unavailable data must never remain green");
  assert.doesNotMatch(consoleNode("master-status").textContent, /uploaded|approved/);
}
controller.dispose();
assert.equal(consoleTimer, null, "disposing stops polling");

// Execute the real HTTP/service/storage paths against a tagged-SQL test double.
let stored = null, events = [], currentSong = structuredClone(song), currentVersions = structuredClone(versions);
let databaseOutage = false, user = { id: "creator" }, memberId = "creator", crossOrigin = false;
const db = { async sql(strings, ...values) {
  if (databaseOutage) throw new Error("internal database credentials");
  const query = strings.join("?");
  if (query.includes("FROM halo_song_catalog")) return currentSong && values[0] === currentSong.id && values[1] === currentSong.owner_member_id ? [structuredClone(currentSong)] : [];
  if (query.includes("FROM halo_master_orchestrator_state")) return [];
  if (query.includes("FROM halo_song_versions")) return structuredClone(currentVersions);
  if (query.includes("INSERT INTO halo_release_conveyor (")) {
    if (stored?.locked_until && new Date(stored.locked_until) > new Date()) return [];
    stored = { ...stored, state: stored?.state || {}, lease_token: values[2], locked_until: new Date(Date.now() + 600_000) };
    return [{ state: structuredClone(stored.state) }];
  }
  if (query.includes("WITH checkpoint")) {
    assert(query.includes("FROM checkpoint") && query.includes("ON CONFLICT (id) DO NOTHING RETURNING id"), "checkpoint and audit must be atomic and retry-safe");
    if (stored?.lease_token !== values[6] || new Date(stored.locked_until) <= new Date()) return [];
    stored.state = JSON.parse(values[1]);
    stored.locked_until = values[2] ? null : new Date(Date.now() + 600_000);
    if (values[3]) stored.lease_token = null;
    events.push({ stage: values[10], details: JSON.parse(values[11]), created_at: new Date() });
    return [{ id: values[7] }];
  }
  if (query.includes("SELECT state, locked_until")) return stored ? [structuredClone(stored)] : [];
  if (query.includes("SELECT song_id FROM halo_release_conveyor")) {
    return stored?.lease_token === values[2] && new Date(stored.locked_until) > new Date() ? [{ song_id: song.id }] : [];
  }
  if (query.includes("SET lease_token = NULL")) {
    if (stored?.lease_token === values[2]) { stored.lease_token = null; stored.locked_until = null; }
    return [];
  }
  if (query.includes("FROM halo_release_conveyor_events")) return structuredClone(events.slice(-50).reverse());
  throw new Error(`Unexpected test query: ${query}`);
} };
let adapterCalls = 0, storageOutage = false;
let audioWait = null;
const handler = createReleaseConveyorHandler({
  getUser: async () => user, getDatabase: async () => db,
  ensureMembership: async () => ({ member_id: memberId }),
  verifyRequestOrigin: () => { if (crossOrigin) throw new Error("origin"); },
  prepareAudio: async () => {
    adapterCalls++;
    if (audioWait) await audioWait;
    if (storageOutage) throw new Error("private blob error");
    return structuredClone(audio);
  },
  downloadAudio: async () => new Response("owned conditioned audio"),
});
const request = (method = "GET", body, query = "") => new Request(`https://halo.test/api/release-conveyor?songId=${song.id}${query}`, {
  method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
});
const post = () => handler(request("POST", { action: "process_submission", songId: song.id }));
user = null;
assert.equal((await post()).status, 401);
const signedOut = await handler(request());
assert.equal(signedOut.status, 401);
assert.equal(Object.hasOwn(await signedOut.json(), "masterStatus"), false);
user = { id: "creator" }; crossOrigin = true;
assert.equal((await post()).status, 403);
assert.equal(stored, null);
crossOrigin = false; memberId = "someone-else";
assert.equal((await post()).status, 404);
const otherOwner = await handler(request());
assert.equal(otherOwner.status, 404);
assert.equal(Object.hasOwn(await otherOwner.json(), "masterStatus"), false);
memberId = "creator";
assert.equal((await handler(request("DELETE"))).status, 405);
assert.equal((await handler(request("POST", { action: "process_submission", songId: song.id, humHz: 70 }))).status, 400);
assert.equal((await handler(request("POST", { action: "bad" }))).status, 400);
const oversizedRequest = await handler(request("POST", {
  action: "process_submission", songId: song.id, extra: "x".repeat(16_384),
}));
assert.equal(oversizedRequest.status, 413);
assert.equal(oversizedRequest.headers.get("cache-control"), "private, no-store");
const rawPost = (body, headers = {}) => new Request("https://halo.test/api/release-conveyor", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body,
  ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
});
assert.equal((await handler(rawPost("{}", { "Content-Length": "16385" }))).status, 413);
assert.equal((await handler(rawPost("{"))).status, 400);
assert.equal((await handler(rawPost(""))).status, 400);
const multibyteBody = JSON.stringify({ action: "process_submission", songId: song.id, extra: "é".repeat(8192) });
assert(multibyteBody.length < 16_384, "the bound counts bytes, not characters");
assert.equal((await handler(rawPost(multibyteBody, { "Content-Length": "1" }))).status, 413);
let streamCancelled = false;
const oversizedStream = new ReadableStream({
  pull(controller) { controller.enqueue(new Uint8Array(4096).fill(32)); },
  cancel() { streamCancelled = true; },
});
assert.equal((await handler(rawPost(oversizedStream))).status, 413);
assert.equal(streamCancelled, true, "oversized streams are cancelled instead of read to completion");
const boundaryBody = JSON.stringify({ action: "bad", extra: "" });
assert.equal((await handler(rawPost(JSON.stringify({
  action: "bad", extra: "x".repeat(16_384 - Buffer.byteLength(boundaryBody)),
})))).status, 400, "an exactly 16 KiB body reaches action validation, not the size rejection");
assert.equal(stored, null, "oversized updates never reach the release conveyor");
const initialResponse = await handler(request());
assert.equal(initialResponse.status, 200);
assert.equal(initialResponse.headers.get("cache-control"), "private, no-store");
const initialState = await initialResponse.json();
assert.equal(initialState.status, "not_started");
assert.deepEqual(initialState.masterStatus, approvedMasterStatus);
assert.equal(initialState.orchestrator.infrastructure, null);
assert.doesNotMatch(JSON.stringify(initialState), /master\.wav|radio\.wav|audio_url|audio_storage_key/);
for (const [master, expected] of [
  [null, { uploaded: false, durationValid: false, masteringStatus: "unknown" }],
  [{ audio_url: "" }, { ...approvedMasterStatus, uploaded: false }],
  [{ audio_url: "blob:https://halo.test/local-preview" }, { ...approvedMasterStatus, uploaded: false }],
  [{ audio_url: "https://drive.google.com/file/d/archive/view" }, { ...approvedMasterStatus, uploaded: false }],
  [{ audio_url: "/api/song-catalog/audio?versionId=other" }, { ...approvedMasterStatus, uploaded: false }],
  [{ song_id: "foreign" }, { uploaded: false, durationValid: false, masteringStatus: "unknown" }],
  [{ duration_seconds: null }, { ...approvedMasterStatus, durationValid: false }],
  [{ duration_seconds: 0 }, { ...approvedMasterStatus, durationValid: false }],
  [{ duration_seconds: -1 }, { ...approvedMasterStatus, durationValid: false }],
  [{ duration_seconds: "unknown" }, { ...approvedMasterStatus, durationValid: false }],
  [{ duration_seconds: Infinity }, { ...approvedMasterStatus, durationValid: false }],
  [{ mastering_status: "review" }, { ...approvedMasterStatus, masteringStatus: "review" }],
  [{ mastering_status: "in_progress" }, { ...approvedMasterStatus, masteringStatus: "in_progress" }],
  [{ mastering_status: "queued" }, { ...approvedMasterStatus, masteringStatus: "queued" }],
  [{ mastering_status: "not_started", audio_filename: "mastered-approved.wav" }, { ...approvedMasterStatus, masteringStatus: "not_started" }],
  [{ mastering_status: "private unexpected value" }, { ...approvedMasterStatus, masteringStatus: "unknown" }],
]) {
  currentVersions = master ? [{ ...versions[0], ...master }, versions[1]] : [versions[1]];
  const state = await (await handler(request())).json();
  assert.deepEqual(state.masterStatus, expected, "only canonical Sale-master facts are exposed; radio approval and filenames do not count");
  assert.doesNotMatch(JSON.stringify(state.masterStatus), /private|wav|audio_url|filename|storage/);
}
currentVersions = structuredClone(versions);
storageOutage = true;
const apiFailed = await (await post()).json();
assert.equal(apiFailed.status, "retryable");
assert.doesNotMatch(JSON.stringify(apiFailed), /private blob error/);
assert.equal(stored.lease_token, null);
assert(events.some(event => event.stage === "retryable"));
storageOutage = false;
const apiSuccess = await (await post()).json();
assert.equal(apiSuccess.status, "ready");
assert.deepEqual(apiSuccess.masterStatus, approvedMasterStatus, "POST responses also carry safe saved status");
const callsBefore = adapterCalls;
assert.equal((await (await post()).json()).status, "ready");
assert.equal(adapterCalls, callsBefore);
const packageResponse = await handler(request("GET", null, "&artifact=package"));
assert.equal(packageResponse.status, 200);
assert.match(packageResponse.headers.get("content-disposition"), /release-package.json/);
assert.equal((await packageResponse.json()).documents.releaseId, song.id);
const docsResponse = await handler(request("GET", null, "&artifact=documents"));
assert.equal(docsResponse.status, 200);
assert.match(await docsResponse.text(), /RELEASE RECEIPT[\s\S]*AUDIO PREFLIGHT[\s\S]*VERSION MANIFEST[\s\S]*RIGHTS CHECKLIST[\s\S]*LYRICS \/ ORACLE INSIGHTS/);
const promoResponse = await handler(request("GET", null, "&artifact=promotion"));
assert.equal(promoResponse.status, 200);
assert.match(await promoResponse.text(), /PRESS WRITEUP[\s\S]*SOCIAL COPY/);
assert.equal(promoResponse.headers.get("x-content-type-options"), "nosniff");
for (const artifact of ["visual-manifest", "creative-manifest"]) {
  const response = await handler(request("GET", null, `&artifact=${artifact}`));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "Unknown release artifact.");
}
assert((await (await handler(request())).json()).events.length > 0);
currentSong.rights_status = "disputed";
currentVersions[0].mastering_status = "review";
const staleApi = await (await handler(request())).json();
assert.equal(staleApi.status, "stale");
assert.equal(staleApi.receipt.ready, false);
assert.match(staleApi.message, /Rerun the conveyor to re-evaluate audio and independent council gates/);
assert.deepEqual(staleApi.masterStatus, { ...approvedMasterStatus, masteringStatus: "review" }, "stale receipts use current catalog facts, not old package data");
currentVersions = structuredClone(versions);
assert.equal((await handler(request("GET", null, "&artifact=package"))).status, 409);
assert.equal((await handler(request("GET", null, "&artifact=audio"))).status, 409);
const blockedApi = await (await post()).json();
assert.equal(blockedApi.status, "blocked");
assert.equal((await handler(request("GET", null, "&artifact=package"))).status, 409);
assert(events.some(event => event.stage === "council" && event.details.outcome === "block"));
databaseOutage = true;
const unavailable = await post();
assert.equal(unavailable.status, 503);
assert.doesNotMatch(await unavailable.text(), /credentials/);
databaseOutage = false;
currentSong = { ...song, notes: "Concurrent revision" };
let unblock;
audioWait = new Promise(resolve => { unblock = resolve; });
const firstRequest = post();
while (!stored?.lease_token) await new Promise(resolve => setTimeout(resolve, 0));
assert.equal((await post()).status, 409, "concurrent retries must not process the same song");
unblock(); audioWait = null;
assert.equal((await (await firstRequest).json()).status, "ready");
stored.locked_until = new Date(Date.now() - 1000);
stored.lease_token = "expired-worker";
assert.equal((await (await post()).json()).status, "ready", "expired leases can be safely reclaimed");
const dualHum = await (await handler(request("POST", { action: "process_submission", songId: song.id, humHz: "both" }))).json();
assert.equal(dualHum.status, "ready");
assert.equal(dualHum.options.humHz, "both");

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = await read("netlify/database/migrations/20261008223000_release_conveyor.sql");
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_release_conveyor/);
assert.match(migration, /REFERENCES halo_song_catalog\(id\) ON DELETE CASCADE/);
const [catalog, html, ui, endpoint] = await Promise.all([
  read("netlify/functions/song-catalog.ts"), read("song-catalog/index.html"),
  read("lib/release-conveyor-ui.js"), read("netlify/functions/release-conveyor.mjs"),
]);
assert.match(catalog, /await processCatalogRelease\(await getDatabase\(\), ownerMemberId, songId, prepareReleaseAudio\)/);
for (const action of ["run", "status", "stages", "issues", "package", "documents", "promotion", "audio", "hum", "master-status",
  "progress", "progress-bar", "percent-text", "current-step", "status-badge"]) assert(html.includes(`data-conveyor-${action}`));
assert.match(html, /id="conveyor-percent-text"/);
assert.match(html, /data-conveyor-master-status[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(html, /not acoustic mastering verification or release clearance/);
const css = await read("song-catalog/song-catalog.css");
assert.match(css, /#releaseConveyorConsole \[data-state="passed"\]\{color:var\(--green\)\}/);
assert.match(css, /#releaseConveyorConsole \[data-state="blocked"\]\{color:var\(--rust\)\}/);
assert.match(css, /#releaseConveyorConsole \[data-state="pending"\]\{color:var\(--muted\)\}/);
assert.doesNotMatch(html + ui, /conveyor-percent-text<\/u>/);
assert.match(ui, /item\.textContent/);
assert.doesNotMatch(ui, /\.innerHTML\s*=/);
assert.match(endpoint, /path: "\/api\/release-conveyor"/);
console.log("Release conveyor stage, retry, lyrics, documents, promotion and audio contracts passed");
