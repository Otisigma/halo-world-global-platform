import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, api, page, client, home, community, packageJson] = await Promise.all([
  readFile(new URL("../netlify/database/migrations/20260807200000_create-sovereign-ambassadors.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/ambassadors.mjs", import.meta.url), "utf8"),
  readFile(new URL("../ambassadors/index.html", import.meta.url), "utf8"),
  readFile(new URL("../ambassadors/ambassadors.js", import.meta.url), "utf8"),
  readFile(new URL("../halo.html", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/community.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

for (const table of [
  "sovereign_ambassador_applications",
  "sovereign_ambassador_nominations",
  "sovereign_ambassador_grants",
  "sovereign_ambassador_events"
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must be created by the roll-forward migration`);
}

assert.match(migration, /CHECK \(status IN \('submitted', 'under_review', 'approved', 'declined', 'withdrawn'\)\)/, "application statuses must be constrained");
assert.match(migration, /'ambassador'/, "community notifications must support Ambassador events");

assert.match(api, /getUser/, "Ambassador API must read Netlify Identity sessions");
assert.match(api, /verifyRequestOrigin/, "Ambassador mutations must verify request origin");
assert.match(api, /ambassador-council/, "Council access must use an explicit Identity role");
assert.match(api, /Council members cannot review their own applications/, "Council members must not self-approve");
assert.match(api, /path: "\/api\/ambassadors"/, "Ambassador API must expose the expected route");

for (const action of ["apply", "withdraw", "nominate", "dismiss_nomination", "review", "revoke"]) {
  assert.match(api, new RegExp(`action === "${action}"`), `${action} action must be implemented`);
}

assert.match(page, /SOVEREIGN<br><em>AMBASSADORS<\/em>/, "Ambassador page must present the role");
assert.match(page, /id="memberWorkspace"/, "Ambassador page must include the member workspace");
assert.match(page, /id="councilSection"/, "Ambassador page must include the restricted council workspace");
assert.match(page, /\/identity\.js/, "Ambassador page must use the shared Netlify Identity client");
assert.match(client, /\/api\/ambassadors/, "Ambassador client must call the protected API");
assert.match(client, /applicationForm/, "Ambassador client must render applications");
assert.match(client, /nominationForm/, "Ambassador client must render nominations");
assert.match(client, /data-review/, "Ambassador client must expose council decisions");
assert.match(home, /href="\/ambassadors\/"/, "HALO Movement must link to the Ambassador path");
assert.match(community, /Sovereign Ambassador/, "Community profiles must surface active Ambassador grants");

const parsedPackage = JSON.parse(packageJson);
assert.match(parsedPackage.scripts.test, /ambassador-contracts\.mjs/, "Ambassador contracts must run in the test suite");

console.log("Sovereign Ambassador contracts passed.");
