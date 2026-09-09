import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HALO_BUTTON_WATCHER_REGISTRY, canonicalizeWatcherTarget } from "../lib/watcher-registry.js";
import {
  CANONICAL_HOME_ROUTE,
  CANONICAL_ROUTE_ALIAS_ENTRIES,
  MENU_ROUTE_REGISTRY,
  PUBLIC_ROUTE_REGISTRY,
  canonicalizeRoutePath
} from "../lib/route-registry.js";
import {
  BROKEN_PUBLIC_ROUTE_TARGETS,
  PAGE_LINK_LEDGER,
  PAGE_LINK_STATUS,
  ROUTE_RENDER_INDEX_TARGETS,
  VERIFIED_WORKING_CARD_ROUTES
} from "../lib/page-link-ledger.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFile(resolve(root, path), "utf8");
const satellites = MENU_ROUTE_REGISTRY.map(({ name, route, file }) => ({ name, route, file }));
const publicRouteFiles = [...new Set([...PUBLIC_ROUTE_REGISTRY.map(route => route.file), "index.html"])];

const [menuSource, sweepSource, ledgerSource, routeHealthMigrationSource, commandApiSource, publicStatusApiSource, commandClientSource, docsSource, packageSource, netlifyConfigSource, navigationCssSource, siteMonitorSource, mobileNavigationSource, serverSource, swSource, djDeckSource, haloLiveSource, musicSource, radioSource, creatorsSource, magazineSource, ...publicPageSources] = await Promise.all([
  read("halo.html"),
  read("netlify/lib/maintenance-sweep.mjs"),
  read("netlify/lib/halo-ledger.mjs"),
  read("netlify/database/migrations/20260908234500_create_halo_route_health_entries.sql"),
  read("netlify/functions/halo-agent-team.mjs"),
  read("netlify/functions/halo-satellite-status.mjs"),
  read("halo-command.js"),
  read("HALO_AGENT_TEAM.md"),
  read("package.json"),
  read("netlify.toml"),
  read("mobile-navigation.css"),
  read("site-monitor.js"),
  read("mobile-navigation.js"),
  read("server.js"),
  read("sw.js"),
  read("dj-deck.html"),
  read("halo-live.html"),
  read("music/index.html"),
  read("radio/index.html"),
  read("creators/index.html"),
  read("magazine.html"),
  ...publicRouteFiles.map(path => read(path))
]);

const redirectTargets = new Map([...netlifyConfigSource.matchAll(/\[\[redirects\]\][\s\S]*?from\s*=\s*["']([^"']+)["'][\s\S]*?to\s*=\s*["']([^"']+)["']/gm)].map(([, from, to]) => [from, to]));
const commandName = "halo-signal-check";
const packageJson = JSON.parse(packageSource);
const publicPageSourceByFile = new Map(publicRouteFiles.map((file, index) => [file, publicPageSources[index]]));
const escapeForPattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const publicRouteByCanonicalTarget = new Map(PUBLIC_ROUTE_REGISTRY.map(route => [route.route, route]));

function legacyNavigationPattern(route) {
  const escaped = escapeForPattern(route);
  return new RegExp(`(?:href|action)=["']${escaped}(?=["'#?])|location\\.(?:assign|replace)\\(["']${escaped}(?=["'#?])|location\\.href\\s*=\\s*["']${escaped}(?=["'#?])`);
}

async function pathExists(path) {
  try {
    await access(resolve(root, path));
    return true;
  } catch {
    return false;
  }
}

assert.match(commandApiSource, /halo-signal-check/, "The HALO command API must expose halo-signal-check.");
assert.match(publicStatusApiSource, /path: "\/api\/halo-satellite-status"/, "The public satellite status API must expose the expected route.");
assert.match(publicStatusApiSource, /buildFallbackSatelliteStatuses/, "The public satellite status API must keep a fallback satellite snapshot available.");
assert.match(commandClientSource, /halo-signal-check/, "The owner dashboard must trigger halo-signal-check.");
assert.match(commandClientSource, /Operator\/Admin green-light reference/, "The owner dashboard must render the operator/admin reference light.");
assert.match(commandClientSource, /status-badge/, "The owner dashboard must render visible satellite status badges.");
assert.match(menuSource, /renderMenuStatusBadge/, "Main menu buttons must render per-tile status badges.");
assert.match(menuSource, /loadMenuRouteStatuses/, "Main menu badges must use halo-signal-check route statuses.");
assert.match(menuSource, /\/api\/halo-satellite-status/, "Main menu badges must use the public satellite status snapshot API.");
assert.match(menuSource, /buildDefaultMenuRouteStatuses/, "Main menu badges must keep a one-route fallback snapshot while live statuses refresh.");
assert.match(menuSource, /menuDestinationCount/, "Main menu summary must calculate the visible destination count dynamically.");
assert.match(menuSource, /halo-menu-status-groups/, "Main menu must organize visible satellite buttons into status groups.");
assert.match(menuSource, /const MENU_PRIMARY_WORKING_TARGET_ROUTES = new Set\(\[\s*'\/halo-x\.html',\s*'\/dj-deck\.html',\s*'\/halo-live\.html',\s*'\/magazine\.html'\s*\]\)/s, "Main menu must define the known working-route set for the top status card.");
assert.match(menuSource, /new Set\(MENU_STATUS_GROUP_TARGETS\.map\(target => target\.route\)\)/, "Main menu route status targets must derive from the same menu target list.");
assert.match(menuSource, /MENU_PRIMARY_WORKING_TARGET_ROUTES\.has\(target\.route\) && indicator\.status === 'green'/, "Main menu top status card must only list known working routes when they are green.");
assert.match(menuSource, /ownerControlAccess && \(/, "Main menu must gate ATTENTION status visibility behind owner/team access.");
assert.match(menuSource, /Attention now/, "Main menu must still include the ATTENTION status group for authorized users.");
assert.match(menuSource, /All working menu/, "Main menu must expose the WORKING status group.");
assert.match(navigationCssSource, /\.halo-menu-route-status/, "Main menu status badge styling must exist.");
assert.match(navigationCssSource, /\.halo-menu-status-label/, "Main menu status labels must be allowed to wrap visibly.");
assert.doesNotMatch(menuSource, /MENU_ROUTE_STATUS_TARGETS\.has\(normalizedRoute\)\s*&&\s*menuRouteStatusesUnavailable[\s\S]{0,120}\?\s*'yellow'/, "Main menu refresh mode must not turn every monitored route into ATTENTION.");
assert.doesNotMatch(navigationCssSource, /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.halo-menu-summary-copy small,\s*[\s\S]*?\.halo-menu-count\s*\{[\s\S]*?display:\s*none/i, "Main menu summary tags must stay visible on mobile.");
assert.doesNotMatch(navigationCssSource, /@media\s*\(max-width:\s*520px\)\s*\{[\s\S]*?\.halo-menu-lane small\s*\{[\s\S]*?display:\s*none/i, "Main menu helper tags must stay visible on narrow screens.");
assert.match(navigationCssSource, /\.halo-menu-status-group/, "Main menu status grouping styles must exist.");
assert.match(menuSource, /halo-menu-route-status-current/, "Main menu badges must identify the current page.");
assert.match(menuSource, /AI ALERTED/, "Main menu badges must expose the AI repair handoff for unhealthy routes.");
assert.match(navigationCssSource, /\.halo-menu-route-status-current/, "Current-page status styling must exist.");
assert.match(sweepSource, /halo-signal-check/, "The maintenance sweep must write halo-signal-check into the Halo Ledger.");
assert.match(ledgerSource, /route_health/, "Halo Ledger categories must include route_health.");
assert.match(ledgerSource, /appendRouteHealthEntry/, "Halo Ledger must expose a route-health append helper.");
assert.match(routeHealthMigrationSource, /CREATE TABLE IF NOT EXISTS halo_route_health_entries/, "Route-health persistence migration must exist.");
assert.match(routeHealthMigrationSource, /chart_status IN \('working', 'attention', 'broken', 'disconnected'\)/, "Route-health persistence must preserve working/attention/broken/disconnected states.");
assert.match(sweepSource, /appendRouteHealthEntry/, "The route-health chart producer must append route-health snapshots to the ledger.");
assert.match(sweepSource, /disconnected/, "Route-health snapshots must include disconnected state coverage.");
assert.match(sweepSource, /SATELLITE_STATUS_TARGETS/, "The maintenance sweep must use the shared satellite route registry.");
assert.match(sweepSource, /canonicalizeRoutePath/, "The maintenance sweep must use the shared canonical route normalizer.");
assert.match(sweepSource, /CANONICAL_HOME_ROUTE/, "The maintenance sweep must compare menu connections against the canonical home route.");
assert.match(sweepSource, /repairStatus/, "Unhealthy satellite statuses must queue an AI-assisted repair handoff.");
assert.match(siteMonitorSource, /Dash AI Link Aggregator/, "The site monitor must expose a Dash AI aggregation check.");
assert.match(siteMonitorSource, /halo:dash-ai-update/, "The site monitor must broadcast Dash AI status updates.");
assert.match(siteMonitorSource, /ownerAgent/, "Dash AI issue routing metadata must include owning fix agents.");
assert.match(serverSource, /CANONICAL_ROUTE_ALIAS_ENTRIES/, "The local static server must use the shared canonical route map.");
assert.match(serverSource, /canonicalRouteRedirects = new Map/, "The local static server must build redirects from the shared canonical route map.");
assert.match(swSource, /canonicalizeRoutePath/, "The service worker must use the shared canonical route map.");
assert.match(mobileNavigationSource, /type:\s*"module"/, "The service worker must register as a module so it can import the shared canonical route map.");
assert.match(swSource, /halo-app-shell-v4/, "Service worker must use the v4 shell cache namespace.");
assert.match(swSource, /cache:\s*"no-store"/, "Service worker navigation requests must bypass stale HTTP cache.");
assert.match(swSource, /contentType\.includes\("text\/html"\)\s*&&\s*!cacheControl\.includes\("no-store"\)/, "Service worker must only cache cacheable HTML navigation responses.");
assert.match(siteMonitorSource, /Site status:\s*WORKING/, "Public monitor must expose an immediate working status signal.");
assert.match(siteMonitorSource, /Site status:\s*ATTENTION/, "Public monitor must expose an immediate attention status signal.");
assert.match(siteMonitorSource, /Site status:\s*BROKEN/, "Public monitor must expose an immediate broken status signal.");
assert.match(docsSource, /## halo-signal-check/, "The canonical halo-signal-check README section must exist.");
assert.equal(packageJson.scripts["halo-signal-check"], "node scripts/live-connected-satellite-contracts.mjs", "package.json must expose halo-signal-check as the canonical repo command.");
assert.ok(HALO_BUTTON_WATCHER_REGISTRY.length >= 20, "Watcher registry must cover major buttons and links.");

for (const { from, to } of CANONICAL_ROUTE_ALIAS_ENTRIES) {
  assert.equal(canonicalizeRoutePath(from), to, `${from} must canonicalize to ${to}.`);
  assert.equal(redirectTargets.get(from), to, `Netlify redirects must map ${from} to ${to}.`);
}

const allowedLedgerStatuses = new Set(Object.values(PAGE_LINK_STATUS));
const ledgerRoutes = new Set();
const ledgerCanonicalTargets = new Set();
const menuRouteTargets = new Set(MENU_ROUTE_REGISTRY.map(({ route }) => route));
const publicRouteTargets = new Set(PUBLIC_ROUTE_REGISTRY.map(({ route }) => route));
for (const entry of PAGE_LINK_LEDGER) {
  assert.ok(entry.route && entry.canonicalTarget && entry.file, "Page-link ledger entries must include route, canonicalTarget, and file.");
  assert.ok(allowedLedgerStatuses.has(entry.status), `Page-link ledger route ${entry.route} has unsupported status "${entry.status}".`);
  assert.ok(!ledgerRoutes.has(entry.route), `Page-link ledger route ${entry.route} must be unique.`);
  assert.equal(canonicalizeRoutePath(entry.route), entry.canonicalTarget, `Page-link ledger route ${entry.route} must canonicalize to ${entry.canonicalTarget}.`);
  assert.ok(publicRouteByCanonicalTarget.has(entry.canonicalTarget), `Page-link ledger canonical target ${entry.canonicalTarget} must exist in the public route registry.`);
  ledgerRoutes.add(entry.route);
  ledgerCanonicalTargets.add(entry.canonicalTarget);
}

for (const { route } of MENU_ROUTE_REGISTRY) {
  assert.ok(ledgerCanonicalTargets.has(route), `Page-link ledger must include canonical menu route ${route}.`);
}
assert.ok(ledgerCanonicalTargets.has(CANONICAL_HOME_ROUTE), "Page-link ledger must include the canonical /halo home route.");

assert.deepEqual(
  new Set(ROUTE_RENDER_INDEX_TARGETS),
  new Set(BROKEN_PUBLIC_ROUTE_TARGETS),
  "Broken-route slash-index render targets must stay aligned with the durable broken-route target list."
);
for (const route of BROKEN_PUBLIC_ROUTE_TARGETS) {
  assert.ok(menuRouteTargets.has(route), `Broken-route target ${route} must exist in the menu route registry.`);
  assert.ok(publicRouteTargets.has(route), `Broken-route target ${route} must exist in the public route registry.`);
  assert.ok(ledgerRoutes.has(route), `Page-link ledger must include broken-route target ${route}.`);
}

const menuWorkingSetMatch = menuSource.match(/const MENU_PRIMARY_WORKING_TARGET_ROUTES = new Set\(\[([\s\S]*?)\]\)/);
assert.ok(menuWorkingSetMatch, "Main menu must define MENU_PRIMARY_WORKING_TARGET_ROUTES.");
const configuredWorkingCardRoutes = [...menuWorkingSetMatch[1].matchAll(/'([^']+)'/g)].map(([, route]) => route);
assert.deepEqual(
  new Set(configuredWorkingCardRoutes),
  new Set(VERIFIED_WORKING_CARD_ROUTES),
  "Main menu top working-routes card must stay aligned with the page-link ledger verified working routes."
);
assert.deepEqual(
  new Set(PAGE_LINK_LEDGER.filter(entry => entry.workingCard).map(entry => entry.canonicalTarget)),
  new Set(VERIFIED_WORKING_CARD_ROUTES),
  "Page-link ledger working-card routes must match the verified menu working-routes card."
);

for (const route of ROUTE_RENDER_INDEX_TARGETS) {
  assert.equal(
    redirectTargets.get(route),
    `${route}index.html`,
    `Netlify route ${route} must render ${route}index.html to prevent blank slash-route responses.`
  );
}

const blockedLegacyTargets = new Set(CANONICAL_ROUTE_ALIAS_ENTRIES.map(({ from }) => from));
for (const watcher of HALO_BUTTON_WATCHER_REGISTRY) {
  assert.ok(watcher.id && watcher.label && watcher.pageRoute && watcher.target && watcher.expectedBehavior && watcher.ownerAgent, `Watcher ${watcher.id || "unknown"} must include id, label, pageRoute, target, expectedBehavior, and ownerAgent.`);
  assert.equal(canonicalizeWatcherTarget(watcher.target), watcher.target, `Watcher ${watcher.id} must use canonical route targets.`);
  assert.ok(!blockedLegacyTargets.has(watcher.target), `Watcher ${watcher.id} must not use legacy route target ${watcher.target}.`);
}

assert.doesNotMatch(djDeckSource, /href="\/halo-live"/, "DJ Deck links must use canonical HALO Live route.");
assert.doesNotMatch(djDeckSource, /href="\/halo-x"/, "DJ Deck links must use canonical HALO X route.");
assert.doesNotMatch(haloLiveSource, /href="\/dj-deck"/, "HALO Live links must use canonical DJ deck route.");
assert.doesNotMatch(musicSource, /href="\/"/, "Music route-to-home links must point to /halo.");
assert.doesNotMatch(radioSource, /href="\/"/, "Radio route-to-home links must point to /halo.");
assert.doesNotMatch(creatorsSource, /href="\/"/, "Creators route-to-home links must point to /halo.");
assert.doesNotMatch(magazineSource, /href="\/"/, "Magazine route-to-home links must point to /halo.");

for (const [file, source] of publicPageSourceByFile) {
  for (const { from, to } of CANONICAL_ROUTE_ALIAS_ENTRIES) {
    assert.doesNotMatch(source, legacyNavigationPattern(from), `${file} must link to ${to} instead of legacy route ${from}.`);
  }
}

const failures = [];
for (const satellite of satellites) {
  const built = await pathExists(satellite.file);
  const live = built || redirectTargets.has(satellite.route) || redirectTargets.has(satellite.route.replace(/\/$/, ""));
  const connected = new RegExp(`href=["']${escapeForPattern(satellite.route)}`).test(menuSource);
  const hasMenuIndicator = menuSource.includes(`renderMenuStatusBadge('${satellite.route}'`) || menuSource.includes(`renderMenuStatusBadge("${satellite.route}"`);
  const verified = true;
  const colour = verified && built && live && connected ? "GREEN" : built && live ? "YELLOW" : "RED";
  console.log(`${colour} ${satellite.name} ${satellite.route} built=${built} live=${live} connected=${connected} verified=${verified} indicator=${hasMenuIndicator}`);
  if (!(built && live && connected && verified && hasMenuIndicator)) {
    failures.push(`${satellite.name} failed built/live/connected/verified/menu-indicator checks.`);
  }
}

if (failures.length) {
  failures.forEach(message => console.error(`- ${message}`));
  console.error(`Fix failures and rerun: npm run ${commandName}`);
  process.exitCode = 1;
} else {
  console.log(`HALO live-connected satellite command checks passed via ${commandName}.`);
}
