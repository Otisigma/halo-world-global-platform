import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const [menuSource, sweepSource, commandApiSource, commandClientSource, docsSource, packageSource, netlifyConfigSource, navigationCssSource] = await Promise.all([
  read("halo.html"),
  read("netlify/lib/maintenance-sweep.mjs"),
  read("netlify/functions/halo-agent-team.mjs"),
  read("halo-command.js"),
  read("HALO_AGENT_TEAM.md"),
  read("package.json"),
  read("netlify.toml"),
  read("mobile-navigation.css")
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
assert.match(commandClientSource, /halo-signal-check/, "The owner dashboard must trigger halo-signal-check.");
assert.match(commandClientSource, /Operator\/Admin green-light reference/, "The owner dashboard must render the operator/admin reference light.");
assert.match(commandClientSource, /status-badge/, "The owner dashboard must render visible satellite status badges.");
assert.match(menuSource, /renderMenuStatusBadge/, "Main menu buttons must render per-tile status badges.");
assert.match(menuSource, /loadMenuRouteStatuses/, "Main menu badges must use halo-signal-check route statuses.");
assert.match(navigationCssSource, /\.halo-menu-route-status/, "Main menu status badge styling must exist.");
assert.match(sweepSource, /halo-signal-check/, "The maintenance sweep must write halo-signal-check into the Halo Ledger.");
assert.match(docsSource, /## halo-signal-check/, "The canonical halo-signal-check README section must exist.");
assert.equal(packageJson.scripts["halo-signal-check"], "node scripts/live-connected-satellite-contracts.mjs", "package.json must expose halo-signal-check as the canonical repo command.");

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
