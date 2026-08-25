import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stableSource = "https://halo-world-global-platform.netlify.app/";
const baselineFiles = [
  "index.html",
  "halo.html",
  "dj-deck.html",
  "halo-live.html",
  "halo-x.html",
  "vip_launchpad.html",
  "creators/index.html",
  "creators/gear-guide.html",
  "creators/gear-guide.css",
  "creators/gear-guide.js",
  "creators/marketplace.css",
  "creators/marketplace.js",
  "identity.js",
  "halo-companion.js",
  "halo-journal.js",
  "halo-x.css",
  "halo-x.js",
  "stats.js",
  "site-monitor.js",
  "accessibility.css",
  "accessibility.js",
  "mobile-navigation.css",
  "mobile-navigation.js",
  "app.webmanifest",
  "sw.js",
  "404.html",
  "assets/halo-app-icon.svg",
  "assets/halo-app-icon-180.png",
  "assets/halo-app-icon-192.png",
  "assets/halo-app-icon-512.png",
  "assets/releases/the-cold-is-lasting-longer.jpg"
];

const pageMarkers = {
  "index.html": ["HALO World — Private Access", "Unlock HALO", "admin role"],
  "halo.html": ["BUILD THE WORLD AROUND YOUR MUSIC", "Pass the Light", "Radio + DJ Release Room", "CREATOR WORLD"],
  "dj-deck.html": ["Opportunity Exchange", "sessionSaveStatus", "openTrackPicker", "AI booth crew"],
  "halo-live.html": ["HALO LIVE", "Copy this live room", "Open the DJ deck"],
  "halo-x.html": ["FOUNDERS CONTROL ROOM", "Activate access", "Who joined"],
  "vip_launchpad.html": ["VIP PRIVATE BETA", "ACTIVATE DJ HALO X ACCESS", "HALO LIVE"],
  "creators/index.html": ["HALO Creator World", "founding catalog", "THE WORK"],
  "creators/gear-guide.html": ["Use what works. Upgrade with purpose.", "Release readiness", "Help first. Context always."]
};

const failures = [];
for (const file of baselineFiles) {
  try {
    await access(resolve(root, file));
  } catch {
    failures.push(`missing stable file ${file}`);
  }
}

for (const [file, markers] of Object.entries(pageMarkers)) {
  const source = await readFile(resolve(root, file), "utf8");
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${file} lost stable marker: ${marker}`);
  }
}

const relationsSource = await readFile(resolve(root, "halo-relations.html"), "utf8");
if (!relationsSource.includes("HALO Relations") || !relationsSource.includes("AI RELATIONSHIP TEAM")) {
  failures.push("the relationship workspace is not layered onto the stable baseline");
}

const netlifyConfigSource = await readFile(resolve(root, "netlify.toml"), "utf8");
const publicRootRoute = /\[\[redirects\]\]\s+from = "\/"\s+to = "\/halo\.html"\s+status = 200\s+force = true(?!\s+conditions)/m;
if (!publicRootRoute.test(netlifyConfigSource)) {
  failures.push("the permanent public URL no longer serves the stable HALO experience");
}

if (/from = "\/"\s+to = "\/index\.html"/m.test(netlifyConfigSource)) {
  failures.push("the private access page replaced the permanent public URL");
}

if (/from = "\/\*"\s+to = "\/"/m.test(netlifyConfigSource)) {
  failures.push("public routes are being redirected into the private access page");
}

if (failures.length) {
  console.error(`HALO stable baseline failed against ${stableSource}`);
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`HALO stable baseline: ${baselineFiles.length} files and ${Object.values(pageMarkers).flat().length} experience markers preserved from ${stableSource}`);
}
