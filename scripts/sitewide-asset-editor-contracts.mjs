import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFile(resolve(root, path), "utf8");

const [halo, concierge, hubPage, hubScript, netlify] = await Promise.all([
  read("halo.html"),
  read("album-concierge/index.html"),
  read("asset-editor/index.html"),
  read("asset-editor/asset-editor.js"),
  read("netlify.toml")
]);

const checks = [
  [halo.includes('href="/asset-editor/"') && halo.includes("SITEWIDE ASSET EDITOR"), "HALO main navigation links to the shared asset editor hub"],
  [concierge.includes('href="/asset-editor/"'), "Album Concierge links to the same shared asset editor hub"],
  [hubPage.includes('id="songCatalogFrame"') && hubPage.includes('id="releaseHouseFrame"') && hubScript.includes('"/release-house/"'), "the hub shells both Song Catalog and Release House editors"],
  [hubPage.includes("image artwork assets") && hubPage.includes("song/track details") && hubPage.includes("release title + description fields"), "the hub explicitly covers artwork, songs, and release metadata editing"],
  [hubScript.includes('parentOrigin') && hubScript.includes('halo-song-catalog-height') && hubScript.includes('setActiveTab'), "the hub uses shared editor shell state and embedded song-catalog messaging"],
  [netlify.includes('from = "/asset-editor/"') && netlify.includes('to = "/asset-editor/index.html"'), "the canonical /asset-editor/ route is served through Netlify redirects"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Sitewide asset editor contracts: ${checks.length}/${checks.length} checks passed.`);
