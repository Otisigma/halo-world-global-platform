import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const files = {
  migration: await readFile("netlify/database/migrations/20260816120000_create-artist-economy.sql", "utf8"),
  api: await readFile("netlify/functions/artist-economy.mjs", "utf8"),
  html: await readFile("artist-economy/index.html", "utf8"),
  js: await readFile("artist-economy/artist-economy.js", "utf8"),
  config: await readFile("netlify.toml", "utf8"),
  docs: await readFile("ARTIST_ECONOMY.md", "utf8")
};

for (const table of [
  "halo_artist_economy_profiles",
  "halo_artist_rights_works",
  "halo_artist_rights_participants",
  "halo_artist_income_entries",
  "halo_artist_campaign_investments",
  "halo_artist_licensing_opportunities",
  "halo_artist_live_engagements",
  "halo_artist_conscience_reviews"
]) assert.match(files.migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));

assert.match(files.migration, /owner_member_id TEXT NOT NULL REFERENCES halo_memberships/);
assert.match(files.migration, /artist_pay_bps \+ next_music_bps \+ audience_bps \+ business_reserve_bps \+ experiment_bps = 10000/);
assert.match(files.api, /getUser, verifyRequestOrigin/);
assert.match(files.api, /ensureMembership, isOwner/);
assert.match(files.api, /This Artist Economy belongs to another artist room/);
assert.match(files.api, /if \(!\(await verifyRequestOrigin\(request\)\)\)/);
assert.match(files.api, /body\.action === "create_review" && access\.platformOwner/);
assert.match(files.api, /path: "\/api\/artist-economy"/);
assert.match(files.html, /Does this help the artist make a healthy, independent living\?/);
assert.match(files.html, /data-panel="rights"/);
assert.match(files.html, /data-panel="income"/);
assert.match(files.html, /data-panel="campaigns"/);
assert.match(files.html, /data-panel="licensing"/);
assert.match(files.html, /data-panel="live"/);
assert.match(files.html, /data-panel="conscience"/);
assert.match(files.html, /No automatic spending/);
assert.match(files.js, /\/api\/artist-economy/);
assert.match(files.config, /for = "\/artist-economy\*"/);
assert.match(files.docs, /does not move money/);

console.log("Artist Economy contracts passed");
