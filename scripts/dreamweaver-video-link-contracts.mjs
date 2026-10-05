import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createVideosHandler } from "../netlify/functions/videos.mjs";
import { catalogSelection, linkedYouTubeVideoId } from "../netlify/lib/dreamweaver-video-links.mjs";

const songId = "11111111-1111-4111-8111-111111111111";
const otherSongId = "22222222-2222-4222-8222-222222222222";
const mixId = "33333333-3333-4333-8333-333333333333";
const memberId = "catalog-owner";
const videoUrl = "https://www.youtube.com/watch?v=yh7qQGvzmdw";
const request = (query = "", options = {}) => new Request(`https://halo.example/api/videos${query}`, options);

function fixture(options = {}) {
  const state = { queries: [], videos: new Map(), writes: 0, blobs: 0, masterUrl: "", ...options };
  const db = { async sql(strings, ...values) {
    const query = strings.join("?");
    state.queries.push(query);
    if (state.failDb) throw new Error("private database connection details");
    if (query.includes("WITH target AS")) {
      assert.match(query, /song\.owner_member_id = \?/);
      assert.match(query, /mix\.member_id = \?/);
      assert.match(query, /version\.version_type = 'sale_master' AND version\.status = 'active'/);
      assert.match(query, /ON CONFLICT \(id\) DO UPDATE/);
      assert.match(query, /halo_videos\.owner_member_id = EXCLUDED\.owner_member_id/);
      assert.match(query, /UPDATE halo_song_versions/);
      const [type, id, owner, mixType, linkedMixId, mixOwner, videoId, videoOwner, artistSlug, title,
        description, sourceType, sourceUrl, youtubeId, blobKey, contentType, sourceFilename,
        thumbnailUrl, galleryVisible, sofaVisible] = values;
      assert.equal(owner, memberId);
      assert.equal(mixOwner, memberId);
      assert.equal(videoOwner, memberId);
      assert.equal(mixType, type);
      assert.equal(linkedMixId, id);
      if (state.targetChanged) return [];
      const row = { id: videoId, owner_member_id: owner, artist_slug: artistSlug, title, description,
        source_type: sourceType, source_url: sourceUrl, youtube_id: youtubeId, blob_key: blobKey,
        content_type: contentType, source_filename: sourceFilename, thumbnail_url: thumbnailUrl,
        gallery_visible: galleryVisible, sofa_visible: sofaVisible,
        linked_song_id: type === "song" ? id : null, linked_mix_id: type === "mix" ? id : null,
        created_at: "2026-10-05T02:00:00Z" };
      state.videos.set(videoId, row);
      if (type === "song") state.masterUrl = sourceType === "upload" ? `/api/videos?media=${videoId}` : sourceUrl;
      state.writes++;
      return [row];
    }
    if (query.includes("FROM halo_song_catalog song")) {
      assert.match(query, /song\.owner_member_id = \? AND song\.status = 'active'/);
      assert.match(query, /release\.id = song\.source_release_id/);
      assert.match(query, /page\.owner_member_id = song\.owner_member_id/);
      assert.equal(values[0], memberId);
      if (values[1] && values[1] !== songId) return [];
      const linked = [...state.videos.values()].some(video => video.linked_song_id === songId);
      return [{ id: songId, title: "Duplicate title", artist_name: "Artist",
        has_master: !state.noMaster, release_id: "published-release", release_status: state.draft ? "draft" : "published",
        release_visibility: "public", artist_slug: "", gallery_linked: linked, sofa_linked: linked }];
    }
    if (query.includes("FROM halo_mixes mix")) {
      assert.match(query, /mix\.member_id = \?/);
      assert.equal(values[0], memberId);
      if (values[1] && values[1] !== mixId) return [];
      const linked = [...state.videos.values()].some(video => video.linked_mix_id === mixId);
      return [{ id: mixId, title: "Duplicate title", artist_name: "Artist",
        visibility: state.privateMix ? "private" : "room", gallery_linked: linked, sofa_linked: linked }];
    }
    if (query.includes("SELECT video.*, page.artist_name")) {
      assert.match(query, /video\.linked_song_id = \?/);
      assert.match(query, /video\.linked_mix_id = \?/);
      return [...state.videos.values()].filter(video => values[0] === "song"
        ? video.linked_song_id === values[1] : video.linked_mix_id === values[3]);
    }
    if (query.includes("SELECT slug, artist_name")) return [];
    if (query.includes("INSERT INTO halo_videos")) {
      state.writes++;
      return [{ id: values[0], title: values[3], source_type: values[5], created_at: "2026-10-05T02:00:00Z" }];
    }
    throw new Error(`Unexpected SQL: ${query}`);
  } };
  const handler = createVideosHandler({
    database: async () => db, userFor: async () => state.anonymous ? null : { id: "identity-id" },
    membershipFor: async () => ({ member_id: memberId }),
    verifyOrigin: async () => { if (state.badOrigin) throw new Error("Rejected origin"); },
    storeFor: () => ({ async set() { state.blobs++; } })
  });
  return { handler, state };
}

function publish({ type = "song", id = songId, url = videoUrl, upload = null, rights = true, linked = true } = {}) {
  const form = new FormData();
  form.set("title", "My published video");
  form.set("sourceType", upload ? "upload" : "youtube");
  form.set("youtubeUrl", url);
  if (linked) {
    form.set("linkedRecordType", type);
    form.set("linkedRecordId", id);
    if (rights) form.set("rightsAttested", "true");
  }
  if (upload) form.set("videoFile", upload, "film.webm");
  return request("", { method: "POST", body: form });
}

assert.equal(catalogSelection("song", "Duplicate title"), null);
assert.equal(catalogSelection("track", songId), null);
assert.equal(catalogSelection("mix", "../../private"), null);
assert.deepEqual(catalogSelection("song", songId.toUpperCase()), { type: "song", id: songId });
assert.notEqual(linkedYouTubeVideoId(memberId, { type: "song", id: songId }, "video"),
  linkedYouTubeVideoId(memberId, { type: "song", id: otherSongId }, "video"));

let f = fixture({ anonymous: true });
assert.equal((await f.handler(request("?catalog=1"))).status, 401);
assert.equal((await f.handler(publish())).status, 401);
assert.equal(f.state.writes, 0);
f = fixture({ badOrigin: true });
const crossOrigin = publish();
assert.equal((await f.handler(crossOrigin)).status, 403);
assert.equal(crossOrigin.bodyUsed, false);

f = fixture();
const catalog = await (await f.handler(request("?catalog=1"))).json();
assert.equal(catalog.records.length, 2);
assert.equal(catalog.records[0].title, catalog.records[1].title);
assert.notEqual(catalog.records[0].id, catalog.records[1].id);
assert.equal(catalog.records[0].destinations.mix, "", "no mix relationship is invented for a song");
assert.equal(catalog.records[0].destinations.gallery, "");
assert.ok(catalog.records[1].destinations.mix.includes(mixId));
assert.equal((await f.handler(request("?catalog=1&recordType=song&recordId=title"))).status, 422);
assert.equal((await f.handler(publish({ id: otherSongId }))).status, 403);
assert.equal((await f.handler(publish({ rights: false }))).status, 422);
assert.equal(f.state.writes, 0);
for (const url of ["https://evil.example/watch?v=yh7qQGvzmdw", "http://youtube.com/watch?v=yh7qQGvzmdw",
  "https://viewer@youtube.com/watch?v=yh7qQGvzmdw", "https://youtube.com/@channel", "https://youtube.com/playlist?list=playlist"]) {
  assert.equal((await f.handler(publish({ url }))).status, 400);
}
const published = await (await f.handler(publish())).json();
assert.equal(published.video.linkedSongId, songId);
assert.equal(f.state.masterUrl, videoUrl);
assert.ok(published.record.destinations.gallery);
assert.ok(published.record.destinations.tv);
assert.equal(published.record.destinations.artist, "", "artist-room verification is not hardcoded");
await f.handler(publish());
assert.equal(f.state.videos.size, 1, "retries of a linked YouTube source are idempotent");
const filtered = await (await f.handler(request(`?recordType=song&recordId=${songId}`))).json();
assert.equal(filtered.videos[0].linkedSongId, songId);
const mixPublished = await (await f.handler(publish({ type: "mix", id: mixId }))).json();
assert.equal(mixPublished.video.linkedMixId, mixId);
assert.equal(f.state.masterUrl, videoUrl, "mix publishing does not change a song master");

f = fixture({ noMaster: true });
assert.equal((await f.handler(publish())).status, 422);
assert.equal(f.state.writes, 0);
f = fixture({ draft: true, privateMix: true });
const missing = await (await f.handler(request("?catalog=1"))).json();
assert.equal(missing.records[0].destinations.shop, "");
assert.equal(missing.records[1].destinations.mix, "");
f = fixture({ targetChanged: true });
assert.equal((await f.handler(publish())).status, 409);
assert.equal(f.state.writes, 0);
f = fixture();
assert.equal((await f.handler(publish({ upload: new Blob(["film"], { type: "video/webm" }) }))).status, 201);
assert.equal(f.state.blobs, 1);
assert.match(f.state.masterUrl, /^\/api\/videos\?media=/);
assert.equal((await f.handler(publish({ upload: new Blob([new Uint8Array(5_000_001)], { type: "video/webm" }) }))).status, 413);
assert.equal(f.state.blobs, 1);
assert.equal((await f.handler(publish({ linked: false }))).status, 201, "legacy video ingestion is preserved");
assert.equal((await f.handler(request("", { method: "DELETE" }))).status, 405);
f = fixture({ failDb: true });
const error = await f.handler(publish());
assert.equal(error.status, 500);
assert.doesNotMatch(await error.text(), /private database/);

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [page, script, api, links, campaign, release, mixes, migration] = await Promise.all([
  read("dreamweaver/index.html"), read("dreamweaver/dreamweaver.js"), read("netlify/functions/videos.mjs"),
  read("netlify/lib/dreamweaver-video-links.mjs"), read("netlify/functions/dreamweaver-campaigns.mjs"),
  read("netlify/functions/release-catalog.mjs"), read("mixes/mixes.js"),
  read("netlify/database/migrations/20261005020000_link_dreamweaver_catalog_videos.sql")
]);
assert.match(page, /id="campaignCatalogRecord" aria-describedby="catalogLinkStatus"/);
assert.match(page, /id="catalogLinkStatus" role="status" aria-live="polite"/);
assert.match(page, /id="linkedVideoRights" type="checkbox" required/);
assert.match(script, /form\.set\("linkedRecordId", record\.id\)/);
assert.match(script, /state\.catalogVerifiedKey !== elements\.campaignCatalogRecord\.value/);
assert.match(script, /nonce !== state\.catalogVerificationNonce \|\| key !== elements\.campaignCatalogRecord\.value/);
assert.match(script, /catalogRefreshTimer = window\.setInterval/);
assert.match(script, /catalogLink:|linkedRecordId: selectedCatalogRecord/);
assert.match(campaign, /catalogLink: selection/);
assert.match(campaign, /catalogLink: input\.catalogLink \|\| null/);
assert.match(api, /await verifyOrigin\(request\)/);
assert.doesNotMatch(links, /LOWER\(.*title|ILIKE|(?:song|mix)\.title\s*=/);
assert.match(mixes, /video\.linkedMixId === state\.selectedMix\?\.id/);
assert.match(release, /ARRAY_AGG\(version\.video_url ORDER BY \(version\.version_type = 'sale_master'\) DESC/);
assert.match(migration, /linked_song_id TEXT REFERENCES halo_song_catalog\(id\) ON DELETE SET NULL/);
assert.match(migration, /linked_mix_id TEXT REFERENCES halo_mixes\(id\) ON DELETE SET NULL/);

const frontendSource = script.slice(script.indexOf("  function selectedCatalogRecord()"), script.indexOf("  async function openCampaignStudio()"));
function frontendFixture(fetchJsonWithTimeout) {
  const records = catalog.records;
  const key = `song:${songId}`;
  const state = { catalogRecords: records, catalogVerifiedKey: key, catalogVerificationNonce: 0,
    publishingCatalogVideo: false, campaign: null, renderedClip: null };
  const elements = {
    campaignCatalogRecord: { value: key, disabled: false },
    catalogLinkStatus: { innerHTML: "", textContent: "" }, publishCatalogVideo: { disabled: false },
    videoPublishForm: { reportValidity: () => true }, linkedVideoSource: { value: "youtube" },
    linkedVideoTitle: { value: "Video title" }, linkedVideoRights: { checked: true },
    campaignYoutubeUrl: { value: videoUrl }, catalogPublishStatus: { textContent: "" }
  };
  const context = { state, elements, FormData, VIDEO_LIBRARY_TIMEOUT_MS: 1000, fetchJsonWithTimeout,
    escapeHtml: value => String(value), loadVideos: () => {}, resolveSongContextId: () => "", window: {} };
  runInNewContext(`${frontendSource}\nglobalThis.workflow = { verifyCatalogSelection, publishCatalogVideo };`, context);
  return { ...context, state, elements };
}
const pending = [];
let ui = frontendFixture(() => new Promise(resolve => pending.push(resolve)));
const oldVerification = ui.workflow.verifyCatalogSelection();
assert.equal(ui.elements.publishCatalogVideo.disabled, true);
ui.elements.campaignCatalogRecord.value = `mix:${mixId}`;
const currentVerification = ui.workflow.verifyCatalogSelection();
pending[1]({ response: { ok: true }, payload: { records: [catalog.records[1]] } });
await currentVerification;
pending[0]({ response: { ok: true }, payload: { records: [catalog.records[0]] } });
await oldVerification;
assert.equal(ui.state.catalogVerifiedKey, `mix:${mixId}`, "late verification cannot overwrite the selected ID");
assert.ok(ui.elements.catalogLinkStatus.innerHTML.includes(mixId));
ui = frontendFixture(async () => { throw new Error("Offline"); });
await ui.workflow.verifyCatalogSelection();
assert.equal(ui.elements.publishCatalogVideo.disabled, true);
assert.equal(ui.state.catalogVerifiedKey, "");
assert.equal(ui.elements.catalogLinkStatus.textContent, "Offline");
let submitted = null;
ui = frontendFixture(async (_url, options) => {
  if (options.method === "POST") {
    submitted = options.body;
    return { response: { ok: true }, payload: { message: "Published" } };
  }
  return { response: { ok: true }, payload: { records: [catalog.records[0]] } };
});
await ui.workflow.publishCatalogVideo({ preventDefault() {} });
assert.equal(submitted.get("linkedRecordId"), songId);
assert.equal(submitted.get("linkedRecordType"), "song");
assert.equal(submitted.get("youtubeUrl"), videoUrl);
assert.equal(submitted.get("rightsAttested"), "true");
assert.equal(ui.elements.linkedVideoRights.checked, false);
assert.equal(ui.elements.catalogPublishStatus.textContent, "Published");
console.log("Dreamweaver catalog video-link contracts passed.");
