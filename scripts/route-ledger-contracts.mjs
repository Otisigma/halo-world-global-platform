import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HALO_BUTTON_WATCHER_REGISTRY } from "../lib/watcher-registry.js";
import { SATELLITE_STATUS_TARGETS } from "../lib/route-registry.js";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [menuSource, fallbackSource, sweepSource, serviceWorkerSource, workflowSource] = await Promise.all([
  read("halo.html"),
  read("404.html"),
  read("netlify/lib/maintenance-sweep.mjs"),
  read("sw.js"),
  read(".github/workflows/ci.yml")
]);

for (const target of SATELLITE_STATUS_TARGETS) {
  assert.ok(target.file, `${target.route} must declare a source file in the shared route ledger.`);
  assert.ok(target.contentSentinel, `${target.route} must declare a content sentinel in the shared route ledger.`);
  await access(resolve(root, target.file));
  const source = await read(target.file);
  const sentinels = Array.isArray(target.contentSentinel) ? target.contentSentinel : [target.contentSentinel];
  for (const sentinel of sentinels) {
    assert.ok(source.includes(sentinel), `${target.file} must contain sentinel ${JSON.stringify(sentinel)}.`);
  }
  if (target.monitorMode === "required") {
    assert.match(source, /site-monitor\.js/, `${target.file} must load site-monitor.js.`);
    assert.match(source, /mobile-navigation\.js/, `${target.file} must load mobile-navigation.js.`);
  }
  if (target.watcherRequired) {
    assert.ok(
      HALO_BUTTON_WATCHER_REGISTRY.some(watcher => watcher.pageRoute === target.route),
      `${target.route} must have watcher coverage.`
    );
  }
}

assert.match(sweepSource, /contentSentinel/, "Maintenance sweep must use route-ledger content sentinels.");
assert.match(sweepSource, /state:\s*"fallback"/, "Fallback snapshots must preserve an explicit fallback state.");
assert.match(sweepSource, /featuredWorking/, "Maintenance sweep must preserve featured working-route metadata.");

assert.match(menuSource, /indicator\.featuredWorking && indicator\.status === 'green'/, "Top working routes must come from featured verified ledger statuses.");
assert.doesNotMatch(menuSource, /const MENU_PRIMARY_WORKING_TARGET_ROUTES = new Set/, "Main menu must not hard-code top working routes.");
assert.match(menuSource, /state:\s*route === attentionRoute \? 'attention' : 'fallback'/, "Default menu statuses must use explicit fallback state.");
assert.match(menuSource, /verified:\s*false/, "Default menu statuses must not claim verification.");

assert.match(fallbackSource, /FALLBACK_HUB_ROUTE_TARGETS/, "Fallback hub must derive routes from the shared route registry.");
assert.match(fallbackSource, /\/api\/halo-satellite-status/, "Fallback hub must read the public route-ledger status API.");
assert.match(fallbackSource, /featuredWorking && route\?\.verified && route\?\.status === "green"/, "Fallback hub must only surface verified live featured routes.");

assert.match(serviceWorkerSource, /"\/404\.html"/, "Service worker must precache the branded fallback hub.");
assert.match(serviceWorkerSource, /normalizedPath !== CANONICAL_HOME_ROUTE && cachedFallback/, "Service worker must prefer the fallback hub for non-home navigation failures.");

assert.match(workflowSource, /route-ledger-contracts\.mjs/, "Active CI must run the route-ledger contract.");

console.log(`Route ledger contracts passed for ${SATELLITE_STATUS_TARGETS.length} major routes.`);
