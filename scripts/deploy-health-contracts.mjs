/**
 * Deploy Health Contracts
 *
 * Internal AI maintenance check for the HALO World production deploy.
 * Validates:
 *   1. Migration order — no migration file has a version timestamp earlier than or
 *      equal to the last completed migration in alphabetical order (prevents the
 *      "added out of order" Netlify deploy failure).
 *   2. Homepage routing — netlify.toml rewrites / to /halo.html with a force:200
 *      rule, and does NOT rewrite / to /index.html (which is the private-access page).
 *   3. Album Concierge public visibility — halo.html contains the /album-concierge/
 *      link so the promo is reachable from the public root route.
 *
 * Run: node scripts/deploy-health-contracts.mjs
 * Included in: npm test
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

// ---------------------------------------------------------------------------
// 1. Migration order check
// ---------------------------------------------------------------------------

const migrationDir = "netlify/database/migrations";
const entries = await readdir(resolve(root, migrationDir));

// Collect numeric version prefixes (digits at the start of each filename)
const versions = entries
  .map(name => ({ name, version: name.match(/^(\d+)/)?.[1] ?? null }))
  .filter(e => e.version !== null)
  .sort((a, b) => a.version.localeCompare(b.version));

// Detect any pair where a later file has a lower or equal version number than
// a file that sorted before it — that would cause Netlify's migration runner
// to report "added out of order".
for (let i = 1; i < versions.length; i++) {
  const prev = versions[i - 1];
  const curr = versions[i];
  assert.ok(
    curr.version.localeCompare(prev.version) > 0,
    [
      `Migration order violation: "${curr.name}" (version ${curr.version})`,
      `must sort after "${prev.name}" (version ${prev.version}).`,
      `Rename the out-of-order migration so its version timestamp follows`,
      `the current highest version to prevent a Netlify deploy failure.`
    ].join(" ")
  );
}

// Guard: the three previously out-of-order migrations must now use the
// corrected 20260830 versions that sort after the 20260828080000 boundary.
const migrationNames = new Set(versions.map(e => e.name));

assert.ok(
  !migrationNames.has("20260828060000_publish-cognitive-erasure.sql"),
  "20260828060000_publish-cognitive-erasure.sql is out of order — use 20260830020000_publish-cognitive-erasure.sql instead."
);
assert.ok(
  !migrationNames.has("20260828061000_publish-ill-do-it-all-again.sql"),
  "20260828061000_publish-ill-do-it-all-again.sql is out of order — use 20260830021000_publish-ill-do-it-all-again.sql instead."
);
assert.ok(
  !migrationNames.has("20260828062000_publish-blessed.sql"),
  "20260828062000_publish-blessed.sql is out of order — use 20260830022000_publish-blessed.sql instead."
);

assert.ok(
  migrationNames.has("20260830020000_publish-cognitive-erasure.sql"),
  "20260830020000_publish-cognitive-erasure.sql is missing — migration order fix has not been applied."
);
assert.ok(
  migrationNames.has("20260830021000_publish-ill-do-it-all-again.sql"),
  "20260830021000_publish-ill-do-it-all-again.sql is missing — migration order fix has not been applied."
);
assert.ok(
  migrationNames.has("20260830022000_publish-blessed.sql"),
  "20260830022000_publish-blessed.sql is missing — migration order fix has not been applied."
);

// ---------------------------------------------------------------------------
// 2. Homepage routing check
// ---------------------------------------------------------------------------

const netlifyConfig = await read("netlify.toml");

// The public root MUST rewrite to /halo.html with a force:200 rule.
// Check each required attribute independently so key order in the TOML block
// does not matter.
const rootRedirectBlock = netlifyConfig.match(/\[\[redirects\]\][^\[]*from\s*=\s*["']\/["'][^\[]*/);
assert.ok(
  rootRedirectBlock !== null,
  "netlify.toml must have a [[redirects]] block with from = \"/\"."
);
const rootBlock = rootRedirectBlock[0];
assert.match(rootBlock, /to\s*=\s*["']\/halo\.html["']/, "netlify.toml root redirect must point to /halo.html.");
assert.match(rootBlock, /status\s*=\s*200/, "netlify.toml root redirect must use status = 200.");
assert.match(rootBlock, /force\s*=\s*true/, "netlify.toml root redirect must use force = true.");

// The public root must NOT be rewritten to /index.html (private-access page).
assert.doesNotMatch(
  rootBlock,
  /to\s*=\s*["']\/index\.html["']/,
  "netlify.toml must not force-rewrite / to /index.html — that is the private-access page, not the public homepage."
);

// ---------------------------------------------------------------------------
// 3. Album Concierge public visibility check
// ---------------------------------------------------------------------------

const haloHtml = await read("halo.html");

assert.match(
  haloHtml,
  /href=["']\/album-concierge\//,
  [
    "halo.html must contain a link to /album-concierge/.",
    "The Album Concierge promo is not reachable from the public homepage.",
    "Add or restore the Album Concierge section in halo.html."
  ].join(" ")
);

assert.match(
  haloHtml,
  /[Aa]lbum [Cc]oncierge/,
  [
    "halo.html must mention Album Concierge by name.",
    "Restore the promotional copy in the public homepage route."
  ].join(" ")
);

// ---------------------------------------------------------------------------

console.log(
  `Deploy health contracts passed: ${versions.length} migrations in order, ` +
  `homepage routes to halo.html, Album Concierge visible on public root.`
);
