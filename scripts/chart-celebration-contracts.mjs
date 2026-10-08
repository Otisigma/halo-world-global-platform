import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { chartMomentum, serializeChartRelease } from "../netlify/lib/catalog-chart.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [celebrationClient, celebrationStyles, chartApi, featuredClient, shopClient, musicPage, uploadPage, signalPage, signalFeedClient] = await Promise.all([
  read("chart-celebration.js"),
  read("chart-celebration.css"),
  read("netlify/functions/chart.mjs"),
  read("music/featuredPlayer.js"),
  read("music/music.js"),
  read("music/index.html"),
  read("music-upload/index.html"),
  read("signal-network/index.html"),
  read("signal-network/signal-feed.js")
]);

// --- 7-day momentum from the chart API -----------------------------------------
assert.deepEqual(chartMomentum({ recentListens: 3, recentOpens: 1, previousListens: 1, previousOpens: 0 }), { delta: 19, value: "+19", label: "Rising", direction: "up" });
assert.equal(chartMomentum({ recentListens: 0, previousListens: 1 }).label, "Cooling");
assert.equal(chartMomentum({}).value, "—");
const serialized = serializeChartRelease({ id: "the-revival", title: "The Revival", artist: "HALO", status: "published", votes: 2, recent_listens: 3, recent_opens: 1, previous_listens: 1, previous_opens: 0 });
assert.equal(serialized.momentum.value, "+19", "chart releases must expose 7-day momentum");
assert.equal(serialized.chartActivity.previousListens, 1, "chart releases must expose the comparison window");
assert.match(chartApi, /previous_listens/, "chart API must count the previous 7-day listening window");
assert.match(chartApi, /INTERVAL '14 days'/, "chart API must load both 7-day windows");

// --- Shared celebration module ---------------------------------------------------
function loadCelebration() {
  const storage = new Map();
  const events = [];
  const channelMessages = [];
  const context = {
    URL, Date, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    dispatchEvent: event => events.push(event),
    BroadcastChannel: class { constructor(name) { this.name = name; } postMessage(message) { channelMessages.push({ name: this.name, message }); } close() {} },
    location: { origin: "https://halo.example" }
  };
  context.window = context;
  vm.runInNewContext(celebrationClient, context);
  return { api: context.HaloChartCelebration, storage, events, channelMessages };
}

const { api, events, channelMessages } = loadCelebration();
assert.ok(api, "chart-celebration.js must expose window.HaloChartCelebration");
const leader = {
  id: "the-revival", title: "THE REVIVAL", artist: "Owen Anthony", rank: 1, signalScore: 42, votes: 5,
  artwork: "/assets/releases/the-revival.jpg",
  chartActivity: { recentListens: 3, recentOpens: 1 },
  momentum: { value: "+19", label: "Rising" }
};
const track = api.trackFromRelease(leader);
const canonical = "https://halo-world-global-platform.netlify.app/music-upload/?song=the-revival";
assert.equal(api.canonicalTrackUrl("the-revival"), canonical, "social posts must use the canonical music-upload URL");
assert.equal(api.momentumText(track.momentum), "+19 Rising");
assert.deepEqual([...api.SOCIAL_PLATFORMS.map(platform => platform.id)], ["signal", "instagram", "tiktok", "x"]);
for (const platform of api.SOCIAL_PLATFORMS) {
  const post = api.formatSocialPost(track, platform.id);
  assert.match(post, /THE REVIVAL/, `${platform.label} post must include the title`);
  assert.match(post, /Owen Anthony/, `${platform.label} post must include the artist`);
  assert.match(post, /\+19 Rising/, `${platform.label} post must include 7-day momentum`);
  assert.ok(post.includes(canonical), `${platform.label} post must include the canonical music-upload URL`);
  assert.ok(post.length <= platform.limit, `${platform.label} post must fit the platform limit`);
}
const longPost = api.formatSocialPost({ ...track, title: "A".repeat(120), artist: "B".repeat(120) }, "x");
assert.ok(longPost.length <= 280, "X posts must stay within 280 characters");
assert.ok(longPost.includes(canonical), "trimmed X posts must keep the canonical URL");
assert.doesNotMatch(api.formatSocialPost({ ...track, title: "Bad\u0000\nTitle" }, "signal"), /\u0000/, "control characters must be removed");

assert.equal(api.shouldCelebrate(leader, ""), true, "a new #1 must trigger the celebration");
assert.equal(api.shouldCelebrate(leader, "the-revival"), false, "the same #1 must not celebrate twice");
assert.equal(api.shouldCelebrate({ ...leader, rank: 2 }, ""), false, "only the #1 position celebrates");
assert.equal(api.shouldCelebrate({ ...leader, signalScore: 0 }, ""), false, "an empty chart has no #1 to celebrate");
assert.equal(api.maybeCelebrate(leader), true, "the trigger must fire for a new leader");
assert.equal(api.maybeCelebrate(leader), false, "the trigger must fire once per leader");
assert.equal(events.length, 1, "the trigger must emit one Public Frequency event");
assert.equal(events[0].type, api.BROADCAST_EVENT);
assert.equal(events[0].detail.type, "living-chart-number-one");
assert.equal(events[0].detail.url, canonical);
assert.equal(channelMessages[0]?.name, "halo-public-frequency", "the broadcast must reach other open Public Frequency tabs");
assert.equal(api.maybeCelebrate({ ...leader, id: "next-leader" }), true, "a different #1 must celebrate again");

assert.doesNotMatch(celebrationClient, /onclick|innerHTML/, "celebration UI must use DOM nodes and event listeners");
assert.match(celebrationClient, /navigator\.clipboard\.writeText/, "share drawer must copy to the clipboard");
assert.match(celebrationClient, /aria-modal/, "celebration must be an accessible modal");
assert.match(celebrationStyles, /prefers-reduced-motion/, "confetti must respect reduced motion");
assert.match(celebrationStyles, /\.chart-celebration__confetti/, "celebration must render confetti");

// --- Wiring -----------------------------------------------------------------------
for (const [name, page] of [["music", musicPage], ["music-upload", uploadPage]]) {
  assert.match(page, /<link rel="stylesheet" href="\/chart-celebration\.css">/, `${name} must load celebration styles`);
  assert.match(page, /<script src="\/chart-celebration\.js" defer><\/script>\s*<script src="\/music\/music\.js" defer><\/script>\s*<script src="\/music\/featuredPlayer\.js" defer>/, `${name} must load the celebration module before the chart leader`);
}
assert.match(featuredClient, /HaloChartCelebration\?\.maybeCelebrate\(state\.releases\[0\]\)/, "the chart leader load must run the #1 trigger");
assert.match(signalPage, /id="feedSystemBroadcast"/, "Public Frequency must reserve a system broadcast slot");
assert.match(signalPage, /<script src="\/chart-celebration\.js" defer><\/script>/, "Public Frequency must load the celebration module");
assert.match(signalFeedClient, /renderBroadcast\(/, "Public Frequency must render the #1 system broadcast");
assert.match(signalFeedClient, /subscribeBroadcasts\(/, "Public Frequency must listen for live #1 broadcasts");

// --- Promo video fallback ------------------------------------------------------------
assert.match(shopClient, /document\.createElement\("video"\)/, "promo videos must use an explicit video element");
assert.match(shopClient, /document\.createElement\("source"\)/, "promo videos must declare an explicit source element");
assert.match(shopClient, /sourceElement\.addEventListener\("error", fail\)/, "promo videos must fall back when the source fails");
assert.match(shopClient, /showVideoFallback\(frame, video, source\)/, "promo videos must show an artwork fallback with an open link");
assert.doesNotMatch(shopClient, /<video src=/, "promo videos must not rely on a bare video src attribute");
assert.match(shopClient, /const matchedVideo = directVideo\?\.id === videoId \? directVideo : state\.videos\.find/, "release promo videos (promoVideoUrl) must resolve when their poster is played");
{
  const source = shopClient.match(/function videoMimeType\(source\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source, "promo videos must infer a source type");
  const videoMimeType = new Function(`${source}\nreturn videoMimeType;`)();
  assert.equal(videoMimeType("https://cdn.example.com/the-revival.mp4?x=1"), "video/mp4");
  assert.equal(videoMimeType("/promo/the-revival.webm"), "video/webm");
  assert.equal(videoMimeType("/api/videos?id=abc"), "", "unknown sources must not declare a type that browsers skip");
}

console.log("Chart celebration contracts passed.");
