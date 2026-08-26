import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [indexPage, haloPage, releaseHouse, migration] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "halo.html"), "utf8"),
  readFile(resolve(root, "release-house/release-house.js"), "utf8"),
  readFile(resolve(root, "netlify/database/migrations/20260826102000_publish-blessed-release.sql"), "utf8")
]);

assert.match(indexPage, /https:\/\/distrokid\.com\/hyperfollow\/owenanthony\/blessed/);
assert.match(indexPage, /<strong class="release-title">Blessed<\/strong>/);
assert.match(indexPage, /<img src="\/assets\/releases\/blessed\.jpg" alt="Blessed cover artwork by Owen Anthony"/);
assert.doesNotMatch(indexPage, /distrokid\.imgix\.net/);
assert.match(indexPage, /eventName: 'open_new_release'/);
assert.match(indexPage, /release_id: releaseId/);
assert.match(indexPage, /const releaseId = releaseFeatureCard\?\.dataset\.releaseFeatureId \|\| 'unknown-release'/);

assert.match(haloPage, /const NEW_RELEASE = \{[\s\S]*title: 'Blessed',[\s\S]*artwork: '\/assets\/releases\/blessed\.jpg',[\s\S]*url: 'https:\/\/distrokid\.com\/hyperfollow\/owenanthony\/blessed'/);
assert.match(haloPage, /data-stat-target="homepage_new_release_card"/);

assert.match(releaseHouse, /Store approved covers as \/assets\/releases\/<release-slug>\.jpg/);

assert.match(migration, /'blessed'/);
assert.match(migration, /'Blessed'/);
assert.match(migration, /'\/assets\/releases\/blessed\.jpg'/);
assert.match(migration, /'https:\/\/distrokid\.com\/hyperfollow\/owenanthony\/blessed'/);
assert.match(migration, /'published'/);

await access(resolve(root, "assets/releases/blessed.jpg"));

console.log("Blessed release contracts passed");
