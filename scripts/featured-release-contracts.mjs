import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const page = await readFile(resolve(root, "halo.html"), "utf8");

assert.match(page, /const DEFAULT_FEATURED_RELEASE = \{/);
assert.match(page, /const DEFAULT_NEW_RELEASE = \{/);
assert.match(page, /\/api\/release-catalog/);
assert.match(page, /\/api\/fan-campaigns\?feed=public/);
assert.match(page, /\/api\/dreamweaver-campaigns\?feed=public/);
assert.match(page, /pickFeaturedRelease/);
assert.match(page, /setFeaturedRelease\(toFeaturedRelease/);
assert.match(page, /setNewRelease\(toNewRelease/);
assert.match(page, /data-stat-event="open_new_release"/);
assert.match(page, /data-stat-event="open_featured_release"/);
assert.doesNotMatch(page, /FEATURED_RELEASE\.titleLines\.map/);
assert.doesNotMatch(page, />\s*Now transmitting\s*</);

const defaultFeaturedArtwork = page.match(/const DEFAULT_FEATURED_RELEASE = \{[\s\S]*?artwork:\s*'([^']+)'/);
const defaultFeaturedUrl = page.match(/const DEFAULT_FEATURED_RELEASE = \{[\s\S]*?url:\s*'([^']+)'/);
const defaultNewArtwork = page.match(/const DEFAULT_NEW_RELEASE = \{[\s\S]*?artwork:\s*'([^']+)'/);
assert.ok(defaultFeaturedArtwork?.[1], "DEFAULT_FEATURED_RELEASE.artwork must be defined");
assert.ok(defaultFeaturedUrl?.[1], "DEFAULT_FEATURED_RELEASE.url must be defined");
assert.ok(defaultNewArtwork?.[1], "DEFAULT_NEW_RELEASE.artwork must be defined");

await access(resolve(root, defaultFeaturedArtwork[1].slice(1)));
await access(resolve(root, defaultNewArtwork[1].slice(1)));
await access(resolve(root, defaultFeaturedUrl[1].slice(1), "index.html"));

console.log("Featured release rotation and promotional feed contracts passed");
