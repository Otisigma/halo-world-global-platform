import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFile(resolve(root, path), "utf8");

const [page, styles, config, routes, home, stats] = await Promise.all([
  read("toolost/index.html"),
  read("toolost/toolost.css"),
  read("netlify.toml"),
  read("lib/route-registry.js"),
  read("halo.html"),
  read("netlify/lib/stats.mjs")
]);

const checks = [
  [page.includes("HALO Distribution") && page.includes("powered by Toolost") && page.includes("Continue on Toolost.com"), "ships a HALO-branded Toolost landing page with a clear external handoff CTA"],
  [page.includes("in-house distributor partner"), "frames Toolost as HALO's in-house distributor partner"],
  [page.includes("official distributor-owned step") && page.includes("/release-house/") && page.includes("/campaign-studio/"), "sets expectations for Toolost's role while keeping HALO prep and follow-through routes connected"],
  [styles.includes(".toolost-hero") && styles.includes(".toolost-route-grid") && styles.includes("prefers-reduced-motion"), "includes premium layout styling with reduced-motion support"],
  [/from = "\/toolost\/"[\s\S]*to = "\/toolost\/index\.html"/.test(config), "serves the canonical /toolost/ route directly"],
  [routes.includes('directoryRoute("Toolost Distribution", "/toolost/", "toolost/index.html", { menuLabel: "HALO DISTRIBUTION" })'), "registers Toolost as a shared public route with a menu label"],
  [home.includes("HALO Distribution") && home.includes('href="/toolost/"') && home.includes("open_toolost_partner") && home.includes("Continue on Toolost.com"), "keeps Toolost discoverable from HALO navigation and homepage promo surfaces"],
  [home.includes("in-house distributor partnership"), "keeps HALO homepage copy explicit about the Toolost partnership role"],
  [stats.includes('"open_toolost_partner"') && stats.includes('"continue_to_toolost"'), "registers Toolost analytics events in the telemetry allowlist"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Toolost contracts: ${checks.length}/${checks.length} checks passed.`);
