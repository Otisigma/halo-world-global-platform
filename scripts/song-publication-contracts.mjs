import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveDreamweaverPageFlow } from "../netlify/lib/dreamweaver-page-manager.mjs";
import { createForcePushTrackHandler } from "../netlify/functions/force-push-track.mjs";
import { reconcilePublishedSong } from "../netlify/lib/song-publication.mjs";

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

{
  const admin = { id: "admin", app_metadata: { roles: ["admin"] } };
  const savedSong = {
    id: sampleSongId, title: "Saved track", owner_member_id: "owner",
    status: "active", rights_status: "cleared", notes: "Preserve these notes",
    artwork_url: "/cover.jpg", sale_price_cents: null, currency: "USD",
  };
  const records = [savedSong];
  const updates = [];
  const database = {
    async sql(strings, ...values) {
      const query = strings.join("?");
      if (query.includes("SELECT id FROM halo_song_catalog")) {
        const [value, memberId] = values;
        return records.filter(song => song.owner_member_id === memberId && song.status === "active"
          && (query.includes("LOWER(title)") ? song.title.toLowerCase() === value.toLowerCase() : song.id === value));
      }
      assert.match(query, /UPDATE halo_song_catalog/);
      assert.match(query, /WHERE id = \? AND owner_member_id = \? AND status = 'active'/);
      const song = records.find(song => song.id === values[0] && song.owner_member_id === values[1]);
      if (!song) return [];
      updates.push(query);
      song.pipeline_status = "published";
      song.pipeline_updated_at = new Date().toISOString();
      song.sale_status = "for_sale";
      if (song.sale_price_cents === null || song.sale_price_cents <= 0) song.sale_price_cents = 129;
      return [song];
    },
  };
  let reconcileCount = 0;
  const options = {
    database: () => database,
    currentUser: () => admin,
    verifyOrigin: () => {},
    membershipFor: () => ({ member_id: "owner", actor_id: "admin" }),
    reconcile: async (_db, input) => {
      assert.equal(input.songId, sampleSongId);
      assert.equal(input.ownerMemberId, "owner");
      reconcileCount++;
      return { ok: true, releaseId: "saved-track" };
    },
  };
  const handler = createForcePushTrackHandler(options);
  const request = (payload, method = "POST") => new Request("https://halo.example/api/catalog/force-push-track", {
    method, ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
  });
  assert.equal((await handler(request({}, "GET"))).status, 405);
  assert.equal((await createForcePushTrackHandler({ ...options, currentUser: () => null })(request({ id: sampleSongId }))).status, 401);
  assert.equal((await createForcePushTrackHandler({ ...options, currentUser: () => ({ id: "member" }) })(request({ id: sampleSongId }))).status, 403);
  assert.equal((await createForcePushTrackHandler({ ...options, verifyOrigin: () => { throw new Error("origin"); } })(request({ id: sampleSongId }))).status, 403);
  for (const payload of [null, [], {}, { id: "invalid" }, { id: "invalid", title: "Saved track" }]) {
    assert.equal((await handler(request(payload))).status, 400);
  }
  assert.equal((await handler(new Request("https://halo.example", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await handler(request({ title: "x".repeat(80_000) }))).status, 413);
  assert.equal((await handler(request({ title: "Missing track" }))).status, 404);
  records.push({ ...savedSong, id: "22222222-2222-4222-8222-222222222222", owner_member_id: "another-owner" });
  assert.equal((await handler(request({ id: "22222222-2222-4222-8222-222222222222" }))).status, 404);
  assert.equal(updates.length, 0, "rejected requests must not mutate the catalog");
  const response = await handler(request({ id: sampleSongId, title: "Overwrite title", notes: "Overwrite notes", salePriceCents: 1 }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.success, true);
  assert.equal(data.track.releaseStatus, "PUBLISHED");
  assert.equal(data.track.status, "PUBLISHED");
  assert.equal(data.track.inChart, true);
  assert.equal(data.track.isLiveVisible, true);
  assert.equal(data.track.price, "US$1.29");
  assert.ok(Number.isFinite(Date.parse(data.track.pushedToLiveAt)));
  assert.equal(savedSong.title, "Saved track");
  assert.equal(savedSong.notes, "Preserve these notes");
  assert.equal(savedSong.artwork_url, "/cover.jpg");
  assert.equal(savedSong.rights_status, "cleared");
  savedSong.sale_price_cents = 299;
  assert.equal((await handler(request({ title: "saved TRACK" }))).status, 200);
  assert.equal(savedSong.sale_price_cents, 299, "existing prices must survive repeat pushes");
  assert.equal(reconcileCount, 2, "every push must invoke the existing idempotent release upsert");
  assert.equal(records.length, 2, "repeat pushes must not create duplicate songs");
  records.push({ ...savedSong, id: "duplicate-title" });
  assert.equal((await handler(request({ title: "Saved track" }))).status, 409);
  const failed = createForcePushTrackHandler({ ...options, reconcile: async () => ({ ok: false, skipped: true }) });
  assert.equal((await failed(request({ id: sampleSongId }))).status, 409, "unconfirmed publication must not claim success");
  const broken = createForcePushTrackHandler({ ...options, reconcile: async () => { throw new Error("database offline"); } });
  const originalError = console.error;
  try {
    console.error = () => {};
    const response = await broken(request({ id: sampleSongId }));
    assert.equal(response.status, 502);
    assert.notEqual((await response.json()).success, true, "backend failures must not claim local-only success");
  } finally { console.error = originalError; }

  const [page, editor] = await Promise.all([read("song-catalog/index.html"), read("song-catalog/song-catalog.js")]);
  assert.match(page, /id="forcePushTrackButton" type="button" hidden>Push to Shop &amp; Charts/);
  assert.match(page, /id="forcePushTrackStatus" role="status"/);
  assert.match(editor, /fetch\("\/api\/catalog\/force-push-track",\{method:"POST"/);
  assert.match(editor, /releaseStatus:"PUBLISHED",status:"PUBLISHED",inChart:true,isLiveVisible:true/);
  assert.match(editor, /if\(!response\.ok\|\|data\.success!==true\)throw/);
  assert.match(editor, /button\.disabled=true;button\.setAttribute\("aria-busy","true"\)/);
  assert.match(editor, /button\.disabled=false;button\.removeAttribute\("aria-busy"\)/);
  assert.match(catalogApi, /canForcePush: isOwner\(user\)/);
  assert.match(helper, /\nfunction isLegacyDreamweaverSatelliteUrl\(/, "publication URL repair must be accessible to the release upsert");
  const clickSource = editor.match(/\$\("#forcePushTrackButton"\)\.addEventListener\("click",(async event=>\{[\s\S]*?\n\})\);/)?.[1];
  assert.ok(clickSource, "editor must register a force-publication click handler");
  for (const succeeds of [true, false]) {
    const attributes = new Map();
    const button = {
      disabled: false,
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: key => attributes.delete(key),
    };
    const status = { textContent: "" };
    let resolveResponse;
    const pendingResponse = new Promise(resolve => { resolveResponse = resolve; });
    let refreshedId;
    const click = new Function("selectedSong", "$", "fetch", "loadCatalog", "message", "money", `return (${clickSource});`)(
      () => ({ id: sampleSongId, title: "Saved track", salePriceCents: null }),
      () => status,
      async (url, options) => {
        assert.equal(url, "/api/catalog/force-push-track");
        assert.equal(options.credentials, "same-origin");
        const payload = JSON.parse(options.body);
        assert.equal(payload.releaseStatus, "PUBLISHED");
        assert.equal(payload.status, "PUBLISHED");
        assert.equal(payload.inChart, true);
        assert.equal(payload.isLiveVisible, true);
        assert.equal(payload.price, "US$1.29");
        return pendingResponse;
      },
      async id => { refreshedId = id; },
      () => {},
      () => { throw new Error("missing prices must use the fallback"); },
    );
    const pushing = click({ currentTarget: button });
    assert.equal(button.disabled, true);
    assert.equal(attributes.get("aria-busy"), "true");
    assert.match(status.textContent, /Pushing/);
    resolveResponse({ ok: succeeds, json: async () => ({ success: succeeds, message: succeeds ? "Live on Shop & Charts" : "Publication failed" }) });
    await pushing;
    assert.equal(button.disabled, false);
    assert.equal(attributes.has("aria-busy"), false);
    assert.equal(refreshedId, sampleSongId);
    assert.equal(status.textContent, succeeds ? "Live on Shop & Charts" : "Publication failed");
  }
}

{
  let releaseUpserts = 0;
  const db = {
    async sql(strings) {
      const query = strings.join("?");
      if (query.includes("FROM halo_song_catalog song")) return [{
        id: sampleSongId, owner_member_id: "owner", pipeline_status: "published",
        title: "Saved track", artist_name: "Artist", genre: "Soul", source_release_id: "saved-track",
      }];
      if (query.includes("FROM halo_song_versions") || query.includes("FROM halo_song_publication_sync")) return [];
      if (query.includes("SELECT id, owner_member_id")) return [{ id: "saved-track", owner_member_id: "owner" }];
      if (query.includes("INSERT INTO halo_release_campaigns")) {
        assert.match(query, /ON CONFLICT \(id\) DO UPDATE SET/, "publication must use a deterministic release upsert");
        assert.match(query, /is_chart_eligible = TRUE/);
        assert.match(query, /visibility = 'public'/);
        releaseUpserts++;
        return [{ id: "saved-track", official_url: "", stream_url: "" }];
      }
      if (query.includes("INSERT INTO halo_song_publication_sync")) return [];
      throw new Error(`Unexpected publication query: ${query}`);
    },
  };
  for (let retry = 0; retry < 2; retry++) {
    const result = await reconcilePublishedSong(db, { songId: sampleSongId, ownerMemberId: "owner", recordLedger: false });
    assert.equal(result.ok, true);
    assert.equal(result.releaseId, "saved-track");
  }
  assert.equal(releaseUpserts, 2, "publication retries must reuse the existing release id");
}

console.log("Song publication contracts passed.");
