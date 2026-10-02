import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FALLBACK_PRICE_CENTS,
  FORCE_PUSH_PATH,
  forcePushTrack,
  formatPriceLabel,
  parseForcePushPayload
} from "../netlify/lib/catalog-force-push.mjs";

const root = resolve(import.meta.dirname, "..");
const [handlerSource, editorPage, editorClient, storefrontClient] = await Promise.all([
  readFile(resolve(root, "netlify/functions/catalog-force-push.mjs"), "utf8"),
  readFile(resolve(root, "song-catalog/index.html"), "utf8"),
  readFile(resolve(root, "song-catalog/song-catalog.js"), "utf8"),
  readFile(resolve(root, "music/music.js"), "utf8")
]);

// Route + server-side safety.
assert.equal(FORCE_PUSH_PATH, "/api/catalog/force-push-track");
assert.match(handlerSource, /export const config = \{ path: "\/api\/catalog\/force-push-track" \}/, "force push route must be a literal Netlify path");
assert.match(handlerSource, /verifyRequestOrigin\(request\)/, "force push must reject cross-origin requests");
assert.match(handlerSource, /getUser\(\)/, "force push must require a signed-in member");
assert.match(handlerSource, /reconcile: reconcilePublishedSong/, "force push must publish through the existing song publication pipeline");
assert.doesNotMatch(handlerSource, /writeFile|node:fs/, "force push must not write catalog files from a request");

// Payload validation.
assert.equal(parseForcePushPayload(null).ok, false);
assert.equal(parseForcePushPayload([]).ok, false);
assert.equal(parseForcePushPayload({}).ok, false, "id or title is required");
assert.equal(parseForcePushPayload({ id: "../../etc/passwd" }).ok, false, "unsafe ids are rejected");
assert.deepEqual(parseForcePushPayload({ id: "0f8fad5b-d9cb-469f-a165-70867728950e" }), { ok: true, songId: "0f8fad5b-d9cb-469f-a165-70867728950e", releaseId: "", title: "" });
assert.deepEqual(parseForcePushPayload({ id: "blessed-single" }), { ok: true, songId: "", releaseId: "blessed-single", title: "" });
assert.deepEqual(parseForcePushPayload({ title: "  Blessed   Night " }), { ok: true, songId: "", releaseId: "", title: "Blessed Night" });
assert.equal(formatPriceLabel(FALLBACK_PRICE_CENTS, "USD"), "US$1.29");

// In-memory catalog behind a tagged-template fake of the database client.
function createFakeDb(songs) {
  const releases = new Map();
  const calls = [];
  const db = {
    async sql(strings, ...values) {
      const text = strings.join("?");
      calls.push(text);
      const active = song => song.status === "active";
      const owned = (song, owner) => !owner || song.owner_member_id === owner;
      if (/FROM halo_song_catalog\s+WHERE id = /.test(text)) {
        const [id, owner] = values;
        return songs.filter(song => song.id === id && active(song) && owned(song, owner)).slice(0, 1);
      }
      if (/FROM halo_song_catalog\s+WHERE source_release_id = /.test(text)) {
        const [releaseId, owner] = values;
        return songs.filter(song => song.source_release_id === releaseId && active(song) && owned(song, owner)).slice(0, 1);
      }
      if (/FROM halo_song_catalog\s+WHERE LOWER\(title\)/.test(text)) {
        const [title, owner] = values;
        return songs.filter(song => song.title.toLowerCase() === title.toLowerCase() && active(song) && owned(song, owner)).slice(0, 1);
      }
      if (/UPDATE halo_song_catalog/.test(text)) {
        const song = songs.find(item => item.id === values[1] && active(item));
        if (!song) return [];
        song.pipeline_status = "published";
        song.pipeline_updated_at = new Date("2026-10-02T12:00:00Z");
        if (!(song.sale_price_cents > 0)) {
          song.sale_price_cents = values[0];
          song.currency = "USD";
        }
        return [{ id: song.id, sale_price_cents: song.sale_price_cents, currency: song.currency, pipeline_updated_at: song.pipeline_updated_at }];
      }
      if (/UPDATE halo_release_campaigns/.test(text)) {
        const release = releases.get(values[0]);
        if (release) Object.assign(release, { status: "published", visibility: "public", is_chart_eligible: true });
        return [];
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };
  // Mirrors ensureReleaseCampaign: upsert by release id, never duplicating rows.
  const reconcile = async (_db, { songId, ownerMemberId }) => {
    const song = songs.find(item => item.id === songId && item.owner_member_id === ownerMemberId && item.pipeline_status === "published");
    if (!song) return { ok: false, skipped: true };
    const releaseId = song.source_release_id || song.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    song.source_release_id = releaseId;
    const existing = releases.get(releaseId) || { pitch: "Keep me", is_chart_eligible: false, visibility: "private", status: "draft" };
    releases.set(releaseId, { ...existing, id: releaseId, title: song.title, status: "published", is_chart_eligible: true, visibility: "public" });
    return { ok: true, releaseId };
  };
  return { db, reconcile, releases, calls };
}

const memberSong = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  owner_member_id: "member-a",
  title: "Blessed Night",
  artist_name: "HALO",
  source_release_id: "",
  sale_price_cents: null,
  currency: "USD",
  pipeline_status: "approved",
  status: "active",
  notes: "Keep this note"
};
const pricedSong = { ...memberSong, id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", title: "Priced Song", sale_price_cents: 199, pipeline_status: "published" };
const otherSong = { ...memberSong, id: "16fd2706-8baf-433b-82eb-8c7fada847da", owner_member_id: "member-b", title: "Someone Else" };
{
  const fake = createFakeDb([memberSong, pricedSong, otherSong]);
  const options = { memberId: "member-a", actorId: "actor-a", reconcile: fake.reconcile };

  const first = await forcePushTrack(fake.db, { id: memberSong.id, title: memberSong.title, notes: "browser overwrite" }, options);
  assert.equal(first.status, 200);
  assert.equal(first.body.success, true);
  assert.deepEqual(
    { releaseStatus: first.body.track.releaseStatus, status: first.body.track.status, inChart: first.body.track.inChart, isLiveVisible: first.body.track.isLiveVisible, price: first.body.track.price },
    { releaseStatus: "PUBLISHED", status: "PUBLISHED", inChart: true, isLiveVisible: true, price: "US$1.29" }
  );
  assert.equal(first.body.track.pushedToLiveAt, "2026-10-02T12:00:00.000Z");
  assert.equal(memberSong.notes, "Keep this note", "unrelated song fields are never overwritten from the browser payload");
  assert.equal(memberSong.sale_price_cents, FALLBACK_PRICE_CENTS, "missing price falls back to US$1.29");

  const again = await forcePushTrack(fake.db, { title: "blessed night" }, options);
  assert.equal(again.status, 200, "title lookup is case-insensitive");
  assert.equal(fake.releases.size, 1, "repeated pushes upsert the same release instead of duplicating it");
  assert.equal(fake.releases.get(first.body.track.releaseId).pitch, "Keep me", "existing release fields are preserved");

  const priced = await forcePushTrack(fake.db, { id: pricedSong.id }, options);
  assert.equal(priced.body.track.price, "US$1.99", "a real price is never replaced by the fallback");
  assert.equal(priced.body.track.priceFallbackApplied, false);

  const byRelease = await forcePushTrack(fake.db, { id: first.body.track.releaseId }, options);
  assert.equal(byRelease.status, 200, "release slugs resolve to their catalog song");
  assert.equal(byRelease.body.track.id, memberSong.id);

  const foreign = await forcePushTrack(fake.db, { id: otherSong.id }, options);
  assert.equal(foreign.status, 404, "members cannot push songs they do not own");
  assert.equal(otherSong.pipeline_status, "approved");

  const admin = await forcePushTrack(fake.db, { id: otherSong.id }, { ...options, isAdmin: true });
  assert.equal(admin.status, 200, "HALO admins can push any active catalog song");
  assert.equal(fake.releases.size, 3);

  const missing = await forcePushTrack(fake.db, { title: "Does Not Exist" }, options);
  assert.equal(missing.status, 404, "unknown tracks are not invented from browser input");
  assert.equal(fake.releases.size, 3);

  const invalid = await forcePushTrack(fake.db, {}, options);
  assert.equal(invalid.status, 400);
  assert.ok(!fake.calls.some(text => /DELETE/i.test(text)), "force push never deletes catalog data");
}

// Admin editor control.
assert.match(editorPage, /id="pushToShopButton"[^>]*>⚡ Push to Shop &amp; Charts<\/button>/, "track editor must expose the Push to Shop & Charts control");
assert.match(editorPage, /type="submit">Save \+ review<\/button><button[^>]*id="pushToShopButton"/, "push control must sit next to the save control");
assert.match(editorPage, /id="pushToShopStatus" role="status"/, "push control must announce progress and results");
assert.match(editorClient, /fetch\("\/api\/catalog\/force-push-track"/, "editor must push through the server-side catalog API");
assert.match(editorClient, /aria-busy","true"\);button\.textContent="Pushing…"/, "editor must show a loading state while pushing");
assert.match(editorClient, /LIVE ON SHOP & CHARTS ✓/, "editor must confirm a successful push");
assert.match(editorClient, /Push failed: /, "editor must surface push failures");
assert.doesNotMatch(editorClient, /localStorage/, "editor must not fake a successful push through browser storage");

// Storefront chart filter.
{
  const source = storefrontClient.match(/function isChartListed\(release\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source, "storefront must define isChartListed");
  const isChartListed = new Function(`${source}\nreturn isChartListed;`)();
  const listed = [
    { id: "eligible", isChartEligible: true },
    { id: "forced", inChart: true },
    { id: "published", releaseStatus: "PUBLISHED" },
    { id: "hidden", inChart: true, isLiveVisible: false },
    { id: "hidden-published", releaseStatus: "PUBLISHED", isLiveVisible: false },
    { id: "listening-only", isChartEligible: false }
  ].filter(isChartListed).map(release => release.id);
  assert.deepEqual(listed, ["eligible", "forced", "published"], "chart must include live chart-eligible or published tracks only");
  assert.match(storefrontClient, /if \(!isChartListed\(release\)\) \{\s*logMusicIssue\("music_chart_eligibility_skipped"/, "chart ranking must use the shared chart filter");
}

console.log("Catalog force push contracts passed.");
