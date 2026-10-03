import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTE_RENDER_INDEX_TARGETS } from "../lib/page-link-ledger.js";
import {
  CANONICAL_ROUTE_ALIAS_ENTRIES,
  PUBLIC_ROUTE_REGISTRY,
  canonicalizeRoutePath
} from "../lib/route-registry.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const netlifyConfigSource = await readFile(resolve(root, "netlify.toml"), "utf8");
const redirectRules = [...netlifyConfigSource.matchAll(/\[\[redirects\]\]([\s\S]*?)(?=\n\[\[redirects\]\]|\s*$)/g)]
  .map(([, block]) => ({
    from: block.match(/from\s*=\s*"([^"]+)"/)?.[1] || null,
    to: block.match(/to\s*=\s*"([^"]+)"/)?.[1] || null,
    status: Number(block.match(/status\s*=\s*(\d+)/)?.[1] || 0),
    force: /force\s*=\s*true/.test(block)
  }))
  .filter(rule => rule.from && rule.to);

const redirectRuleBySource = new Map();
for (const rule of redirectRules) {
  assert.ok(!redirectRuleBySource.has(rule.from), `Duplicate redirect source detected in netlify.toml: ${rule.from}`);
  redirectRuleBySource.set(rule.from, rule);
}

function normalizedNetlifyPath(path) {
  return path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
}

function assertNormalizedRedirects(rules) {
  const firstRuleByPath = new Map();
  for (const rule of rules) {
    const source = normalizedNetlifyPath(rule.from);
    // Netlify matches slash variants alike; the first matching rule wins.
    if (!firstRuleByPath.has(source)) firstRuleByPath.set(source, rule);
  }
  for (const [source, rule] of firstRuleByPath) {
    if (![301, 302, 303, 307, 308].includes(rule.status)) continue;
    if (!rule.to.startsWith("/") || rule.to.startsWith("//")) continue;
    const target = normalizedNetlifyPath(rule.to);
    assert.notEqual(source, target, `Slash-normalized self-redirect detected: ${rule.from} -> ${rule.to}`);
    const reverseRule = firstRuleByPath.get(target);
    if (!reverseRule || ![301, 302, 303, 307, 308].includes(reverseRule.status)) continue;
    assert.notEqual(
      normalizedNetlifyPath(reverseRule.to),
      source,
      `Slash-normalized two-way redirect loop detected: ${rule.from} <-> ${reverseRule.from}`
    );
  }
  return firstRuleByPath;
}

for (const status of [301, 302, 303, 307, 308]) {
  for (const [from, to] of [
    ["/stats", "/stats/"],
    ["/stats/", "/stats"],
    ["/stats/", "/stats/?view=public"],
    ["/dreamweaver/satellite/:songId", "/dreamweaver/satellite/:songId/"]
  ]) {
    assert.throws(() => assertNormalizedRedirects([{ from, to, status }]), /Slash-normalized self-redirect/);
  }
}
assert.throws(() => assertNormalizedRedirects([
  { from: "/stats/", to: "/login", status: 302 },
  { from: "/login/", to: "/stats", status: 307 }
]), /Slash-normalized two-way redirect loop/);
assert.doesNotThrow(() => assertNormalizedRedirects([
  { from: "/stats/", to: "/stats/index.html", status: 200 },
  { from: "/stats", to: "/stats/", status: 301 }
]));
assert.doesNotThrow(() => assertNormalizedRedirects([
  { from: "/", to: "/halo", status: 301 },
  { from: "/halo", to: "/halo.html", status: 200 }
]));

const normalizedRules = assertNormalizedRedirects(redirectRules);
for (const path of ["/stats", "/stats/"]) {
  const rule = normalizedRules.get(normalizedNetlifyPath(path));
  assert.equal(rule?.status, 200, `${path} must terminate in a rewrite, not a login or slash redirect.`);
  assert.equal(rule?.to, "/stats/index.html", `${path} must serve the public stats page.`);
  assert.equal(rule?.force, true, `${path} must keep its forced public stats rewrite.`);
}
assert.ok(!normalizedRules.has("/stats/index.html"), "The stats backing file must not redirect back to its public route.");

for (const rule of redirectRules) {
  assert.notEqual(rule.from, rule.to, `Self-redirect detected in netlify.toml: ${rule.from}`);
  const reverseRule = redirectRuleBySource.get(rule.to);
  assert.ok(reverseRule?.to !== rule.from, `Two-way redirect loop detected in netlify.toml: ${rule.from} <-> ${rule.to}`);
}

const renderedIndexRoutes = new Set(ROUTE_RENDER_INDEX_TARGETS);
const directoryRoutes = PUBLIC_ROUTE_REGISTRY.filter(({ route, file }) => route.endsWith("/") && file.endsWith("/index.html"));
const fileRenderRoutes = PUBLIC_ROUTE_REGISTRY.filter(({ route, file }) => !route.endsWith("/") && !route.endsWith(".html") && `/${file}` !== route);
const canonicalHtmlFileRoutes = PUBLIC_ROUTE_REGISTRY.filter(({ route }) => route.endsWith(".html"));
const forbiddenLegacyAliases = ["/signal", "/halo-support", "/halo-support/", "/halo-%20support", "/halo- support"];

assert.deepEqual(
  CANONICAL_ROUTE_ALIAS_ENTRIES,
  [],
  "Canonical route alias registry must stay empty so non-canonical public aliases cannot silently reappear."
);
for (const legacyAlias of forbiddenLegacyAliases) {
  assert.ok(
    !redirectRuleBySource.has(legacyAlias),
    `Legacy alias redirect ${legacyAlias} must remain removed.`
  );
}

for (const { route, file } of directoryRoutes) {
  const nonSlashAlias = route.slice(0, -1);
  const renderFilePath = `/${file}`;
  const legacyIndexFilePath = `${route}index.html`;
  const nonSlashRedirect = redirectRuleBySource.get(nonSlashAlias);
  const canonicalRenderRule = redirectRuleBySource.get(route);
  const renderFileRedirect = redirectRuleBySource.get(renderFilePath);
  const allowsNonSlashDirectRender = route === "/dreamweaver/";
  assert.equal(canonicalizeRoutePath(nonSlashAlias), nonSlashAlias, `${nonSlashAlias} must remain non-canonicalized once aliases are removed.`);

  const familyCanonicalTargets = new Set(
    CANONICAL_ROUTE_ALIAS_ENTRIES
      .filter(({ to }) => to === route)
      .map(({ from }) => canonicalizeRoutePath(from))
  );
  familyCanonicalTargets.add(canonicalizeRoutePath(route));
  assert.deepEqual(
    familyCanonicalTargets,
    new Set([route]),
    `Route family ${route} must have exactly one canonical target path across route canonicalization files.`
  );

  if (allowsNonSlashDirectRender) {
    assert.ok(nonSlashRedirect, `${nonSlashAlias} must render directly to ${renderFilePath} to avoid Dreamweaver route dead-ends.`);
    assert.equal(nonSlashRedirect.status, 200, `${nonSlashAlias} must use a 200 rewrite to ${renderFilePath}.`);
    assert.equal(nonSlashRedirect.to, renderFilePath, `${nonSlashAlias} must rewrite to ${renderFilePath}.`);
  } else {
    assert.ok(!nonSlashRedirect, `${nonSlashAlias} alias redirect must be removed for canonical-only routing.`);
  }
  assert.ok(canonicalRenderRule, `netlify.toml must render ${route} from ${renderFilePath}.`);
  assert.equal(canonicalRenderRule.status, 200, `${route} must use a 200 rewrite to ${renderFilePath}.`);
  assert.equal(canonicalRenderRule.to, renderFilePath, `${route} must rewrite to ${renderFilePath}.`);
  assert.ok(
    !renderFileRedirect,
    `${renderFilePath} alias redirect must be removed for canonical-only routing.`
  );
  if (renderedIndexRoutes.has(route)) {
    assert.equal(canonicalRenderRule.to, renderFilePath, `${route} must keep its route-registry render target enabled for monitored non-live pages.`);
  }
}

for (const { route, file } of fileRenderRoutes) {
  const renderFilePath = `/${file}`;
  const canonicalRenderRule = redirectRuleBySource.get(route);
  const renderFileRedirect = redirectRuleBySource.get(renderFilePath);

  const familyCanonicalTargets = new Set(
    CANONICAL_ROUTE_ALIAS_ENTRIES
      .filter(({ to }) => to === route)
      .map(({ from }) => canonicalizeRoutePath(from))
  );
  familyCanonicalTargets.add(canonicalizeRoutePath(route));
  assert.deepEqual(
    familyCanonicalTargets,
    new Set([route]),
    `File-backed route family ${route} must have exactly one canonical target path across route canonicalization files.`
  );

  assert.ok(canonicalRenderRule, `netlify.toml must render ${route} from ${renderFilePath}.`);
  assert.equal(canonicalRenderRule.status, 200, `${route} must use a 200 rewrite to ${renderFilePath}.`);
  assert.equal(canonicalRenderRule.to, renderFilePath, `${route} must rewrite to ${renderFilePath}.`);
  assert.ok(
    !renderFileRedirect,
    `${renderFilePath} must not redirect back to ${route} while ${route} already rewrites to ${renderFilePath}.`
  );
}

for (const { route } of canonicalHtmlFileRoutes) {
  const basename = route.replace(/\.html$/, "");
  assert.ok(
    !redirectRuleBySource.has(basename),
    `${basename} alias redirect must be removed for canonical file route ${route}.`
  );
  assert.ok(
    !redirectRuleBySource.has(`${basename}/`),
    `${basename}/ alias redirect must be removed for canonical file route ${route}.`
  );
}

console.log(`Redirect loop contracts passed for ${redirectRules.length} Netlify rules, ${directoryRoutes.length} directory route families, ${fileRenderRoutes.length} file-backed canonical rewrites, and ${canonicalHtmlFileRoutes.length} canonical file-route alias checks.`);
