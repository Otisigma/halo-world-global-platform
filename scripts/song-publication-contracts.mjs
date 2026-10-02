import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveDreamweaverPageFlow } from "../netlify/lib/dreamweaver-page-manager.mjs";
import { forcePushTrack } from "../netlify/lib/song-publication.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [helper, manager, healthHelper, migration, reconcileFunction, scheduledReconcileFunction, unifiedUpload, uploadPipeline, catalogApi, dreamweaver, releaseCatalog, releaseLink] = await Promise.all([
  read("netlify/lib/song-publication.mjs"),
  read("netlify/lib/dreamweaver-page-manager.mjs"),
  read("netlify/lib/song-publication-health.mjs"),
  read("netlify/database/migrations/20260919130000_create_song_publication_sync.sql"),
  read("netlify/functions/song-publication-reconcile.mjs"),
  read("netlify/functions/song-publication-reconcile-scheduled.mjs"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/upload-pipeline.mjs"),
  read("netlify/functions/song-catalog.ts"),
  read("dreamweaver/dreamweaver.js"),
  read("netlify/functions/release-catalog.mjs"),
  read("netlify/functions/release-link.mjs"),
]);
const sampleSongId = "11111111-1111-4111-8111-111111111111";
const forcePushApi = await read("netlify/functions/force-push-track.mjs");
assert.match(forcePushApi, /path: "\/api\/catalog\/force-push-track"/);
assert.match(forcePushApi, /getUser\(\)/);
assert.match(forcePushApi, /verifyRequestOrigin\(request\)/);
assert.match(forcePushApi, /Buffer\.byteLength\(body, "utf8"\)/, "size checks must not rely only on content-length");

{
  const membership = { member_id: "owner", actor_id: "actor" };
  const song = {
    id: sampleSongId, owner_member_id: "owner", title: "Keep my title", artist_name: "Artist",
    pipeline_status: "uploaded", sale_price_cents: null, currency: "USD",
    artwork_url: "https://cdn.halo.world/cover.jpg", notes: "Keep my notes",
    source_release_id: "existing-release", rights_status: "cleared",
  };
  const releases = new Map();
  const statements = [];
  let missing = false;
  let ambiguous = false;
  let failRelease = false;
  const db = { sql: async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    statements.push({ query, values });
    if (query.startsWith("SELECT id FROM halo_song_catalog")) {
      assert.equal(values[1], "owner", "lookups must be owner scoped");
      if (missing) return [];
      return ambiguous ? [{ id: song.id }, { id: "other" }] : [{ id: song.id }];
    }
    if (query.startsWith("UPDATE halo_song_catalog SET pipeline_status")) {
      assert.equal(values[1], "owner", "writes must be owner scoped");
      song.pipeline_status = "published";
      if (!(song.sale_price_cents > 0)) { song.sale_price_cents = 129; song.currency = "USD"; }
      song.pipeline_updated_at = "2026-10-02T12:00:00.000Z";
      return [{ ...song }];
    }
    if (query.includes("FROM halo_song_catalog song")) return [{ ...song }];
    if (query.includes("FROM halo_song_versions")) return [];
    if (query.includes("FROM halo_song_publication_sync")) return [];
    if (query.startsWith("SELECT id, owner_member_id FROM halo_release_campaigns")) {
      return [{ id: song.source_release_id, owner_member_id: song.owner_member_id }];
    }
    if (query.startsWith("INSERT INTO halo_release_campaigns")) {
      if (failRelease) throw new Error("Storage unavailable");
      assert.match(query, /ON CONFLICT \(id\) DO UPDATE/, "release publication must be idempotent");
      const release = { id: values[0], official_url: values[8], stream_url: values.at(-1) };
      releases.set(release.id, release);
      return [release];
    }
    if (query.startsWith("INSERT INTO halo_song_publication_sync") || query.startsWith("INSERT INTO halo_ledger")) return [];
    throw new Error(`Unexpected publication query: ${query}`);
  }};
  const result = await forcePushTrack(db, {
    id: song.id, title: "Do not overwrite", notes: "", owner_member_id: "attacker",
    price: "US$0.01", releaseStatus: "READY",
  }, membership);
  assert.equal(result.success, true);
  assert.equal(result.track.price, "US$1.29");
  assert.equal(result.track.pushedToLiveAt, song.pipeline_updated_at);
  assert.equal(result.track.releaseStatus, "PUBLISHED");
  assert.equal(result.track.status, "PUBLISHED");
  assert.equal(result.track.inChart, true);
  assert.equal(result.track.isLiveVisible, true);
  assert.equal(song.title, "Keep my title");
  assert.equal(song.notes, "Keep my notes");
  assert.equal(song.artwork_url, "https://cdn.halo.world/cover.jpg");
  assert.equal(song.owner_member_id, "owner");
  song.sale_price_cents = 249;
  song.currency = "EUR";
  assert.equal((await forcePushTrack(db, { title: song.title }, membership)).track.price, "EUR 2.49");
  assert.equal(releases.size, 1, "repeated pushes must reuse the existing release");
  for (const invalid of [null, [], {}, { id: "bad-id" }, { title: " " }]) {
    const count = statements.length;
    await assert.rejects(forcePushTrack(db, invalid, membership), { status: 400 });
    assert.equal(statements.length, count, "invalid payloads must not write anything");
  }
  missing = true;
  await assert.rejects(forcePushTrack(db, { id: song.id }, membership), { status: 404 });
  missing = false;
  ambiguous = true;
  await assert.rejects(forcePushTrack(db, { title: song.title }, membership), { status: 409 });
  ambiguous = false;
  failRelease = true;
  await assert.rejects(forcePushTrack(db, { id: song.id }, membership), /Storage unavailable/, "failed sync must not report success");
  assert.ok(statements.every(({ query }) => !/\bDELETE\b|\bTRUNCATE\b/.test(query)), "force pushes must never delete catalog data");
}

{
  let user = null;
  let rejectOrigin = false;
  let calls = 0;
  const source = forcePushApi.replace(/^import .*;\n/gm, "").replace("export default ", "").replace(/export const config[\s\S]*$/, "");
  const handler = new Function("getDatabase", "getUser", "verifyRequestOrigin", "ensureMembership", "forcePushTrack", `${source}\nreturn forcePushTrackHandler;`)(
    () => ({}), async () => user, () => { if (rejectOrigin) throw new Error("origin"); },
    async () => ({ member_id: "owner" }), async () => { calls++; return { success: true }; }
  );
  const request = (body = "{}", method = "POST") => new Request("https://halo.world/api/catalog/force-push-track", {
    method, ...(method === "POST" ? { body } : {}),
  });
  assert.equal((await handler(request("", "GET"))).status, 405);
  assert.equal((await handler(request())).status, 401);
  user = { id: "signed-in" };
  rejectOrigin = true;
  assert.equal((await handler(request())).status, 403);
  rejectOrigin = false;
  assert.equal((await handler(request("{"))).status, 400);
  assert.equal((await handler(request(" ".repeat(80_001)))).status, 413);
  assert.equal(calls, 0, "rejected requests must never publish");
  const response = await handler(request('{"id":"track"}'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).success, true);
}

{
  const editor = await read("song-catalog/song-catalog.js");
  const page = await read("song-catalog/index.html");
  assert.match(page, /id="pushToShopButton" type="button">Push to Shop &amp; Charts/);
  assert.match(page, /id="pushToShopStatus" role="status" aria-live="polite"/);
  const source = editor.match(/\$\("#pushToShopButton"\)\.addEventListener\("click",async event=>\{[\s\S]*?\n\}\);/)?.[0];
  assert.ok(source, "editor must wire the force-push action");
  const status = { textContent: "" };
  const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
  let click;
  let track = { id: sampleSongId, title: "Test track", salePriceCents: null, currency: "USD" };
  let fail = false;
  let refreshed = "";
  new Function("$", "selectedSong", "fetch", "loadCatalog", source)(
    selector => selector === "#pushToShopStatus" ? status : { addEventListener: (_name, handler) => { click = handler; } },
    () => track,
    async (url, options) => {
      assert.equal(button.disabled, true, "push must be disabled while the request is running");
      assert.equal(status.textContent, "Pushing to Shop & Charts…");
      assert.equal(url, "/api/catalog/force-push-track");
      assert.equal(options.credentials, "same-origin");
      const payload = JSON.parse(options.body);
      assert.equal(payload.releaseStatus, "PUBLISHED");
      assert.equal(payload.status, "PUBLISHED");
      assert.equal(payload.inChart, true);
      assert.equal(payload.isLiveVisible, true);
      assert.equal(payload.price, "US$1.29");
      if (fail) throw new Error("Backend unavailable");
      return { ok: true, json: async () => ({ success: true, message: "Live on Shop & Charts" }) };
    },
    async id => { refreshed = id; }
  );
  await click({ currentTarget: button });
  assert.equal(refreshed, sampleSongId);
  assert.equal(status.textContent, "Live on Shop & Charts");
  assert.equal(button.disabled, false);
  fail = true;
  refreshed = "";
  await click({ currentTarget: button });
  assert.equal(status.textContent, "Backend unavailable", "offline publication must fail visibly");
  assert.equal(refreshed, "", "offline publication must not report a local save as live");
  assert.equal(button.disabled, false);
  track = null;
  await click({ currentTarget: button });
  assert.equal(status.textContent, "Select and save a track first.");
}
const managedDreamweaverFlow = resolveDreamweaverPageFlow(sampleSongId, {
  mixId: "sample-release",
  publicUrl: "/music/?song=sample-release",
  streamUrl: "https://cdn.halo.world/audio/sample-track.mp3",
  relatedUrls: ["/api/release-link?slug=sample-release&audience=fan"],
  promoUrls: ["/release-kit.html?slug=sample-release&audience=fan"],
});
const hyperfollowDreamweaverFlow = resolveDreamweaverPageFlow(sampleSongId, {
  publicUrl: "/music/?song=sample-release",
  officialUrl: "https://distrokid.com/hyperfollow/owenanthony/sample-track",
});

assert.match(helper, /halo_release_campaigns/, "publication helper must upsert public release campaigns");
assert.match(helper, /halo_release_audio_versions/, "publication helper must sync release audio versions from song versions");
assert.match(helper, /halo_radio_tracks/, "publication helper must reconcile radio track fan-out");
assert.match(helper, /halo_song_publication_sync/, "publication helper must persist durable publication sync state");
assert.match(helper, /appendLedgerEntry/, "publication helper must write ledger entries for reconciliation results");
assert.match(helper, /resolveDreamweaverPageFlow/, "publication helper must delegate Dreamweaver page decisions to the dedicated manager");
assert.match(helper, /radio_master_missing_or_not_uploaded/, "publication helper must keep a deterministic radio fallback reason");
assert.match(helper, /\/music\/\?song=/, "publication helper must derive canonical public song URLs");
assert.match(helper, /destinationUrl/, "publication helper must persist the resolved Dreamweaver destination");
assert.match(helper, /dreamweaverStorefrontPath/, "publication helper must set Dreamweaver storefront pages as release entry routes");
assert.ok(helper.includes("official_url = CASE") && helper.includes("official_url ~* '^/api/song-catalog/audio\\\\?(?:[^#]*&)?versionId=") && helper.includes("official_url ~* '^/dreamweaver/satellite/"), "publication helper must replace legacy song-catalog audio and satellite navigation URLs during release upserts");

assert.match(manager, /isHyperFollowUrl/, "Dreamweaver page manager must detect HyperFollow URLs");
assert.match(manager, /manage_dreamweaver_song_page/, "Dreamweaver page manager must have a single page-management purpose");
assert.match(manager, /buildDreamweaverSongPage/, "Dreamweaver page manager must expose a shared generated-page builder");
assert.match(manager, /dreamweaverHubPath/, "Dreamweaver page manager must define a dedicated canonical hub resolver");
assert.equal(managedDreamweaverFlow.managed, true, "songs without HyperFollow must get a managed Dreamweaver page");
assert.equal(managedDreamweaverFlow.routeMode, "dreamweaver_page", "non-HyperFollow songs must resolve to Dreamweaver page route mode");
assert.equal(managedDreamweaverFlow.hubUrl, "/dreamweaver/?mix=sample-release", "Dreamweaver manager must emit a canonical mix-aware hub URL");
assert.equal(managedDreamweaverFlow.launchUrl, "/dreamweaver/?mix=sample-release", "songs without HyperFollow must launch into the Dreamweaver hub flow");
assert.equal(managedDreamweaverFlow.page?.route, `/dreamweaver/satellite/${sampleSongId}/`, "Dreamweaver manager must preserve deterministic satellite routes");
assert.equal(managedDreamweaverFlow.destinationUrl, managedDreamweaverFlow.page?.experienceUrl, "managed releases must expose the generated Dreamweaver page as the public doorway");
assert.equal(managedDreamweaverFlow.page?.hubUrl, "/dreamweaver/?mix=sample-release", "Dreamweaver page metadata must expose canonical hub URL");
assert.ok(
  managedDreamweaverFlow.loop?.linkedPages?.includes("/music/?song=sample-release")
    && managedDreamweaverFlow.loop?.linkedPages?.includes("/api/release-link?slug=sample-release&audience=fan")
    && managedDreamweaverFlow.loop?.linkedPages?.includes("/release-kit.html?slug=sample-release&audience=fan"),
  "Dreamweaver loop metadata must link hub, sales/release pages, and related promo pages"
);
assert.equal(managedDreamweaverFlow.manager?.id, `dreamweaver-page-manager-${sampleSongId}`, "Dreamweaver page manager IDs must be deterministic per song");
assert.equal(managedDreamweaverFlow.page?.pageAgent?.id, `dreamweaver-page-manager-${sampleSongId}`, "generated Dreamweaver pages must expose the dedicated page manager identity");
assert.equal(hyperfollowDreamweaverFlow.hasHyperfollow, true, "HyperFollow releases must be detected");
assert.equal(hyperfollowDreamweaverFlow.managed, false, "HyperFollow releases must not be replaced by managed Dreamweaver pages");
assert.equal(hyperfollowDreamweaverFlow.routeMode, "hyperfollow", "HyperFollow releases must report the HyperFollow route mode");
assert.equal(hyperfollowDreamweaverFlow.destinationUrl, "https://distrokid.com/hyperfollow/owenanthony/sample-track", "HyperFollow releases must preserve the HyperFollow doorway");
assert.equal(hyperfollowDreamweaverFlow.launchUrl, "https://distrokid.com/hyperfollow/owenanthony/sample-track", "HyperFollow releases must keep their existing HyperFollow destination");
assert.ok(
  hyperfollowDreamweaverFlow.loop?.linkedPages?.includes("https://distrokid.com/hyperfollow/owenanthony/sample-track"),
  "HyperFollow loop metadata must retain the HyperFollow destination"
);
assert.ok(
  !hyperfollowDreamweaverFlow.loop?.linkedPages?.some(page => page.startsWith("/dreamweaver/?mix=")),
  "HyperFollow loop metadata must not advertise managed Dreamweaver hub routing"
);
assert.match(helper, /buildPublicationHealth/, "publication helper must derive artist-facing health snapshots during reconciliation");
assert.match(helper, /errorStreak/, "publication helper must track deterministic retry escalation state");
assert.match(helper, /COALESCE\(sync\.details->>'escalatedAt', ''\) = ''/, "publication batch reconcile must stop auto-retrying escalated rows until the song changes again");
assert.match(helper, /sync\.last_reconciled_at < NOW\(\) - INTERVAL '15 minutes'/, "healthy published songs must be checked on the monitor cadence");
assert.match(helper, /ORDER BY sync\.last_reconciled_at ASC NULLS FIRST, song\.updated_at DESC/, "limited monitor batches must check never-reconciled and oldest songs first");
assert.match(helper, /fallbackCanonicalUrl = existingSync\?\.canonical_url \|\| ""/, "failures must keep only previously verified canonical routes");
assert.match(helper, /publicationHealth: health/, "manual reconciliation must return the shared health snapshot");
assert.match(helper, /routeMode\)\s*\? "ready"/, "managed and HyperFollow sharing must persist a schema-supported readiness status");
assert.match(healthHelper, /published_and_fully_distributed/, "publication health helper must classify fully distributed songs");
assert.match(healthHelper, /awaiting_release_propagation/, "publication health helper must classify release propagation waits");
assert.match(healthHelper, /awaiting_radio_ready_assets/, "publication health helper must classify radio asset waits");
assert.match(healthHelper, /awaiting_dreamweaver_share_readiness/, "publication health helper must classify Dreamweaver share waits");
assert.match(healthHelper, /waiting_on_artist_action/, "publication health helper must classify artist-owned blockers");
assert.match(healthHelper, /waiting_on_internal_repair/, "publication health helper must classify internal repair states");
assert.match(healthHelper, /escalated/, "publication health helper must classify escalated publication issues");
assert.match(healthHelper, /recommendedFixes/, "publication health helper must return deterministic artist guidance");
assert.match(healthHelper, /agentTeam/, "publication health helper must expose the distributor agent team state");

assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_song_publication_sync/, "migration must create durable publication sync storage");
assert.match(migration, /release_status/, "migration must track public release reconciliation state");
assert.match(migration, /radio_status/, "migration must track radio reconciliation state");
assert.match(migration, /dreamweaver_status/, "migration must track Dreamweaver sharing readiness");

assert.match(reconcileFunction, /reconcilePublishedSongs/, "manual reconciler must invoke published-song repair");
assert.match(reconcileFunction, /path: "\/api\/song-publication-reconcile"/, "reconciler must expose a manual repair endpoint");
assert.doesNotMatch(reconcileFunction, /schedule:/, "manual reconciler must not also be configured as a scheduled function");
assert.match(scheduledReconcileFunction, /runReconcile/, "scheduled reconciler must invoke published-song repair");
assert.match(scheduledReconcileFunction, /schedule: "\*\/15 \* \* \* \*"/, "scheduled reconciler must run on an automated cadence");
assert.doesNotMatch(scheduledReconcileFunction, /path:/, "scheduled reconciler must not specify a custom path");

assert.match(unifiedUpload, /reconcilePublishedSong/, "unified upload pipeline must trigger publication fan-out on publish");
assert.match(uploadPipeline, /reconcilePublishedSong/, "upload pipeline must trigger publication fan-out on publish");
assert.match(catalogApi, /attachPublicationHealth/, "song catalog API must attach publication health to artist songs");
assert.match(catalogApi, /attachPublicationHealthToSongs/, "song catalog API must reuse the deterministic publication health helper");
assert.match(catalogApi, /payload\.action === "recheck_publication"/, "song catalog must offer manual health rechecks");
assert.match(catalogApi, /eq\(songs\.ownerMemberId, membership\.member_id\)[\s\S]*?eq\(songs\.pipelineStatus, "published"\)/, "manual rechecks must require ownership and published state");
assert.match(dreamweaver, /new URL\("\/music\/", location\.origin\)/, "Dreamweaver share flow must target the canonical published-song URL");
assert.match(dreamweaver, /dreamweaverPage\?\.manager/, "Dreamweaver page must use the dedicated page manager metadata when available");
assert.match(dreamweaver, /preferredReleaseDoorway/, "Dreamweaver page must prefer resolved release doorway metadata");
assert.match(releaseCatalog, /dreamweaverPage/, "release catalog must expose Dreamweaver page metadata for song-linked releases");
assert.match(releaseCatalog, /resolveDreamweaverPageFlow/, "release catalog must derive Dreamweaver page state through the shared manager");
assert.match(releaseCatalog, /dreamweaverHubUrl/, "release catalog must serialize canonical Dreamweaver hub metadata");
assert.match(releaseCatalog, /dreamweaverLoop/, "release catalog must serialize linked Dreamweaver loop metadata");
assert.match(releaseCatalog, /entryExperience/, "release catalog must expose the resolved entry mode");
assert.match(releaseCatalog, /entryUrl/, "release catalog must expose the resolved entry URL");
assert.match(releaseLink, /remapLegacyAudioDestination/, "release-link handler must guard against legacy song-catalog audio entry URLs");
assert.match(releaseLink, /dreamweaverStorefrontPath/, "release-link handler must reroute legacy audio entries into the Dreamweaver storefront page");
assert.match(releaseLink, /searchParams\.set\("audience"/, "release-link legacy remapping must preserve audience context on storefront redirects");

console.log("Song publication contracts passed.");
