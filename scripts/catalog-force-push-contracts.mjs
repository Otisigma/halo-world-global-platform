import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createForcePushTrackHandler, config } from "../netlify/functions/catalog-force-push-track.mjs";
import { reconcilePublishedSong } from "../netlify/lib/song-publication.mjs";
import {
  FORCE_PUSH_DEFAULT_PRICE,
  ForcePushError,
  forcePushTrack,
  normalizeForcePushPayload,
  priceCentsFromInput
} from "../netlify/lib/catalog-force-push.mjs";

{
const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [handler, editorHtml, editorJs, musicClient, packageJson] = await Promise.all([
  read("netlify/functions/catalog-force-push-track.mjs"),
  read("song-catalog/index.html"),
  read("song-catalog/song-catalog.js"),
  read("music/music.js"),
  read("package.json")
]);

const songId = "11111111-1111-4111-8111-111111111111";
const owner = "member-1";

function fakeDb(songs) {
  const queries = [];
  return {
    queries,
    async sql(strings, ...values) {
      const text = strings.join("?").replace(/\s+/g, " ").trim();
      queries.push({ text, values });
      if (text.startsWith("SELECT") && text.includes("FROM halo_song_catalog")) {
        if (text.includes("WHERE id =")) return songs.filter(song => song.id === values[0] && song.owner === values[1]);
        return songs.filter(song => song.title.toLowerCase() === String(values[0]).toLowerCase() && song.owner === values[1]);
      }
      if (text.startsWith("UPDATE halo_song_catalog")) {
        const [priceCents, currency, id, ownerId] = values;
        const song = songs.find(entry => entry.id === id && entry.owner === ownerId);
        if (!song) return [];
        Object.assign(song, { pipeline_status: "published", sale_status: "for_sale", sale_price_cents: priceCents, currency });
        return [{ id }];
      }
      if (text.startsWith("INSERT INTO halo_ledger")) return [];
      throw new Error(`Unexpected query: ${text}`);
    }
  };
}

function fakeReconcile(releases) {
  return async (_db, { songId: id, ownerMemberId, preserveReleaseMetadata }) => {
    assert.equal(preserveReleaseMetadata, true, "all publication helpers must preserve curated release metadata");
    // Mirrors the canonical publication pipeline: upsert by release id, never duplicate.
    releases.set(id, { id: `release-${id.slice(0, 8)}`, ownerMemberId, status: "published", isChartEligible: true });
    return { ok: true, releaseId: releases.get(id).id, canonicalUrl: `/music/?song=release-${id.slice(0, 8)}` };
  };
}

// Payload validation and price parsing.
assert.throws(() => normalizeForcePushPayload(null), ForcePushError);
assert.throws(() => normalizeForcePushPayload({}), /id or title is required/);
assert.throws(() => normalizeForcePushPayload({ id: "../../etc/passwd" }), /valid catalog song id/);
assert.deepEqual(normalizeForcePushPayload({ title: "  Night   Drive " }), { id: "", title: "Night Drive", priceCents: null });
assert.equal(priceCentsFromInput("US$1.29"), 129);
assert.equal(priceCentsFromInput("$2"), 200);
assert.equal(priceCentsFromInput(0.99), 99);
for (const placeholder of ["", "—", "placeholder", "0", 0, -1, null, undefined, "US$0.00"]) {
  assert.equal(priceCentsFromInput(placeholder), null, `placeholder price ${String(placeholder)} must fall back`);
}
assert.equal(FORCE_PUSH_DEFAULT_PRICE, "US$1.29");

// Force push by id: sets live/chart flags, defaults a missing price, preserves the record.
{
  const songs = [{ id: songId, owner, title: "Night Drive", rights_status: "cleared", sale_price_cents: null, currency: "USD", genre: "house" }];
  const releases = new Map();
  const db = fakeDb(songs);
  const result = await forcePushTrack(db, {
    ownerMemberId: owner,
    actorId: "actor-1",
    payload: { id: songId, title: "Night Drive", price: "placeholder" },
    reconcile: fakeReconcile(releases),
    now: () => new Date("2026-10-02T00:00:00.000Z")
  });
  assert.equal(result.success, true);
  assert.equal(result.track.releaseStatus, "PUBLISHED");
  assert.equal(result.track.status, "PUBLISHED");
  assert.equal(result.track.inChart, true);
  assert.equal(result.track.isLiveVisible, true);
  assert.equal(result.track.price, "US$1.29");
  assert.equal(result.track.forcePushedAt, "2026-10-02T00:00:00.000Z");
  assert.equal(songs[0].pipeline_status, "published");
  assert.equal(songs[0].sale_price_cents, 129);
  assert.equal(songs[0].genre, "house", "unrelated song fields must be preserved");
  const ledger = db.queries.find(query => query.text.startsWith("INSERT INTO halo_ledger"));
  assert.ok(ledger, "forced push must be timestamped in the HALO ledger");
  assert.ok(ledger.values.some(value => typeof value === "string" && value.includes("forcePushedAt")));
  assert.ok(!db.queries.some(query => /DELETE|INSERT INTO halo_song_catalog/.test(query.text)), "force push must never delete or duplicate catalog songs");

  // Idempotent repeat by title keeps one release and the existing price.
  songs[0].sale_price_cents = 199;
  const again = await forcePushTrack(fakeDb(songs), {
    ownerMemberId: owner,
    payload: { title: "night drive" },
    reconcile: fakeReconcile(releases)
  });
  assert.equal(again.songId, songId);
  assert.equal(again.track.price, "US$1.99", "existing prices must be preserved");
  assert.equal(releases.size, 1, "repeat pushes must upsert, not duplicate");
}

// Safety: unknown, foreign, and disputed songs are rejected.
await assert.rejects(
  forcePushTrack(fakeDb([{ id: songId, owner: "someone-else", title: "X", rights_status: "cleared" }]), { ownerMemberId: owner, payload: { id: songId }, reconcile: fakeReconcile(new Map()) }),
  error => error instanceof ForcePushError && error.status === 404
);
await assert.rejects(
  forcePushTrack(fakeDb([{ id: songId, owner, title: "X", rights_status: "disputed" }]), { ownerMemberId: owner, payload: { id: songId }, reconcile: fakeReconcile(new Map()) }),
  error => error instanceof ForcePushError && error.status === 409
);
{
  const songs = [
    { id: songId, owner, title: "Shared title", rights_status: "cleared" },
    { id: "22222222-2222-4222-8222-222222222222", owner, title: "Shared title", rights_status: "cleared" }
  ];
  const db = fakeDb(songs);
  await assert.rejects(
    forcePushTrack(db, { ownerMemberId: owner, payload: { id: "33333333-3333-4333-8333-333333333333", title: "Shared title" }, reconcile: fakeReconcile(new Map()) }),
    error => error instanceof ForcePushError && error.status === 404,
    "a stale id must not publish a different song with the same title"
  );
  await assert.rejects(
    forcePushTrack(db, { ownerMemberId: owner, payload: { title: "shared title" }, reconcile: fakeReconcile(new Map()) }),
    error => error instanceof ForcePushError && error.status === 409,
    "title-only requests must reject ambiguous catalog matches"
  );
  assert.ok(!db.queries.some(query => query.text.startsWith("UPDATE")), "ambiguous requests must not modify any song");
}

// Server-side route contract.
assert.match(handler, /path: "\/api\/catalog\/force-push-track"/, "force push must be served at /api/catalog/force-push-track");
assert.match(handler, /currentUser = getUser/, "force push must require a signed-in member");
assert.match(handler, /verifyOrigin\(request\)/, "force push must reject cross-origin writes");
assert.match(handler, /request\.method !== "POST"/, "force push must be POST only");
const legacyHandler = await read("netlify/functions/force-push-track.mjs");
assert.doesNotMatch(legacyHandler, /path: "\/api\/catalog\/force-push-track"/, "only one function may own the catalog force-push route");
{
  let user = null;
  let rejectOrigin = false;
  let calls = 0;
  const run = createForcePushTrackHandler({
    database: () => ({ sql: async strings => strings.join("").includes("UPDATE")
      ? [{ id: songId, title: "Track", sale_price_cents: 129, currency: "USD", pipeline_updated_at: new Date() }]
      : [{ id: songId }] }),
    currentUser: async () => user,
    verifyOrigin: () => { if (rejectOrigin) throw new Error("origin"); },
    membershipFor: async () => ({ member_id: owner, actor_id: "actor-1" }),
    reconcile: async (_db, options) => {
      calls++;
      assert.equal(options.ownerMemberId, owner);
      assert.equal(options.actorId, "actor-1");
      assert.equal(options.preserveReleaseMetadata, true);
      return { ok: true };
    }
  });
  const request = (body = JSON.stringify({ id: songId }), type = "application/json", method = "POST") => new Request("https://halo.world/api/catalog/force-push-track", {
    method, headers: { "Content-Type": type }, ...(method === "POST" ? { body } : {})
  });
  assert.equal((await run(request("", "application/json", "GET"))).status, 405);
  assert.equal((await run(request())).status, 401);
  user = { id: "signed-in" };
  assert.equal((await run(request())).status, 403);
  assert.equal(calls, 0, "non-admin requests must never publish");
  user = { id: "signed-in", appMetadata: { roles: ["admin"] } };
  rejectOrigin = true;
  assert.equal((await run(request())).status, 403);
  rejectOrigin = false;
  assert.equal((await run(request("{}", "text/plain"))).status, 415);
  assert.equal((await run(request("{"))).status, 400);
  assert.equal((await run(request(JSON.stringify({ title: "é".repeat(40_000) })))).status, 413, "body limit must count UTF-8 bytes, not characters");
  assert.equal(calls, 0, "invalid requests must never reach the database publication pipeline");
  assert.equal((await run(request(JSON.stringify({ id: songId, notes: "é".repeat(12_000) })))).status, 200, "valid saved records above 20 KB must retain main's request-size allowance");
  const response = await run(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).success, true);
  assert.equal(calls, 2);
}

// Admin editor control.
assert.match(editorHtml, /id="pushToShopButton"[^>]*>Push to Shop &amp; Charts<\/button>/, "song editor must expose Push to Shop & Charts next to save");
assert.match(editorHtml, /class="quiet-button" id="pushToShopButton"/);
assert.equal((editorHtml.match(/id="pushToShopButton"/g) || []).length, 1);
assert.equal((editorJs.match(/\$\("#pushToShopButton"\)\.addEventListener/g) || []).length, 1, "one click must produce only one publication request");
assert.match(editorJs, /\/api\/catalog\/force-push-track/, "song editor must call the server-side force push endpoint");
assert.match(editorJs, /releaseStatus:"PUBLISHED",status:"PUBLISHED",inChart:true,isLiveVisible:true/, "song editor must send live publication flags");
assert.match(editorJs, /aria-busy/, "song editor must show loading state while pushing");
assert.doesNotMatch(editorJs, /localStorage/, "song editor must not persist catalog data in the browser");

{
  const source = editorJs.match(/async function pushToShop\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, "editor must retain its single force-push handler");
  const status = { textContent: "" };
  const attributes = new Map();
  const button = {
    disabled: false,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name)
  };
  let click;
  let requests = 0;
  let reloads = 0;
  let success = true;
  click = new Function("$", "selectedSong", "fetch", "loadCatalog", "state", "message", "money", `${source};return pushToShop;`)(
    selector => selector === "#pushToShopStatus" ? status : button,
    () => ({ id: songId, title: "Night Drive", salePriceCents: null }),
    async (url, options) => {
      requests++;
      assert.equal(url, "/api/catalog/force-push-track");
      assert.equal(options.method, "POST");
      assert.equal(options.credentials, "same-origin");
      assert.equal(button.disabled, true);
      assert.equal(attributes.get("aria-busy"), "true");
      const payload = JSON.parse(options.body);
      assert.equal(payload.id, songId);
      assert.equal(payload.inChart, true);
      assert.equal(payload.price, "US$1.29");
      return { ok: success, json: async () => ({ success, message: success ? "Published successfully" : "Publication failed" }) };
    },
    async id => {
      reloads++;
      assert.equal(id, songId);
      throw new Error("Catalog refresh unavailable");
    }, { authenticated: true }, () => {}, () => ""
  );
  await click({ currentTarget: button });
  assert.equal(requests, 1, "one click must send one publication request");
  assert.equal(reloads, 1);
  assert.equal(status.textContent, "Published successfully", "a failed refresh must not report a successful push as failed");
  assert.equal(button.disabled, false);
  assert.equal(attributes.has("aria-busy"), false);
  success = false;
  await click({ currentTarget: button });
  assert.equal(requests, 2);
  assert.equal(reloads, 1, "failed publication must not reload the catalog");
  assert.equal(status.textContent, "Publication failed");
  assert.equal(button.disabled, false);
  assert.equal(attributes.has("aria-busy"), false);
}

// Storefront chart filter.
const filterSource = musicClient.match(/function isChartRelease\(release\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(filterSource, "music client must define the chart listing filter");
const isChartListed = new Function(`${filterSource}; return isChartRelease;`)();
assert.equal(isChartListed({ isChartEligible: true }), true);
assert.equal(isChartListed({ inChart: true }), true);
assert.equal(isChartListed({ releaseStatus: "PUBLISHED" }), true);
assert.equal(isChartListed({ releaseStatus: "PUBLISHED", isChartEligible: false }), false);
assert.equal(isChartListed({ inChart: true, isChartEligible: false }), false);
assert.equal(isChartListed({ inChart: true, isLiveVisible: false }), false);
assert.equal(isChartListed({ isChartEligible: false }), false, "non-chart releases must stay off the chart");
for (const flags of [{ inChart: true }, { releaseStatus: "PUBLISHED" }, { isChartEligible: true }]) {
  assert.equal(isChartListed({ ...flags, isLiveVisible: false }), false, "hidden releases must never be chart-listed");
}
assert.match(packageJson, /scripts\/catalog-force-push-contracts\.mjs/, "npm test must run force push contracts");

console.log("Catalog force push contracts passed.");
}

const root = resolve(import.meta.dirname, "..");
const songId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const savedSong = {
  id: songId, owner_member_id: "owner", title: "Saved title", artist_name: "Saved artist",
  notes: "Keep these notes", artwork_url: "/cover.jpg", sale_price_cents: null,
  currency: "USD", status: "active", source_release_id: "existing-release",
};

function fixture({ user = { id: "owner", appMetadata: { roles: ["admin"] } }, origin = true, price = null, fail = false, duplicate = false, rights = "cleared" } = {}) {
  const songs = [
    { ...savedSong, sale_price_cents: price, rights_status: rights },
    { ...savedSong, id: otherId, owner_member_id: duplicate ? "owner" : "other", notes: "Unrelated data" },
  ];
  const releases = new Map([["existing-release", { id: "existing-release", pitch: "Keep this pitch" }]]);
  let reconciles = 0;
  let writes = 0;
  let databaseCalls = 0;
  const db = {
    async sql(strings, ...values) {
      const query = strings.join("?");
      if (query.includes("SELECT id, rights_status FROM halo_song_catalog")) {
        const [key, owner] = values;
        return songs.filter(song => song.owner_member_id === owner && song.status === "active"
          && (query.includes("LOWER(title)") ? song.title.toLowerCase() === key.toLowerCase() : song.id === key)).map(song => ({ id: song.id, rights_status: song.rights_status }));
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
  assert.equal((await handler(request({ title: savedSong.title.toLowerCase() }))).status, 200);
  assert.equal(songs[0].sale_price_cents, price > 0 ? price : 129);
}
for (const [options, payload, expected] of [
  [{ user: null }, { id: songId }, 401],
  [{ user: { id: "owner", userMetadata: { roles: ["admin"] } } }, { id: songId }, 403],
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
  [{ rights: "disputed" }, { id: songId }, 409],
  [{}, { id: "33333333-3333-4333-8333-333333333333", title: savedSong.title }, 404],
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
assert.match(page, /id="pushToShopButton" type="button" hidden>Push to Shop &amp; Charts/);
assert.match(client, /\$\("#pushToShopButton"\)\.hidden=!data\.viewer\?\.canForcePush/);
assert.match(await readFile(resolve(import.meta.dirname, "../netlify/functions/song-catalog.ts"), "utf8"), /canForcePush: isOwner\(user\)/);
assert.match(client, /fetch\("\/api\/catalog\/force-push-track",\{method:"POST",credentials:"same-origin"/);
assert.match(client, /price:hasPrice\?money\(cents,song\.currency\):"US\$1\.29"/);
assert.match(client, /if\(!response\.ok\|\|data\.success!==true\)throw/);
assert.match(client, /finally\{button\.disabled=false;button\.removeAttribute\("aria-busy"\)/);
assert.doesNotMatch(client, /localStorage/);
assert.match(publication, /ON CONFLICT \(id\) DO UPDATE SET/);
assert.match(publication, /is_chart_eligible = TRUE/);
{
  const song = { ...savedSong, pipeline_status: "published", explicit_lyrics: false, genre: "Soul" };
  const releases = new Map();
  let sync = null;
  const queries = [];
  const db = {
    async sql(strings, ...values) {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("FROM halo_song_catalog song")) return [song];
      if (query.includes("FROM halo_song_versions")) {
        return [{ id: otherId, version_type: "sale_master", audio_url: "https://cdn.halo.world/song.mp3" }];
      }
      if (query.includes("FROM halo_song_publication_sync")) return sync ? [sync] : [];
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
      if (query.includes("INSERT INTO halo_song_publication_sync")) {
        sync = { release_id: values[2], details: JSON.parse(values[8]) };
        return [];
      }
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
  assert.equal(sync.details.preserveReleaseMetadata, true, "force-push must persist the metadata preservation policy");
  const scheduledResult = await reconcilePublishedSong(db, {
    songId, ownerMemberId: "owner", recordLedger: false,
  });
  assert.equal(scheduledResult.ok, true);
  assert.equal(sync.details.preserveReleaseMetadata, true, "normal reconciliation must retain the policy");
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
    const status = { textContent: "" };
    let reloads = 0;
    const push = new Function("selectedSong", "state", "$", "message", "fetch", "loadCatalog", "money", `${source}; return pushToShop;`)(
      () => ({ id: songId, salePriceCents: null }), { authenticated: true }, selector => selector === "#pushToShopStatus" ? status : button,
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
