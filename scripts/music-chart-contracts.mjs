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
assert.match(client, /Dreamweaver fallback active/, "chart must label Dreamweaver fallback playback when no video exists");
assert.match(client, /release-statuses/, "catalog cards and stage must expose playback and artwork status labels");
assert.match(catalogApi, /dreamweaver_fallback_track_id/, "catalog API must expose fallback audio linkage for video-pending songs");
assert.match(catalogApi, /video_url/, "catalog API must expose release video URL data for exact matching");
assert.match(catalogApi, /queryCatalogRowsWithoutFallback/, "catalog API must degrade gracefully when fallback-track linkage metadata is unavailable");
assert.match(catalogApi, /queryCatalogRowsWithoutFallbackOrVideo/, "catalog API must still return published releases when optional video metadata columns are unavailable");
assert.match(styles, /\.chart-console/, "chart console must have a dedicated responsive layout");
assert.match(styles, /\.chart-row\.is-active/, "chart rows must expose a selected state");

console.log("Music chart contracts passed.");
