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
    status: Number(block.match(/status\s*=\s*(\d+)/)?.[1] || 0)
  }))
  .filter(rule => rule.from && rule.to);

const redirectRuleBySource = new Map();
for (const rule of redirectRules) {
  assert.ok(!redirectRuleBySource.has(rule.from), `Duplicate redirect source detected in netlify.toml: ${rule.from}`);
  redirectRuleBySource.set(rule.from, rule);
}

for (const rule of redirectRules) {
  assert.notEqual(rule.from, rule.to, `Self-redirect detected in netlify.toml: ${rule.from}`);
  const reverseRule = redirectRuleBySource.get(rule.to);
  assert.ok(reverseRule?.to !== rule.from, `Two-way redirect loop detected in netlify.toml: ${rule.from} <-> ${rule.to}`);
}

const renderedIndexRoutes = new Set(ROUTE_RENDER_INDEX_TARGETS);
const directoryRoutes = PUBLIC_ROUTE_REGISTRY.filter(({ route, file }) => route.endsWith("/") && file.endsWith("/index.html"));
const fileRenderRoutes = PUBLIC_ROUTE_REGISTRY.filter(({ route, file }) => !route.endsWith("/") && !route.endsWith(".html") && `/${file}` !== route);

for (const { route } of directoryRoutes) {
  const nonSlashAlias = route.slice(0, -1);
  const indexFilePath = `${route}index.html`;
  const nonSlashRedirect = redirectRuleBySource.get(nonSlashAlias);
  const canonicalRenderRule = redirectRuleBySource.get(route);
  const indexFileRedirect = redirectRuleBySource.get(indexFilePath);

  assert.equal(canonicalizeRoutePath(nonSlashAlias), route, `${nonSlashAlias} must canonicalize to ${route}.`);

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

  assert.ok(nonSlashRedirect, `netlify.toml must redirect ${nonSlashAlias} to the canonical directory route ${route}.`);
  assert.equal(nonSlashRedirect.status, 301, `${nonSlashAlias} must use a 301 redirect to ${route}.`);
  assert.equal(nonSlashRedirect.to, route, `${nonSlashAlias} must redirect to the canonical directory route ${route}.`);

  if (renderedIndexRoutes.has(route)) {
    assert.ok(canonicalRenderRule, `netlify.toml must render ${route} from ${indexFilePath}.`);
    assert.equal(canonicalRenderRule.status, 200, `${route} must use a 200 rewrite to ${indexFilePath}.`);
    assert.equal(canonicalRenderRule.to, indexFilePath, `${route} must rewrite to ${indexFilePath}.`);
    assert.ok(
      !indexFileRedirect,
      `${indexFilePath} must not redirect back to ${route} while ${route} already rewrites to ${indexFilePath}.`
    );
    continue;
  }

  if (canonicalRenderRule) {
    assert.equal(canonicalRenderRule.status, 200, `${route} may only map to a rendered index target with status 200.`);
    assert.equal(canonicalRenderRule.to, indexFilePath, `${route} may only rewrite to its own index file ${indexFilePath}.`);
  }

  if (indexFileRedirect) {
    assert.equal(indexFileRedirect.status, 301, `${indexFilePath} must canonicalize with a 301 redirect.`);
    assert.equal(indexFileRedirect.to, route, `${indexFilePath} must redirect to the canonical route ${route}.`);
  }

  const familyRedirectTargets = new Set(
    [nonSlashRedirect.to, indexFileRedirect?.to].filter(Boolean)
  );
  assert.deepEqual(
    familyRedirectTargets,
    new Set([route]),
    `Directory route family ${route} must converge on exactly one canonical public target path.`
  );
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

console.log(`Redirect loop contracts passed for ${redirectRules.length} Netlify rules, ${directoryRoutes.length} directory route families, and ${fileRenderRoutes.length} file-backed canonical routes.`);
