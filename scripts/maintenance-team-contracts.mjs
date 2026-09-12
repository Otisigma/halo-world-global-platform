import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, satelliteStatusesMigration, sweep, scheduled, maintenanceLib, maintenanceIssuesApi, maintenanceIssuesValidation, heartbeatLib, radioScout, outreachWeekly, artistWeekly, api, satelliteApi, page, client, docs, packageJson, navigationCss, mainMenuPage] = await Promise.all([
  readFile(new URL("../netlify/database/migrations/20260809150000_create-maintenance-sweeps.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/database/migrations/20260905073000_add_satellite_statuses_to_maintenance_sweeps.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/lib/maintenance-sweep.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/health-scout.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/lib/maintenance.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/maintenance-issues.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/lib/maintenance-issues-validation.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/lib/scheduled-heartbeats.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/radio-health-scout.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/outreach-weekly.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/artist-agent-weekly.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/halo-agent-team.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/halo-satellite-status.mjs", import.meta.url), "utf8"),
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
assert.match(sweep, /canonicalizeRoutePath/, "the maintenance team must use the shared canonical route normalizer");
assert.match(sweep, /CANONICAL_HOME_ROUTE/, "the maintenance team must compare menu links against the canonical home route");
assert.match(sweep, /halo-signal-check/, "the maintenance team must label the one-command satellite workflow");
assert.match(sweep, /appendLedgerEntry/, "the maintenance team must write sweep command outcomes to the Halo Ledger");
assert.match(sweep, /command:\s*SIGNAL_CHECK_COMMAND/, "maintenance auto-heals must attach verification command metadata");
assert.match(sweep, /satellite_statuses/i, "the maintenance sweep must store satellite statuses for dashboard reloads");
assert.match(sweep, /satelliteStatuses:\s*Array\.isArray\(row\.satellite_statuses\)/, "dashboard hydration must read persisted satellite statuses");
assert.match(sweep, /HALO_ACTIVE_ATTENTION_ROUTE/, "the maintenance sweep must allow selecting the current attention route independently");
assert.match(sweep, /DEFAULT_SATELLITE_ATTENTION_ROUTE/, "the maintenance sweep must provide a default single-route attention target");
assert.match(sweep, /statusRecord\.route !== manualAttentionRoute/, "the maintenance sweep must keep manual attention scoped to one selected route");
assert.match(scheduled, /schedule: "\*\/15 \* \* \* \*"/, "the maintenance team must run every 15 minutes");
assert.doesNotMatch(scheduled, /process\.env/, "new scheduled code must use Netlify function environment access");
assert.match(scheduled, /retryDispatchQueue/, "the health scout must retry dispatch failures");
assert.match(scheduled, /escalateStaleMaintenanceIssues/, "the health scout must escalate stale maintenance issues");
assert.match(scheduled, /reconcileScheduledHeartbeats/, "the health scout must monitor scheduled heartbeats");
assert.match(scheduled, /recordScheduledHeartbeat/, "the health scout must emit heartbeat telemetry");
assert.match(maintenanceLib, /retryDispatchQueue/, "the maintenance library must expose dispatch retry handling");
assert.match(maintenanceLib, /DISPATCH_MAX_ATTEMPTS/, "dispatch retries must enforce a maximum attempts cap");
assert.match(maintenanceLib, /nextDispatchAt/, "dispatch retries must schedule an explicit retry window");
assert.match(maintenanceLib, /recordMaintenanceLifecycle/, "maintenance lifecycle changes must be written to the Halo Ledger");
assert.match(maintenanceLib, /normalizeVerificationMetadata/, "maintenance heals must support structured verification metadata");
assert.match(maintenanceIssuesValidation, /verificationUnavailableReason/, "healed issue updates must document unverified cases");
assert.match(maintenanceIssuesValidation, /structured verification metadata/i, "healed issue updates must enforce verification metadata when possible");
assert.match(maintenanceIssuesApi, /validateMaintenancePatchPayload/, "maintenance issue handler must enforce payload validation centrally");
assert.match(heartbeatLib, /SCHEDULED_HEARTBEAT_SLA/, "scheduled heartbeat monitoring must define SLA windows");
assert.match(heartbeatLib, /scheduled-heartbeat:/, "scheduled heartbeat monitoring must escalate missed runs into maintenance issues");
assert.match(radioScout, /recordScheduledHeartbeat/, "radio scheduled checks must record heartbeat coverage");
assert.match(outreachWeekly, /recordScheduledHeartbeat/, "outreach scheduled checks must record heartbeat coverage");
assert.match(artistWeekly, /recordScheduledHeartbeat/, "artist scheduled checks must record heartbeat coverage");
assert.match(api, /run_maintenance/, "owners must be able to request a manual sweep");
assert.match(api, /halo-signal-check/, "owners must be able to trigger the one-command satellite sweep");
assert.match(satelliteApi, /path: "\/api\/halo-satellite-status"/, "the public satellite status API must expose the expected route");
assert.match(satelliteApi, /satelliteStatuses/, "the public satellite status API must return the latest satellite status snapshot");
assert.match(satelliteApi, /buildFallbackSatelliteStatuses/, "the public satellite status API must keep a public fallback snapshot available");
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
assert.match(mainMenuPage, /\/api\/halo-satellite-status/, "the primary menu must load public satellite statuses without owner authentication");
assert.match(mainMenuPage, /buildDefaultMenuRouteStatuses/, "the primary menu must keep a one-route fallback snapshot when live statuses refresh");
assert.match(mainMenuPage, /menuDestinationCount/, "the primary menu summary must calculate the visible destination count dynamically");
assert.doesNotMatch(mainMenuPage, /MENU_ROUTE_STATUS_TARGETS\.has\(normalizedRoute\)\s*&&\s*menuRouteStatusesUnavailable[\s\S]{0,120}\?\s*'yellow'/, "the primary menu must not force every monitored route into ATTENTION during a refresh");
assert.match(navigationCss, /\.halo-menu-route-status/, "menu status badge styling must exist");
assert.match(navigationCss, /\.halo-menu-status-label/, "menu status labels must wrap visibly");
assert.doesNotMatch(navigationCss, /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.halo-menu-summary-copy small,\s*[\s\S]*?\.halo-menu-count\s*\{[\s\S]*?display:\s*none/i, "mobile styles must keep the menu summary tags visible");
assert.doesNotMatch(navigationCss, /@media\s*\(max-width:\s*520px\)\s*\{[\s\S]*?\.halo-menu-lane small\s*\{[\s\S]*?display:\s*none/i, "mobile styles must keep helper tags visible");
for (const route of [
  "/music/", "/halo-x.html", "/mixes/", "/dj-deck.html", "/halo-live.html", "/radio/",
  "/artist-pro/", "/creators/", "/artists/", "/creator-freedom/", "/campaign-studio/",
  "/release-house/", "/song-catalog/", "/music-upload/", "/dreamweaver/", "/dreamweaver-lab/",
  "/album-concierge/", "/finish-house/", "/magazine.html", "/support/"
]) {
  assert.match(mainMenuPage, new RegExp(`renderMenuStatusBadge\\(["']${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `menu route ${route} must expose a visible status badge`);
}
assert.match(docs, /source-line audit/, "maintenance coverage must be documented");
assert.match(docs, /## halo-signal-check/, "the canonical halo-signal-check README section must be documented");
const parsedPackage = JSON.parse(packageJson);
assert.equal(parsedPackage.scripts["halo-signal-check"], "node scripts/live-connected-satellite-contracts.mjs", "the canonical halo-signal-check command must exist");
assert.match(parsedPackage.scripts["contracts:ai-maintenance"], /maintenance-team-contracts\.mjs/, "focused AI-maintenance contract gating must include maintenance contracts");
assert.match(parsedPackage.scripts["contracts:ai-maintenance"], /maintenance-issues-contracts\.mjs/, "focused AI-maintenance contract gating must include maintenance issue API verification checks");
assert.match(parsedPackage.scripts.test, /maintenance-source-audit\.mjs/, "the source-line audit must run in the test suite");
assert.match(parsedPackage.scripts.test, /maintenance-issues-contracts\.mjs/, "maintenance issue API verification checks must run in the default test suite");
assert.match(parsedPackage.scripts.test, /maintenance-team-contracts\.mjs/, "maintenance contracts must run in the test suite");
assert.match(parsedPackage.scripts["satellite:verify"], /live-connected-satellite-contracts\.mjs/, "a one-command satellite verification script must exist");
assert.match(parsedPackage.scripts.test, /live-connected-satellite-contracts\.mjs/, "the live-connected satellite contracts must run in the test suite");

console.log("HALO Maintenance Team contracts passed.");
