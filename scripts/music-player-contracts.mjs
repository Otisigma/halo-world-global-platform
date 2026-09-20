import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { allowedEvents } from "../netlify/lib/stats.mjs";

const root = resolve(import.meta.dirname, "..");
const [client, styles, stats, summary, statsLib, statsEvent, haloHome, releaseCatalogApi, musicWorld, dreamweaver] = await Promise.all([
  readFile(resolve(root, "music-player.js"), "utf8"),
  readFile(resolve(root, "music-player.css"), "utf8"),
  readFile(resolve(root, "stats.js"), "utf8"),
  readFile(resolve(root, "netlify/functions/stats-summary.mjs"), "utf8"),
  readFile(resolve(root, "netlify/lib/stats.mjs"), "utf8"),
  readFile(resolve(root, "netlify/functions/stats-event.mjs"), "utf8"),
  readFile(resolve(root, "halo.html"), "utf8"),
  readFile(resolve(root, "netlify/functions/release-catalog.mjs"), "utf8"),
  readFile(resolve(root, "music-world.html"), "utf8"),
  readFile(resolve(root, "dreamweaver/dreamweaver.js"), "utf8")
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
assert.match(client, /dataset\.haloPlayerArtist/, "the player should read artist metadata from link dataset fields");
assert.match(client, /halo-listening-room__facts/, "the player should render rich now-playing metadata rows");
assert.match(styles, /halo-listening-room__meta/, "the listening room styles must support the metadata panel");
assert.match(styles, /PLAY HERE/, "eligible links must advertise on-site playback");
assert.match(stats, /music-player\.js/, "the shared analytics client must load the player");
assert.match(haloHome, /resolveDreamweaverPreviewUrl/, "the homepage Dreamweaver player must validate preview audio sources before playback");
assert.match(haloHome, /dreamweaverPreviewCandidates/, "the homepage Dreamweaver player must keep alternate preview candidates available");
assert.match(haloHome, /preload="metadata"/, "the homepage Dreamweaver player must preload metadata for reliable click-to-play behavior");
assert.match(haloHome, /Preview loading/, "the homepage Dreamweaver player must expose a loading state");
assert.match(haloHome, /Preview ready/, "the homepage Dreamweaver player must expose a ready state");
assert.match(haloHome, /Preview playing/, "the homepage Dreamweaver player must expose a playing state");
assert.match(haloHome, /Preview unavailable/, "the homepage Dreamweaver player must expose a failed state");
assert.match(haloHome, /playDreamweaverPreviewCandidates/, "the homepage Dreamweaver player must use fallback-aware playback attempts");
assert.match(haloHome, /This preview source failed\. Loading the next Dreamweaver signal\./, "the homepage Dreamweaver player must explain automatic source fallback");
assert.match(haloHome, /dreamweaverPreviewRetryAllowedRef\.current[\s\S]*!dreamweaverPreviewRetryActiveRef\.current[\s\S]*nextCandidates\.length/, "the homepage Dreamweaver player must only retry to the next candidate after a guarded play attempt");
assert.match(releaseCatalogApi, /catalog_album_title/, "release catalog must include song-catalog album metadata for player hydration");
assert.match(releaseCatalogApi, /catalog_genre/, "release catalog must include song-catalog genre metadata for player hydration");
assert.match(releaseCatalogApi, /catalog_artwork_url/, "release catalog must include song-catalog artwork metadata for player hydration");
assert.match(musicWorld, /album\s*:\s*release\.albumTitle\s*\|\|\s*release\.collectionTitle\s*\|\|\s*details\.albumTitle\s*\|\|\s*''/, "music world player mapping must hydrate album metadata from catalog fallbacks");
assert.match(musicWorld, /genre\s*:\s*genres\[0\]\s*\|\|\s*details\.genre\s*\|\|\s*''/, "music world player mapping must hydrate genre metadata from catalog fallbacks");
assert.match(dreamweaver, /dataset\.haloPlayerAlbum\s*=\s*cleanText\(state\.release\?\.albumTitle\s*\|\|\s*state\.release\?\.collectionTitle\s*\|\|\s*state\.release\?\.catalog\?\.albumTitle\s*\|\|\s*""\)/, "dreamweaver source link must hydrate album metadata from catalog fallbacks");
assert.match(dreamweaver, /dataset\.haloPlayerGenre\s*=\s*Array\.isArray\(state\.release\?\.genres\)\s*&&\s*state\.release\.genres\.length[\s\S]*state\.release\?\.catalog\?\.genre/, "dreamweaver source link must hydrate genre metadata from catalog fallbacks");
assert.match(dreamweaver, /dataset\.haloPlayerArtwork\s*=\s*safeMediaUrl\(state\.release\?\.artwork\s*\|\|\s*state\.release\?\.artworkOverride\s*\|\|\s*state\.release\?\.importedArtwork\s*\|\|\s*state\.release\?\.catalog\?\.artworkUrl\)/, "dreamweaver source link must hydrate artwork metadata from catalog fallbacks");
assert.match(summary, /averageListenSeconds/, "admin reporting must expose listening duration");
assert.match(summary, /listeningVariants/, "admin reporting must compare preview variants");
assert.match(summary, /commercialIntent/, "preview reporting must connect listening with commercial intent");
assert.match(statsLib, /export async function getStatsDatabase\(\)/, "stats database access must stay asynchronous");
assert.match(statsLib, /await import\("@netlify\/database"\)/, "stats database access must use lazy dynamic import");
assert.match(summary, /await getStatsDatabase\(\)/, "stats summary must await database initialization");
assert.match(statsEvent, /await getStatsDatabase\(\)/, "stats event ingestion must await database initialization");

console.log("Music player contracts passed.");
