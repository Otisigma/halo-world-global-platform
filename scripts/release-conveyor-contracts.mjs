import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { RELEASE_STAGES, runReleaseConveyor, validateRelease, councilDecision, releaseFingerprint } from "../netlify/lib/release-conveyor.mjs";
import { conditionReleaseWav } from "../netlify/lib/release-audio.mjs";
import { createReleaseConveyorHandler } from "../netlify/lib/release-conveyor-http.mjs";
import { prepareReleaseAudio } from "../netlify/lib/release-conveyor-audio.mjs";
import { createReleaseConveyorConsole } from "../lib/release-conveyor-ui.js";

const song = { id: "12345678-1234-4123-8123-123456789012", owner_member_id: "creator",
  title: "A Signal", artist_name: "Artist", genre: "Soul", isrc: "GB-AAA-26-00001",
  rights_status: "cleared", sale_status: "for_sale", sale_price_cents: 129,
  artwork_url: "/cover.jpg", lyrics_text: "[00:01] A signal || Written at dawn\nAn untimed line",
  metadata_issues: [], notes: "Recorded at dawn." };
const versions = [
  { id: "master", song_id: song.id, version_type: "sale_master", audio_url: "/master.wav", mastering_status: "approved", duration_seconds: 180 },
  { id: "radio", song_id: song.id, version_type: "radio_edit", audio_url: "/radio.wav", mastering_status: "approved", duration_seconds: 180 },
];
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
assert(missingAudio.issues.some(item => /Upload the canonical/.test(item.message)));
const unsupportedHum = await prepareReleaseAudio(song, versions, "revision", { humHz: 60 });
assert(unsupportedHum.issues.some(item => /requires a stored PCM WAV/.test(item.message)));
for (const source of [{ audio_byte_size: 150 * 1024 * 1024, audio_storage_key: "stored-master" }, { audio_byte_size: 0 }]) {
  const externalWavVersions = versions.map(version => ({ ...version, audio_content_type: "audio/wav", ...source }));
  const externalWav = await prepareReleaseAudio(song, externalWavVersions, "revision", { humHz: 0 });
  assert.equal(externalWav.conditioning, "external_master", "approved large/link-only WAVs can complete without automatic conditioning");
  assert.deepEqual(externalWav.issues, []);
  const needsFilter = await prepareReleaseAudio(song, externalWavVersions, "revision", { humHz: 50 });
  assert(needsFilter.issues.length > 0, "an unsatisfied filter request must still escalate");
}

class ConsoleElement extends EventTarget {
  constructor() { super(); this.children = []; this.value = "0"; this.hidden = false; this.disabled = false; this.textContent = ""; }
  replaceChildren() { this.children = []; }
  append(item) { this.children.push(item); }
  setAttribute() {}
}
const consoleNodes = new Map();
const consoleRoot = new ConsoleElement();
consoleRoot.querySelector = selector => {
  if (!consoleNodes.has(selector)) consoleNodes.set(selector, new ConsoleElement());
  return consoleNodes.get(selector);
};
let resolveConsoleRequest;
const consoleFetch = () => new Promise(resolve => { resolveConsoleRequest = resolve; });
const controller = createReleaseConveyorConsole({ root: consoleRoot, doc: { createElement: () => new ConsoleElement() }, fetcher: consoleFetch });
const consoleNode = key => consoleNodes.get(`[data-conveyor-${key}]`);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
controller.select(song.id);
assert.equal(consoleNode("hum").disabled, true, "filter selection is disabled during a request");
resolveConsoleRequest({ ok: true, json: async () => ({ ...success, options: { humHz: 0 } }) });
await settle();
assert.equal(consoleNode("hum").disabled, false);
assert.equal(consoleNode("package").hidden, false);
consoleNode("run").dispatchEvent(new Event("click"));
assert.equal(consoleNode("hum").disabled, true);
// Even a programmatic change cannot leave options mismatched with a returned package.
consoleNode("hum").value = "50";
resolveConsoleRequest({ ok: true, json: async () => ({ ...success, options: { humHz: 0 } }) });
await settle();
assert.equal(consoleNode("hum").value, "0");
consoleNode("hum").value = "50";
consoleNode("hum").dispatchEvent(new Event("change"));
assert.equal(consoleNode("package").hidden, true);
assert.equal(consoleNode("audio").hidden, true);
consoleNode("refresh").dispatchEvent(new Event("click"));
resolveConsoleRequest({ ok: false, json: async () => ({ message: "Connection interrupted." }) });
await settle();
assert.equal(consoleNode("package").hidden, true);
assert.equal(consoleNode("documents").hidden, true);

// Execute the real HTTP/service/storage paths against a tagged-SQL test double.
let stored = null, events = [], currentSong = structuredClone(song), currentVersions = structuredClone(versions);
let databaseOutage = false, user = { id: "creator" }, memberId = "creator", crossOrigin = false;
const db = { async sql(strings, ...values) {
  if (databaseOutage) throw new Error("internal database credentials");
  const query = strings.join("?");
  if (query.includes("FROM halo_song_catalog")) return currentSong && values[0] === currentSong.id && values[1] === currentSong.owner_member_id ? [structuredClone(currentSong)] : [];
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
user = { id: "creator" }; crossOrigin = true;
assert.equal((await post()).status, 403);
assert.equal(stored, null);
crossOrigin = false; memberId = "someone-else";
assert.equal((await post()).status, 404);
memberId = "creator";
assert.equal((await handler(request("DELETE"))).status, 405);
assert.equal((await handler(request("POST", { action: "process_submission", songId: song.id, humHz: 70 }))).status, 400);
assert.equal((await handler(request("POST", { action: "bad" }))).status, 400);
assert.equal((await handler(request())).status, 200);
storageOutage = true;
const apiFailed = await (await post()).json();
assert.equal(apiFailed.status, "retryable");
assert.doesNotMatch(JSON.stringify(apiFailed), /private blob error/);
assert.equal(stored.lease_token, null);
assert(events.some(event => event.stage === "retryable"));
storageOutage = false;
const apiSuccess = await (await post()).json();
assert.equal(apiSuccess.status, "ready");
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
assert((await (await handler(request())).json()).events.length > 0);
currentSong.rights_status = "disputed";
const staleApi = await (await handler(request())).json();
assert.equal(staleApi.status, "stale");
assert.equal(staleApi.receipt.ready, false);
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
for (const action of ["run", "status", "stages", "issues", "package", "documents", "promotion", "audio", "hum"]) assert(html.includes(`data-conveyor-${action}`));
assert.match(ui, /item\.textContent/);
assert.doesNotMatch(ui, /\.innerHTML\s*=/);
assert.match(endpoint, /path: "\/api\/release-conveyor"/);
console.log("Release conveyor stage, retry, lyrics, documents, promotion and audio contracts passed");
