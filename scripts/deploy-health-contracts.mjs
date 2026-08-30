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
const results = [];

const reportPass = (name, detail) => {
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
  results.push({ name, ok: true });
};

const reportFail = (name, error) => {
  console.error(`❌ ${name} — ${error.message}`);
  results.push({ name, ok: false, error: error.message });
};

const runCheck = async (name, check) => {
  try {
    const detail = await check();
    reportPass(name, detail);
  } catch (error) {
    reportFail(name, error);
  }
};

await runCheck("Migration ordering", async () => {
  const migrationDir = "netlify/database/migrations";
  const entries = await readdir(resolve(root, migrationDir));
  const versions = entries
    .map(name => ({ name, version: name.match(/^(\d+)/)?.[1] ?? null }))
    .filter(e => e.version !== null)
    .sort((a, b) => a.version.localeCompare(b.version));

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

  return `${versions.length} migrations in strict order`;
});

await runCheck("Homepage routing to /halo.html", async () => {
  const netlifyConfig = await read("netlify.toml");
  const rootRedirectBlock = netlifyConfig.match(/\[\[redirects\]\][^\[]*from\s*=\s*["']\/["'][^\[]*/);
  assert.ok(
    rootRedirectBlock !== null,
    "netlify.toml must have a [[redirects]] block with from = \"/\"."
  );
  const rootBlock = rootRedirectBlock[0];
  assert.match(rootBlock, /to\s*=\s*["']\/halo\.html["']/, "netlify.toml root redirect must point to /halo.html.");
  assert.match(rootBlock, /status\s*=\s*200/, "netlify.toml root redirect must use status = 200.");
  assert.match(rootBlock, /force\s*=\s*true/, "netlify.toml root redirect must use force = true.");
  assert.doesNotMatch(
    rootBlock,
    /to\s*=\s*["']\/index\.html["']/,
    "netlify.toml must not force-rewrite / to /index.html — that is the private-access page, not the public homepage."
  );
  return "root redirect enforces / -> /halo.html (200 force)";
});

await runCheck("Album Concierge visibility on public root page", async () => {
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
  return "Album Concierge name and /album-concierge/ link found in halo.html";
});

const failed = results.filter(result => !result.ok);
console.log(
  `Deploy health summary: ${results.length - failed.length}/${results.length} checks passed.`
);

if (failed.length > 0) {
  for (const result of failed) {
    console.error(`- ${result.name}: ${result.error}`);
  }
  console.error("Fix the failed contracts above, then rerun: node scripts/deploy-health-contracts.mjs");
  process.exitCode = 1;
}
