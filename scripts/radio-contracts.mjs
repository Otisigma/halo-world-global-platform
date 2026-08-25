import { readFile } from "node:fs/promises";
import { azuraCastStreamUrl, normalizeAzuraCastNowPlaying } from "../netlify/functions/radio-stations.mjs";
import { extractId3Artwork, parseId3Metadata, titleFromFileName } from "../netlify/lib/audio-metadata.mjs";

const files = {
  page: await readFile(new URL("../radio/index.html", import.meta.url), "utf8"),
  client: await readFile(new URL("../radio/radio.js", import.meta.url), "utf8"),
  styles: await readFile(new URL("../radio/radio.css", import.meta.url), "utf8"),
  stations: await readFile(new URL("../netlify/functions/radio-stations.mjs", import.meta.url), "utf8"),
  health: await readFile(new URL("../netlify/functions/radio-health.mjs", import.meta.url), "utf8"),
  scout: await readFile(new URL("../netlify/functions/radio-health-scout.mjs", import.meta.url), "utf8"),
  healthLibrary: await readFile(new URL("../netlify/lib/radio-health.mjs", import.meta.url), "utf8"),
  submissions: await readFile(new URL("../netlify/functions/radio-submissions.mjs", import.meta.url), "utf8"),
  resolver: await readFile(new URL("../netlify/functions/resolve-track.mjs", import.meta.url), "utf8"),
  audio: await readFile(new URL("../netlify/functions/radio-audio.mjs", import.meta.url), "utf8"),
  mixes: await readFile(new URL("../netlify/functions/mixes.mjs", import.meta.url), "utf8"),
  mixAudio: await readFile(new URL("../netlify/functions/mix-audio.mjs", import.meta.url), "utf8"),
  gemma: await readFile(new URL("../netlify/functions/gemma-radio-operator.mjs", import.meta.url), "utf8"),
  managerCouncil: await readFile(new URL("../netlify/functions/radio-manager-council.mjs", import.meta.url), "utf8"),
  managerCouncilLibrary: await readFile(new URL("../netlify/lib/radio-manager-council.mjs", import.meta.url), "utf8"),
  managerCouncilMigration: await readFile(new URL("../netlify/database/migrations/20260817150000_create-radio-manager-council.sql", import.meta.url), "utf8"),
  gemmaRelay: await readFile(new URL("../ops/gemma-relay/server.mjs", import.meta.url), "utf8"),
  migration: await readFile(new URL("../netlify/database/migrations/20260809120000_create-halo-radio.sql", import.meta.url), "utf8"),
  intelligenceMigration: await readFile(new URL("../netlify/database/migrations/20260812190000_add-radio-track-intelligence.sql", import.meta.url), "utf8"),
  reviewMigration: await readFile(new URL("../netlify/database/migrations/20260812230000_add-radio-rotation-review.sql", import.meta.url), "utf8"),
  artistSubmissionMigration: await readFile(new URL("../netlify/database/migrations/20260812234000_link-artist-radio-submissions.sql", import.meta.url), "utf8"),
  releaseAudioMigration: await readFile(new URL("../netlify/database/migrations/20260812234500_link-release-audio-versions.sql", import.meta.url), "utf8"),
  artistReviewMigration: await readFile(new URL("../netlify/database/migrations/20260812235000_add-radio-artist-review-updates.sql", import.meta.url), "utf8"),
  developmentMigration: await readFile(new URL("../netlify/database/migrations/20260814120000_create-radio-artist-development.sql", import.meta.url), "utf8"),
  trackVersionMigration: await readFile(new URL("../netlify/database/migrations/20260812235500_link-radio-track-versions.sql", import.meta.url), "utf8"),
  longPlayMigration: await readFile(new URL("../netlify/database/migrations/20260812210000_add-curated-radio-long-plays.sql", import.meta.url), "utf8"),
  haloTvMigration: await readFile(new URL("../netlify/database/migrations/20260812220000_add-ghost-to-me-halo-tv.sql", import.meta.url), "utf8"),
  audioMetadata: await readFile(new URL("../netlify/lib/audio-metadata.mjs", import.meta.url), "utf8")
};

function synchsafe(value) {
  return [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
}

function id3TextFrame(id, value) {
  const body = new Uint8Array([3, ...new TextEncoder().encode(value)]);
  return new Uint8Array([...new TextEncoder().encode(id), ...synchsafe(body.length), 0, 0, ...body]);
}

const titleFrame = id3TextFrame("TIT2", "Contract Song");
const artistFrame = id3TextFrame("TPE1", "Contract Artist");
const artworkBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const artworkBody = new Uint8Array([3, ...new TextEncoder().encode("image/jpeg"), 0, 3, 0, ...artworkBytes]);
const artworkFrame = new Uint8Array([...new TextEncoder().encode("APIC"), ...synchsafe(artworkBody.length), 0, 0, ...artworkBody]);
const tagBody = new Uint8Array([...titleFrame, ...artistFrame, ...artworkFrame]);
const parsedMetadata = parseId3Metadata(new Uint8Array([73, 68, 51, 4, 0, 0, ...synchsafe(tagBody.length), ...tagBody]));
const parsedArtwork = extractId3Artwork(new Uint8Array([73, 68, 51, 4, 0, 0, ...synchsafe(tagBody.length), ...tagBody]));

const sampleStation = {
  station: {
    id: 1,
    shortcode: "azuratest_radio",
    listen_url: "http://localhost:8000/radio.mp3",
    mounts: [{ url: "http://localhost:8000/radio.mp3", is_default: true }],
    hls_enabled: true,
    hls_is_default: true,
    hls_url: "https://example.com/hls/azuratest_radio/live.m3u8"
  }
};
const normalizedSample = normalizeAzuraCastNowPlaying([sampleStation], "azuratest_radio");

const checks = [
  ["official service song import", files.page.includes('id="resolveTrackButton"') && files.client.includes("resolveOfficialTrack") && files.resolver.includes("DistroKid HyperFollow")],
  ["owned release audio library", files.page.includes('id="submissionRelease"') && files.client.includes("releaseLibrary") && files.submissions.includes("listReleaseLibrary")],
  ["saved release version submission", files.page.includes('id="submissionAudioVersion"') && files.client.includes('payload.action = "submitReleaseVersion"') && files.submissions.includes("submitReleaseVersion")],
  ["editable connected track versions", files.page.includes("PUT YOUR WORK") && files.page.includes('name="linkedTrackId"') && files.client.includes("versionRelationshipLabels") && files.submissions.includes("linked_track_id") && files.trackVersionMigration.includes("version_relationship")],
  ["four channel controls", files.page.includes("LONG PLAY / 04") && files.client.includes('id: "longplay"')],
  ["three room demos", ["Pressure Test 01", "Last Light Drift", "Velvet Frequency"].every(value => files.stations.includes(value))],
  ["music fallback instead of oscillator", files.client.includes("playLongPlay") && !files.client.includes("createOscillator")],
  ["HALO artist playlist rotation", files.client.includes("PLcmaoB9ss1YE") && files.client.includes('listType: "playlist"') && files.client.includes("setLoop(true)") && files.client.includes("playFallbackMix") && files.page.includes('id="fallbackVideo"')],
  ["complete mix catalog", files.mixes.includes("Math.min(100") && files.client.includes("/api/mixes?limit=100&station=longplay")],
  ["curated YouTube long plays", ["IbwPoo-b1bs", "Bn1V4lvhFTA", "d8Nd2jb7BDs", "GKjU4Ac1Pzw"].every(value => files.longPlayMigration.includes(value)) && files.haloTvMigration.includes("yh7qQGvzmdw") && files.mixes.includes("alternateLongPlays") && files.mixes.includes("loadCuratedLongPlays")],
  ["automatic YouTube long play advancement", files.client.includes("playYouTubeLongPlay") && files.client.includes("youtubeLongPlayActive") && files.client.includes("PlayerState?.ENDED) advanceLongPlay()")],
  ["DJ HALO X takeover long play mix", files.mixes.includes("preview-pool-60-minute-mix") && files.mixes.includes("DJ HALO X 60 MIN TAKEOVER MIX") && files.mixes.includes("stationFallback: true") && files.client.includes("advanceLongPlay")],
  ["latest recorded hour leads long play", files.mixes.includes("prioritizeLatestHourSession") && files.mixes.includes("hourSessionMinimumSeconds") && files.mixes.includes("hourSessionMaximumSeconds")],
  ["long form audio range playback", files.mixAudio.includes('consistency: "strong"') && files.mixAudio.includes('"Accept-Ranges"') && files.mixAudio.includes('status: 206') && files.mixAudio.includes('"Content-Range"')],
  ["persistent station player", files.page.includes('id="stationAudio"') && files.client.includes("playCurrentRoom")],
  ["creator submission form", files.page.includes('id="submissionForm"') && files.page.includes("rightsConfirmed")],
  ["generated covers for artwork-free uploads", files.client.includes("generatedArtworkMarkup") && files.client.includes('20 * 60') && files.client.includes("Original signal") && files.client.includes("Long play") && files.styles.includes(".preview-artwork-generated.is-long-play")],
  ["owner bulk upload desk", files.page.includes('id="bulkUploadForm"') && files.page.includes("multiple required") && files.client.includes("submitBulkTracks") && files.client.includes("files.slice(0, 25)")],
  ["owner-only direct rotation", files.submissions.includes("isOwner(user)") && files.submissions.includes("ownerBulk") && files.submissions.includes('"rotation" : "preview"')],
  ["AI track cataloging", files.submissions.includes('intelligenceModel = "gpt-5.4-mini"') && files.submissions.includes("enrichCatalog") && files.submissions.includes("Never claim to hear or acoustically analyze")],
  ["embedded MP3 metadata", parsedMetadata.title === "Contract Song" && parsedMetadata.artist === "Contract Artist" && titleFromFileName("Contract Song-4.mp3") === "Contract Song"],
  ["embedded cover artwork", parsedArtwork?.mime === "image/jpeg" && parsedArtwork.byteSize === artworkBytes.length && files.submissions.includes("artwork_key") && files.client.includes("preview-artwork")],
  ["newest-first room takeover cycle", files.stations.includes("ORDER BY room, created_at DESC") && files.client.includes("playTakeoverFallback") && files.client.includes("advanceTakeoverFallback") && files.client.includes("rotationIndex(room) >= room.rotation.length - 1")],
  ["community voting client", files.client.includes('action: "vote"') && files.client.includes("castVote")],
  ["owner upload management", files.client.includes('action: "update"') && files.client.includes('action: "delete"') && files.client.includes("openTrackEditor") && files.submissions.includes("updateTrack") && files.submissions.includes("deleteTrack") && files.submissions.includes("member_id = ${membership.member_id}") && files.submissions.includes("audioStore.delete")],
  ["station route", files.stations.includes('path: "/api/radio/stations"')],
  ["azuracast integration", files.stations.includes("HALO_RADIO_AZURACAST_URL") && files.stations.includes("/api/nowplaying/")],
  ["azuracast station-list response", normalizedSample === sampleStation],
  ["azuracast default HLS stream", azuraCastStreamUrl(normalizedSample) === sampleStation.station.hls_url],
  ["station-wide YouTube recovery fallback", files.client.includes("playFallbackMix") && files.client.includes("youtube.com/iframe_api") && files.client.includes("PLcmaoB9ss1YE") && !files.client.includes("HALO AutoDJ")],
  ["visible long play queue", files.page.includes('id="longPlayQueue"') && files.client.includes("renderLongPlayQueue")],
  ["dual-deck seamless playback", files.page.includes('id="stationAudio" preload="auto"') && files.page.includes('id="standbyAudio" preload="auto"') && files.client.includes("startSeamlessTransition") && files.client.includes("prepareStandbyAudio")],
  ["incoming tracks start at zero", files.client.includes("incoming.currentTime = 0") && files.client.includes("await incoming.play()")],
  ["equal-power no-dead-air blend", files.client.includes("Math.cos(progress * Math.PI / 2)") && files.client.includes("Math.sin(progress * Math.PI / 2)") && files.page.includes("no dead air")],
  ["listener transition controls", files.page.includes('id="transitionSeconds"') && files.page.includes('id="transitionMode"') && files.client.includes("tempoMatchRate")],
  ["azuracast source timing", files.stations.includes("played_at") && files.healthLibrary.includes("sourcePosition")],
  ["station health route", files.health.includes('path: "/api/radio/health"') && files.healthLibrary.includes("probeStream")],
  ["background station agents", files.scout.includes('schedule: "*/5 * * * *"') && files.scout.includes("reportIssue")],
  ["visible signal monitor", files.page.includes('id="signalWatch"') && files.page.includes('id="signalScope"') && files.client.includes("loadHealth")],
  ["always-on browser QA monitor", files.page.includes('src="/site-monitor.js"') && files.page.includes('id="previewPlaybackStatus"')],
  ["YouTube podcast playlist", files.page.includes('id="podcast"') && files.page.includes("youtube-nocookie.com/embed/videoseries?list=PLcW5JzViKrdI")],
  ["authenticated submissions", files.submissions.includes("getUser") && files.submissions.includes("verifyRequestOrigin")],
  ["artist-card radio submissions", files.submissions.includes("Only the artist room owner can send this release to radio") && files.submissions.includes("artist_slug") && files.artistSubmissionMigration.includes("ADD COLUMN IF NOT EXISTS artist_slug")],
  ["release-card audio versions", files.submissions.includes("submitReleaseVersion") && files.submissions.includes("audio_version_id") && files.releaseAudioMigration.includes("halo_release_audio_versions") && files.releaseAudioMigration.includes("current_release_id")],
  ["track vault preservation", files.submissions.includes("release audio remains in the Track Vault") && files.submissions.includes("if (!deleted[0].audio_version_id) await cleanupTrackAudio")],
  ["strongly consistent blob audio storage", files.submissions.includes('name: "halo-radio-submissions"') && files.submissions.includes('consistency: "strong"')],
  ["browser audio type normalization", files.submissions.includes("normalizeAudioType") && files.client.includes("audioContentType")],
  ["preview audio route", files.audio.includes('path: "/api/radio/audio"') && files.audio.includes('"Content-Length"') && files.audio.includes('"HEAD"') && files.audio.includes('"Accept-Ranges"') && files.audio.includes("status: 206")],
  ["preview playback preflight", files.client.includes('method: "HEAD"') && files.client.includes("reportAudioHealth") && files.client.includes("Audio check passed")],
  ["owner-only Gemma operator", files.gemma.includes("isOwner(user)") && files.gemma.includes("verifyRequestOrigin(request)")],
  ["approved Gemma updates", files.gemma.includes('payload?.approved !== true') && files.gemma.includes('path: "/api/radio/gemma"')],
  ["visible Gemma station desk", files.page.includes('id="gemmaOperator"') && files.client.includes("runGemmaAction")],
  ["owner-only radio manager council", files.managerCouncil.includes("isOwner(user)") && files.managerCouncil.includes("verifyRequestOrigin(request)") && files.managerCouncil.includes('path: "/api/radio/manager-council"')],
  ["five-role evidence council", ["programme", "audience", "artist", "systems", "growth"].every(value => files.managerCouncilLibrary.includes(`key: "${value}"`)) && files.managerCouncilLibrary.includes("gatherStationSignals")],
  ["human-approved manager queue", files.managerCouncilMigration.includes("halo_radio_manager_actions") && files.managerCouncilMigration.includes("'proposed', 'approved', 'rejected', 'completed'") && files.page.includes('id="managerCouncil"') && files.client.includes("decideManagerAction")],
  ["scoped Watchtower relay", files.gemmaRelay.includes('payload.action !== "watchtower_update"') && files.gemmaRelay.includes('payload.scope !== "azuracast"') && !files.gemmaRelay.includes("docker.sock")],
  ["radio database schema", files.migration.includes("halo_radio_tracks") && files.migration.includes("halo_radio_votes")],
  ["track intelligence schema", ["ai_metadata", "analysis_status", "moods", "energy", "source_filename"].every(value => files.intelligenceMigration.includes(value))],
  ["human rotation review", files.submissions.includes('payload.action === "review"') && files.page.includes('id="rotationReview"') && files.client.includes("data-review-decision") && ["reviewed_by_member_id", "review_note", "spotlight_month"].every(value => files.reviewMigration.includes(value))],
  ["artist review updates", files.submissions.includes("acknowledgeArtistUpdate") && files.submissions.includes("artist_message") && files.client.includes("data-artist-message") && files.artistReviewMigration.includes("artist_viewed_at")],
  ["artist development review ledger", files.developmentMigration.includes("halo_radio_development_reviews") && files.developmentMigration.includes("development_stage") && files.submissions.includes("draftDevelopmentCoaching") && files.submissions.includes("scorecard")],
  ["artist development interface", files.page.includes('id="developmentBoard"') && files.client.includes("renderDevelopmentBoard") && files.client.includes("data-coaching-draft") && files.styles.includes(".development-guidance")],
  ["artist owner update acknowledgement", files.submissions.includes("page.slug = track.artist_slug") && files.submissions.includes("page.owner_member_id = ${membership.member_id}")]
];

const failures = checks.filter(([, passed]) => !passed);
if (failures.length) {
  for (const [name] of failures) console.error(`FAIL Halo Radio: ${name}`);
  process.exit(1);
}

console.log(`HALO Radio contracts: ${checks.length}/${checks.length} checks passed.`);
