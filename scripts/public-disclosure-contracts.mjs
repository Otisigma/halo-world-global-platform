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

const [homePage, creatorPage, releaseHouse] = await Promise.all([
  readFile(resolve(root, "halo.html"), "utf8"),
  readFile(resolve(root, "creators/index.html"), "utf8"),
  readFile(resolve(root, "release-house/release-house.js"), "utf8")
]);

for (const phrase of restrictedDisclosures) {
  const exposedBy = contents.filter(file => file.content.includes(phrase)).map(file => file.path);
  assert.deepEqual(exposedBy, [], `Public Dreamweaver surfaces disclose restricted implementation language: ${phrase}`);
}

const dreamweaverPage = contents.find(file => file.path === "dreamweaver/index.html")?.content || "";
assert.ok(dreamweaverPage.includes("proprietary halo technology"), "Dreamweaver identifies the product as proprietary");
assert.ok(dreamweaverPage.includes("capabilities and outcomes, not confidential methods"), "Dreamweaver states the public disclosure boundary");
for (const [path, content] of [["HALO footer", homePage], ["Creator World", creatorPage]]) {
  assert.match(content, /Halo Music owns Owen Anthony’s music only\./, `${path} identifies Owen Anthony music ownership`);
  assert.match(content, /Artist-uploaded music and content remain 100% the uploader’s property by default/, `${path} preserves artist-upload ownership by default`);
  assert.match(content, /ownership or split agreement is explicitly configured and agreed on this site/, `${path} makes ownership changes agreement-dependent`);
  assert.match(content, /Uploading alone (transfers no rights|does not transfer ownership)/i, `${path} clarifies upload does not transfer rights`);
}
assert.match(homePage, /Platform software, code and technical infrastructure are proprietary to the platform’s technology rights holder/, "the public footer identifies platform IP as proprietary");
assert.match(releaseHouse, /enter confirmed holders for this release/, "copyright metadata asks for release-specific rights holders");

console.log(`Public disclosure contracts: ${restrictedDisclosures.length + 12}/${restrictedDisclosures.length + 12} checks passed.`);
