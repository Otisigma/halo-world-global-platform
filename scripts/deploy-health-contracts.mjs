/**
 * Deploy Health Contracts
 *
 * Internal AI maintenance check for the HALO World production deploy.
 * Validates:
 *   1. Migration order — no migration file has a version timestamp earlier than or
 *      equal to the last completed migration in alphabetical order (prevents deploy
 *      failures caused by out-of-order migration files).
 *   2. Homepage routing — server.js registers a GET "/" route that sends users to
 *      /halo, and /halo serves halo.html (while index.html remains private access).
 *   3. Album Concierge public visibility — halo.html contains the /album-concierge/
 *      link so the promo is reachable from the public root route.
 *   4. Build Your Album promotion + route health — halo.html visibly promotes
 *      Build Your Album, links to /album-concierge/, and server.js registers a
 *      301 redirect from /album-concierge to /album-concierge/.
 *   5. Homepage music experiment visibility — halo.html includes the native-vs-
 *      embed comparison markers and instrumentation hooks for measurement.
 *   6. Dreamweaver homepage hero — halo.html includes the adaptive Dreamweaver
 *      preview/player surface and preserves the experiment copy and routing.
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

await runCheck("Homepage routing to /halo", async () => {
  const serverJs = await read("server.js");

  // server.js must register a GET "/" route that routes users into /halo
  assert.match(
    serverJs,
    /app\.get\s*\(\s*["']\/["]/,
    "server.js must register a GET \"/\" route for the public homepage."
  );
  assert.match(
    serverJs,
    /redirect\s*\(\s*301\s*,\s*["']\/halo["']\)/,
    "server.js GET \"/\" route must redirect to /halo."
  );
  assert.match(
    serverJs,
    /app\.get\s*\(\s*["']\/halo["']/, 
    "server.js must register a GET \"/halo\" route for the public homepage."
  );
  assert.match(
    serverJs,
    /app\.get\s*\(\s*["']\/halo["'][\s\S]*?halo\.html/,
    "server.js GET \"/halo\" route must serve halo.html."
  );
  // server.js must NOT serve index.html from the public homepage paths
  // (index.html is the private-access page)
  const publicRouteSection = serverJs.match(/app\.get\s*\(\s*["']\/["][\s\S]*?app\.get\s*\(\s*["']\/private["']/)?.[0] ?? "";
  assert.doesNotMatch(
    publicRouteSection,
    /index\.html/,
    "server.js public routes must not serve index.html — that is the private-access page, not the public homepage."
  );
  return "server.js routes GET \"/\" to /halo and serves halo.html there";
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
  const [haloHtml, albumConciergePage, serverJs] = await Promise.all([
    read("halo.html"),
    read("album-concierge/index.html"),
    read("server.js")
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
  // server.js must register a 301 redirect from /album-concierge → /album-concierge/
  assert.match(
    serverJs,
    /["']\/album-concierge["']/, 
    "server.js must register the /album-concierge route."
  );
  assert.match(
    serverJs,
    /redirect\s*\(\s*301\s*,\s*["']\/album-concierge\/["']\)/,
    "server.js must 301-redirect /album-concierge → /album-concierge/."
  );
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

  return "Build Your Album promo and /album-concierge/ route are healthy";
});

await runCheck("Homepage music experiment markers and tracking", async () => {
  const haloHtml = await read("halo.html");
  assert.match(
    haloHtml,
    /Homepage Experiment[\s\S]*Artist-first listening test \/ Supporter-first model/,
    "halo.html must include the homepage experiment framing label in the homepage hero."
  );
  assert.match(
    haloHtml,
    /data-homepage-hero="dreamweaver"[\s\S]*Dreamweaver Preview[\s\S]*Dreamweaver Player[\s\S]*Play preview[\s\S]*Open Dreamweaver/,
    "halo.html must expose the Dreamweaver homepage hero player surface and its primary actions."
  );
  assert.match(
    haloHtml,
    /Variant A \(Primary\): Native HALO artist home/,
    "halo.html must include the native HALO music-home variant marker."
  );
  assert.match(
    haloHtml,
    /Variant B \(Comparison\): Quick-listen embed/,
    "halo.html must include the embed quick-listen variant marker."
  );
  assert.match(
    haloHtml,
    /musicExperiment/,
    "halo.html must support controlled variant rendering via a musicExperiment query parameter."
  );
  assert.match(
    haloHtml,
    /homepage_music_experiment_viewed/,
    "halo.html must emit a homepage experiment view tracking event."
  );
  assert.match(
    haloHtml,
    /homepage_music_experiment_exit/,
    "halo.html must emit a homepage experiment exit tracking event."
  );
  assert.match(
    haloHtml,
    /Measurement focus[\s\S]*Listening[\s\S]*Relationship room[\s\S]*Support actions[\s\S]*Repeat visits[\s\S]*Supporter conversion/,
    "halo.html must make the homepage experiment success signals easy to review."
  );
  assert.match(
    haloHtml,
    /transparent on-page behavior signals[\s\S]*without exploiting either side of the relationship/i,
    "halo.html must preserve the ethical data-use note for the experiment."
  );
  const statsDoc = await read("STATS.md");
  assert.match(
    statsDoc,
    /\| Goal \| Variant A target \| Variant B target \| Reading \|/,
    "STATS.md must document the homepage experiment comparison scorecard."
  );
  return "Homepage experiment variants and analytics hooks are present";
});

await runCheck("Adaptive Dreamweaver homepage preview surface", async () => {
  const haloHtml = await read("halo.html");
  assert.match(
    haloHtml,
    /data-homepage-surface="adaptive-dreamweaver-player"/,
    "halo.html must include the adaptive Dreamweaver homepage preview surface marker."
  );
  assert.match(
    haloHtml,
    /Adaptive Dreamweaver preview player/,
    "halo.html must include the adaptive Dreamweaver preview heading."
  );
  assert.match(
    haloHtml,
    /Route-aware mode/,
    "halo.html must include route-aware context copy for the homepage preview surface."
  );
  assert.match(
    haloHtml,
    /homepage_adaptive_preview_play/,
    "halo.html must emit adaptive preview action telemetry targets."
  );
  assert.match(
    haloHtml,
    /QUICK_LISTEN_AUTOPLAY_URL/,
    "halo.html must reuse the existing quick-listen embed path for adaptive preview playback."
  );
  return "Adaptive Dreamweaver preview surface is present and wired";
});

await runCheck("Core public navigation routes", async () => {
  const haloHtml = await read("halo.html");
  const requiredRoutes = [
    "/dreamweaver/",
    "/dreamweaver-lab/",
    "/mixes/",
    "/dj-deck.html",
    "/artists/",
    "/release-house/",
    "/campaign-studio/",
    "/finish-house/",
    "/radio/"
  ];

  for (const route of requiredRoutes) {
    assert.match(
      haloHtml,
      new RegExp(`href=["']${route.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`),
      `halo.html must link to ${route} from the main landing experience.`
    );
  }

  return "halo.html keeps links to Dreamweaver routes, mixes, DJ deck, artist rooms, release house, campaign studio, finish house, and radio";
});

await runCheck("Canonical menu route aliases", async () => {
  const [haloHtml, serverJs, netlifyConfig] = await Promise.all([
    read("halo.html"),
    read("server.js"),
    read("netlify.toml")
  ]);

  for (const href of ["href=\"/dj-deck.html\"", "href=\"/halo-live.html\"", "href=\"/halo-x.html\""]) {
    assert.match(haloHtml, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `halo.html must use the canonical absolute route ${href.slice(6, -1)}.`);
  }

  for (const [from, to] of [
    ["/artists", "/artists/"],
    ["/creator-freedom", "/creator-freedom/"],
    ["/creators", "/creators/"],
    ["/finish-house", "/finish-house/"],
    ["/mixes", "/mixes/"],
    ["/music", "/music/"],
    ["/radio", "/radio/"],
    ["/support", "/support/"],
    ["/dj-deck", "/dj-deck.html"],
    ["/halo-live", "/halo-live.html"],
    ["/halo-x", "/halo-x.html"],
    ["/magazine", "/magazine.html"]
  ]) {
    assert.match(netlifyConfig, new RegExp(`from = "${from.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}"[\\s\\S]*to = "${to.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}"`), `netlify.toml must canonicalize ${from} to ${to}.`);
  }

  assert.match(serverJs, /app\.get\("\/control-center"/, "server.js must serve the control-center alias locally.");
  assert.match(serverJs, /canonicalRouteRedirects = new Map\(/, "server.js must declare explicit canonical route aliases.");
  assert.match(serverJs, /canonicalRouteRedirects\.get\(routePath\)/, "server.js must use the canonical route alias map at runtime.");

  return "menu routes stay canonical across halo.html, netlify.toml, and server.js";
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
