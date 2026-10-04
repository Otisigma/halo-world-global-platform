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
const ownershipContents = await Promise.all(ownershipSurfaces.map(async path => ({
  path,
  content: await readFile(resolve(root, path), "utf8")
})));
const ownershipStatements = [
  "Owen Anthony’s music is owned by Halo Music.",
  "Other artist-uploaded content remains the uploader’s property unless an explicit split or ownership agreement is configured on HALO.",
  "Uploading alone transfers no rights.",
  "HALO software and technical infrastructure are proprietary."
];
const copyrightPrompt = "℗ sound-recording rights holder and year / © composition or artwork rights holder and year; enter confirmed rights holders for this release";

for (const phrase of restrictedDisclosures) {
  const exposedBy = contents.filter(file => file.content.includes(phrase)).map(file => file.path);
  assert.deepEqual(exposedBy, [], `Public Dreamweaver surfaces disclose restricted implementation language: ${phrase}`);
}

const dreamweaverPage = contents.find(file => file.path === "dreamweaver/index.html")?.content || "";
assert.ok(dreamweaverPage.includes("proprietary halo technology"), "Dreamweaver identifies the product as proprietary");
assert.ok(dreamweaverPage.includes("capabilities and outcomes, not confidential methods"), "Dreamweaver states the public disclosure boundary");
for (const { path, content } of ownershipContents) {
  assert.ok(content.includes(ownershipStatements.join(" ")), `${path} displays the exact ownership policy`);
  for (const statement of ownershipStatements) {
    assert.equal(content.split(statement).length - 1, 1, `${path} states each ownership provision only once`);
  }
  assert.equal((content.match(/(?:Owen Anthony[’']s music is owned|Halo Music owns Owen Anthony[’']s music|Halo Music[’']s ownership claim covers Owen Anthony[’']s music)/gi) || []).length, 1, `${path} does not repeat the music ownership disclosure`);
  assert.equal((content.match(/(?:artist-uploaded (?:music and )?content remains?|artist uploads remain uploader-owned)/gi) || []).length, 1, `${path} does not repeat the uploader ownership disclosure`);
  assert.doesNotMatch(content, /(?:HALO (?:owns|takes ownership of) (?:all |these |the )?(?:uploaded (?:files|content)|artist uploads)|(?:uploaded (?:files|content)|these files) (?:are|is) owned by HALO)/i, `${path} does not claim blanket upload ownership`);
}
const releaseHouse = ownershipContents.find(file => file.path === "release-house/release-house.js").content;
assert.ok(releaseHouse.includes(`placeholder: "${copyrightPrompt}"`), "copyright metadata asks for exact release-specific rights holders");

const checkCount = restrictedDisclosures.length + 2 + ownershipSurfaces.length * (ownershipStatements.length + 4) + 1;
console.log(`Public disclosure contracts: ${checkCount}/${checkCount} checks passed.`);
