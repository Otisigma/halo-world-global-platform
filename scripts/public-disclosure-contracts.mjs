import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const publicSurfaces = [
  "dreamweaver/index.html",
  "dreamweaver/dreamweaver.js",
  "campaign-studio/index.html",
  "campaign-studio/campaign-studio.js"
];

const copyrightSurfaces = [
  "halo.html",
  "halo-live.html",
  "halo-command.html",
  "halo_agent_console_single_cover_lab.html",
  "halo_signal_network_console.html",
  "vip_launchpad.html",
  "artwork-manager.html",
  "signal-network/index.html",
  "album-concierge/index.html",
  "when-the-world-goes-dark/index.html",
  "creators/index.html"
];

const restrictedDisclosures = [
  "with no paid ai call",
  "five specialist agents",
  "model weights",
  "spectral choices",
  "simulated room telemetry",
  "full set history"
];

const contents = await Promise.all(publicSurfaces.map(async path => ({
  path,
  content: (await readFile(resolve(root, path), "utf8")).toLowerCase()
})));

for (const phrase of restrictedDisclosures) {
  const exposedBy = contents.filter(file => file.content.includes(phrase)).map(file => file.path);
  assert.deepEqual(exposedBy, [], `Public Dreamweaver surfaces disclose restricted implementation language: ${phrase}`);
}

const dreamweaverPage = contents.find(file => file.path === "dreamweaver/index.html")?.content || "";
assert.ok(dreamweaverPage.includes("proprietary halo technology"), "Dreamweaver identifies the product as proprietary");
assert.ok(dreamweaverPage.includes("capabilities and outcomes, not confidential methods"), "Dreamweaver states the public disclosure boundary");

const standardCopyright = "Copyright © 2026 HALO MUSIC WORLD LTD. All Rights Reserved.";
const copyrightContents = await Promise.all(copyrightSurfaces.map(async path => ({
  path,
  content: await readFile(resolve(root, path), "utf8")
})));
for (const file of copyrightContents) {
  assert.ok(file.content.includes(standardCopyright), `${file.path} uses the standard public copyright notice`);
  assert.ok(!file.content.includes("SYSTEMS LLC"), `${file.path} does not expose the obsolete company name`);
}

const [homePage, creatorPage, releaseHouse, releaseHouseClient, deck, stemVault] = await Promise.all([
  readFile(resolve(root, "halo.html"), "utf8"),
  readFile(resolve(root, "creators/index.html"), "utf8"),
  readFile(resolve(root, "release-house/index.html"), "utf8"),
  readFile(resolve(root, "release-house/release-house.js"), "utf8"),
  readFile(resolve(root, "dj-deck.html"), "utf8"),
  readFile(resolve(root, "netlify/functions/stem-vault.mjs"), "utf8")
]);
assert.ok(homePage.includes(`<meta name="copyright" content="${standardCopyright}">`), "home metadata uses the standard public copyright notice");
assert.ok(creatorPage.includes("Owen Anthony’s music is owned by Halo Music."), "ownership copy identifies Owen Anthony's music owner");
assert.ok(creatorPage.includes("All other artist-uploaded music, recordings, stems, and releases remain 100% the uploader’s property"), "ownership copy protects other artists' uploads by default");
assert.ok(creatorPage.includes("unless an explicit split or ownership agreement is configured on the site"), "ownership changes require explicit site configuration");
assert.ok(creatorPage.includes("Uploading content does not transfer rights unless an explicit agreement is configured."), "uploading alone does not transfer rights");
assert.ok(creatorPage.includes("platform, software, codebase, and technical infrastructure remain proprietary"), "platform technology remains proprietary");
assert.ok(releaseHouse.includes("All other artist-uploaded music, recordings, stems, and releases remain 100% the uploader’s property"), "Release House preserves uploader ownership");
assert.ok(releaseHouseClient.includes("copyrightLines: \"℗ 2026 HALO MUSIC WORLD LTD / © 2026 HALO MUSIC WORLD LTD\""), "Owen Anthony's sample release metadata names HALO MUSIC WORLD LTD");
assert.ok(deck.includes("I own or control these files, or have permission to upload them") && deck.includes("Uploading does not transfer ownership"), "stem upload terms reflect uploader ownership");
assert.ok(stemVault.includes("Confirm that you own or control each uploaded stem or have permission to upload it"), "stem upload errors describe the uploader's rights attestation");

const checkCount = restrictedDisclosures.length + 2 + copyrightContents.length * 2 + 10;
console.log(`Public disclosure contracts: ${checkCount}/${checkCount} checks passed.`);
