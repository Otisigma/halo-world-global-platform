import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, satelliteStatusesMigration, sweep, scheduled, api, page, client, docs, packageJson, navigationCss, mainMenuPage] = await Promise.all([
  readFile(new URL("../netlify/database/migrations/20260809150000_create-maintenance-sweeps.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/database/migrations/20260905073000_add_satellite_statuses_to_maintenance_sweeps.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/lib/maintenance-sweep.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/health-scout.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/halo-agent-team.mjs", import.meta.url), "utf8"),
  readFile(new URL("../halo-command.html", import.meta.url), "utf8"),
  readFile(new URL("../halo-command.js", import.meta.url), "utf8"),
  readFile(new URL("../HALO_AGENT_TEAM.md", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../mobile-navigation.css", import.meta.url), "utf8"),
  readFile(new URL("../halo.html", import.meta.url), "utf8")
]);

assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_maintenance_sweeps/, "maintenance sweeps must persist");
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_maintenance_checks/, "individual maintenance checks must persist");
assert.match(satelliteStatusesMigration, /satellite_statuses/i, "maintenance sweeps must persist satellite status snapshots");
for (const kind of ["page", "connection", "output"]) assert.match(migration, new RegExp(`'${kind}'`), `${kind} checks must be constrained`);
assert.match(sweep, /CORE_PAGES/, "the maintenance team must cover core pages");
assert.match(sweep, /extractConnections/, "the maintenance team must discover internal connections");
assert.match(sweep, /OUTPUT_CHECKS/, "the maintenance team must validate outputs");
assert.match(sweep, /API_ROUTES/, "the maintenance team must check every declared API route");
assert.match(sweep, /reportIssue/, "failed checks must enter maintenance triage");
assert.match(sweep, /SATELLITE_STATUS_TARGETS/, "the maintenance team must track satellite status targets");
assert.match(sweep, /halo-signal-check/, "the maintenance team must label the one-command satellite workflow");
assert.match(sweep, /appendLedgerEntry/, "the maintenance team must write sweep command outcomes to the Halo Ledger");
assert.match(sweep, /satellite_statuses/i, "the maintenance sweep must store satellite statuses for dashboard reloads");
assert.match(sweep, /satelliteStatuses:\s*Array\.isArray\(row\.satellite_statuses\)/, "dashboard hydration must read persisted satellite statuses");
assert.match(sweep, /\/dreamweaver\//, "the maintenance team must include Dreamweaver in core page checks");
assert.match(sweep, /\/dreamweaver-lab\//, "the maintenance team must include Dreamweaver Lab in core page checks");
assert.match(sweep, /\/halo-x\.html/, "the maintenance team must include HALO X in satellite checks");
assert.match(sweep, /\/support\//, "the maintenance team must include Support in satellite checks");
assert.match(scheduled, /schedule: "\*\/15 \* \* \* \*"/, "the maintenance team must run every 15 minutes");
assert.doesNotMatch(scheduled, /process\.env/, "new scheduled code must use Netlify function environment access");
assert.match(api, /run_maintenance/, "owners must be able to request a manual sweep");
assert.match(api, /halo-signal-check/, "owners must be able to trigger the one-command satellite sweep");
assert.match(page, /Every page\. Every connection\. Every output\./, "the owner dashboard must explain sweep coverage");
assert.match(client, /renderMaintenance/, "the owner dashboard must render sweep evidence");
assert.match(page, /id="satelliteStatuses"/, "the owner dashboard must show satellite status cards");
assert.match(page, /operator\/admin reference light/i, "the owner dashboard must describe the operator/admin reference light");
assert.match(client, /halo-signal-check/, "the owner dashboard must trigger the one-command satellite sweep");
assert.match(client, /renderSatelliteStatuses/, "the owner dashboard must render red\/yellow\/green satellite states");
assert.match(client, /Operator\/Admin green-light reference/, "the owner dashboard must render the operator/admin status reference card");
assert.match(client, /status-badge/, "the owner dashboard must render visible status badges");
assert.match(mainMenuPage, /renderMenuStatusBadge/, "the primary menu must render a route-level red\/yellow\/green status badge per button/tile");
assert.match(mainMenuPage, /loadMenuRouteStatuses/, "the primary menu must hydrate route statuses from halo-signal-check data");
assert.match(navigationCss, /\.halo-menu-route-status/, "menu status badge styling must exist");
for (const route of [
  "/music/", "/halo-x.html", "/mixes/", "/dj-deck.html", "/halo-live.html", "/radio/",
  "/artist-pro/", "/creators/", "/artists/", "/creator-freedom/", "/campaign-studio/",
  "/release-house/", "/song-catalog/", "/dreamweaver/", "/dreamweaver-lab/",
  "/album-concierge/", "/finish-house/", "/magazine.html", "/support/"
]) {
  assert.match(mainMenuPage, new RegExp(`renderMenuStatusBadge\\(["']${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `menu route ${route} must expose a visible status badge`);
}
assert.match(docs, /source-line audit/, "maintenance coverage must be documented");
assert.match(docs, /## halo-signal-check/, "the canonical halo-signal-check README section must be documented");
const parsedPackage = JSON.parse(packageJson);
assert.equal(parsedPackage.scripts["halo-signal-check"], "node scripts/live-connected-satellite-contracts.mjs", "the canonical halo-signal-check command must exist");
assert.match(parsedPackage.scripts.test, /maintenance-source-audit\.mjs/, "the source-line audit must run in the test suite");
assert.match(parsedPackage.scripts.test, /maintenance-team-contracts\.mjs/, "maintenance contracts must run in the test suite");
assert.match(parsedPackage.scripts["satellite:verify"], /live-connected-satellite-contracts\.mjs/, "a one-command satellite verification script must exist");
assert.match(parsedPackage.scripts.test, /live-connected-satellite-contracts\.mjs/, "the live-connected satellite contracts must run in the test suite");

console.log("HALO Maintenance Team contracts passed.");
