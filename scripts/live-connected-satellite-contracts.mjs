import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFile(resolve(root, path), "utf8");

const satellites = [
  { name: "Dreamweaver", route: "/dreamweaver/", file: "dreamweaver/index.html" },
  { name: "Dreamweaver Lab", route: "/dreamweaver-lab/", file: "dreamweaver-lab/index.html" },
  { name: "Campaign Studio", route: "/campaign-studio/", file: "campaign-studio/index.html" },
  { name: "Finish House", route: "/finish-house/", file: "finish-house/index.html" },
  { name: "Release House", route: "/release-house/", file: "release-house/index.html" },
  { name: "Artists", route: "/artists/", file: "artists/index.html" },
  { name: "Music", route: "/music/", file: "music/index.html" },
  { name: "Radio", route: "/radio/", file: "radio/index.html" }
];

const [menuSource, sweepSource, commandApiSource, commandClientSource, netlifyConfigSource] = await Promise.all([
  read("halo.html"),
  read("netlify/lib/maintenance-sweep.mjs"),
  read("netlify/functions/halo-agent-team.mjs"),
  read("halo-command.js"),
  read("netlify.toml")
]);

const redirectAliases = new Set([...netlifyConfigSource.matchAll(/^\s*from\s*=\s*["']([^"']+)["']/gm)].map(match => match[1]));
const commandName = "run_live_connected_satellite_status";

async function pathExists(path) {
  try {
    await access(resolve(root, path));
    return true;
  } catch {
    return false;
  }
}

assert.match(commandApiSource, /run_live_connected_satellite_status/, "The HALO command API must expose run_live_connected_satellite_status.");
assert.match(commandClientSource, /run_live_connected_satellite_status/, "The owner dashboard must trigger run_live_connected_satellite_status.");
assert.match(sweepSource, /appendLedgerEntry/, "The maintenance sweep must write command outcomes into the Halo Ledger.");

const failures = [];
for (const satellite of satellites) {
  const built = await pathExists(satellite.file);
  const live = built || redirectAliases.has(satellite.route) || redirectAliases.has(satellite.route.replace(/\/$/, ""));
  const connected = new RegExp(`href=["']${satellite.route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(menuSource);
  const verified = sweepSource.includes(satellite.route);
  const colour = verified && built && live && connected ? "GREEN" : built && live ? "YELLOW" : "RED";
  console.log(`${colour} ${satellite.name} ${satellite.route} built=${built} live=${live} connected=${connected} verified=${verified}`);
  if (!(built && live && connected && verified)) {
    failures.push(`${satellite.name} failed built/live/connected/verified checks.`);
  }
}

if (failures.length) {
  failures.forEach(message => console.error(`- ${message}`));
  console.error(`Fix failures and rerun: node scripts/live-connected-satellite-contracts.mjs (${commandName})`);
  process.exitCode = 1;
} else {
  console.log(`HALO live-connected satellite command checks passed via ${commandName}.`);
}
