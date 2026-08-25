import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, library, api, page, client, docs, netlify, packageJson, outreachPage] = await Promise.all([
  readFile("netlify/database/migrations/20260814200000_create-partner-trust-team.sql", "utf8"),
  readFile("netlify/lib/partner-trust.mjs", "utf8"),
  readFile("netlify/functions/partner-trust.mjs", "utf8"),
  readFile("partner-trust.html", "utf8"),
  readFile("partner-trust.js", "utf8"),
  readFile("PARTNER_TRUST_TEAM.md", "utf8"),
  readFile("netlify.toml", "utf8"),
  readFile("package.json", "utf8"),
  readFile("outreach.html", "utf8")
]);

assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_partner_contacts/, "platform records must persist in Netlify Database");
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_partner_briefs/, "partner briefs must be auditable records");
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_partner_events/, "partner decisions must retain an event trail");
assert.match(migration, /https:\/\/suno\.com\/@halomusicworld5/, "the owner-supplied Suno account must seed the first record");
assert.match(migration, /prospective/, "Suno must not be presented as a confirmed formal partner");
assert.match(migration, /Do not scrape, bypass limits, share credentials, or automate outside an approved API/, "the Suno record must state platform protection controls");

for (const role of ["Bridge", "Covenant", "Rights", "Signal", "Mirror"]) assert.match(library, new RegExp(role), `${role} must be represented on the team`);
assert.match(library, /gpt-5\.4-mini/, "partner drafting must use an AI Gateway-supported model");
assert.doesNotMatch(library, /process\.env/, "partner drafting must not read secret values directly");
assert.match(library, /fallbackDraft/, "partner drafting must retain a deterministic fallback");
assert.match(library, /You never send, submit, publish, schedule, or contact anyone/, "the model must not receive external authority");
assert.match(library, /partner\.usageSummary/, "drafts must cite intended use");
assert.match(library, /partner\.safeguards/, "drafts must cite recorded safeguards");

assert.match(api, /getUser/, "the partner desk must read Netlify Identity sessions");
assert.match(api, /isOwner/, "the partner desk must remain owner-only");
assert.match(api, /verifyRequestOrigin/, "partner mutations must verify their request origin");
assert.match(api, /brief\.status !== transition\.from/, "sharing must respect approval-state transitions");
assert.match(api, /min_days_between_contacts/, "recorded sharing must respect the platform contact cadence");
assert.match(api, /path: "\/api\/partner-trust"/, "the partner desk must expose its API route");

assert.match(page, /Trust is a/, "the partner desk must present its trust purpose");
assert.match(page, /Nothing sends itself/, "the interface must state the human authority boundary");
assert.match(page, /id="partnerList"/, "the interface must show platform records");
assert.match(page, /id="briefList"/, "the interface must show the owner review queue");
assert.match(client, /Copy for human sharing/, "approved briefs must cross into external channels through a human copy action");
assert.match(client, /record_shared/, "the owner must be able to record actual sharing");
assert.match(client, /record_response/, "the owner must be able to record partner outcomes");
assert.match(docs, /Suno remains marked as a prospective platform relationship/, "documentation must avoid claiming an unconfirmed partnership");
assert.match(netlify, /for = "\/partner-trust\.html"[\s\S]*noindex, nofollow, noarchive/, "the owner desk must not be indexed");
assert.match(outreachPage, /\/partner-trust\.html/, "the existing outreach desk must link to the partner trust team");

const parsedPackage = JSON.parse(packageJson);
assert.match(parsedPackage.scripts.test, /partner-trust-contracts\.mjs/, "partner trust contracts must run in the test suite");

console.log("HALO Partner Trust Team contracts passed.");
