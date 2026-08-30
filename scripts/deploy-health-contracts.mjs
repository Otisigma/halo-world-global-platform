/**
 * Deploy Health Contracts
 *
 * Internal AI maintenance check for the HALO World production deploy.
 * Validates:
 *   1. Migration order — no migration file has a version timestamp earlier than or
 *      equal to the last completed migration in alphabetical order (prevents the
 *      "added out of order" Netlify deploy failure).
 *   2. Production publish configuration — Netlify publishes the repository root,
 *      where the public pages, route directories, and netlify.toml live.
 *   3. Homepage routing — netlify.toml rewrites / to /halo.html with a force:200
 *      rule, and does NOT rewrite / to /index.html (which is the private-access page).
 *   4. Album Concierge public visibility — halo.html contains the /album-concierge/
 *      link so the promo is reachable from the public root route.
 *   5. Build Your Album promotion + route health — halo.html visibly promotes
 *      Build Your Album, links to /album-concierge/, and the route is wired to a
 *      healthy local page entrypoint.
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
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const getRedirectBlock = (toml, fromPath) => toml
  .split("[[redirects]]")
  .map(block => block.trim())
  .find(block => new RegExp(`^from\\s*=\\s*["']${escapeRegExp(fromPath)}["']`, "m").test(block));

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

await runCheck("Production publish configuration", async () => {
  const netlifyConfig = await read("netlify.toml");
  assert.match(
    netlifyConfig,
    /\[build\][\s\S]*?publish\s*=\s*["']\.["']/,
    "netlify.toml must publish the repository root so halo.html and album-concierge/index.html are deployed."
  );
  assert.doesNotMatch(
    netlifyConfig,
    /publish\s*=\s*["']public\/?["']/,
    "Do not publish the legacy public directory; it does not contain the HALO production site."
  );
  return "repository root is the Netlify publish directory";
});

await runCheck("Homepage routing to /halo.html", async () => {
  const netlifyConfig = await read("netlify.toml");
  const rootRedirectBlock = getRedirectBlock(netlifyConfig, "/");
  assert.ok(
    rootRedirectBlock,
    "netlify.toml must have a [[redirects]] block with from = \"/\"."
  );
  const rootBlock = rootRedirectBlock;
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

await runCheck("Build Your Album promotion and route health", async () => {
  const [haloHtml, albumConciergePage, albumConciergeScript, albumConciergeFunction, netlifyConfig] = await Promise.all([
    read("halo.html"),
    read("album-concierge/index.html"),
    read("album-concierge/album-concierge.js"),
    read("netlify/functions/album-concierge.mjs"),
    read("netlify.toml")
  ]);

  assert.match(
    haloHtml,
    /Build Your Album/i,
    [
      "halo.html must visibly promote Build Your Album.",
      "Add or restore Build Your Album copy in the public homepage experience."
    ].join(" ")
  );
  assert.match(
    haloHtml,
    /href\s*=\s*["']\/album-concierge\/["']/,
    [
      "Build Your Album homepage promo must link to /album-concierge/.",
      "Restore the route in the homepage CTA."
    ].join(" ")
  );
  const albumRedirectBlock = getRedirectBlock(netlifyConfig, "/album-concierge");
  assert.ok(
    albumRedirectBlock,
    "netlify.toml must have a [[redirects]] block with from = \"/album-concierge\"."
  );
  assert.match(albumRedirectBlock, /to\s*=\s*["']\/album-concierge\/["']/, "netlify.toml must normalize /album-concierge to /album-concierge/.");
  assert.match(albumRedirectBlock, /status\s*=\s*301/, "netlify.toml must normalize /album-concierge with a 301 redirect.");
  assert.match(
    albumConciergePage,
    /Album Concierge — HALO World/,
    "album-concierge/index.html must expose the Build Your Album page title."
  );
  assert.match(
    albumConciergePage,
    /id="step-1"/,
    "album-concierge/index.html must include the Build Your Album guided flow entrypoint."
  );
  assert.match(
    albumConciergePage,
    /src=["']\/album-concierge\/album-concierge\.js["']/,
    "album-concierge/index.html must load its guided-flow controller."
  );
  assert.match(
    albumConciergeScript,
    /fetch\(["']\/api\/album-concierge["']/,
    "The Build Your Album flow must submit to the Album Concierge API."
  );
  assert.match(
    albumConciergeFunction,
    /path:\s*["']\/api\/album-concierge["']/,
    "The Album Concierge Netlify Function must expose /api/album-concierge."
  );
  assert.match(
    albumConciergeFunction,
    /request\.method\s*!==\s*["']GET["'][\s\S]*?try\s*\{[\s\S]*?verifyRequestOrigin\(request\)/,
    "The Album Concierge API must allow authenticated GET reads and catch origin failures on state-changing requests."
  );

  return "Build Your Album promo and /album-concierge/ route are healthy";
});

const failed = results.filter(result => !result.ok);
const summary = `Deploy health summary: ${results.length - failed.length}/${results.length} checks passed.`;
if (failed.length > 0) {
  console.error(summary);
} else {
  console.log(summary);
}

if (failed.length > 0) {
  for (const result of failed) {
    console.error(`- ${result.name}: ${result.error}`);
  }
  console.error("Fix the failed contracts above, then rerun: node scripts/deploy-health-contracts.mjs");
  process.exitCode = 1;
}
