import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { respondOracle, routeOracleIntent, countdownLabel } from "../lib/halo-oracle-engine.js";
import { createOracleHandler, config } from "../netlify/functions/halo-oracle.mjs";

const catalog = [
  { id: "cinema", title: "Night Signal", artist: "Artist A", status: "published", genres: ["Electronic", "Cinematic"], bpm: 120, pitch: "Artist-provided cinematic liner note.", releaseDate: "2026-10-01", availableVersions: ["Original", { name: "Extended Mix" }] },
  { id: "focus", title: "Focus Signal", artist: "Artist B", status: "published", genres: ["Deep House"], bpm: 122, releaseDate: "2026-10-10" },
  { id: "soul", title: "Soul Signal", artist: "Artist C", status: "published", genres: ["Afro Vocal"], bpm: 110 },
  { id: "draft", title: "Private Draft", status: "draft", genres: ["House"], bpm: 122, pitch: "Private notes" },
  { id: "hidden", title: "Hidden Release", status: "published", isLiveVisible: false },
  { id: "focus", title: "Duplicate Signal", status: "published" }
];
const now = Date.parse("2026-10-08T00:00:00Z");
const ask = (message, extra = {}) => respondOracle({ message, ...extra }, catalog, now);

for (const [query, intent] of [
  ["I need to lock in and focus", "mood"], ["Make this room soulful", "mood"],
  ["A calm late night vibe", "mood"], ["Build a 122 BPM mix", "mood"],
  ["What inspired this bassline?", "story"], ["Who plays saxophone on this track?", "story"],
  ["Show extended versions", "versions"], ["Build a bespoke 12-track album", "curator"],
  ["Personalized favorites", "curator"], ["Release countdown and early access", "event"],
  ["Is my Signal Score enough for the listening party?", "event"], ["Hello", "welcome"]
]) assert.equal(routeOracleIntent(query), intent, query);

assert.equal(ask("Help me focus").recommendations[0].id, "focus", "focus prefers house at 122 BPM");
assert.equal(ask("Find a soulful vibe").recommendations[0].id, "soul", "soulful prompts prefer Afro/vocal catalog matches");
assert.equal(ask("A cinematic night vibe").recommendations[0].id, "cinema");
assert.equal(ask("Recommend a 110 BPM mix").recommendations[0].id, "soul");
const story = ask("What inspired Night Signal?", { contextTrackId: "focus" });
assert.equal(story.trackDetails.id, "cinema", "named tracks override listening context");
assert.ok(story.reply.includes(catalog[0].pitch), "lore is sourced from published artist metadata");
assert.match(ask("Who plays saxophone?", { contextTrackId: "focus" }).reply, /not verified/, "never invent performer credits");
assert.match(ask("Tell the story", { contextTrackId: "focus" }).reply, /not published liner notes/);
assert.equal(ask("Show versions", { contextTrackId: "cinema" }).recommendations.length, 2);
assert.match(ask("Show versions").recommendations[1].actionUrl, /version=Extended%20Mix/);
assert.equal(ask("Show versions", { contextTrackId: "focus" }).recommendations.length, 0);

const album = ask("Curate my album", { favoriteTrackIds: ["soul", "draft", "invented"] });
assert.equal(album.recommendations[0].id, "soul", "explicitly saved signals lead personalized curation");
assert.deepEqual(album.album.trackIds, ["soul", "cinema", "focus"]);
assert.equal(album.album.targetSize, 12, "collector goal does not fabricate missing tracks");
const handoff = new URL(album.gateways.find(item => item.actionUrl.startsWith("/album-concierge/")).actionUrl, "https://halo.local");
assert.equal(handoff.searchParams.get("purpose"), "collector");
assert.match(handoff.searchParams.get("oracleStory"), /Soul Signal/);
assert.ok(!handoff.searchParams.get("oracleStory").includes("Curate my album"), "personal prompts are not copied into gateway URLs");
assert.equal(respondOracle({ message: "Curate my album" }, Array.from({ length: 20 }, (_, i) => ({ id: `track-${i}`, status: "published", title: `Track ${i}` }))).recommendations.length, 12);

const event = ask("Show early access", { signalScore: 999999, access: "unlocked" });
assert.equal(event.event.trackId, "focus", "host surfaces the next announced release");
assert.equal(event.event.access, "verification-required", "browser scores cannot unlock exclusive experiences");
assert.equal(event.event.countdown, "2d 0h 0m until release");
assert.match(event.reply, /not a fan's access eligibility/);
assert.ok(event.gateways.some(item => item.actionUrl === "/live-party/"));
assert.ok(event.gateways.some(item => item.actionUrl === "/release-kit.html?slug=focus&audience=preview"), "private previews reuse the verified invitation gateway");
assert.equal(countdownLabel("2026-10-01", now), "Release is live");
assert.equal(countdownLabel("unknown", now), "Schedule not announced");
assert.equal(ask("Release date of Night Signal").event.trackId, "cinema", "named release countdown remains contextual");

for (const message of ["focus", "story", "album", "event", "versions", "hello"]) {
  const reply = ask(message);
  assert.ok(!JSON.stringify(reply).includes("Private notes"));
  assert.ok(!reply.recommendations.some(item => ["draft", "hidden"].includes(item.id)));
  assert.ok(reply.quickActions.every(action => routeOracleIntent(action.query) !== "welcome"), "follow-up chips have supported routes");
  const empty = respondOracle({ message }, [], now);
  assert.equal(typeof empty.reply, "string");
  assert.equal(empty.trackDetails, null);
}
assert.equal(respondOracle({ message: "hello" }, null).trackDetails, null);
const hostile = respondOracle({ message: "story" }, [{ id: 'x&audience=preview', title: "<img onerror=alert(1)>", status: "published", pitch: "<script>bad</script>" }]);
assert.equal(hostile.trackDetails.actionUrl, "/music-upload/?song=x%26audience%3Dpreview", "IDs cannot inject route parameters");

let loads = 0;
const handler = createOracleHandler({ loadCatalog: async () => { loads++; return catalog; } });
const request = (body, headers = { "Content-Type": "application/json" }) => new Request("https://halo.local/api/halo-oracle", { method: "POST", headers, body });
assert.equal(config.path, "/api/halo-oracle");
assert.equal((await handler(new Request("https://halo.local/api/halo-oracle"))).status, 405);
assert.equal((await handler(request("hi", {}))).status, 415);
for (const body of ["{", "null", "[]", "{}", '{"message":12}', '{"message":" "}', JSON.stringify({ message: "x".repeat(1201) }), JSON.stringify({ message: "hello", favoriteTrackIds: [null] }), JSON.stringify({ message: "hello", contextTrackId: {} })]) {
  assert.equal((await handler(request(body))).status, 400, body);
}
assert.equal((await handler(request(JSON.stringify({ message: "😀".repeat(2500) })))).status, 413, "byte limit includes multi-byte prompts");
assert.equal((await handler(request("{}", { "Content-Type": "application/json", "Content-Length": "9000" }))).status, 413);
assert.equal(loads, 0, "invalid requests never query the catalog");
const response = await handler(request(JSON.stringify({ message: "Help me focus", signalScore: 99999, releases: [{ status: "published", title: "Fake" }] })));
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.equal((await response.json()).recommendations[0].id, "focus", "catalog is loaded server-side, never supplied by the browser");
const failed = createOracleHandler({ loadCatalog: async () => { throw new Error("private database detail"); } });
const unavailable = await failed(request('{"message":"hello"}'));
assert.equal(unavailable.status, 503);
assert.ok(!(await unavailable.text()).includes("private database detail"));

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [client, css, concierge, releaseLink] = await Promise.all([
  read("halo-oracle.js"), read("halo-oracle.css"), read("album-concierge/album-concierge.js"), read("netlify/functions/release-link.mjs")
]);
assert.doesNotMatch(client, /innerHTML|onclick|new Audio/);
for (const hook of ["__conversation", "__status", "__response", "__input", "__chips", "__selection"]) assert.ok(css.includes(`.halo-oracle${hook}`));
assert.match(css, /backdrop-filter:\s*blur/);
assert.match(css, /#ebc470/);
assert.match(client, /AbortController/);
assert.match(client, /contextTrackId: card.contextId/);
assert.match(client, /revision !== card.revision/, "stale replies cannot replace a newly selected track");
assert.match(concierge, /storyInput.value = state.storyInput/, "curator shortlist prefills the existing album story flow");
assert.match(releaseLink, /accessCodeMatches\(url.searchParams.get\("code"\), row.preview_access_code_hash\)/, "existing private preview gateway verifies the code server-side");
assert.match(releaseLink, /preview_expires_at/, "preview expiration stays enforced");
console.log("HALO Oracle engine, API, gateway, and theme contracts passed.");
