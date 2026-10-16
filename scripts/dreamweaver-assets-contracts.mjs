import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { handleDreamweaverAssets } from "../netlify/functions/dreamweaver-assets.mjs";
import { BindingError, bindingSongId, buildBinding, canonicalMasterUrl, generateActVisual, loadDreamweaverSong, resolveDreamweaverBinding, validateCustomImages } from "../netlify/lib/dreamweaver-assets.mjs";

const songId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const song = { id: songId, owner_member_id: "owner", title: "Celebration", artist_name: "Artist", genre: "house", lyrics_text: "<script>never embed lyrics</script>", status: "active", pipeline_status: "published", rights_status: "cleared" };
const master = { id: versionId, audio_url: "https://archive.halo.test/master.wav" };

function fakeDb({ visible = true, masters = [master], stored = null, conflicts = 0, onConflict = null } = {}) {
  const queries = [];
  return {
    queries,
    get stored() { return stored; },
    async sql(strings, ...values) {
      const query = strings.join("?");
      queries.push({ query, values });
      if (query.includes("FROM halo_song_catalog")) {
        const [id, memberId, publicAllowed] = values;
        return id === song.id && (memberId === song.owner_member_id || (publicAllowed && visible)) ? [song] : [];
      }
      if (query.includes("FROM halo_song_versions")) return masters;
      if (query.includes("SELECT * FROM halo_release_assets")) return stored ? [{ ...stored }] : [];
      if (query.includes("INSERT INTO halo_release_assets")) {
        assert.match(query, /ON CONFLICT \(song_id\)/);
        assert.match(query, /WHERE halo_release_assets.revision =/);
        if (conflicts-- > 0) { if (onConflict) stored = onConflict; return []; }
        const [id, masterId, audio, ...rest] = values;
        const [v1, v2, v3, v4, custom, revision, previous] = rest;
        if (stored && stored.revision !== previous) return [];
        stored = { song_id: id, master_version_id: masterId, canonical_master_url: audio, visual_act_1: v1, visual_act_2: v2, visual_act_3: v3, visual_act_4: v4, custom_images: JSON.parse(custom), revision, status: "ready" };
        return [{ song_id: id }];
      }
      throw new Error(`Unexpected query: ${query}`);
    }
  };
}

assert.equal(bindingSongId(songId.toUpperCase()), songId);
for (const id of ["", "not-an-id", `${songId}'`, null]) assert.throws(() => bindingSongId(id));
for (const images of [null, {}, Array(5).fill("https://halo.test/art.jpg"), ["javascript:alert(1)"], ["data:image/svg+xml,unsafe"], ["//evil.test/art"], ["http://halo.test/art"], ["/assets/../../api/private"], ["/api/song-catalog/audio?versionId=x"], ["/other-page"]]) {
  assert.throws(() => validateCustomImages(images));
}
assert.deepEqual(validateCustomImages(["/assets/cover.jpg", null]), ["/assets/cover.jpg", null]);

for (let count = 0; count <= 4; count++) {
  const uploads = Array.from({ length: count }, (_, index) => `https://halo.test/upload-${index}.jpg`);
  const binding = buildBinding(song, master, uploads);
  assert.equal(binding.status, "ready");
  assert.equal(binding.audioSource, master.audio_url);
  assert.equal(binding.visualActs.length, 4);
  assert.deepEqual(binding.visualActs.slice(0, count).map(visual => visual.uri), uploads);
  assert.ok(binding.visualActs.slice(count).every(visual => visual.sourceType === "generated"));
  assert.deepEqual(buildBinding(song, master, uploads), binding, "generation and revisions are deterministic");
}
const sparse = buildBinding(song, master, ["https://halo.test/one.jpg", null, "https://halo.test/three.jpg"]);
assert.equal(sparse.visualActs[1].sourceType, "generated");
assert.equal(sparse.visualActs[2].uri, "https://halo.test/three.jpg");
assert.equal(buildBinding({ ...song, artwork_url: "/assets/cover.jpg" }, master).visualActs[0].uri, "/assets/cover.jpg");
assert.notEqual(generateActVisual(song, 1), generateActVisual(song, 2));
assert.notEqual(generateActVisual(song, 1), generateActVisual({ ...song, lyrics_text: "different lyrics" }, 1));
const svg = Buffer.from(generateActVisual(song, 1).split(",")[1], "base64").toString();
assert.match(svg, /#c8a45c/);
assert.match(svg, /#09090d/);
assert.doesNotMatch(svg, /<script|never embed|Celebration|href=|onload=|foreignObject|<text/i, "untrusted metadata is never embedded in generated SVG markup");
assert.equal(canonicalMasterUrl(song, { ...master, audio_storage_key: "masters/private.wav" }), `/api/song-catalog/audio?versionId=${versionId}&dreamweaver=1&songId=${songId}`);
assert.equal(canonicalMasterUrl(song, { ...master, audio_blob_prefix: "stored/", audio_url: "/api/preview" }), `/api/song-catalog/audio?versionId=${versionId}&dreamweaver=1&songId=${songId}`);
for (const audio_url of ["", "/api/preview", "/api/song-catalog/audio?versionId=x", "javascript:alert(1)"]) {
  assert.throws(() => canonicalMasterUrl(song, { ...master, audio_url }));
}
await assert.rejects(loadDreamweaverSong(fakeDb({ visible: false }), songId), { status: 404 });
await assert.rejects(loadDreamweaverSong(fakeDb(), songId, "stranger", true), { status: 404 });
assert.equal((await loadDreamweaverSong(fakeDb({ visible: false }), songId, "owner", true)).song.id, songId);
for (const masters of [[], [master, master]]) await assert.rejects(loadDreamweaverSong(fakeDb({ masters }), songId), { status: 409 });
const gateDb = fakeDb();
await loadDreamweaverSong(gateDb, songId);
for (const gate of ["pipeline_status = 'published'", "rights_status = 'cleared'", "release.status = 'published'", "release.visibility = 'public'", "release.id = song.source_release_id"]) {
  assert.ok(gateDb.queries[0].query.includes(gate), `public master access requires ${gate}`);
}

const db = fakeDb();
const first = await resolveDreamweaverBinding(db, { songId, memberId: "owner", customImages: ["https://halo.test/custom.jpg"] });
assert.equal(db.stored.visual_act_1, first.visualActs[0].uri);
assert.equal(db.stored.canonical_master_url, master.audio_url);
assert.deepEqual(await resolveDreamweaverBinding(db, { songId }), first, "public reads preserve uploaded visuals");
assert.equal(db.queries.filter(item => item.query.includes("INSERT INTO")).length, 1, "unchanged reads do not rewrite the binding");
const racing = fakeDb({ conflicts: 1, onConflict: { ...db.stored, revision: "new-owner-revision", custom_images: ["https://halo.test/new.jpg"] } });
assert.equal((await resolveDreamweaverBinding(racing, { songId })).visualActs[0].uri, "https://halo.test/new.jpg", "a stale reader must retry with the newest uploaded visuals");
await assert.rejects(resolveDreamweaverBinding(fakeDb({ conflicts: 3 }), { songId }), { status: 409 });

const request = (method = "GET", body, headers = {}) => new Request(`https://halo.test/api/dreamweaver-assets?songId=${songId}`, {
  method, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  headers: { "Content-Type": "application/json", ...headers }
});
const invoke = (req, options = {}) => handleDreamweaverAssets(req, { database: fakeDb(), verifyOrigin() {}, ...options });
const response = await invoke(request());
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.equal((await response.json()).binding.visualActs.length, 4);
assert.equal((await invoke(request("PUT"))).status, 405);
assert.equal((await invoke(request("POST", { songId, customImages: [] }))).status, 401);
assert.equal((await invoke(request("POST", { songId, customImages: [] }), { user: { id: "stranger" } })).status, 404);
assert.equal((await invoke(request("POST", { songId, customImages: [] }), { user: { id: "owner" }, verifyOrigin() { throw new Error(); } })).status, 403);
assert.equal((await invoke(request("POST", "{"), { user: { id: "owner" } })).status, 400);
assert.equal((await invoke(request("POST", " ".repeat(12_289)), { user: { id: "owner" } })).status, 413);
assert.equal((await invoke(request("POST", { songId, customImages: [] }, { "Content-Type": "text/plain" }), { user: { id: "owner" } })).status, 415);
assert.equal((await invoke(request("POST", { songId, customImages: [], mixId: "unrelated" }), { user: { id: "owner" } })).status, 400);
assert.equal((await invoke(request("POST", { songId, customImages: [] }), { user: { id: "owner" } })).status, 200);
assert.equal((await invoke(request(), { database: { sql() { throw new Error("private database detail"); } } })).status, 503);

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, schema, audio] = await Promise.all([
  read("netlify/database/migrations/20261016010000_dreamweaver_release_assets.sql"),
  read("db/schema.ts"), read("netlify/functions/song-catalog-audio.ts")
]);
for (const column of ["canonical_master_url", "visual_act_1", "visual_act_2", "visual_act_3", "visual_act_4"]) {
  assert.ok(migration.includes(column) && schema.includes(column));
}
assert.match(migration, /song_id text PRIMARY KEY REFERENCES halo_song_catalog/);
assert.match(audio, /loadDreamweaverSong\(db, bindingSongId\(params.get\("songId"\)\), ownerMemberId\)/);
assert.match(audio, /resolved.master.id === versionId/);
assert.match(audio, /if \(!user\?\.id\) return json/);

// Exercise the existing delivery implementation without a live storage account.
const serveSource = audio.slice(audio.indexOf("async function serveAudio("), audio.indexOf("\nasync function listRadioTracks("));
const rangeSource = audio.slice(audio.indexOf("function requestedByteRange("), audio.indexOf("\nasync function ownedVersion("));
let ownerLookups = 0;
const streamContext = {
  URL, Response, Uint8Array, ReadableStream, BindingError, bindingSongId, loadDreamweaverSong,
  cleanId: value => value,
  json: (body, status) => Response.json(body, { status }),
  directUploadConfig: () => ({}),
  presignObjectUrl: ({ method }) => `https://storage.halo.test/master?method=${method}`,
  MASTER_PLAYBACK_URL_TTL_SECONDS: 60,
  MEDIA_CORS_HEADERS: {},
  ownedVersion: async () => { ownerLookups++; return null; },
  readAudioRange: async (_version, range) => new Uint8Array(range.end - range.start + 1),
  audioStore: { get: async () => new Uint8Array(10).buffer }
};
vm.runInNewContext(`${stripTypeScriptTypes(rangeSource)}\n${stripTypeScriptTypes(serveSource)}\nglobalThis.serve = serveAudio;`, streamContext);
const audioRequest = (params = "", method = "GET", headers = {}) => new Request(
  `https://halo.test/api/song-catalog/audio?versionId=${versionId}&songId=${songId}${params}`, { method, headers }
);
const storedMaster = { ...master, audio_storage_key: "masters/track.wav" };
assert.equal((await streamContext.serve(audioRequest("&dreamweaver=1"), fakeDb({ visible: false, masters: [storedMaster] }), "")).status, 404);
const wrongVersionRequest = new Request(audioRequest("&dreamweaver=1").url.replace(versionId, songId));
assert.equal((await streamContext.serve(wrongVersionRequest, fakeDb({ masters: [storedMaster] }), "")).status, 404);
const redirect = await streamContext.serve(audioRequest("&dreamweaver=1", "HEAD"), fakeDb({ masters: [storedMaster] }), "");
assert.equal(redirect.status, 302);
assert.equal(redirect.headers.get("location"), "https://storage.halo.test/master?method=HEAD");
assert.equal(ownerLookups, 0, "public canonical requests must use the publication gate, not owner lookup");
assert.equal((await streamContext.serve(audioRequest(), fakeDb(), "")).status, 404);
assert.equal(ownerLookups, 1, "ordinary audio requests retain owner-only lookup");
const chunked = { ...master, audio_blob_prefix: "chunks/", audio_chunk_count: 1, audio_byte_size: 10, audio_content_type: "audio/wav" };
const chunkDb = fakeDb({ masters: [chunked] });
const ranged = await streamContext.serve(audioRequest("&dreamweaver=1", "GET", { Range: "bytes=2-5" }), chunkDb, "");
assert.equal(ranged.status, 206);
assert.equal(ranged.headers.get("content-range"), "bytes 2-5/10");
assert.equal((await ranged.arrayBuffer()).byteLength, 4);
assert.equal((await streamContext.serve(audioRequest("&dreamweaver=1", "GET", { Range: "bytes=20-" }), chunkDb, "")).status, 416);
const head = await streamContext.serve(audioRequest("&dreamweaver=1", "HEAD"), chunkDb, "");
assert.equal(head.headers.get("content-length"), "10");
assert.equal(await head.text(), "");
assert.equal((await (await streamContext.serve(audioRequest("&dreamweaver=1"), chunkDb, "")).arrayBuffer()).byteLength, 10);
console.log("Dreamweaver assets contracts passed: authorization, canonical masters, four slots, bounded generation, persistence, races, and HTTP errors.");
