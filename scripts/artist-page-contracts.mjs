import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isHyperFollowUrl,
  isTrustedCrewCredit,
  isTrustedCrewHyperFollow,
  parseHyperFollow
} from "../netlify/lib/hyperfollow.mjs";

const sourceUrl = "https://distrokid.com/hyperfollow/djhalo1/glass-house";
const html = `
  <script>
    hyperAlbum.artist = "Owen Anthony mixed by DJ Halo X"
    hyperAlbum.albumTitle = "Glass House"
    hyperAlbum.releaseDate = "July, 17 2026 00:00:00 +0000"
  </script>
  <meta property="og:image:url" content="https://images.example/glass-house.jpg">
  <iframe src="https://www.youtube.com/embed/IEPXrHY77fc" title="Glass House (Official Video)"></iframe>
  <a href="https:&#47;&#47;open.spotify.com&#47;album&#47;example" data-hyperfollow-store="spotify">Spotify</a>
`;

assert.equal(isHyperFollowUrl(sourceUrl), true);
assert.equal(isHyperFollowUrl("https://example.com/hyperfollow/djhalo1/glass-house"), false);
assert.equal(isTrustedCrewHyperFollow(sourceUrl), true);
assert.equal(isTrustedCrewCredit("DJ Halo X"), true);
assert.equal(isTrustedCrewCredit("DJ Butterfly"), true);
assert.equal(isTrustedCrewCredit("The Scout"), true);
assert.equal(isTrustedCrewCredit("Owen Anthony"), false);

const result = parseHyperFollow(html, sourceUrl);
assert.ok(result);
assert.equal(result.draft.artistName, "Owen Anthony");
assert.equal(result.draft.releaseTitle, "Glass House");
assert.equal(result.draft.releaseDate, "2026-07-17");
assert.equal(result.draft.videoUrl, "https://www.youtube.com/watch?v=IEPXrHY77fc");
assert.equal(result.draft.websiteUrl, "https://open.spotify.com/album/example");
assert.equal(result.draft.confidence, "high");
assert.match(result.draft.reviewNote, /DJ Halo X/);

const learnedUrl = "https://distrokid.com/hyperfollow/owenanthony/what-ive-learned";
const learnedResult = parseHyperFollow(`
  <script>
    hyperAlbum.artist = "Owen Anthony"
    hyperAlbum.albumTitle = "What I&#39;ve Learned"
    hyperAlbum.releaseDate = "July, 10 2026 00:00:00 +0000"
  </script>
  <meta property="og:image:url" content="https://images.example/what-ive-learned.jpg">
  <a href="https://open.spotify.com/album/example-learned" data-hyperfollow-store="spotify">Spotify</a>
`, learnedUrl);
assert.ok(learnedResult);
assert.equal(learnedResult.draft.releaseTitle, "What I've Learned");
assert.equal(learnedResult.draft.releaseDate, "2026-07-10");
assert.equal(learnedResult.draft.releaseUrl, learnedUrl);

const closestThingUrl = "https://distrokid.com/hyperfollow/djhalo1/closest-thing-to-heaven-dj-halo-mix-extended-remix-";
const closestThingResult = parseHyperFollow(`
  <script>
    hyperAlbum.artist = "DJ Halo"
    hyperAlbum.albumTitle = "Closest Thing To Heaven .DJ Halo Mix (Extended Remix )"
    hyperAlbum.releaseDate = "July, 09 2026 00:00:00 +0000"
  </script>
  <meta property="og:image:url" content="https://images.example/closest-thing.jpg">
`, closestThingUrl);
assert.ok(closestThingResult);
assert.equal(closestThingResult.draft.artistName, "DJ Halo");
assert.equal(closestThingResult.draft.releaseTitle, "Closest Thing To Heaven. DJ Halo Mix (Extended Remix)");
assert.equal(closestThingResult.draft.releaseUrl, closestThingUrl);
assert.match(closestThingResult.draft.reviewNote, /HALO crew release/);

const [artistPageFunction, artistScoutFunction, releasePackFunction, radioSubmissionsFunction, artistStudio, artistScript, mainStudio, roomDemoMigration, requestedReleaseMigration, requestedTrackCatalogMigration, starterMigration, releaseAudioMigration, artistReviewMigration] = await Promise.all([
  readFile(new URL("../netlify/functions/artist-pages.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/artist-page-scout.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/release-pack.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/radio-submissions.mjs", import.meta.url), "utf8"),
  readFile(new URL("../artists/index.html", import.meta.url), "utf8"),
  readFile(new URL("../artists/artists.js", import.meta.url), "utf8"),
  readFile(new URL("../halo.html", import.meta.url), "utf8"),
  readFile(new URL("../netlify/database/migrations/20260810190000_fill-release-room-demos.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/database/migrations/20260810210000_load-requested-hyperfollow-releases.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/database/migrations/20260812235900_publish-requested-track-catalog.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/database/migrations/20260812180000_enable-self-service-starter-promotion.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/database/migrations/20260812234500_link-release-audio-versions.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/database/migrations/20260812235000_add-radio-artist-review-updates.sql", import.meta.url), "utf8")
]);
assert.match(artistPageFunction, /syncCatalogRelease/);
assert.match(artistPageFunction, /INSERT INTO halo_release_campaigns/);
assert.match(artistPageFunction, /ensureStarterPlan/);
assert.match(artistPageFunction, /INSERT INTO halo_artist_agent_plans/);
assert.match(artistPageFunction, /'\["scout", "circle"\]'::jsonb, 4/);
assert.match(artistPageFunction, /releaseDate: dateOnly\(row\.release_date\)/);
assert.match(artistPageFunction, /radioSubmission/);
assert.match(artistPageFunction, /WHERE artist_slug = \$\{slug\}/);
assert.match(artistPageFunction, /releaseAudioVersions/);
assert.match(artistPageFunction, /FROM halo_mixes/);
assert.match(artistPageFunction, /client_sale_enabled/);
assert.match(artistPageFunction, /current_release_id = \$\{releaseId\}/);
assert.match(releasePackFunction, /releaseDate: dateOnly\(row\.release_date\)/);
assert.doesNotMatch(releasePackFunction, /Release campaign editing is restricted to HALO owners/);
assert.match(releasePackFunction, /owner_member_id = \$\{memberId\}/);
assert.match(releasePackFunction, /already belongs to another artist/);
assert.match(releasePackFunction, /canCreate: Boolean\(membership\)/);
assert.match(artistStudio, /id="catalogPreview"/);
assert.match(artistStudio, /id="radioSendDialog"/);
assert.match(artistStudio, /id="radioDeleteButton"/);
assert.match(artistStudio, /id="radioAudioVersion"/);
assert.match(artistStudio, /Publish free to activate your Starter team/);
assert.match(artistStudio, /fills remaining empty card fields/);
assert.match(artistStudio, /Backstage team/);
assert.match(artistScript, /renderCatalogPreview/);
assert.match(artistScript, /wireArtworkFallbacks/);
assert.match(artistScript, /data-artwork-fallback="\/assets\/halo-app-icon-512\.png"/);
assert.match(artistScript, /image\.complete && image\.naturalWidth === 0/);
assert.match(artistScript, /Send to HALO Radio/);
assert.match(artistScript, /PUT YOUR WORK/);
assert.match(artistScript, /ON THE FREQUENCY/);
assert.match(artistScript, /frequencyRadioButton/);
assert.match(artistScript, /release-kit\.html\?slug=/);
assert.match(artistScript, /Verified station plays/);
assert.match(artistScript, /mixEditionMarkup/);
assert.match(artistScript, /artist_mix_open/);
assert.match(artistScript, /artistSlug: state\.page\.slug/);
assert.match(artistScript, /releaseId: state\.page\.releaseId/);
assert.match(artistScript, /submitReleaseVersion/);
assert.match(artistScript, /deleteRadioUpload/);
assert.match(artistScript, /action: "delete"/);
assert.match(artistScript, /releaseFields\.has\(name\)/);
assert.match(artistScript, /currentDraft/);
assert.match(artistScript, /Completing the full editable card/);
assert.match(artistScoutFunction, /verifiedReleaseSeed/);
assert.match(artistScoutFunction, /mergeVerifiedDraft/);
assert.match(artistScoutFunction, /combined the verified release with public artist data/);
assert.doesNotMatch(artistScoutFunction, /if \(hyperFollow\) \{\s*return json/);
assert.match(artistScript, /setFormValue\("sourceLink", context\.source\)/);
assert.match(artistScript, /openSourceImport/);
assert.match(artistScript, /url === "\/#community" \? "\/#clubhouse" : url/);
assert.match(artistScript, /setFormValue\("communityUrl", "\/#clubhouse"\)/);
assert.match(roomDemoMigration, /closest-thing-to-heaven-dj-halo-mix-extended-remix-/);
assert.match(roomDemoMigration, /Campaign room prepared by HALO/);
assert.match(roomDemoMigration, /'dj-halo'/);
assert.match(requestedReleaseMigration, /https:\/\/distrokid\.com\/hyperfollow\/owenanthony\/ghost-to-me/);
assert.match(requestedReleaseMigration, /https:\/\/distrokid\.com\/hyperfollow\/halomusic1\/beautiful-lie-anna/);
assert.match(requestedReleaseMigration, /https:\/\/distrokid\.com\/hyperfollow\/halomusic1\/my-decision--dj-halo-mix-special-version/);
assert.match(requestedReleaseMigration, /https:\/\/distrokid\.com\/hyperfollow\/halomusic1\/beautiful-lie/);
assert.match(requestedReleaseMigration, /'halo-music'/);
assert.match(requestedTrackCatalogMigration, /what-ive-learned\?ref=release/);
assert.match(requestedTrackCatalogMigration, /ghost-to-me-by-owen-anthony-remixed-by-dj-halo-x-special-version-extended-remix-/);
assert.match(requestedTrackCatalogMigration, /hit-that-beat-extended-mix\?ref=release/);
assert.match(requestedTrackCatalogMigration, /'dj-halo-x-remix'/);
assert.match(requestedTrackCatalogMigration, /'released'/);
assert.match(requestedTrackCatalogMigration, /'public'/);
assert.match(requestedTrackCatalogMigration, /DJ, radio, and press campaign rooms/);
assert.match(starterMigration, /WHERE page\.status = 'published'/);
assert.match(starterMigration, /page\.owner_member_id IS NOT NULL/);
assert.match(starterMigration, /'starter'/);
assert.match(starterMigration, /'\["scout", "circle"\]'::jsonb/);
assert.match(starterMigration, /ON CONFLICT \(artist_slug\) DO NOTHING/);
assert.match(releaseAudioMigration, /CREATE TABLE IF NOT EXISTS halo_release_audio_versions/);
assert.match(releaseAudioMigration, /ADD COLUMN IF NOT EXISTS current_release_id/);
assert.match(releaseAudioMigration, /ADD COLUMN IF NOT EXISTS release_id/);
assert.match(artistReviewMigration, /artist_message/);
assert.match(artistReviewMigration, /artist_viewed_at/);
assert.match(artistScript, /New station update/);
assert.match(artistScript, /acknowledgeArtistUpdate/);
assert.match(radioSubmissionsFunction, /page\.slug = track\.artist_slug/);
assert.match(radioSubmissionsFunction, /page\.owner_member_id = \$\{membership\.member_id\}/);
assert.match(mainStudio, /Campaign studio \/\/ Artist controls/);
assert.match(mainStudio, /Every signed-in artist can start a release campaign/);

console.log("Artist page contracts passed");
