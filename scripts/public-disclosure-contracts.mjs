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

const ownershipSurfaces = [
  "halo.html",
  "creators/index.html",
  "dj-deck.html",
  "release-house/release-house.js"
];
const policySurfaces = [
  ...ownershipSurfaces,
  "release-house/index.html",
  "sync-hub/index.html",
  "asset-inventory/index.html"
];
const policyContents = await Promise.all(policySurfaces.map(async path => ({
  path,
  normalized: normalizeCopy(await readFile(resolve(root, path), "utf8"))
})));
const ownershipContents = policyContents.filter(({ path }) => ownershipSurfaces.includes(path));
const ownershipStatements = [
  "Owen Anthony’s music is owned by Halo Music.",
  "Other artist-uploaded content remains the uploader’s property unless an explicit split or ownership agreement is configured on HALO.",
  "Uploading alone transfers no rights.",
  "HALO software and technical infrastructure are proprietary."
].map(normalizeCopy);
const copyrightPrompt = "℗ sound-recording rights holder and year / © composition or artwork rights holder and year; enter confirmed rights holders for this release";

function normalizeCopy(value) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

for (const phrase of restrictedDisclosures) {
  const exposedBy = contents.filter(file => file.content.includes(phrase)).map(file => file.path);
  assert.deepEqual(exposedBy, [], `Public Dreamweaver surfaces disclose restricted implementation language: ${phrase}`);
}

const dreamweaverPage = contents.find(file => file.path === "dreamweaver/index.html")?.content || "";
assert.ok(dreamweaverPage.includes("proprietary halo technology"), "Dreamweaver identifies the product as proprietary");
assert.ok(dreamweaverPage.includes("capabilities and outcomes, not confidential methods"), "Dreamweaver states the public disclosure boundary");
for (const { path, normalized } of ownershipContents) {
  assert.ok(normalized.includes(ownershipStatements.join(" ")), `${path} displays the ownership policy`);
  for (const statement of ownershipStatements) {
    assert.equal(normalized.split(statement).length - 1, 1, `${path} states each ownership provision only once`);
  }
  assert.equal((normalized.match(/(?:owen anthony s music is owned|halo music owns owen anthony s music|halo music s ownership claim covers owen anthony s music)/g) || []).length, 1, `${path} does not repeat the music ownership disclosure`);
  assert.equal((normalized.match(/(?:artist uploaded (?:music and )?content remains?|artist uploads remain uploader owned)/g) || []).length, 1, `${path} does not repeat the uploader ownership disclosure`);
}
for (const { path, normalized } of policyContents) {
  assert.doesNotMatch(normalized, /(?:halo (?:owns|takes ownership of|retains ownership of) (?:all |these |the )?(?:uploaded (?:files|content)|artist uploads)|(?:uploaded (?:files|content)|these files) (?:are|is) owned by halo)/, `${path} does not claim blanket upload ownership`);
}
const releaseHouse = policyContents.find(file => file.path === "release-house/index.html").normalized;
assert.ok(releaseHouse.includes("uploading alone transfers no rights"), "the Release House ownership section states that uploading does not transfer rights");
const releaseMetadata = policyContents.find(file => file.path === "release-house/release-house.js").normalized;
assert.ok(releaseMetadata.includes(normalizeCopy(copyrightPrompt)), "copyright metadata asks for release-specific rights holders");

const checkCount = restrictedDisclosures.length + 2 + ownershipSurfaces.length * (ownershipStatements.length + 3) + policySurfaces.length + 2;
console.log(`Public disclosure contracts: ${checkCount}/${checkCount} checks passed.`);
