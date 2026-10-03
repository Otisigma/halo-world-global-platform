import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PUBLIC_ROUTE_REGISTRY, MENU_ROUTE_REGISTRY, canonicalizeRoutePath } from "../lib/route-registry.js";
import { ORBIT_TIERS, SEEDED_CREATORS, SEEDED_SIGNAL_POSTS, filterSeededCreators, findSeededCreator } from "../lib/halo-creator-seed.js";
import {
  SIGNAL_LIMITS, buildFeed, catalogPost, createComment, createLocalPost, formatTime,
  resolveAuthor, sanitizeStoredState, seedPosts, splitMentions, waveformBars
} from "../lib/halo-signal-feed.js";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [html, client, styles, netlify, home, network, pkg] = await Promise.all([
  read("signal/index.html"), read("signal/signal.js"), read("signal/signal.css"),
  read("netlify.toml"), read("halo.html"), read("creator-network/index.html"), read("package.json")
]);

// Route + navigation from the main app shell.
const route = PUBLIC_ROUTE_REGISTRY.find(entry => entry.route === "/signal/");
assert.equal(route?.file, "signal/index.html");
assert.equal(MENU_ROUTE_REGISTRY.find(entry => entry.route === "/signal/")?.menuLabel, "SIGNAL FEED");
assert.equal(canonicalizeRoutePath("/signal/"), "/signal/");
assert.match(netlify, /from = "\/signal\/"\s+to = "\/signal\/index.html"\s+status = 200/);
assert.match(home, /route: '\/signal\/', label: 'SIGNAL FEED'/, "Signal Feed participates in menu route status checks");
assert.match(home, /href="\/signal\/" data-stat-event="open_signal_feed" data-stat-target="header"/, "Signal Feed is in the main menu");
assert.match(home, /href="\/signal\/" data-stat-event="open_signal_feed" data-stat-target="homepage_network"/, "Signal Feed is on the homepage directory");
assert.match(network, /href="\/signal\/"/, "Creator Network links to the Signal Feed");

// Netlify deploy fix stays intact: the static catalog stays optional for the release guard.
assert.equal(JSON.parse(pkg).scripts.prebuild, "npm run release-guard -- --allow-missing-catalog");

// Page shell follows shared HALO conventions.
for (const asset of ["/site-monitor.js", "/stats.js", "/accessibility.js", "/accessibility.css", "/halo-hud.js", "/halo-hud.css", "/identity.js", "/release-artwork.js", "/creator-network/network.css"]) {
  assert.ok(html.includes(asset), `Signal Feed loads ${asset}`);
}
assert.match(html, /<script type="module" src="\/signal\/signal.js"><\/script>/);
for (const id of ["composer", "composerBody", "composerTrack", "feed", "signalAudio", "residentList", "signalStatus"]) {
  assert.match(html, new RegExp(`id="${id}"`), `Signal Feed renders #${id}`);
}
for (const mode of ["all", "signal", "studio"]) assert.match(html, new RegExp(`data-mode="${mode}"`));
assert.match(html, /data-halo-guide=/);
assert.match(html, /href="\/creator-network\/#guardian"/);
assert.doesNotMatch(html, /name="robots" content="noindex/);
assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML|outerHTML|eval\(/, "Feed renders user text without HTML injection");
assert.match(client, /\/api\/release-catalog/, "Audio previews come from the published release catalog");
assert.match(client, /resolveAudio\(/);
assert.match(styles, /\.waveform/);

// Seed data contract.
assert.deepEqual(SEEDED_CREATORS.map(creator => creator.displayName), ["DJ Halo", "DJ Butterfly", "DJ Romy"]);
for (const creator of SEEDED_CREATORS) {
  assert.equal(creator.verified, true);
  assert.equal(creator.seed, true);
  assert.ok(ORBIT_TIERS.some(tier => tier.id === creator.orbitTier));
  assert.ok(!("email" in creator) && !("memberId" in creator) && !("member_id" in creator), "Seeds never carry member identity");
  assert.ok(Object.isFrozen(creator) && Object.isFrozen(creator.roles));
}
assert.ok(findSeededCreator("dj-halo").languages.includes("Swahili"));
assert.equal(findSeededCreator("@DJRomy")?.id, "dj-romy");
assert.deepEqual(filterSeededCreators({ language: "swahili" }).map(c => c.id), ["dj-halo"]);
assert.deepEqual(filterSeededCreators({ bpm: "120" }).map(c => c.id), ["dj-butterfly"]);
assert.equal(filterSeededCreators({ genre: "polka" }).length, 0);
assert.ok(SEEDED_SIGNAL_POSTS.every(post => findSeededCreator(post.authorId)));

// Feed helpers.
const parts = splitMentions("Hi @djhalo and @stranger!");
assert.deepEqual(parts.map(part => part.type), ["text", "mention", "text", "mention", "text"]);
assert.equal(parts[1].creatorId, "dj-halo");
assert.equal(parts[3].creatorId, null);
const bars = waveformBars("seed-halo-001", 56);
assert.equal(bars.length, 56);
assert.deepEqual(bars, waveformBars("seed-halo-001", 56), "Waveforms are deterministic per post");
assert.ok(bars.every(bar => bar >= 0.12 && bar <= 1));
assert.equal(formatTime(96), "1:36");
assert.equal(formatTime(-4), "0:00");

const post = createLocalPost({ body: "  New   loop for @djromy  ", kind: "studio" }, { now: 1000 });
assert.equal(post.body, "New loop for @djromy");
assert.equal(post.kind, "studio");
assert.equal(post.authorId, "you");
assert.equal(createLocalPost({ body: "x", kind: "admin" }).kind, "signal");
assert.equal(createLocalPost({ body: "x".repeat(900) }).body.length, SIGNAL_LIMITS.body);
assert.throws(() => createLocalPost({ body: "   " }));
assert.equal(createComment({ body: "Lift the pad", atSec: 95.7 }).atSec, 95);
assert.equal(createComment({ body: "No stamp", atSec: null }).atSec, null);
assert.equal(createComment({ body: "Bad stamp", atSec: -3 }).atSec, null);
assert.throws(() => createComment({ body: "" }));

const catalog = catalogPost({ id: "rel-1", title: "Night Drive", artist: "HALO" }, "/media/preview.mp3", 0, 10_000_000);
assert.equal(catalog.authorId, "halo-signal");
assert.equal(catalog.track.src, "/media/preview.mp3");
assert.equal(resolveAuthor("halo-signal").verified, true);
assert.equal(resolveAuthor("you").verified, false, "Local posters are never shown as verified");

const restored = sanitizeStoredState({
  posts: [
    { id: "local-1", authorId: "you", body: "Saved", kind: "signal", createdAt: 5, track: { src: "//evil.example/x.mp3" } },
    { id: "local-2", authorId: "dj-halo", body: "Impersonation" },
    { id: "local-3", authorId: "you", body: "With audio", track: { src: "/media/a.mp3", title: "A" } },
    null
  ],
  reactions: { "seed-halo-001": ["fire", "admin"], bad: "fire" },
  comments: { "seed-halo-001": [{ body: "ok", atSec: 3 }, { body: "" }], bad: "x" }
});
assert.deepEqual(restored.posts.map(item => item.id), ["local-1", "local-3"], "Stored posts can only be authored by the local viewer");
assert.equal(restored.posts[0].track, null, "Protocol-relative audio sources are dropped");
assert.equal(restored.posts[1].track.src, "/media/a.mp3");
assert.deepEqual(restored.reactions, { "seed-halo-001": ["fire"] });
assert.equal(restored.comments["seed-halo-001"].length, 1);
assert.ok(!("bad" in restored.comments));
assert.deepEqual(sanitizeStoredState("garbage"), { posts: [], reactions: {}, comments: {} });

const feed = [...seedPosts(1_000_000_000), post];
assert.equal(buildFeed({ posts: feed }).length, 4);
assert.ok(buildFeed({ posts: feed, mode: "studio" }).every(item => item.kind === "studio"));
assert.ok(buildFeed({ posts: feed, mode: "signal" }).every(item => item.kind === "signal"));
const romy = buildFeed({ posts: feed, creator: "djromy" });
assert.ok(romy.length >= 2 && romy.every(item => item.authorId === "dj-romy" || item.body.includes("@djromy")));
const ordered = buildFeed({ posts: feed });
assert.ok(ordered.every((item, index) => index === 0 || ordered[index - 1].createdAt >= item.createdAt), "Newest signals first");

console.log("Signal Feed contracts passed: route, navigation, seeds, mentions, waveform, composer, comments, storage hygiene");
