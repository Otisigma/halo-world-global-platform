import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { allowedEvents } from "../netlify/lib/stats.mjs";

const root = resolve(import.meta.dirname, "..");
const [client, styles, stats, summary] = await Promise.all([
  readFile(resolve(root, "music-player.js"), "utf8"),
  readFile(resolve(root, "music-player.css"), "utf8"),
  readFile(resolve(root, "stats.js"), "utf8"),
  readFile(resolve(root, "netlify/functions/stats-summary.mjs"), "utf8")
]);

for (const eventName of [
  "music_player_open",
  "music_playback_start",
  "music_preview_reached",
  "music_preview_continue",
  "music_playback_milestone",
  "music_playback_complete",
  "music_player_close",
  "music_external_open"
]) {
  assert.equal(allowedEvents.has(eventName), true, `${eventName} must be accepted by analytics`);
  assert.equal(client.includes(`"${eventName}"`), true, `${eventName} must be emitted by the player`);
}

assert.match(client, /youtube-nocookie\.com/, "YouTube playback must use the privacy-enhanced embed host");
assert.match(client, /quick_15: 15, sample_30: 30, full_listen: 0/, "preview duration variants must remain measurable");
assert.match(client, /MutationObserver/, "dynamically rendered music links must be discovered");
assert.match(client, /dataset\.haloPlayer === "off"/, "links must support an explicit player opt-out");
assert.match(styles, /PLAY HERE/, "eligible links must advertise on-site playback");
assert.match(stats, /music-player\.js/, "the shared analytics client must load the player");
assert.match(summary, /averageListenSeconds/, "admin reporting must expose listening duration");
assert.match(summary, /listeningVariants/, "admin reporting must compare preview variants");
assert.match(summary, /commercialIntent/, "preview reporting must connect listening with commercial intent");

console.log("Music player contracts passed.");
