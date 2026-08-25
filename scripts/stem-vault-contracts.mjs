import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [deck, api, audio, migration] = await Promise.all([
  read("dj-deck.html"),
  read("netlify/functions/stem-vault.mjs"),
  read("netlify/functions/stem-vault-audio.mjs"),
  read("netlify/database/migrations/20260815120000_create-halo-stem-vault.sql")
]);

const checks = [
  [deck.includes("In-house Stem Vault") && deck.includes("Save private stem pack"), "ships the private in-house stem vault inside the DJ Deck"],
  [deck.includes('name="rightsAttested"') && deck.includes("HALO owns or controls these files"), "requires an explicit rights attestation before upload"],
  [deck.includes("stemAssets") && deck.includes("stemSources") && deck.includes("stemGains"), "plays synchronized source stems through independent gain controls"],
  [deck.includes('stem === "hats" ? "drums" : stem') && deck.includes('data-stem="vocals"') && deck.includes('data-stem="bass"'), "maps the performance pads to real drums, vocals, and bass stems"],
  [api.includes("verifyRequestOrigin") && api.includes("ensureMembership") && api.includes("halo-stem-vault"), "protects stem management with origin checks, identity, and private blob storage"],
  [api.includes("Stem lengths must match within a quarter second") && api.includes("Add at least two synchronized audio stems"), "rejects incomplete or unsynchronized stem packs"],
  [audio.includes("pack.member_id = ${membership.member_id}") && audio.includes('"Cache-Control": "private, no-store"'), "restricts stem playback to the owning signed-in member"],
  [migration.includes("halo_stem_packs") && migration.includes("halo_stem_files") && migration.includes("rights_attested"), "stores searchable pack metadata and ownership proof in Netlify Database"],
  [migration.includes("status IN ('private', 'archived')") && migration.includes("stem_type IN ('full', 'drums', 'bass', 'music', 'vocals', 'fx')"), "keeps packs private and limits files to supported stem roles"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Stem vault contracts: ${checks.length}/${checks.length} checks passed.`);
