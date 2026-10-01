import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import {
  chartVoterKey,
  directStreamUrl,
  isValidReleaseId,
  normalizeChartSort,
  rankChartReleases,
  serializeChartRelease
} from "../netlify/lib/catalog-chart.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [chartApi, migration, featuredClient, shopClient, styles, musicPage, uploadPage] = await Promise.all([
  read("netlify/functions/chart.mjs"),
  read("netlify/database/migrations/20260930030000_create_chart_votes.sql"),
  read("music/featuredPlayer.js"),
  read("music/music.js"),
  read("music/music.css"),
  read("music/index.html"),
  read("music-upload/index.html")
]);

// --- Direct audio sources only -------------------------------------------------
assert.equal(directStreamUrl("https://cdn.example.com/audio/track.mp3"), "https://cdn.example.com/audio/track.mp3");
assert.equal(directStreamUrl("/api/song-catalog/audio?versionId=abc"), "/api/song-catalog/audio?versionId=abc");
assert.equal(
  directStreamUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing"),
  "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp",
  "Drive share links must become direct-download stream URLs"
);
for (const landing of [
  "https://distrokid.com/hyperfollow/owenanthony/emotional-healing",
  "https://hyperfollow.com/owenanthony/emotional-healing",
  "https://linktr.ee/owenanthony",
  "https://drive.google.com/uc?export=download&id=EMOTIONAL_HEALING_FILE_ID",
  "https://example.com/release-page",
  "javascript:alert(1)",
  "//evil.example/track.mp3",
  ""
]) {
  assert.equal(directStreamUrl(landing), "", `${landing || "(empty)"} must never be used as an audio source`);
}

// --- Chart ranking and shape ----------------------------------------------------
assert.equal(normalizeChartSort("SIGNAL"), "signal");
assert.equal(normalizeChartSort("votes"), "votes");
assert.equal(normalizeChartSort("'; DROP TABLE"), "signal");
assert.ok(isValidReleaseId("emotional-healing"));
assert.ok(!isValidReleaseId("../etc/passwd"));
assert.ok(!isValidReleaseId("x"));
assert.match(chartVoterKey({ ip: "203.0.113.9", userAgent: "test" }), /^anon-[0-9a-f]{40}$/, "voter keys must be anonymous hashes");
assert.notEqual(chartVoterKey({ ip: "203.0.113.9" }), chartVoterKey({ ip: "203.0.113.10" }));

const rows = [
  { id: "quiet-one", title: "Quiet One", artist: "HALO", status: "published", release_date: "2026-09-01", genres: ["Dance"], artwork_url: "/assets/releases/quiet.jpg", stream_url: "https://cdn.example.com/quiet.mp3", votes: 0, recent_listens: 1, recent_opens: 0 },
  { id: "emotional-healing", title: "Emotional <Healing>", artist: "Owen Anthony", status: "published", release_date: "2026-09-20", genres: ["R&B"], artwork_url: "/assets/releases/emotional-healing.jpg", stream_url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view", votes: 4, recent_listens: 2, recent_opens: 1 },
  { id: "presave-only", title: "Presave Only", artist: "HALO", status: "published", release_date: "2026-09-25", genres: [], artwork_url: "", stream_url: "https://distrokid.com/hyperfollow/halo/presave-only", votes: 1, recent_listens: 0, recent_opens: 0 },
  { id: "draft-track", title: "Draft", artist: "HALO", status: "draft", release_date: "2026-09-29", genres: [], artwork_url: "", stream_url: "https://cdn.example.com/draft.mp3", votes: 99, recent_listens: 99, recent_opens: 99 }
];
const serialized = rows.map(serializeChartRelease);
const leader = serialized.find(release => release.id === "emotional-healing");
for (const field of ["id", "title", "artist", "status", "releaseDate", "genres", "artwork", "audioUrl", "isPlayable", "votes", "chartActivity", "signalScore", "listenUrl", "kitUrl", "shopUrl"]) {
  assert.ok(field in leader, `chart releases must expose ${field} for the hero and queue`);
}
assert.equal(leader.audioUrl, "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp");
assert.equal(leader.signalScore, 4 * 5 + 2 * 8 + 1 * 3);
assert.equal(serialized.find(release => release.id === "presave-only").audioUrl, "", "HyperFollow pages must not be exposed as audio");
assert.equal(serialized.find(release => release.id === "presave-only").isPlayable, false);

const ranked = rankChartReleases(serialized, "signal");
assert.deepEqual(ranked.map(release => release.id), ["emotional-healing", "quiet-one", "presave-only"], "signal chart must rank by score and drop unapproved releases");
assert.deepEqual(ranked.map(release => release.rank), [1, 2, 3]);
assert.deepEqual(rankChartReleases(serialized, "newest").map(release => release.id), ["presave-only", "emotional-healing", "quiet-one"]);
assert.deepEqual(rankChartReleases([...serialized].reverse(), "signal").map(release => release.id), ranked.map(release => release.id), "ranking must be deterministic");
assert.ok(rankChartReleases([{ ...leader, status: "passed" }], "signal").length === 1, "passed must be treated as approved");

// --- Chart API wiring -------------------------------------------------------------
assert.match(chartApi, /path: \["\/api\/catalog\/chart", "\/api\/catalog\/vote"\]/, "chart function must declare both routes as string literals for Netlify static configuration parsing");
assert.match(chartApi, /const CHART_PATH = "\/api\/catalog\/chart"/);
assert.match(chartApi, /const VOTE_PATH = "\/api\/catalog\/vote"/);
assert.match(chartApi, /FROM halo_release_campaigns release[\s\S]*WHERE release\.status = 'published'\s+AND release\.is_chart_eligible = TRUE/, "chart must only surface published, chart-eligible releases");
assert.match(chartApi, /FROM halo_chart_votes vote/, "chart must rank with stored votes");
assert.match(chartApi, /ON CONFLICT \(release_id, voter_key, vote_day\) DO NOTHING/, "votes must be idempotent per voter per day");
assert.doesNotMatch(chartApi, /audio_url|release\.description/, "chart must only select columns that exist on halo_release_campaigns");
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_chart_votes/);
assert.match(migration, /REFERENCES halo_release_campaigns\(id\) ON DELETE CASCADE/);
assert.match(migration, /PRIMARY KEY \(release_id, voter_key, vote_day\)/);

const { default: chartHandler, config } = await import("../netlify/functions/chart.mjs");
assert.deepEqual(config.path, ["/api/catalog/chart", "/api/catalog/vote"]);
{
  const response = await chartHandler(new Request("https://halo.test/api/catalog/vote", { method: "GET" }), {});
  assert.equal(response.status, 405, "vote route must reject GET");
}
{
  const response = await chartHandler(new Request("https://halo.test/api/catalog/chart", { method: "DELETE" }), {});
  assert.equal(response.status, 405, "chart route must reject unsupported methods");
}
{
  const response = await chartHandler(new Request("https://halo.test/api/catalog/vote", { method: "POST", body: "releaseId=blessed", headers: { "Content-Type": "application/x-www-form-urlencoded" } }), {});
  assert.equal(response.status, 415, "votes must require JSON so cross-site form posts cannot vote");
}
{
  const response = await chartHandler(new Request("https://halo.test/api/catalog/vote", { method: "POST", body: JSON.stringify({ releaseId: "../../x" }), headers: { "Content-Type": "application/json" } }), {});
  assert.equal(response.status, 400, "votes must validate the release id");
}

// --- Featured hero client ---------------------------------------------------------
assert.doesNotMatch(featuredClient, /new Audio\(|<audio/, "featured hero must reuse the HaloGlobalPlayer singleton instead of creating audio elements");
assert.match(featuredClient, /window\.HaloPlayer/, "featured hero must use the shared window.HaloPlayer");
assert.match(featuredClient, /const CHART_ENDPOINT = "\/api\/catalog\/chart\?sort=signal"/);
assert.match(featuredClient, /document\.querySelector\("#featuredRelease"\)/, "featured hero must render into #featuredRelease");

const sandboxWindow = { location: { origin: "https://halo.test", pathname: "/music/" }, dispatchEvent() {} };
vm.runInNewContext(featuredClient, {
  window: sandboxWindow,
  document: { querySelector: () => null },
  URL,
  console
});
const featured = sandboxWindow.HaloFeaturedPlayer;
assert.ok(featured, "featuredPlayer.js must expose its hero/queue helpers");

const chartReleases = rankChartReleases(serialized, "signal");
const queue = featured.buildQueue(chartReleases);
assert.deepEqual(queue.map(release => release.id), ["emotional-healing", "quiet-one"], "queue must only include approved, directly streamable releases");
assert.deepEqual(featured.buildQueue([{ ...leader, status: "pending" }]), [], "queue must drop unapproved releases");

const markup = featured.heroMarkup({ releases: chartReleases, queue });
assert.match(markup, /featured-hero-card/);
assert.match(markup, /Emotional &lt;Healing&gt;/, "hero must escape release text");
assert.doesNotMatch(markup, /Emotional <Healing>/);
const heroButton = markup.match(/<button class="action play"[^>]*>/)?.[0] || "";
for (const [attribute, value] of [
  ["data-action", "play-track"],
  ["data-play-track-id", "emotional-healing"],
  ["data-track-id", "emotional-healing"],
  ["data-title", "Emotional &lt;Healing&gt;"],
  ["data-artist", "Owen Anthony"],
  ["data-audio-url", "https://drive.google.com/uc?export=download&amp;id=1AbCdEfGhIjKlMnOp"],
  ["data-cover", "https://halo.test/assets/releases/emotional-healing.jpg"],
  ["data-queue-index", "0"]
]) {
  assert.ok(heroButton.includes(`${attribute}="${value}"`), `hero play button must expose ${attribute}="${value}" for the delegated player`);
}
assert.match(markup, /Up next on the chart[\s\S]*Quiet One[\s\S]*data-queue-index="1"/, "hero must preview the rest of the queue");
assert.doesNotMatch(markup, /Presave Only[\s\S]*data-action="play-track"/, "non-streamable releases must not get play buttons");
assert.match(markup, /data-featured-vote="emotional-healing"/, "hero must let listeners vote for the chart leader");

const presaveHero = featured.heroMarkup({ releases: [chartReleases[2]] });
assert.match(presaveHero, /Direct preview coming soon/, "a chart leader without a direct stream must fall back to its listen link");
assert.doesNotMatch(presaveHero, /data-action="play-track"/);
assert.match(featured.heroMarkup({ releases: chartReleases, queue, playerReady: false }), /Player unavailable/, "hero must degrade safely when the global player is missing");
assert.equal(featured.heroMarkup({ releases: [] }), "", "hero must render nothing when the chart is empty");

// Auto-advance through the shared player.
assert.equal(featured.nextQueueIndex(0, 3), 1);
assert.equal(featured.nextQueueIndex(2, 3), 0, "queue must loop back to the chart leader");
assert.equal(featured.nextQueueIndex(0, 1), -1, "a single-track queue must not loop");
{
  const played = [];
  const fakePlayer = {
    audio: new EventTarget(),
    track: null,
    play(track) { played.push(track.id); this.track = track; }
  };
  const threeQueue = [...queue, { ...queue[1], id: "third-track", rank: 3 }];
  const controller = featured.createQueueController(fakePlayer, () => threeQueue);
  fakePlayer.audio.dispatchEvent(new Event("ended"));
  assert.deepEqual(played, [], "auto-advance must stay idle until the queue is started from the hero");
  controller.start(0);
  fakePlayer.track = featured.trackFor(threeQueue[0]);
  fakePlayer.audio.dispatchEvent(new Event("ended"));
  fakePlayer.audio.dispatchEvent(new Event("ended"));
  fakePlayer.audio.dispatchEvent(new Event("ended"));
  assert.deepEqual(played, ["quiet-one", "third-track", "emotional-healing"], "ended must advance through the chart queue and loop");
  assert.equal(fakePlayer.track.src, "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp");
  fakePlayer.track = { id: "some-grid-track" };
  fakePlayer.audio.dispatchEvent(new Event("ended"));
  assert.equal(played.length, 3, "auto-advance must stop when the listener plays something outside the queue");
  assert.equal(controller.active, false);
}

// --- Page wiring and shop invariants ------------------------------------------------
for (const [name, page] of [["music/index.html", musicPage], ["music-upload/index.html", uploadPage]]) {
  assert.match(page, /id="featuredRelease"/, `${name} must keep the #featuredRelease hero mount`);
  assert.match(page, /<script src="\/music\/music\.js" defer><\/script>\s*<script src="\/music\/featuredPlayer\.js" defer><\/script>/, `${name} must load featuredPlayer.js after the global player`);
}
assert.match(shopClient, /state\.releases = \(Array\.isArray\(data\.releases\) \? data\.releases : \[\]\)\.filter\(isApprovedRelease\)/, "shop must keep filtering unapproved releases");
assert.match(shopClient, /document\.addEventListener\("click", handlePlayTrackClick\)/, "shop must keep delegated play handling");
assert.equal((shopClient.match(/new Audio\(/g) || []).length, 1, "shop must keep a single global Audio instance");
for (const selector of ["featured-hero-card", "featured-hero-actions", "featured-queue", "featured-queue-item.is-current"]) {
  assert.match(styles, new RegExp(`\\.${selector.replace(".", "\\.")} \\{`), `music.css must style .${selector}`);
}

console.log("Music featured player contracts passed.");
