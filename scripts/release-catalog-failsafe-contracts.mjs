import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { queryCatalogRows, serializeRelease } from "../netlify/functions/release-catalog.mjs";

const root = resolve(import.meta.dirname, "..");
const [catalogApi, musicClient] = await Promise.all([
  readFile(resolve(root, "netlify/functions/release-catalog.mjs"), "utf8"),
  readFile(resolve(root, "music/music.js"), "utf8")
]);

let capturedSql = "";
const rows = await queryCatalogRows({
  sql(strings, ...values) {
    capturedSql = String.raw({ raw: strings }, ...values);
    return Promise.resolve([{
      id: "dream-state",
      title: "Dream State",
      artist: "HALO",
      release_date: null,
      duration: null,
      genres: null,
      artwork_url: null,
      imported_artwork_url: null,
      artwork_override_url: null,
      video_title: null,
      video_url: null,
      bpm: null,
      musical_key: null,
      content_rating: null,
      pitch: null,
      available_versions: null,
      is_clean_version: null,
      is_chart_eligible: null,
      purchase_url: null,
      stream_url: null,
      featured_type: null,
      featured_until: null,
      dreamweaver_fallback_track_id: null,
      recent_opens: null,
      recent_listens: null,
      previous_opens: null,
      previous_listens: null
    }]);
  }
});

assert.equal(rows.length, 1, "catalog query helper should return rows from the database client");
assert.match(capturedSql, /to_jsonb\(release\)\s*->>\s*'video_title'/, "catalog query must read video_title through JSON so missing columns stay null-safe");
assert.match(capturedSql, /to_jsonb\(release\)\s*->>\s*'video_url'/, "catalog query must read video_url through JSON so missing columns stay null-safe");
assert.match(capturedSql, /to_jsonb\(track\)\s*->>\s*'release_id'/, "catalog query must treat radio-track release linkage as optional");

const withoutOptionalMedia = serializeRelease(rows[0]);
assert.equal(withoutOptionalMedia.videoTitle, "", "serialization must emit an empty video title when optional metadata is absent");
assert.equal(withoutOptionalMedia.videoUrl, "", "serialization must emit an empty video URL when optional metadata is absent");
assert.equal(withoutOptionalMedia.dreamweaverFallbackTrackId, "", "serialization must emit an empty fallback track id when no fallback exists");
assert.equal(withoutOptionalMedia.dreamweaverFallbackAudioUrl, "", "serialization must emit an empty fallback audio URL when no fallback exists");
assert.equal(withoutOptionalMedia.playbackStatus, "pending_video", "serialization must keep releases renderable when no video or fallback exists");

const withFallbackAudio = serializeRelease({
  ...rows[0],
  dreamweaver_fallback_track_id: "fallback track",
  video_url: "notaurl",
  video_title: null
});
assert.equal(withFallbackAudio.videoUrl, "", "invalid optional video URLs must be dropped instead of returned");
assert.equal(withFallbackAudio.dreamweaverFallbackAudioUrl, "/api/radio/audio?id=fallback%20track", "fallback audio URLs must still be emitted when a fallback track id exists");
assert.equal(withFallbackAudio.playbackStatus, "dreamweaver_fallback", "fallback playback status must survive absent video metadata");

assert.match(catalogApi, /export async function queryCatalogRows/, "catalog API should expose the query helper for failsafe contract coverage");
assert.match(musicClient, /function normalizeRelease/, "music client must normalize catalog releases before rendering");
assert.match(musicClient, /data\.releases\.map\(normalizeRelease\)/, "music client must sanitize catalog payloads before rendering");

console.log("Release catalog failsafe contracts passed.");
