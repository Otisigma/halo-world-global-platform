import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HALO_BUTTON_WATCHER_REGISTRY, canonicalizeWatcherTarget } from "../lib/watcher-registry.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFile(resolve(root, path), "utf8");

const satellites = [
  { name: "HALO X", route: "/halo-x.html", file: "halo-x.html" },
  { name: "DJ Deck", route: "/dj-deck.html", file: "dj-deck.html" },
  { name: "HALO Live", route: "/halo-live.html", file: "halo-live.html" },
  { name: "Magazine", route: "/magazine.html", file: "magazine.html" },
  { name: "Dreamweaver", route: "/dreamweaver/", file: "dreamweaver/index.html" },
  { name: "Dreamweaver Lab", route: "/dreamweaver-lab/", file: "dreamweaver-lab/index.html" },
  { name: "Creator World", route: "/creators/", file: "creators/index.html" },
  { name: "Creator Freedom", route: "/creator-freedom/", file: "creator-freedom/index.html" },
  { name: "Campaign Studio", route: "/campaign-studio/", file: "campaign-studio/index.html" },
  { name: "Finish House", route: "/finish-house/", file: "finish-house/index.html" },
  { name: "Release House", route: "/release-house/", file: "release-house/index.html" },
  { name: "Artist Pro", route: "/artist-pro/", file: "artist-pro/index.html" },
  { name: "Artists", route: "/artists/", file: "artists/index.html" },
  { name: "Mixes", route: "/mixes/", file: "mixes/index.html" },
  { name: "Music", route: "/music/", file: "music/index.html" },
  { name: "Radio", route: "/radio/", file: "radio/index.html" },
  { name: "Song Catalog", route: "/song-catalog/", file: "song-catalog/index.html" },
  { name: "Album Concierge", route: "/album-concierge/", file: "album-concierge/index.html" },
  { name: "Support", route: "/support/", file: "support/index.html" }
];

const [menuSource, sweepSource, commandApiSource, publicStatusApiSource, commandClientSource, docsSource, packageSource, netlifyConfigSource, navigationCssSource, siteMonitorSource, djDeckSource, haloLiveSource, musicSource, radioSource, creatorsSource, magazineSource] = await Promise.all([
  read("halo.html"),
  read("netlify/lib/maintenance-sweep.mjs"),
  read("netlify/functions/halo-agent-team.mjs"),
  read("netlify/functions/halo-satellite-status.mjs"),
  read("halo-command.js"),
  read("HALO_AGENT_TEAM.md"),
  read("package.json"),
  read("netlify.toml"),
  read("mobile-navigation.css"),
  read("site-monitor.js"),
  read("dj-deck.html"),
  read("halo-live.html"),
  read("music/index.html"),
  read("radio/index.html"),
  read("creators/index.html"),
  read("magazine.html")
]);

const redirectAliases = new Set([...netlifyConfigSource.matchAll(/^\s*from\s*=\s*["']([^"']+)["']/gm)].map(match => match[1]));
const commandName = "halo-signal-check";
const packageJson = JSON.parse(packageSource);

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
assert.match(menuSource, /Attention now/, "Main menu must expose the ATTENTION status group.");
assert.match(menuSource, /Working now/, "Main menu must expose the WORKING status group.");
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
assert.match(sweepSource, /repairStatus/, "Unhealthy satellite statuses must queue an AI-assisted repair handoff.");
assert.match(siteMonitorSource, /Dash AI Link Aggregator/, "The site monitor must expose a Dash AI aggregation check.");
assert.match(siteMonitorSource, /halo:dash-ai-update/, "The site monitor must broadcast Dash AI status updates.");
assert.match(siteMonitorSource, /ownerAgent/, "Dash AI issue routing metadata must include owning fix agents.");
assert.match(docsSource, /## halo-signal-check/, "The canonical halo-signal-check README section must exist.");
assert.equal(packageJson.scripts["halo-signal-check"], "node scripts/live-connected-satellite-contracts.mjs", "package.json must expose halo-signal-check as the canonical repo command.");
assert.ok(HALO_BUTTON_WATCHER_REGISTRY.length >= 20, "Watcher registry must cover major buttons and links.");

const blockedLegacyTargets = new Set(["/", "/halo/", "/halo.html", "/music", "/music/index.html", "/radio", "/radio/index.html", "/creators", "/creators/index.html", "/dj-deck", "/halo-live", "/halo-x", "/magazine"]);
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

const failures = [];
for (const satellite of satellites) {
  const built = await pathExists(satellite.file);
  const live = built || redirectAliases.has(satellite.route) || redirectAliases.has(satellite.route.replace(/\/$/, ""));
  const connected = new RegExp(`href=["']${satellite.route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(menuSource);
  const hasMenuIndicator = menuSource.includes(`renderMenuStatusBadge('${satellite.route}'`) || menuSource.includes(`renderMenuStatusBadge("${satellite.route}"`);
  const verified = sweepSource.includes(satellite.route);
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
