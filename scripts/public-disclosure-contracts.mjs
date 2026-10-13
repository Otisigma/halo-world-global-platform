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
const ownershipPolicy = ownershipStatements.join(" ");
const copyrightPrompt = "℗ sound-recording rights holder and year / © composition or artwork rights holder and year; enter confirmed rights holders for this release";

function normalizeCopy(content) {
  return content.normalize("NFKC").toLowerCase().replace(/<[^>]*>/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function assertOwnershipPolicy(content, path) {
  assert.ok(content.includes(ownershipPolicy), `${path} displays the exact ownership policy`);
  const normalized = normalizeCopy(content);
  for (const statement of ownershipStatements) {
    assert.equal(normalized.split(normalizeCopy(statement)).length - 1, 1, `${path} states each ownership provision only once`);
  }
  assert.equal((normalized.match(/(?:owen anthony s music is owned|halo music owns owen anthony s music|halo music s ownership claim covers owen anthony s music)/g) || []).length, 1, `${path} does not repeat the music ownership disclosure`);
  assert.equal((normalized.match(/(?:artist uploaded (?:music and )?content remains?|artist uploads remain uploader owned)/g) || []).length, 1, `${path} does not repeat the uploader ownership disclosure`);
  assert.equal((normalized.match(/uploading alone (?:transfers no rights|does not transfer ownership)/g) || []).length, 1, `${path} does not repeat the no-rights-transfer disclosure`);
  assert.doesNotMatch(normalized, /\bhalo (?:music )?(?:owns|takes ownership of|retains ownership of|acquires|claims) (?:all |any |these |the )?(?:uploaded (?:music|files|content|tracks)|artist uploads|uploads)\b|\b(?:uploaded (?:music|files|content|tracks)|these files|artist uploads) (?:are|is|become|becomes) (?:owned by|the property of) halo\b|\bhalo music owns (?:all|any|every|the entire|the full|the whole)\b/, `${path} does not claim blanket upload ownership`);
  assert.doesNotMatch(normalized, /\b(?:uploading|uploads?|submitting|submissions?) (?:to halo )?(?:automatically )?(?:transfers?|assigns?|grants?|conveys?) (?:all |full |exclusive |your |the )?(?:rights|ownership|copyrights?)\b/, `${path} does not claim that uploading transfers rights`);
}

assertOwnershipPolicy(ownershipPolicy, "canonical policy fixture");
const invalidPolicies = [
  ...ownershipStatements.map(statement => ownershipPolicy.replace(statement, "")),
  ownershipPolicy.replace("explicit split or ownership agreement", "split or ownership agreement"),
  ownershipPolicy.replace("Owen Anthony’s", "Owen Anthony's"),
  ...ownershipStatements.map(statement => `${ownershipPolicy} ${statement.toUpperCase()}`),
  `${ownershipPolicy} Halo Music owns Owen Anthony's music only; artist-uploaded music and content remain 100% the uploader's property by default unless an ownership or split agreement is explicitly configured and agreed on this site.`,
  `${ownershipPolicy} Other artist-uploaded content remains the uploader’s unless an explicit split or ownership agreement is configured.`,
  `${ownershipPolicy} Halo Music <strong>owns</strong> Owen Anthony's music only.`,
  `${ownershipPolicy} Uploading alone does not transfer ownership.`,
  `${ownershipPolicy} HALO owns all uploaded content.`,
  `${ownershipPolicy} These files are owned by HALO.`,
  `${ownershipPolicy} Halo Music owns all music.`,
  `${ownershipPolicy} Uploading to HALO automatically transfers your rights.`
];
for (const policy of invalidPolicies) {
  assert.throws(() => assertOwnershipPolicy(policy, "invalid policy fixture"), assert.AssertionError, "rejects changed wording, legacy duplicates, and ownership claims");
}

for (const phrase of restrictedDisclosures) {
  const exposedBy = contents.filter(file => file.content.includes(phrase)).map(file => file.path);
  assert.deepEqual(exposedBy, [], `Public Dreamweaver surfaces disclose restricted implementation language: ${phrase}`);
}

const dreamweaverPage = contents.find(file => file.path === "dreamweaver/index.html")?.content || "";
assert.ok(dreamweaverPage.includes("proprietary halo technology"), "Dreamweaver identifies the product as proprietary");
assert.ok(dreamweaverPage.includes("capabilities and outcomes, not confidential methods"), "Dreamweaver states the public disclosure boundary");
for (const { path, content } of ownershipContents) {
  assertOwnershipPolicy(content, path);
}
const releaseHouse = ownershipContents.find(file => file.path === "release-house/release-house.js").content;
assert.ok(releaseHouse.includes(`placeholder: "${copyrightPrompt}"`), "copyright metadata asks for exact release-specific rights holders");

const checkCount = restrictedDisclosures.length + 2 + (ownershipSurfaces.length + 1) * (ownershipStatements.length + 6) + invalidPolicies.length + 1;
console.log(`Public disclosure contracts: ${checkCount}/${checkCount} checks passed.`);
