import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, styles, script, deck, campaign, radio, config, campaignFunction, campaignLibrary, campaignMigration, campaignJobMigration, campaignMonitor, stats, fanSignupFunction, fanSignupMigration] = await Promise.all([
  read("dreamweaver/index.html"),
  read("dreamweaver/dreamweaver.css"),
  read("dreamweaver/dreamweaver.js"),
  read("dj-deck.html"),
  read("campaign-studio/index.html"),
  read("radio/index.html"),
  read("netlify.toml"),
  read("netlify/functions/dreamweaver-campaigns.mjs"),
  read("netlify/lib/dreamweaver-campaigns.mjs"),
  read("netlify/database/migrations/20260816180000_create-dreamweaver-campaigns.sql"),
  read("netlify/database/migrations/20260816210000_add-dreamweaver-background-jobs.sql"),
  read("netlify/functions/dreamweaver-campaign-monitor.mjs"),
  read("netlify/lib/stats.mjs"),
  read("netlify/functions/dreamweaver-fan-signups.mjs"),
  read("netlify/database/migrations/20260905025500_create_dreamweaver_fan_signups.sql")
]);

const checks = [
  [page.includes("Dreamweaver Show — HALO") && page.includes('id="showAudio"'), "ships the standalone Dreamweaver visual show"],
  [page.includes('data-mode="watch"') && page.includes('data-mode="room"') && page.includes('data-mode="explore"'), "offers Watch, Room, and Explore modes"],
  [script.includes('fetch("/api/mixes?limit=100"') && script.includes("requestedMix"), "loads an existing Mix Desk recording and supports direct mix links"],
  [script.includes('fetch("/api/videos?artistSlug=owen-anthony"') && script.includes("archiveReel"), "enriches the experience with the connected artist video archive"],
  [script.includes("activateChapter") && script.includes("elements.audio.currentTime") && script.includes("chapters.length - 1"), "synchronizes five story movements with audio playback"],
  [styles.includes("body.mode-room") && styles.includes("body.mode-explore") && styles.includes("prefers-reduced-motion"), "styles atmospheric modes and reduced-motion behavior"],
  [deck.includes('id="dreamweaverMix"') && deck.includes("/dreamweaver/?mix=${encodeURIComponent(data.id)}"), "moves a newly published mix directly into Dreamweaver"],
  [campaign.includes('href="/dreamweaver/"') && radio.includes('href="/dreamweaver/"'), "links the show from Campaign Studio and Radio"],
  [config.includes('from = "/dreamweaver"') && config.includes('to = "/dreamweaver/"'), "normalizes the public Dreamweaver route"],
  [page.includes('id="campaignStudio"') && page.includes('id="campaignCanvas"') && page.includes("Make a Reel / Short"), "adds the Dreamweaver campaign cutting room"],
  [script.includes("renderVerticalClip") && script.includes("captureStream") && script.includes("MediaRecorder"), "renders a downloadable vertical clip in supported browsers"],
  [page.includes('id="downloadClip"') && page.includes('id="renderStatus"') && styles.includes('[hidden] { display: none !important; }'), "shows reliable film progress and keeps hidden overlays out of the preview"],
  [script.includes("blob.size < 1024") && script.includes("state.renderedClip") && script.includes("downloadRenderedClip"), "verifies a completed film before enabling its download"],
  [page.includes('id="dreamweaverSatellite"') && page.includes('id="dreamweaverUnlockForm"') && page.includes("Dreamweaver AI") && page.includes("concierge service"), "ships a fan-facing Dreamweaver satellite landing with email unlock framing"],
  [page.includes('id="dreamweaverReward"') && page.includes('id="dreamweaverSpotifyLink"') && page.includes('href="/album-concierge/?purpose=collector"') && page.includes('href="/support/#send"'), "unlocks streaming exits and keeps premium remix and album-builder offers as paid direct next steps"],
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
  [fanSignupFunction.includes("verifyRequestOrigin") && fanSignupFunction.includes("halo_dreamweaver_fan_signups") && fanSignupFunction.includes('path: "/api/dreamweaver-fan-signups"'), "stores public Dreamweaver unlock requests behind an origin-checked lightweight endpoint"],
  [fanSignupMigration.includes("halo_dreamweaver_fan_signups") && fanSignupMigration.includes("favorite_platform") && fanSignupMigration.includes("unlock_reward"), "persists Dreamweaver fan signups and their unlocked reward metadata"],
  [stats.includes('"open_dreamweaver_campaign_studio"') && stats.includes('"dreamweaver_campaign_generated"'), "accepts Dreamweaver campaign analytics events"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Dreamweaver show contracts: ${checks.length}/${checks.length} checks passed.`);
