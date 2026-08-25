import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const page = await readFile(resolve(root, "halo.html"), "utf8");
const releaseMatch = page.match(/const FEATURED_RELEASE = \{([\s\S]*?)\n        \};/);

assert.ok(releaseMatch, "FEATURED_RELEASE must remain the homepage feature source");

const releaseSource = releaseMatch[1];
const stringField = field => {
  const match = releaseSource.match(new RegExp(`${field}:\\s*'([^']+)'`));
  assert.ok(match, `FEATURED_RELEASE.${field} must be defined`);
  return match[1];
};

const releaseId = stringField("id");
const title = stringField("title");
const artwork = stringField("artwork");
const url = stringField("url");
const description = stringField("description");

assert.equal(title, "When The World Goes Dark");
assert.equal(artwork, `/assets/releases/${releaseId}.jpg`);
assert.equal(url, `/${releaseId}/`);
assert.ok(description.length >= 80, "featured release description must be editorially complete");
assert.match(releaseSource, /titleLines:/);
assert.match(page, /FEATURED_RELEASE\.titleLines\.map/);
assert.match(page, /\{FEATURED_RELEASE\.description\}/);
assert.doesNotMatch(page, /The Cold Is<br\/>/);

await access(resolve(root, artwork.slice(1)));
await access(resolve(root, url.slice(1), "index.html"));

console.log("Featured release artwork and writeup contracts passed");
