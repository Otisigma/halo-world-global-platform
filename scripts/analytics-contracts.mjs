import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { allowedEvents } from "../netlify/lib/stats.mjs";

const root = resolve(import.meta.dirname, "..");
const excludedDirectories = new Set([".git", ".netlify", "netlify", "node_modules", "ops", "scripts"]);

async function findPublicSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) sources.push(...await findPublicSources(absolutePath));
      continue;
    }
    if (/\.(?:html|js)$/.test(entry.name)) sources.push(relative(root, absolutePath));
  }
  return sources;
}

function collectEventNames(source) {
  const eventNames = new Set();
  for (const match of source.matchAll(/data-stat-event=["']([a-z0-9_]+)["']/g)) eventNames.add(match[1]);
  for (const match of source.matchAll(/haloStats(?:\?\.|\.)track\(["']([a-z0-9_]+)["']/g)) eventNames.add(match[1]);
  return eventNames;
}

const missingEvents = [];
const sourcePaths = await findPublicSources(root);
for (const sourcePath of sourcePaths) {
  const source = await readFile(resolve(root, sourcePath), "utf8");
  for (const eventName of collectEventNames(source)) {
    if (!allowedEvents.has(eventName)) missingEvents.push(`${sourcePath}: ${eventName}`);
  }
}

assert.equal(
  missingEvents.length,
  0,
  `Every analytics event emitted by a public experience must be accepted by the telemetry API:\n${missingEvents.join("\n")}`
);

console.log(`HALO Analytics contracts passed across ${sourcePaths.length} source files.`);
