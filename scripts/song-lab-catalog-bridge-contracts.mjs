import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { bindSongLabProject } from "../netlify/lib/song-lab-catalog-bridge.mjs";
import { connectSongLabToCatalog } from "../dreamweaver-lab/resumable-upload.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const owner = "owner-one";
function memoryStore() {
  const entries = new Map();
  return {
    entries,
    async get(key) { return entries.get(key)?.bytes.slice(0) || null; },
    async getMetadata(key) { return entries.has(key) ? { metadata: entries.get(key).metadata } : null; },
    async list({ prefix }) { return { blobs: [...entries.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
    async set(key, blob, { metadata }) { entries.set(key, { bytes: await blob.arrayBuffer(), metadata }); },
  };
}
function fixture() {
  const sourceStore = memoryStore(), audioStore = memoryStore();
  const bytes = new TextEncoder().encode("saved private recording").buffer;
  const project = {
    id: projectId, member_id: owner, title: "Test song", artist_name: "Test artist",
    rights_attested: true, blob_prefix: `${owner}/${projectId}/parts/`, chunk_count: 1,
    byte_size: bytes.byteLength, content_type: "audio/wav", duration_seconds: 12.5, file_name: "test.wav",
  };
  sourceStore.entries.set(`${project.blob_prefix}000`, {
    bytes, metadata: { sha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex") },
  });
  let binding = null, writes = 0, failWrite = false;
  const db = {
    async sql(strings, ...values) {
      const query = strings.join("?");
      if (query.includes("FROM halo_dreamweaver_songs")) {
        return values[0] === project.id && values[1] === project.member_id ? [project] : [];
      }
      if (query.includes("LEFT JOIN halo_song_versions")) return binding ? [binding] : [];
      if (query.includes("WITH draft AS")) {
        if (failWrite) throw new Error("Temporary database outage");
        assert.match(query, /ON CONFLICT \(id\) DO NOTHING RETURNING id/);
        assert.match(query, /'not_for_sale', 'needs_review'/);
        assert.match(query, /'not_started', FALSE FROM draft/);
        assert.doesNotMatch(query, /UPDATE|published|approved/);
        writes++;
        binding = {
          owner_member_id: values[1], song_status: "active", source_upload_surface: "dreamweaver_lab",
          id: values[4], status: "active", audio_blob_prefix: values[6], audio_storage_key: "",
        };
        return [];
      }
      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
  return {
    db, sourceStore, audioStore, project, ownerMemberId: owner, projectId,
    get writes() { return writes; }, get binding() { return binding; },
    set failWrite(value) { failWrite = value; },
  };
}
{
  const test = fixture();
  const binding = await bindSongLabProject(test);
  assert.deepEqual(binding, { songId: projectId, versionId: projectId, audioUrl: `/api/song-catalog/audio?versionId=${projectId}` });
  assert.equal(test.writes, 1);
  assert.deepEqual(new Uint8Array([...test.audioStore.entries.values()][0].bytes), new Uint8Array([...test.sourceStore.entries.values()][0].bytes));
  assert.ok(test.binding.audio_blob_prefix.startsWith(`${owner}/${projectId}/`));
  await bindSongLabProject(test);
  assert.equal(test.writes, 1, "repeated restoration must not create another song or replace a master");
  test.binding.song_status = "archived";
  await assert.rejects(bindSongLabProject(test), /changed or archived/);
}
for (const mutate of [
  test => { test.ownerMemberId = "other-owner"; },
  test => { test.project.rights_attested = false; },
  test => { test.project.artist_name = ""; },
  test => { test.project.blob_prefix = `other-owner/${projectId}/parts/`; },
  test => { test.project.byte_size += 1; },
  test => { test.project.content_type = "text/html"; },
  test => { test.sourceStore.entries.clear(); },
  test => { [...test.sourceStore.entries.values()][0].metadata.sha256 = "0".repeat(64); },
]) {
  const test = fixture();
  mutate(test);
  await assert.rejects(bindSongLabProject(test));
  assert.equal(test.writes, 0, "invalid, missing or unauthorized bytes cannot create a playable catalog record");
}
{
  const test = fixture();
  test.failWrite = true;
  await assert.rejects(bindSongLabProject(test), /database outage/);
  assert.equal(test.writes, 0);
  test.failWrite = false;
  await bindSongLabProject(test);
  assert.equal(test.writes, 1, "a partial copy can be retried without another browser upload");
}

const test = fixture();
let user = { id: owner }, trusted = true;
globalThis.__bridgeFixture = {
  getUser: async () => user, verifyRequestOrigin: async () => trusted, getDatabase: () => test.db,
  ensureMembership: async (_db, identity) => ({ member_id: identity.id }),
  getStore: ({ name }) => {
    assert.ok(["halo-dreamweaver-songs", "halo-song-catalog-audio"].includes(name));
    return name === "halo-dreamweaver-songs" ? test.sourceStore : test.audioStore;
  },
};
let handlerSource = await readFile(new URL("../netlify/functions/song-lab-catalog-bridge.mjs", import.meta.url), "utf8");
handlerSource = handlerSource
  .replace(/import \{ getStore \} from "@netlify\/blobs";/, "const { getStore } = globalThis.__bridgeFixture;")
  .replace(/import \{ getDatabase \} from "@netlify\/database";/, "const { getDatabase } = globalThis.__bridgeFixture;")
  .replace(/import \{ getUser, verifyRequestOrigin \} from "@netlify\/identity";/, "const { getUser, verifyRequestOrigin } = globalThis.__bridgeFixture;")
  .replace(/import \{ ensureMembership \} from "..\/lib\/halo-x.mjs";/, "const { ensureMembership } = globalThis.__bridgeFixture;")
  .replace('"../lib/song-lab-catalog-bridge.mjs"', JSON.stringify(new URL("../netlify/lib/song-lab-catalog-bridge.mjs", import.meta.url).href));
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(handlerSource).toString("base64")}`);
const request = (body = { projectId }, method = "POST") => handler(new Request("https://halo.test/api/song-lab/catalog-bridge", {
  method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
}));
assert.equal((await request({}, "GET")).status, 405);
user = null;
assert.equal((await request()).status, 401);
user = { id: owner }; trusted = false;
assert.equal((await request()).status, 403);
trusted = true; user = { id: "other-owner" };
assert.equal((await request()).status, 404);
user = { id: owner };
assert.equal((await request({ projectId: "blob:local-audio" })).status, 400);
assert.equal((await request({ projectId, junk: "x".repeat(1024) })).status, 413);
const response = await request();
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "private, no-store");
trusted = undefined;
assert.equal((await request()).status, 200, "the deployed Identity SDK returns void after successful origin validation");
const binding = await response.json();
assert.equal(JSON.stringify(binding).includes("/parts/"), false, "private storage references stay server-side");
assert.deepEqual(await connectSongLabToCatalog(projectId, async (url, options) => {
  assert.equal(url, "/api/song-lab/catalog-bridge");
  assert.equal(options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(options.body), { projectId });
  return Response.json(binding);
}), binding);
await assert.rejects(connectSongLabToCatalog(projectId, async () => Response.json({ ...binding, audioUrl: "blob:local-only" })), /invalid project audio binding/);
delete globalThis.__bridgeFixture;

const client = await readFile(new URL("../dreamweaver-lab/song-lab.js", import.meta.url), "utf8");
const catalog = await readFile(new URL("../song-catalog/song-catalog.js", import.meta.url), "utf8");
{
  const status = {}, retry = {}, link = {}, state = { project: { id: projectId, status: "ready" } };
  const events = [], messages = [];
  let calls = 0, fail = true;
  const connectProject = new Function(
    "connectSongLabToCatalog", "state", "catalogBridgeStatus", "catalogBridgeRetry", "catalogBridgeLink", "window", "CustomEvent", "BroadcastChannel",
    `const catalogConnections = new Map(); ${client.slice(client.indexOf("async function connectProject("), client.indexOf('  let currentOwnerId'))}; return connectProject;`,
  )(async id => {
    calls++;
    if (fail) throw new Error("Controlled bridge outage");
    return { songId: id, versionId: id, audioUrl: `/api/song-catalog/audio?versionId=${id}` };
  }, state, status, retry, link, { dispatchEvent: event => events.push(event) },
  class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  class {
    constructor(name) { assert.equal(name, "halo-catalog-audio"); }
    postMessage(data) { messages.push(data); }
    close() {}
  });
  await connectProject(state.project);
  assert.equal(retry.hidden, false);
  assert.equal(link.hidden, true);
  assert.match(status.textContent, /Controlled bridge outage/);
  assert.equal(events.length, 0, "a failed connection cannot announce catalog readiness");
  fail = false;
  await connectProject(state.project);
  assert.equal(calls, 2);
  assert.equal(retry.hidden, true);
  assert.equal(link.hidden, false);
  assert.equal(link.href, `/song-catalog/?song=${projectId}`);
  assert.equal(messages[0].songId, projectId);
  assert.deepEqual(Object.keys(messages[0]).sort(), ["songId", "type"], "notifications carry no URLs, bytes or private metadata");
  await connectProject(state.project);
  assert.equal(calls, 2, "repeated display in one session reuses the successful binding");
}
assert.match(client, /void connectProject\(project\)/, "completed and restored projects both connect automatically");
assert.match(client, /catalogBridgeRetry\.addEventListener/, "failed connection offers a retry without regenerating the project");
assert.match(client, /catalogBridgeLink\.href = `\/song-catalog\/\?song=/);
assert.doesNotMatch(client, /localStorage\.setItem\([^;]*(?:blob|audioBlobUrl|halo_master_stream)/);
assert.match(catalog, /BroadcastChannel\("halo-catalog-audio"\)/);
const refresh = catalog.slice(catalog.indexOf("function refreshLinkedCatalogAudio"), catalog.indexOf("function selectedSong"));
assert.match(refresh, /loadCatalog\(state.selectedId\)/);
assert.doesNotMatch(refresh, /\.play\(|\.src\s*=|catalogPlayback\?\.select/, "cross-tab updates cannot autoplay or replace the active track");
console.log("Song Lab catalog bridge contracts passed: stored bytes, owner/origin/rights checks, private drafts, idempotency, retry and non-interrupting refresh.");
