import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FORCE_PUSH_DEFAULT_PRICE,
  ForcePushError,
  forcePushTrack,
  normalizeForcePushPayload,
  priceCentsFromInput
} from "../netlify/lib/catalog-force-push.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [handler, editorHtml, editorJs, musicClient, packageJson] = await Promise.all([
  read("netlify/functions/catalog-force-push.mjs"),
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
  return async (_db, { songId: id, ownerMemberId }) => {
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
assert.match(handler, /getUser\(\)/, "force push must require a signed-in member");
assert.match(handler, /verifyRequestOrigin\(request\)/, "force push must reject cross-origin writes");
assert.match(handler, /request\.method !== "POST"/, "force push must be POST only");
const legacyHandler = await read("netlify/functions/force-push-track.mjs");
assert.doesNotMatch(legacyHandler, /path: "\/api\/catalog\/force-push-track"/, "only one function may own the catalog force-push route");
{
  let user = null;
  let rejectOrigin = false;
  let calls = 0;
  const source = handler.replace(/^import .*;\n/gm, "").replace("export default ", "").replace(/export const config[\s\S]*$/, "");
  const run = new Function("getDatabase", "getUser", "verifyRequestOrigin", "ensureMembership", "ForcePushError", "forcePushTrack", `${source}\nreturn catalogForcePushHandler;`)(
    () => ({}), async () => user, () => { if (rejectOrigin) throw new Error("origin"); },
    async () => ({ member_id: owner, actor_id: "actor-1" }), ForcePushError,
    async (_db, options) => {
      calls++;
      assert.equal(options.ownerMemberId, owner);
      assert.equal(options.actorId, "actor-1");
      return { success: true };
    }
  );
  const request = (body = "{}", type = "application/json", method = "POST") => new Request("https://halo.world/api/catalog/force-push-track", {
    method, headers: { "Content-Type": type }, ...(method === "POST" ? { body } : {})
  });
  assert.equal((await run(request("", "application/json", "GET"))).status, 405);
  assert.equal((await run(request())).status, 401);
  user = { id: "signed-in" };
  rejectOrigin = true;
  assert.equal((await run(request())).status, 403);
  rejectOrigin = false;
  assert.equal((await run(request("{}", "text/plain"))).status, 415);
  assert.equal((await run(request("{"))).status, 400);
  assert.equal((await run(request(JSON.stringify({ title: "é".repeat(40_000) })))).status, 413, "body limit must count UTF-8 bytes, not characters");
  assert.equal(calls, 0, "invalid requests must never reach the database publication pipeline");
  assert.equal((await run(request(JSON.stringify({ notes: "é".repeat(12_000) })))).status, 200, "valid saved records above 20 KB must retain main's request-size allowance");
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
  const source = editorJs.match(/\$\("#pushToShopButton"\)\.addEventListener\("click",async event=>\{[\s\S]*?\n\}\);/)?.[0];
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
  new Function("$", "selectedSong", "fetch", "loadCatalog", source)(
    selector => selector === "#pushToShopStatus" ? status : { addEventListener: (_event, handler) => { click = handler; } },
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
    }
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
assert.equal(isChartListed({ releaseStatus: "PUBLISHED", isChartEligible: false }), true);
assert.equal(isChartListed({ inChart: true, isChartEligible: false }), true);
assert.equal(isChartListed({ inChart: true, isLiveVisible: false }), false);
assert.equal(isChartListed({ isChartEligible: false }), false, "non-chart releases must stay off the chart");
for (const flags of [{ inChart: true }, { releaseStatus: "PUBLISHED" }, { isChartEligible: true }]) {
  assert.equal(isChartListed({ ...flags, isLiveVisible: false }), false, "hidden releases must never be chart-listed");
}
assert.match(packageJson, /scripts\/catalog-force-push-contracts\.mjs/, "npm test must run force push contracts");

console.log("Catalog force push contracts passed.");
