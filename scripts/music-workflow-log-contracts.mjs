/**
 * Music Workflow Observability Contracts
 *
 * These contracts verify that all music-related failure paths (catalog load,
 * missing listen links, broken artwork, audio connection errors, and YouTube
 * playback failures) dispatch a structured `halo:journal-event` so every issue
 * is automatically recorded in the Halo Journal and cross-referenced against
 * future fixes.
 *
 * Where to look for logs:
 *  - Browser console: search for "[HALO Music]" prefix entries.
 *  - Halo Journal (bottom-right panel on any HALO page): shows queued events.
 *  - /api/halo-journal and /api/issues: server-side issue records with fingerprints
 *    that prevent duplicate reports across sessions.
 *
 * How future fixes should be cross-referenced:
 *  - Each `halo:journal-event` carries an `eventType` (e.g. "music_catalog_error",
 *    "music_listen_url_missing", "music_artwork_error", "music_audio_error",
 *    "music_youtube_error"). Search the journal or issues API by eventType to
 *    find all occurrences of a given problem class.
 *  - When resolving an issue, note the eventType in the commit or PR description
 *    so the history of that event type shows the full fix chain.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [musicClient, artworkHelper, musicPlayer] = await Promise.all([
  readFile(resolve(root, "music/music.js"), "utf8"),
  readFile(resolve(root, "release-artwork.js"), "utf8"),
  readFile(resolve(root, "music-player.js"), "utf8")
]);

// music/music.js — catalog and link observability
assert.match(musicClient, /function logMusicIssue/, "music client must define a logMusicIssue helper");
assert.match(musicClient, /halo:journal-event/, "music client must dispatch halo:journal-event for issues");
assert.match(musicClient, /music_catalog_error/, "music client must log catalog load failures with eventType music_catalog_error");
assert.match(musicClient, /music_listen_url_missing/, "music client must log releases with missing listen URLs");
assert.match(musicClient, /logMusicIssue.*renderError|renderError.*logMusicIssue/s, "renderError must call logMusicIssue");

// release-artwork.js — artwork failure observability
assert.match(artworkHelper, /logArtworkIssue/, "release-artwork helper must define a logArtworkIssue function");
assert.match(artworkHelper, /music_artwork_error/, "release-artwork helper must log broken artwork URLs with eventType music_artwork_error");
assert.match(artworkHelper, /music_artwork_missing/, "release-artwork helper must log final artwork-missing state with eventType music_artwork_missing");
assert.match(artworkHelper, /halo:journal-event/, "release-artwork helper must dispatch halo:journal-event for artwork failures");

// music-player.js — audio and YouTube playback observability
assert.match(musicPlayer, /music_audio_error/, "music player must log audio connection failures with eventType music_audio_error");
assert.match(musicPlayer, /music_youtube_error/, "music player must log YouTube playback failures with eventType music_youtube_error");
assert.match(musicPlayer, /music_youtube_script_error/, "music player must log YouTube script load failures with eventType music_youtube_script_error");
assert.match(musicPlayer, /halo:journal-event.*music_audio_error|music_audio_error.*halo:journal-event/s, "music player must dispatch halo:journal-event for audio errors");

console.log("Music workflow observability contracts passed.");
