import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DREAMWEAVER_STOREFRONT_MIX_ID } from "../netlify/lib/dreamweaver-satellite.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, styles, script, deck, campaign, radio, config, server, artworkHelper, campaignFunction, campaignLibrary, campaignMigration, campaignJobMigration, campaignMonitor, stats, fanSignupFunction, fanSignupMigration, relationsPage, relationsScript, relationsFunction, haloXLib, dailyEmailTemplate, relationshipSignupMigration] = await Promise.all([
  read("dreamweaver/index.html"),
  read("dreamweaver/dreamweaver.css"),
  read("dreamweaver/dreamweaver.js"),
  read("dj-deck.html"),
  read("campaign-studio/index.html"),
  read("radio/index.html"),
  read("netlify.toml"),
  read("server.js"),
  read("release-artwork.js"),
  read("netlify/functions/dreamweaver-campaigns.mjs"),
  read("netlify/lib/dreamweaver-campaigns.mjs"),
  read("netlify/database/migrations/20260816180000_create-dreamweaver-campaigns.sql"),
  read("netlify/database/migrations/20260816210000_add-dreamweaver-background-jobs.sql"),
  read("netlify/functions/dreamweaver-campaign-monitor.mjs"),
  read("netlify/lib/stats.mjs"),
  read("netlify/functions/dreamweaver-fan-signups.mjs"),
  read("netlify/database/migrations/20260905025500_create_dreamweaver_fan_signups.sql"),
  read("halo-relations.html"),
  read("halo-relations.js"),
  read("netlify/functions/halo-relations.mjs"),
  read("netlify/lib/halo-x.mjs"),
  read("emails/halo-daily-summary/index.html"),
  read("netlify/database/migrations/20260910071500_integrate_dreamweaver_signups_into_relationships.sql")
]);

const checks = [
  [page.includes("Dreamweaver Show — HALO") && page.includes('id="showAudio"'), "ships the standalone Dreamweaver visual show"],
  [page.includes("release-artwork.css") && page.includes("release-artwork.js"), "loads the shared HALO artwork fallback assets on the Dreamweaver page"],
  [page.includes('data-mode="watch"') && page.includes('data-mode="room"') && page.includes('data-mode="explore"'), "offers Watch, Room, and Explore modes"],
  [script.includes('fetchJsonWithTimeout("/api/mixes?limit=100"') && script.includes("requestedMix"), "loads an existing Mix Desk recording and supports direct mix links"],
  [page.includes('id="dreamweaverSongLabLink"') && script.includes('halo-dreamweaver-upload-trust') && script.includes('target.searchParams.set("flow", "artist-upload")'), "bridges the canonical Dreamweaver route into a trusted artist upload handoff"],
  [script.includes('fetchJsonWithTimeout("/api/videos?artistSlug=owen-anthony"') && script.includes("archiveReel"), "enriches the experience with the connected artist video archive"],
  [script.includes("fetchJsonWithTimeout") && script.includes("RELEASE_CONTEXT_TIMEOUT_MS") && script.includes("VIDEO_LIBRARY_TIMEOUT_MS"), "guards Dreamweaver release-context and video loads with deterministic timeouts"],
  [page.includes('data-release-artwork') && script.includes("HaloReleaseArtwork?.resolve") && artworkHelper.includes("window.HaloReleaseArtwork"), "routes Dreamweaver release artwork through the shared HALO fallback recovery system"],
  [script.includes("activateChapter") && script.includes("elements.audio.currentTime") && script.includes("chapters.length - 1"), "synchronizes five story movements with audio playback"],
  [styles.includes("body.mode-room") && styles.includes("body.mode-explore") && styles.includes("prefers-reduced-motion"), "styles atmospheric modes and reduced-motion behavior"],
  [deck.includes('id="dreamweaverMix"') && deck.includes("/dreamweaver/?mix=${encodeURIComponent(data.id)}&experience=studio"), "moves a newly published mix directly into Dreamweaver"],
  [campaign.includes('href="/dreamweaver/"') && radio.includes('href="/dreamweaver/"'), "links the show from Campaign Studio and Radio"],
  [
    /from = "\/"[\s\S]*to = "\/halo"[\s\S]*status = 301/.test(config)
      && /from = "\/dreamweaver\/"[\s\S]*to = "\/dreamweaver\/index\.html"/.test(config)
      && !/from = "\/dreamweaver"\s+to = "\/dreamweaver\/"/.test(config),
    "keeps Netlify aligned to the canonical HALO home route and serves /dreamweaver/ directly without reintroducing the legacy alias redirect"
  ],
  [
    config.includes(`/dreamweaver/?mix=${DREAMWEAVER_STOREFRONT_MIX_ID}&song=:songId&satellite=dreamweaver`)
      && /from = "\/dreamweaver\/satellite\/:songId"[\s\S]*status = 301/.test(config)
      && /from = "\/dreamweaver\/satellite\/:songId\/"[\s\S]*status = 301/.test(config)
      && server.includes("app.get(/^\\/dreamweaver\\/satellite\\/([^/]+)$/")
      && server.includes("app.get(/^\\/dreamweaver\\/satellite\\/([^/]+)\\/$")
      && server.includes("dreamweaverStorefrontPath")
      && server.includes("songIdPattern"),
    "funnels deterministic Dreamweaver satellite URLs into the storefront route across Netlify and local server"
  ],
  [page.includes('id="campaignStudio"') && page.includes('id="campaignCanvas"') && page.includes("Make a Reel / Short"), "adds the Dreamweaver campaign cutting room"],
  [script.includes("renderVerticalClip") && script.includes("captureStream") && script.includes("MediaRecorder"), "renders a downloadable vertical clip in supported browsers"],
  [page.includes('id="downloadClip"') && page.includes('id="renderStatus"') && styles.includes('[hidden] { display: none !important; }'), "shows reliable film progress and keeps hidden overlays out of the preview"],
  [script.includes("blob.size < 1024") && script.includes("state.renderedClip") && script.includes("downloadRenderedClip"), "verifies a completed film before enabling its download"],
  [page.includes('id="dreamweaverSatellite"') && page.includes('id="dreamweaverUnlockForm"') && page.includes("Dreamweaver AI") && page.includes("concierge service"), "ships a fan-facing Dreamweaver satellite landing with email unlock framing"],
  [page.includes('id="dreamweaverReward"') && page.includes('id="dreamweaverSpotifyLink"') && page.includes('href="/album-concierge/?purpose=collector"') && page.includes('href="/support/#send"'), "unlocks streaming exits and keeps premium remix and album-builder offers as paid direct next steps"],
  [
    page.includes('id="dreamweaverSourceLink"')
      && page.includes("Blessed — Owen Anthony")
      && page.includes('href="https://distrokid.com/hyperfollow/owenanthony/blessed"')
      && script.includes('title: "Blessed"')
      && script.includes('artist: "Owen Anthony"')
      && script.includes('url: "https://distrokid.com/hyperfollow/owenanthony/blessed"')
      && script.includes("elements.sourceLink.href = featuredTrack.url"),
    "keeps Blessed by Owen Anthony wired into the Dreamweaver release doorway with the canonical HyperFollow source"
  ],
  [script.includes("publishedSongId: resolveSongContextId()") && script.includes('new URL("/music/", location.origin)') && script.includes("Published song link copied."), "shares a published song from Dreamweaver using the canonical public music URL when song context is present"],
  [script.includes("resolveSongContextId") && script.includes("songIdFromSatellitePath") && script.includes("canonicalDreamweaverUrl") && script.includes("startSatelliteAgentLoop") && script.includes("dreamweaver-satellite-"), "derives song-specific context from deterministic storefront/satellite routes and runs an isolated per-song update loop"],
  [script.includes('fetch("/api/dreamweaver-fan-signups"') && script.includes("readStoredUnlock") && script.includes("updatePlatformLinks"), "submits email unlocks and rehydrates the lightweight fan reward state"],
  [script.includes('action: "start"') && script.includes("pollCampaignJob") && script.includes("renderPlatformPackages"), "starts, monitors, and exports background campaign packages"],
  [page.includes('id="campaignYoutubeUrl"') && page.includes("Load it. Shape it. Send it.") && campaignFunction.includes("cleanYouTubeUrl") && campaignFunction.includes("halo_youtube_sources"), "offers a one-link YouTube launch that persists the source signal"],
  [campaignFunction.includes("gallery_visible = TRUE OR sofa_visible = TRUE") && campaignFunction.includes("sourceVideoIds = galleryRows.map"), "automatically gathers the artist-owned HALO gallery when no manual footage is chosen"],
  [campaignFunction.includes("feeds/videos.xml?channel_id=") && campaignFunction.includes("recentVideos"), "gathers recent public YouTube video references in the background without requiring another form"],
  [page.includes('name="visualTreatment"') && page.includes('id="footageSelector"') && script.includes("prepareCampaignVideos"), "cuts selected approved archive footage into section, reel, and collage treatments"],
  [campaignFunction.includes('path: "/api/dreamweaver-campaigns"') && campaignLibrary.includes("generateCampaignPackage") && campaignLibrary.includes("reviewCampaignEvidence"), "ships grounded Gemma generation and review services"],
  [campaignMigration.includes("halo_dreamweaver_campaigns") && campaignMigration.includes("halo_dreamweaver_campaign_events"), "persists campaigns and their feedback signals"],
  [campaignJobMigration.includes("halo_dreamweaver_campaign_jobs") && campaignJobMigration.includes("halo_memberships(member_id)") && campaignFunction.includes("context.waitUntil") && campaignFunction.includes("processCampaignJob"), "persists resumable background campaign jobs"],
  [campaignFunction.includes("owner_member_id = ${job.member_id}") && campaignFunction.includes("rightsNote"), "limits production footage to artist-owned published video records"],
  [campaignMonitor.includes('schedule: "30 7 * * *"') && campaignMonitor.includes("reviewCampaignEvidence"), "runs the automated daily campaign monitoring loop"],
  [fanSignupFunction.includes("verifyRequestOrigin") && fanSignupFunction.includes("halo_dreamweaver_fan_signups") && fanSignupFunction.includes("halo_relationship_signups") && fanSignupFunction.includes("relationship_summary = ''") && fanSignupFunction.includes('path: "/api/dreamweaver-fan-signups"'), "stores public Dreamweaver unlock requests behind an origin-checked endpoint and syncs them into CRM records"],
  [fanSignupMigration.includes("halo_dreamweaver_fan_signups") && fanSignupMigration.includes("favorite_platform") && fanSignupMigration.includes("unlock_reward"), "persists Dreamweaver fan signups and their unlocked reward metadata"],
  [relationshipSignupMigration.includes("halo_relationship_signups") && relationshipSignupMigration.includes("linked_member_id") && relationshipSignupMigration.includes("signup_count"), "maps Dreamweaver unlocks into a CRM signup spine with member linkage and repeat activity"],
  [relationsPage.includes("DREAMWEAVER CRM") && relationsScript.includes("dreamweaverSignupList") && relationsFunction.includes("halo_relationship_signups"), "surfaces Dreamweaver signup counts and recent CRM activity in the owner relationship desk"],
  [haloXLib.includes("dreamweaverSignupsTotal") && dailyEmailTemplate.includes("{{dreamweaverSignupsToday}}"), "adds Dreamweaver signup observability to the owner daily report"],
  [stats.includes('"open_dreamweaver_campaign_studio"') && stats.includes('"dreamweaver_campaign_generated"'), "accepts Dreamweaver campaign analytics events"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Dreamweaver show contracts: ${checks.length}/${checks.length} checks passed.`);
