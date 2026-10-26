import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createReleaseTeaserHandler, teaserReadiness, TEASER_SPEC } from "../netlify/lib/release-teaser.mjs";
import { releaseFingerprint } from "../netlify/lib/release-conveyor.mjs";
import { createReleaseTeaserConsole } from "../lib/release-teaser-ui.js";

const song = {
  id: "12345678-1234-4123-8123-123456789012", owner_member_id: "artist",
  title: "Artist's : %{metadata} [signal]", artist_name: "<script>Artist</script>",
  genre: "Soul", isrc: "GBAAA2600001", rights_status: "cleared", sale_status: "not_for_sale",
  artwork_url: "/api/song-catalog/artwork?songId=12345678-1234-4123-8123-123456789012",
};
const master = {
  id: "23456789-1234-4123-8123-123456789012", song_id: song.id, version_type: "sale_master",
  audio_url: "/api/song-catalog/audio?versionId=23456789-1234-4123-8123-123456789012",
  audio_blob_prefix: "artist/23456789-1234-4123-8123-123456789012/upload/parts/",
  audio_chunk_count: 1, audio_byte_size: 1024, audio_content_type: "audio/wav",
  mastering_status: "approved", duration_seconds: 45, status: "active",
};
const submission = { song, versions: [master, {
  id: "radio", song_id: song.id, version_type: "radio_edit", audio_url: "/radio.wav",
  mastering_status: "approved", duration_seconds: 45,
}] };
function readyState(input = submission) {
  return { state: { status: "ready", receipt: { ready: true }, package: { council: { passed: true } },
    options: { humHz: 0 }, inputHash: releaseFingerprint(input.song, input.versions) } };
}
const stored = readyState();
const original = JSON.stringify({ submission, stored });
const readiness = teaserReadiness(submission, stored);
assert.equal(readiness.eligible, true);
assert.equal(readiness.status, "unavailable");
assert.equal(readiness.canGenerate, false);
assert.equal(readiness.renderer.available, false);
assert.equal(TEASER_SPEC.width / TEASER_SPEC.height, 9 / 16);
assert.equal(TEASER_SPEC.durationSeconds, 15);
assert.equal(TEASER_SPEC.waveform, true);
assert.equal(TEASER_SPEC.cta, "Vote on HALO Living Chart");
assert.equal(teaserReadiness(submission, stored, 30).eligible, true);
for (const start of [-1, 31, Infinity, NaN]) assert.equal(teaserReadiness(submission, stored, start).eligible, false);
for (const [field, value] of [["rights_status", "disputed"], ["rights_status", "needs_review"], ["title", ""],
  ["artwork_url", "https://untrusted.invalid/cover.jpg"], ["artwork_url", "/api/song-catalog/artwork?songId=another"]]) {
  const changed = { ...submission, song: { ...song, [field]: value } };
  assert.equal(teaserReadiness(changed, readyState(changed)).eligible, false, field);
}
for (const changes of [
  { mastering_status: "review" }, { audio_byte_size: 129 * 1024 * 1024 }, { audio_byte_size: 0 },
  { audio_content_type: "video/mp4" }, { duration_seconds: 14 }, { audio_blob_prefix: "other-owner/master/parts/" },
  { audio_blob_prefix: "artist/23456789-1234-4123-8123-123456789012/../parts/" },
  { audio_chunk_count: 0 }, { audio_chunk_count: 2 }, { audio_storage_key: "masters/other/song/version/master.wav" },
]) {
  const changed = { ...submission, versions: [{ ...master, ...changes }, submission.versions[1]] };
  assert.equal(teaserReadiness(changed, readyState(changed)).eligible, false, JSON.stringify(changes));
}
const direct = { ...submission, versions: [{ ...master, audio_blob_prefix: "",
  audio_storage_key: `masters/artist/${song.id}/${master.id}/upload/master.wav` }, submission.versions[1]] };
assert.equal(teaserReadiness(direct, readyState(direct)).eligible, true);
const mp3 = { ...submission, versions: [{ ...master, audio_content_type: "audio/mpeg" }, submission.versions[1]] };
assert.equal(teaserReadiness(mp3, readyState(mp3)).eligible, true);
for (const versions of [[], [...submission.versions, master]]) {
  const changed = { ...submission, versions };
  assert.equal(teaserReadiness(changed, readyState(changed)).eligible, false);
}
assert.equal(teaserReadiness(submission, null).eligible, false);
assert.equal(teaserReadiness({ ...submission, song: { ...song, title: "Changed" } }, stored).eligible, false);
assert.equal(teaserReadiness(submission, { state: { ...stored.state, status: "processing" } }).eligible, false);
assert.equal(JSON.stringify({ submission, stored }), original, "readiness must preserve persisted conveyor and catalog data");

let user = { id: "identity" }, originAllowed = true, found = true, databaseError = false;
const queries = [];
const db = { sql: async (parts, ...values) => {
  const query = parts.join("?");
  queries.push({ query, values });
  assert.match(query.trim(), /^SELECT/, "teaser checks must not persist a job, consent or fake output");
  if (databaseError) throw new Error("private connection details");
  if (query.includes("FROM halo_song_catalog")) {
    assert.match(query, /owner_member_id = \?/);
    assert.equal(values[0], song.id);
    assert.equal(values[1], "artist");
    return found ? [song] : [];
  }
  if (query.includes("FROM halo_song_versions")) return submission.versions;
  assert.match(query, /FROM halo_release_conveyor/);
  assert.deepEqual(values, [song.id, "artist"]);
  return [stored];
} };
const handler = createReleaseTeaserHandler({
  getUser: async () => user, getDatabase: async () => db,
  verifyRequestOrigin: () => { if (!originAllowed) throw new Error("origin"); },
  ensureMembership: async (_db, actor) => { assert.equal(actor.id, "identity"); return { member_id: "artist" }; },
});
const request = (body, options = {}) => new Request(`https://halo.invalid/api/release-teaser?songId=${song.id}`, {
  ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  ...options,
});
const payload = { songId: song.id, startSeconds: 0, consent: true };
user = null;
assert.equal((await handler(request())).status, 401);
assert.equal(queries.length, 0);
user = { id: "identity" };
originAllowed = false;
assert.equal((await handler(request(payload))).status, 403);
assert.equal(queries.length, 0);
originAllowed = true;
assert.equal((await handler(request(undefined, { method: "DELETE" }))).status, 405);
for (const body of [null, [], { songId: song.id }, { ...payload, consent: "true" },
  { ...payload, audioPath: "/tmp/master.wav" }, { ...payload, audioUrl: "https://untrusted.invalid/audio" },
  { ...payload, startSeconds: "0" }, { ...payload, songId: "invalid" }, { ...payload, startSeconds: 3601 }]) {
  assert.equal((await handler(request(body))).status, 400);
}
assert.equal((await handler(request(payload, { headers: { "Content-Type": "text/plain" } }))).status, 415);
assert.equal((await handler(request(payload, { body: "{" }))).status, 400);
assert.equal((await handler(request(payload, { body: " ".repeat(2049) }))).status, 413);
assert.equal((await handler(request(payload, { headers: { "Content-Type": "application/json", "Content-Length": "3000" } }))).status, 413);
found = false;
assert.equal((await handler(request())).status, 404);
assert.equal((await handler(request(payload))).status, 404);
found = true;
const get = await handler(request());
assert.equal(get.status, 200);
assert.equal(get.headers.get("cache-control"), "private, no-store");
assert.equal((await get.json()).canGenerate, false);
assert.equal((await handler(request({ ...payload, startSeconds: 31 }))).status, 409);
const results = await Promise.all(Array.from({ length: 4 }, () => handler(request(payload))));
for (const response of results) {
  assert.equal(response.status, 503);
  const state = await response.json();
  assert.equal(state.status, "unavailable");
  assert.match(state.message, /No teaser has been queued or generated/);
  assert.equal(state.teaserUrl, undefined, "never expose a public or nonexistent output");
  assert.equal(state.jobId, undefined);
}
databaseError = true;
const failure = await handler(request());
assert.equal(failure.status, 503);
const error = await failure.json();
assert.equal(error.retryable, true);
assert.doesNotMatch(JSON.stringify(error), /private connection/);
assert.equal(JSON.stringify({ submission, stored }), original, "all requests leave existing persisted data unchanged");

function element() {
  return {
    textContent: "", disabled: false, children: [], attributes: {}, listeners: {},
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(event, listener) { this.listeners[event] = listener; },
  };
}
const nodes = Object.fromEntries(["status", "issues", "check", "generate"].map(key => [`[data-teaser-${key}]`, element()]));
const root = { ...element(), querySelector: selector => nodes[selector] };
let response = Response.json(readiness), resolvePending, calls = 0, pending = false;
const ui = createReleaseTeaserConsole({
  root, doc: { createElement: element },
  fetcher: async (url, options) => {
    calls++;
    assert.match(url, /^\/api\/release-teaser\?songId=/);
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.method, undefined, "readiness must not trigger generation");
    if (pending) return new Promise(resolve => { resolvePending = resolve; });
    if (response instanceof Error) throw response;
    return response;
  },
});
ui.select("");
assert.equal(nodes["[data-teaser-check]"].disabled, true);
ui.select(song.id);
assert.equal(calls, 0, "do not process media on selection/upload");
const click = () => nodes["[data-teaser-check]"].listeners.click();
await click();
assert.equal(nodes["[data-teaser-generate]"].disabled, true);
assert.match(nodes["[data-teaser-status]"].textContent, /prerequisites passed.*not deployed/);
response = Response.json({ ...readiness, eligible: false, issues: [{ message: "<img src=x onerror=alert(1)>" }] });
await click();
assert.equal(nodes["[data-teaser-issues]"].children[0].textContent, "<img src=x onerror=alert(1)>", "render issue copy as text");
response = Response.json({ message: "Sign in" }, { status: 401 });
await click();
assert.equal(nodes["[data-teaser-status]"].textContent, "Sign in");
assert.equal(nodes["[data-teaser-issues]"].children.length, 0);
response = new Error("network");
await click();
assert.match(nodes["[data-teaser-status]"].textContent, /Connection interrupted/);
pending = true;
const inFlight = click();
assert.equal(root.attributes["aria-busy"], "true");
ui.select("");
resolvePending(Response.json(readiness));
await inFlight;
assert.match(nodes["[data-teaser-status]"].textContent, /Select a saved catalog song/);
assert.equal(nodes["[data-teaser-generate]"].disabled, true);
assert.equal(root.attributes["aria-busy"], "false");

const read = path => readFile(new URL(path, import.meta.url), "utf8");
assert.match(await read("../song-catalog/song-catalog.js"), /releaseTeaser\.select\(state\.authenticated/);
assert.match(await read("../song-catalog/index.html"), /data-teaser-generate[^>]*disabled/);
assert.match(await read("../release-house/release-house.js"), /\/song-catalog\/#social-teaser/);
assert.match(await read("../netlify/functions/release-teaser.mjs"), /path: "\/api\/release-teaser"/);
console.log("Release teaser contracts passed: ownership, approval, validation, deployment gate, persistence safety and UI states.");
