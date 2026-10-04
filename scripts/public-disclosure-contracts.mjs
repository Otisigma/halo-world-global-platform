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
const ownershipSurfaces = [
  "creators/index.html",
  "release-house/index.html",
  "asset-inventory/index.html",
  "dj-deck.html",
  "mixes/index.html",
  "dreamweaver-lab/index.html",
  "artists/index.html",
  "radio/index.html",
  "release-house/release-house.js",
  "netlify/functions/stem-vault.mjs",
  "HALO_PROMOTIONAL_PACK.md",
  "HALO_AGENT_STATUS_BOARD.md",
  "signal-network/index.html"
];
const copyrightSurfaces = [
  "halo.html",
  "halo-live.html",
  "halo-command.html",
  "halo_signal_network_console.html",
  "halo_agent_console_single_cover_lab.html",
  "artwork-manager.html",
  "vip_launchpad.html",
  "signal-network/index.html",
  "album-concierge/index.html",
  "when-the-world-goes-dark/index.html"
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
const ownershipContent = Object.fromEntries(await Promise.all(ownershipSurfaces.map(async path => [
  path,
  await readFile(resolve(root, path), "utf8")
])));
const copyrightContent = await Promise.all(copyrightSurfaces.map(async path => ({
  path,
  content: await readFile(resolve(root, path), "utf8")
})));

for (const phrase of restrictedDisclosures) {
  const exposedBy = contents.filter(file => file.content.includes(phrase)).map(file => file.path);
  assert.deepEqual(exposedBy, [], `Public Dreamweaver surfaces disclose restricted implementation language: ${phrase}`);
}

const dreamweaverPage = contents.find(file => file.path === "dreamweaver/index.html")?.content || "";
assert.ok(dreamweaverPage.includes("proprietary halo technology"), "Dreamweaver identifies the product as proprietary");
assert.ok(dreamweaverPage.includes("capabilities and outcomes, not confidential methods"), "Dreamweaver states the public disclosure boundary");

const copyrightLine = "Copyright © 2026 HALO MUSIC WORLD LTD. All Rights Reserved.";
for (const file of copyrightContent) {
  assert.ok(file.content.includes(copyrightLine), `${file.path} uses the standardized HALO MUSIC WORLD LTD copyright notice`);
}

const creatorDisclosure = ownershipContent["creators/index.html"];
assert.ok(creatorDisclosure.includes("Owen Anthony’s music is owned by Halo Music"), "Creator World identifies Owen Anthony’s music ownership");
assert.ok(creatorDisclosure.includes("All other artist-uploaded music, recordings, stems, and releases remain 100%"), "Creator World states the uploader ownership default");
assert.ok(creatorDisclosure.includes("Uploading alone does not transfer rights"), "Creator World states that upload alone transfers no rights");
assert.ok(ownershipContent["release-house/index.html"].includes("unless an explicit split or ownership agreement is set on the site"), "Release House limits ownership changes to configured agreements");
assert.ok(ownershipContent["asset-inventory/index.html"].includes("are proprietary"), "Asset inventory identifies platform technology as proprietary");
assert.ok(ownershipContent["HALO_PROMOTIONAL_PACK.md"].includes("technical infrastructure remain proprietary"), "Promotional guidance distinguishes proprietary platform technology");
assert.ok(ownershipContent["HALO_AGENT_STATUS_BOARD.md"].includes("proprietary, artist-first music and software platform"), "Internal status guidance distinguishes platform IP from artist uploads");
assert.ok(ownershipContent["signal-network/index.html"].includes("proprietary platform for artist-led"), "Signal Network avoids calling the platform artist-owned");
assert.ok(ownershipContent["dj-deck.html"].includes("Uploaded content remains mine unless an explicit split"), "Stem upload attestation preserves uploader ownership by default");
assert.ok(ownershipContent["mixes/index.html"].includes("Uploading alone does not transfer rights"), "Remix upload attestation preserves uploader ownership by default");
assert.ok(ownershipContent["dreamweaver-lab/index.html"].includes("Uploading alone does not transfer rights"), "Song Lab upload attestation preserves uploader ownership by default");
assert.ok(ownershipContent["artists/index.html"].includes("Submission alone does not transfer rights"), "Artist submission attestation preserves uploader ownership by default");
assert.ok(ownershipContent["radio/index.html"].includes("Submission alone does not transfer rights"), "Radio submission attestation preserves uploader ownership by default");
assert.ok(ownershipContent["release-house/release-house.js"].includes("℗ 2026 Halo Music / © 2026 Halo Music"), "Owen Anthony sample release metadata identifies Halo Music as rights owner");
assert.ok(ownershipContent["netlify/functions/stem-vault.mjs"].includes("Confirm that you own or control every uploaded stem"), "Stem upload validation asks the uploader to confirm their rights");
assert.ok(!ownershipContent["dj-deck.html"].includes("HALO owns or controls these files"), "Stem upload does not claim HALO owns artist uploads");

const checkCount = restrictedDisclosures.length + 2 + copyrightContent.length + 16;
console.log(`Public disclosure contracts: ${checkCount}/${checkCount} checks passed.`);
