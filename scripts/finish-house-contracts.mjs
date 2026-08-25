import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, client, api, migration, releaseHouse, home] = await Promise.all([
  read("finish-house/index.html"),
  read("finish-house/finish-house.js"),
  read("netlify/functions/finish-house.mjs"),
  read("netlify/database/migrations/20260815180000_create-finish-house.sql"),
  read("release-house/index.html"),
  read("halo.html")
]);

const checks = [
  [page.includes("From mix") && page.includes("Mastering finish line") && page.includes("Licensing launchpad"), "ships a complete mix-to-master-to-market workspace"],
  [page.includes("Master ownership") && page.includes("Writer + producer splits") && page.includes("Samples cleared"), "makes ownership and clearance visible before a pitch"],
  [page.includes("Streaming master") && page.includes("Instrumental") && page.includes("Clean version"), "organises the alternate audio versions licensing teams commonly need"],
  [client.includes("HALO FINISH HOUSE — LICENSING BRIEF") && client.includes("DISCO is an independent third-party"), "creates a portable brief without promising external placement"],
  [api.includes("verifyRequestOrigin") && api.includes("ensureMembership") && api.includes('path: "/api/finish-house"'), "protects private finish projects with identity and origin checks"],
  [api.includes("owner_member_id = ${membership.member_id}") && api.includes("release_project_id"), "keeps every project private and connects it to its owning release"],
  [api.includes("Approve the master, confirm every clearance item") && api.includes('masteringStatus !== "brief" && !masteringBrief.mixUrl'), "prevents incomplete mastering and licensing states from being presented as ready"],
  [migration.includes("halo_finish_house_projects") && migration.includes("licensing_checklist") && migration.includes("requested_deliverables"), "stores mastering and licensing progress in Netlify Database"],
  [migration.includes("status IN ('active', 'archived')") && migration.includes("licensing_destination IN"), "constrains finish projects to supported lifecycle and destination states"],
  [releaseHouse.includes('href="/finish-house/"') && home.includes("FINISH HOUSE"), "connects Finish House from Release House and the main HALO navigation"]
];

const failures = checks.filter(([passed]) => !passed);
for (const [passed, description] of checks) console.log(`${passed ? "PASS" : "FAIL"}: ${description}`);
if (failures.length) process.exitCode = 1;
else console.log(`Finish House contracts: ${checks.length}/${checks.length} checks passed.`);
