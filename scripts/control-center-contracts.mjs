import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [migration, library, api, page, client, styles, config, docs, world] = await Promise.all([
  readFile(new URL("../netlify/database/migrations/20260813160000_create-halo-control-center.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/lib/control-center.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/halo-control-center.mjs", import.meta.url), "utf8"),
  readFile(new URL("../halo-command.html", import.meta.url), "utf8"),
  readFile(new URL("../halo-command.js", import.meta.url), "utf8"),
  readFile(new URL("../halo-command.css", import.meta.url), "utf8"),
  readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
  readFile(new URL("../HALO_AGENT_TEAM.md", import.meta.url), "utf8"),
  readFile(new URL("../halo.html", import.meta.url), "utf8")
]);

assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_agent_commands/, "owner commands must persist in Netlify Database");
assert.match(migration, /source_command_id/, "command proposals must link to the existing action queue");
assert.match(migration, /ALTER COLUMN run_id DROP NOT NULL/, "direct owner commands must create actions without inventing a council run");

assert.match(library, /new OpenAI\(\{ maxRetries: 0 \}\)/, "optional paid command responses use the gateway client without automatic retries");
assert.match(library, /AGENT_MODEL/, "command responses must use the council's supported model");
assert.match(library, /needs_approval|TRUE/, "command-created work must preserve human approval");
assert.match(library, /fallbackReply/, "the owner channel must retain a deterministic fallback");
assert.doesNotMatch(library, /process\.env/, "control center code must not read secrets through process.env");

assert.match(api, /getUser/, "the control center API must require a Netlify Identity session");
assert.match(api, /isOwner/, "the control center API must require owner authority");
assert.match(api, /verifyRequestOrigin/, "control center mutations must verify request origin");
assert.match(api, /path: "\/api\/halo-control-center"/, "the control center must expose its protected API route");
assert.match(api, /request\.method === "HEAD"/, "the world menu must verify owner access without loading private control data");

assert.match(page, /id="commandForm"/, "the owner must have a direct team command form");
assert.match(page, /id="activityFeed"/, "the page must expose a unified operations feed");
assert.match(page, /Route useful work into approval queue/, "the command form must make the approval route explicit");
assert.match(client, /45_000/, "the private page must refresh its live pulse while visible");
assert.match(client, /halo-control-center/, "the browser must use the protected control center API");
assert.match(styles, /\.control-deck/, "the control room must have a dedicated responsive cockpit layout");
assert.match(config, /from = "\/control-center"[\s\S]*to = "\/halo-command\.html"/, "the private control center needs a memorable route");
assert.match(docs, /Private control center/, "the owner command workflow must be documented");
const buildLane = world.match(/<section className="halo-menu-lane halo-menu-lane-build"[\s\S]*?<\/section>/)?.[0] || "";
const worldOutsideBuildLane = world.replace(buildLane, "");

assert.match(buildLane, /ownerControlAccess &&[\s\S]*href="\/control-center"/, "the Choose Your Signal build lane must hide the control room unless owner access is verified");
assert.doesNotMatch(worldOutsideBuildLane, /href="\/control-center"/, "the private control room must appear only in the Choose Your Signal build lane");
assert.match(buildLane, /\{ownerControlAccess && \(\s*<a href="\/control-center"[^>]*>[\s\S]*?<strong>CONTROL CENTER [\s\S]*?<\/a>\s*\)\}/, "the labeled Control Center entry must remain inside the verified owner guard");
assert.match(world, /const \[ownerControlAccess, setOwnerControlAccess\] = useState\(false\)/, "owner access must not default to authorized");

const ownerAccessEffect = world.match(/useEffect\(\(\) => \{\n\s*let active = true;\n\s*setOwnerControlAccess\(false\);([\s\S]*?)\n\s*\}, \[identityUser\?\.id\]\);/)?.[0];
assert.ok(ownerAccessEffect, "owner access must be reverified when the identity changes");
for (const [identityUser, status, expectedAccess, reject, cancel] of [
  [null, 204, false],
  [{ id: "member" }, 401, false],
  [{ id: "member" }, 403, false],
  [{ id: "owner" }, 200, false],
  [{ id: "owner" }, 204, true],
  [{ id: "owner" }, 204, false, true],
  [{ id: "owner" }, 204, false, false, true]
]) {
  let access = true;
  let requests = 0;
  let cleanup;
  vm.runInNewContext(ownerAccessEffect, {
    identityUser,
    useEffect(effect) { cleanup = effect(); },
    setOwnerControlAccess(value) { access = value; },
    fetch(route, options) {
      requests++;
      assert.equal(route, "/api/halo-control-center");
      assert.equal(options.method, "HEAD");
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.cache, "no-store");
      return reject ? Promise.reject(new Error("offline")) : Promise.resolve({ status });
    }
  });
  assert.equal(access, false, "owner access must reset before verification");
  if (cancel) cleanup();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, identityUser ? 1 : 0, "anonymous users must not request owner access");
  assert.equal(access, expectedAccess, "only an active, server-verified owner session may reveal Control Center");
  cleanup();
}

await import("./owner-signups-contracts.mjs");
await import("./owner-member-activity-contracts.mjs");
console.log("HALO Control Center contracts passed.");
