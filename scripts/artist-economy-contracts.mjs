import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const files = {
  migration: await readFile("netlify/database/migrations/20260816120000_create-artist-economy.sql", "utf8"),
  rightsOwnershipMigration: await readFile("netlify/database/migrations/20260913071000_expand_artist_rights_ownership.sql", "utf8"),
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
assert.match(files.rightsOwnershipMigration, /ALTER TABLE halo_artist_rights_works/);
assert.match(files.rightsOwnershipMigration, /composition_owner TEXT NOT NULL DEFAULT ''/);
assert.match(files.rightsOwnershipMigration, /admin_publisher_name TEXT NOT NULL DEFAULT ''/);
assert.match(files.rightsOwnershipMigration, /admin_publishing_status TEXT NOT NULL DEFAULT 'unknown'/);
assert.match(files.rightsOwnershipMigration, /CREATE TABLE IF NOT EXISTS halo_artist_rights_society_memberships/);
assert.match(files.rightsOwnershipMigration, /society_type IN \('pro', 'cmo', 'neighbouring_rights', 'mechanical', 'publisher_admin', 'other'\)/);
assert.match(files.rightsOwnershipMigration, /approval_status TEXT NOT NULL DEFAULT 'required'/);
assert.match(files.rightsOwnershipMigration, /approved_by_member_id TEXT REFERENCES halo_memberships/);
assert.match(files.rightsOwnershipMigration, /stage IN \('brief', 'matched', 'artist_approval', 'declined'\) OR approval_status = 'approved'/);
assert.match(files.api, /getUser, verifyRequestOrigin/);
assert.match(files.api, /ensureMembership, isOwner/);
assert.match(files.api, /buildRightsGuidance/);
assert.match(files.api, /rightsGuidance: buildRightsGuidance/);
assert.match(files.api, /addSocietyMembership/);
assert.match(files.api, /approval_status = \$\{approvalStatus\}/);
assert.match(files.api, /This Artist Economy belongs to another artist room/);
assert.match(files.api, /if \(!\(await verifyRequestOrigin\(request\)\)\)/);
assert.match(files.api, /body\.action === "create_review" && access\.platformOwner/);
assert.match(files.api, /body\.action === "add_society_membership"/);
assert.match(files.api, /path: "\/api\/artist-economy"/);
assert.match(files.html, /Does this help the artist make a healthy, independent living\?/);
assert.match(files.html, /id="rightsGuidance"/);
assert.match(files.html, /territory-specific societies/);
assert.match(files.html, /No automatic registration/);
assert.match(files.html, /data-panel="rights"/);
assert.match(files.html, /data-panel="income"/);
assert.match(files.html, /data-panel="campaigns"/);
assert.match(files.html, /data-panel="licensing"/);
assert.match(files.html, /data-panel="live"/);
assert.match(files.html, /data-panel="conscience"/);
assert.match(files.html, /No automatic spending/);
assert.match(files.js, /\/api\/artist-economy/);
assert.match(files.js, /renderRightsGuidance/);
assert.match(files.js, /data-open-form="membership"/);
assert.match(files.js, /add_society_membership/);
assert.match(files.js, /licensingApproval/);
assert.match(files.config, /for = "\/artist-economy\*"/);
assert.match(files.docs, /does not move money/);
assert.match(files.docs, /UK-first rather than BMI-first/);
assert.match(files.docs, /PRS for Music and PPL/);

console.log("Artist Economy contracts passed");
