import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [page, client, styles, catalogApi] = await Promise.all([
  readFile(resolve(root, "music/index.html"), "utf8"),
  readFile(resolve(root, "music/music.js"), "utf8"),
  readFile(resolve(root, "music/music.css"), "utf8"),
  readFile(resolve(root, "netlify/functions/release-catalog.mjs"), "utf8")
]);

assert.match(page, /The living chart/, "music catalog must identify the live chart");
assert.match(page, /Hip-Hop \/ Rap/, "chart must include a hip-hop room");
assert.match(page, /R&amp;B \/ Soul/, "chart must include an R&B and soul room");
assert.match(page, /House \/ Dance/, "chart must include a house and dance room");
assert.match(page, /Gospel \/ Inspirational/, "chart must include a gospel room");
assert.match(page, /Afrobeats \/ Global/, "chart must include a global room");
assert.match(page, /transparent HALO activity chart—not an industry sales chart/, "chart must explain what its rankings represent");
assert.match(catalogApi, /recent_listens/, "catalog API must expose rolling recent listening activity");
assert.match(catalogApi, /previous_listens/, "catalog API must expose the comparison window");
assert.match(client, /rankedReleases/, "client must calculate interactive room rankings");
assert.match(client, /youtube-nocookie\.com/, "chart video must use privacy-enhanced YouTube playback");
assert.match(client, /data-play-chart-video/, "chart stage must support in-place video playback");
assert.match(client, /satellite"\) === "music-video-fallback"/, "chart must keep fallback behavior behind a satellite query-flag path");
assert.match(client, /isFallbackVisual/, "chart must generate a per-release fallback visual when no playable video exists in satellite mode");
assert.match(styles, /\.chart-console/, "chart console must have a dedicated responsive layout");
assert.match(styles, /\.chart-row\.is-active/, "chart rows must expose a selected state");
assert.match(styles, /\.stage-video-fallback-visual/, "chart styles must support fallback visual playback without remote media");

console.log("Music chart contracts passed.");
