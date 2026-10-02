import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createForcePushTrackHandler, config } from "../netlify/functions/catalog-force-push-track.mjs";
import { reconcilePublishedSong } from "../netlify/lib/song-publication.mjs";

const root = resolve(import.meta.dirname, "..");
const songId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const savedSong = {
  id: songId, owner_member_id: "owner", title: "Saved title", artist_name: "Saved artist",
  notes: "Keep these notes", artwork_url: "/cover.jpg", sale_price_cents: null,
  currency: "USD", status: "active", source_release_id: "existing-release",
};

function fixture({ user = { id: "owner" }, origin = true, price = null, fail = false, duplicate = false } = {}) {
  const songs = [
    { ...savedSong, sale_price_cents: price },
    { ...savedSong, id: otherId, owner_member_id: duplicate ? "owner" : "other", notes: "Unrelated data" },
  ];
  const releases = new Map([["existing-release", { id: "existing-release", pitch: "Keep this pitch" }]]);
  let reconciles = 0;
  let writes = 0;
  let databaseCalls = 0;
  const db = {
    async sql(strings, ...values) {
      const query = strings.join("?");
      if (query.includes("SELECT id FROM halo_song_catalog")) {
        const [key, owner] = values;
        return songs.filter(song => song.owner_member_id === owner && song.status === "active"
          && (query.includes("WHERE title") ? song.title === key : song.id === key)).map(song => ({ id: song.id }));
      }
      if (query.includes("UPDATE halo_song_catalog")) {
        assert.match(query, /sale_price_cents IS NULL OR sale_price_cents <= 0 THEN 129 ELSE sale_price_cents END/);
        assert.match(query, /owner_member_id = \?/);
        assert.doesNotMatch(query, /\b(?:title|artist_name|notes|artwork_url|status)\s*=(?!\s*'active')/);
        const [id, owner] = values;
        const song = songs.find(song => song.id === id && song.owner_member_id === owner);
        if (!song) return [];
        writes++;
        if (song.sale_price_cents == null || song.sale_price_cents <= 0) {
          song.sale_price_cents = 129;
          song.currency = "USD";
        }
        Object.assign(song, { pipeline_status: "published", sale_status: "for_sale", pipeline_updated_at: new Date("2026-10-02T12:00:00Z") });
        return [{ ...song }];
      }
      throw new Error(`Unexpected query: ${query}`);
    },
  };
  const handler = createForcePushTrackHandler({
    currentUser: async () => user,
    verifyOrigin: async () => { if (origin === "throw") throw new Error("Bad origin"); return origin === "void" ? undefined : origin; },
    database: async () => { databaseCalls++; return db; },
    membershipFor: async () => ({ member_id: "owner", actor_id: "member-owner" }),
    reconcile: async (_db, context) => {
      reconciles++;
      assert.equal(context.songId, songId);
      assert.equal(context.ownerMemberId, "owner");
      assert.equal(context.preserveReleaseMetadata, true);
      if (fail) throw new Error("Storage offline");
      const release = releases.get("existing-release");
      Object.assign(release, { status: "published", visibility: "public", is_chart_eligible: true });
      return { ok: true, releaseId: release.id };
    },
  });
  return { handler, songs, releases, counts: () => ({ reconciles, writes, databaseCalls }) };
}

function request(payload, { method = "POST", headers = {}, raw } = {}) {
  return new Request("https://halo.world/api/catalog/force-push-track", {
    method, headers: { "Content-Type": "application/json", ...headers },
    ...(method === "POST" ? { body: raw ?? JSON.stringify(payload) } : {}),
  });
}

assert.equal(config.path, "/api/catalog/force-push-track");
{
  const { handler, songs, releases, counts } = fixture();
  const unrelated = structuredClone(songs[1]);
  const payload = { ...savedSong, title: "Stale browser title", notes: "", salePriceCents: 1, owner_member_id: "other" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await handler(request(payload));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.track.title, "Saved title");
    assert.equal(result.track.releaseStatus, "PUBLISHED");
    assert.equal(result.track.status, "PUBLISHED");
    assert.equal(result.track.inChart, true);
    assert.equal(result.track.isLiveVisible, true);
    assert.equal(result.track.salePriceCents, 129);
    assert.equal(result.track.pushedToLiveAt, "2026-10-02T12:00:00.000Z");
  }
  assert.equal(songs.length, 2);
  assert.equal(releases.size, 1, "repeated pushes must reuse the canonical release");
  assert.equal(releases.get("existing-release").pitch, "Keep this pitch");
  assert.equal(songs[0].notes, savedSong.notes);
  assert.equal(songs[0].artist_name, savedSong.artist_name);
  assert.equal(songs[0].artwork_url, savedSong.artwork_url);
  assert.deepEqual(songs[1], unrelated);
  assert.equal(counts().reconciles, 2);
}
for (const price of [249, 0, -1]) {
  const { handler, songs } = fixture({ price, origin: "void" });
  assert.equal((await handler(request({ title: savedSong.title }))).status, 200);
  assert.equal(songs[0].sale_price_cents, price > 0 ? price : 129);
}
for (const [options, payload, expected] of [
  [{ user: null }, { id: songId }, 401],
  [{ origin: false }, { id: songId }, 403],
  [{ origin: "throw" }, { id: songId }, 403],
  [{}, {}, 400],
  [{}, [], 400],
  [{}, null, 400],
  [{}, { id: "invalid", title: savedSong.title }, 400],
  [{}, { title: "x".repeat(161) }, 400],
  [{}, { id: otherId }, 404],
  [{}, { title: "Missing song" }, 404],
  [{ duplicate: true }, { title: savedSong.title }, 409],
]) {
  const { handler, counts } = fixture(options);
  assert.equal((await handler(request(payload))).status, expected);
  assert.equal(counts().writes, 0);
  assert.equal(counts().reconciles, 0);
}
{
  const { handler, counts } = fixture();
  for (const [options, expected] of [
    [{ method: "GET" }, 405],
    [{ raw: "{" }, 400],
    [{ headers: { "Content-Type": "text/plain" } }, 415],
    [{ headers: { "Content-Length": "80001" } }, 413],
    [{ raw: JSON.stringify({ id: songId, notes: "x".repeat(80_001) }) }, 413],
  ]) assert.equal((await handler(request({ id: songId }, options))).status, expected);
  assert.equal(counts().databaseCalls, 0, "invalid requests must not touch storage");
}
{
  const { handler, counts } = fixture({ fail: true });
  const response = await handler(request({ id: songId }));
  assert.equal(response.status, 503, "pipeline failures must not claim a successful live push");
  assert.equal((await response.json()).success, undefined);
  assert.equal(counts().reconciles, 1);
}
const [page, client, publication] = await Promise.all([
  readFile(resolve(root, "song-catalog/index.html"), "utf8"),
  readFile(resolve(root, "song-catalog/song-catalog.js"), "utf8"),
  readFile(resolve(root, "netlify/lib/song-publication.mjs"), "utf8"),
]);
assert.match(page, /id="pushToShopButton" type="button">Push to Shop &amp; Charts/);
assert.match(client, /fetch\("\/api\/catalog\/force-push-track",\{method:"POST",credentials:"same-origin"/);
assert.match(client, /price:song\.salePriceCents>0\?money\(song\.salePriceCents,song\.currency\):"US\$1\.29"/);
assert.match(client, /if\(!response\.ok\|\|data\.success!==true\)throw/);
assert.match(client, /finally\{button\.disabled=false;button\.removeAttribute\("aria-busy"\)/);
assert.doesNotMatch(client, /localStorage/);
assert.match(publication, /ON CONFLICT \(id\) DO UPDATE SET/);
assert.match(publication, /is_chart_eligible = TRUE/);
{
  const song = { ...savedSong, pipeline_status: "published", explicit_lyrics: false, genre: "Soul" };
  const releases = new Map();
  const queries = [];
  const db = {
    async sql(strings, ...values) {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("FROM halo_song_catalog song")) return [song];
      if (query.includes("FROM halo_song_versions")) {
        return [{ id: otherId, version_type: "sale_master", audio_url: "https://cdn.halo.world/song.mp3" }];
      }
      if (query.includes("FROM halo_song_publication_sync")) return [];
      if (query.includes("SELECT id, owner_member_id")) return releases.has(values[0]) ? [releases.get(values[0])] : [];
      if (query.includes("UPDATE halo_release_campaigns")) {
        assert.doesNotMatch(query, /\b(?:title|artist|pitch|stream_url|artwork_url|available_versions|content_rating)\s*=/);
        const release = releases.get(values[0]);
        if (!release) return [];
        Object.assign(release, { status: "published", visibility: "public", is_chart_eligible: true });
        return [release];
      }
      if (query.includes("INSERT INTO halo_release_campaigns")) {
        const [id, owner_member_id] = values;
        const release = { id, owner_member_id, official_url: "", stream_url: "https://cdn.halo.world/song.mp3", title: "Curated release title", pitch: "Keep release metadata" };
        releases.set(id, release);
        return [release];
      }
      if (query.includes("INSERT INTO halo_song_publication_sync")) return [];
      throw new Error(`Unexpected publication query: ${query}`);
    },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await reconcilePublishedSong(db, {
      songId, ownerMemberId: "owner", recordLedger: false, preserveReleaseMetadata: true,
    });
    assert.equal(result.ok, true, "the real publication pipeline must handle external master audio");
    assert.equal(result.releaseId, "existing-release");
  }
  assert.equal(releases.size, 1);
  assert.equal(queries.filter(query => query.includes("INSERT INTO halo_release_campaigns")).length, 1);
  assert.equal(releases.get("existing-release").title, "Curated release title");
  assert.equal(releases.get("existing-release").pitch, "Keep release metadata");
  assert.equal(releases.get("existing-release").is_chart_eligible, true);
}
{
  const source = client.match(/async function pushToShop\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  for (const success of [true, false]) {
    const button = { disabled: false, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; } };
    const messages = [];
    let reloads = 0;
    const push = new Function("selectedSong", "state", "$", "message", "fetch", "loadCatalog", "money", `${source}; return pushToShop;`)(
      () => ({ id: songId, salePriceCents: null }), { authenticated: true }, () => button,
      text => messages.push(text), async (_url, options) => {
        assert.equal(button.disabled, true);
        assert.equal(button.attributes["aria-busy"], "true");
        assert.deepEqual(JSON.parse(options.body), {
          id: songId, salePriceCents: null, price: "US$1.29",
          releaseStatus: "PUBLISHED", status: "PUBLISHED", inChart: true, isLiveVisible: true,
        });
        return Response.json({ success, message: success ? "Published" : "Unavailable" }, { status: success ? 200 : 503 });
      }, async () => { reloads++; }, () => "",
    );
    await push();
    assert.equal(button.disabled, false);
    assert.equal(button.attributes["aria-busy"], undefined);
    assert.equal(reloads, success ? 1 : 0);
    assert.equal(messages.at(-1), success ? "Published" : "Unavailable");
  }
}
console.log("Shop and Charts force-push contracts passed.");
