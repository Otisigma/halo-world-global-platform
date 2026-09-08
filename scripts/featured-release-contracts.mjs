import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const page = await readFile(resolve(root, "halo.html"), "utf8");
const configMatch = page.match(/<script id="haloFeaturedReleaseConfig" type="application\/json">\s*([\s\S]*?)\s*<\/script>/);

assert.ok(configMatch, "haloFeaturedReleaseConfig must remain the homepage feature source");

const release = JSON.parse(configMatch[1]);
const releaseId = release.id;
const title = release.title;
const artwork = release.artwork;
const url = release.url;
const description = release.description;

assert.equal(title, "When The World Goes Dark");
assert.equal(artwork, `/assets/releases/${releaseId}.jpg`);
assert.equal(url, `/${releaseId}/`);
assert.ok(description.length >= 80, "featured release description must be editorially complete");
assert.ok(Array.isArray(release.titleLines) && release.titleLines.length > 0, "featured release title lines must be defined in the config");
assert.ok(Array.isArray(release.roles) && release.roles.length > 0, "featured release roles must remain configurable");
assert.match(page, /const DEFAULT_FEATURED_RELEASE = \{/);
assert.match(page, /JSON\.parse\(configNode\.textContent\)/);
assert.match(page, /FEATURED_RELEASE = Object\.freeze/);
assert.match(page, /FEATURED_RELEASE\.titleLines\.map/);
assert.match(page, /\{FEATURED_RELEASE\.description\}/);
assert.doesNotMatch(page, /The Cold Is<br\/>/);
assert.doesNotMatch(page, /The newest Owen Anthony signal is live/);
assert.doesNotMatch(page, /const NEW_RELEASE = \{/);

await access(resolve(root, artwork.slice(1)));
await access(resolve(root, url.slice(1), "index.html"));

console.log("Featured release artwork and writeup contracts passed");
