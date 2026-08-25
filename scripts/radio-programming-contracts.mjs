import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { nextShowStart, serializeShow } from "../netlify/lib/radio-programming.mjs";

const [migration, scheduleFunction, connectionsFunction, radioPage, radioClient, artistClient] = await Promise.all([
  readFile(new URL("../netlify/database/migrations/20260810230000_create-radio-programming-and-artist-fans.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/radio-schedule.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/artist-connections.mjs", import.meta.url), "utf8"),
  readFile(new URL("../radio/index.html", import.meta.url), "utf8"),
  readFile(new URL("../radio/radio.js", import.meta.url), "utf8"),
  readFile(new URL("../artists/artists.js", import.meta.url), "utf8")
]);

const reference = new Date("2026-08-10T12:00:00.000Z");
assert.equal(nextShowStart(1, "18:00", reference).toISOString(), "2026-08-10T18:00:00.000Z");
assert.equal(nextShowStart(1, "10:00", reference).toISOString(), "2026-08-17T10:00:00.000Z");

const serialized = serializeShow({
  id: "artist-room-live",
  room: "lounge",
  title: "Artist Room Live",
  description: "Artist conversation",
  host_name: "HALO Radio Team",
  producer_name: "Artist Desk",
  show_type: "interview",
  day_of_week: 3,
  start_time_utc: "20:00:00",
  duration_minutes: 60,
  artist_slug: "owen-anthony",
  artwork_url: "",
  status: "published",
  subscribed: true,
  subscriber_count: 7
}, reference);
assert.equal(serialized.startsAt, "2026-08-12T20:00:00.000Z");
assert.equal(serialized.subscribed, true);
assert.equal(serialized.subscriberCount, 7);

assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_radio_shows/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_radio_show_subscriptions/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_artist_follows/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_radio_play_history/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_artist_activity/);
assert.match(migration, /halo-club-live/);

assert.match(scheduleFunction, /isOwner\(user\)/);
assert.match(scheduleFunction, /verifyRequestOrigin\(request\)/);
assert.match(scheduleFunction, /action === "save_show"/);
assert.match(scheduleFunction, /action === "subscribe"/);
assert.match(scheduleFunction, /action === "log_play"/);
assert.match(scheduleFunction, /action === "save_activity"/);
assert.match(scheduleFunction, /path: "\/api\/radio\/schedule"/);

assert.match(connectionsFunction, /halo_artist_follows/);
assert.match(connectionsFunction, /halo_radio_play_history/);
assert.match(connectionsFunction, /halo_artist_activity/);
assert.match(connectionsFunction, /path: "\/api\/artist\/connections"/);

assert.match(radioPage, /id="scheduleGrid"/);
assert.match(radioPage, /id="stationDeskDialog"/);
assert.match(radioClient, /loadSchedule/);
assert.match(radioClient, /data-show-follow/);
assert.match(artistClient, /toggleArtistFollow/);
assert.match(artistClient, /upcomingShows/);
assert.match(artistClient, /recentPlays/);

console.log("Radio programming contracts passed");

