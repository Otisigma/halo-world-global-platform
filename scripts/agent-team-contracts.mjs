import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, knowledgeMigration, library, api, scheduled, page, client, docs, radioRunbook, packageJson] = await Promise.all([
  readFile(new URL("../netlify/database/migrations/20260808160000_create-halo-agent-team.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/database/migrations/20260811170000_create-agent-incident-knowledge.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/lib/agent-team.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/halo-agent-team.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/halo-agent-daily.mjs", import.meta.url), "utf8"),
  readFile(new URL("../halo-command.html", import.meta.url), "utf8"),
  readFile(new URL("../halo-command.js", import.meta.url), "utf8"),
  readFile(new URL("../HALO_AGENT_TEAM.md", import.meta.url), "utf8"),
  readFile(new URL("../HALO_RADIO_VIDEO_PLAYBACK_RUNBOOK.md", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

for (const table of ["halo_agent_runs", "halo_agent_findings", "halo_agent_actions", "halo_agent_memory"]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must be created by a roll-forward migration`);
}

for (const agent of ["atlas", "pulse", "bridge", "hearth", "sentinel", "mirror"]) {
  assert.match(migration, new RegExp(`'${agent}'`), `${agent} must have constrained persistent memory`);
}

assert.match(knowledgeMigration, /CREATE TABLE IF NOT EXISTS halo_agent_knowledge/, "the council must have searchable incident knowledge");
assert.match(knowledgeMigration, /radio-video-recovery-2026-08-11/, "the successful radio recovery must be stored as council knowledge");

assert.match(library, /gpt-5\.4-mini/, "the council must use an AI Gateway-supported model");
assert.doesNotMatch(library, /process\.env/, "new agent code must read function environment through Netlify.env");
assert.match(library, /needsApproval/, "agent priorities must preserve a human approval gate");
assert.match(library, /actual_outcome/, "the council must learn from recorded outcomes");
assert.match(library, /fallbackSpecialist/, "specialists must retain a deterministic fallback");
assert.match(library, /fallbackSynthesis/, "Mirror must retain a deterministic fallback");
assert.match(library, /HALO_AGENT_REPORT_WEBHOOK_URL/, "daily report delivery must use the documented webhook configuration");
assert.match(library, /operationalKnowledge/, "specialists and Mirror must receive persistent operational knowledge");
assert.match(library, /recentIssues/, "the council must receive actionable maintenance issue evidence");
assert.match(library, /Restore Halo Radio from the verified playback path/, "the fallback council must know the radio recovery sequence");

assert.match(api, /getUser/, "the council API must read Netlify Identity sessions");
assert.match(api, /isOwner/, "the council API must require owner authority");
assert.match(api, /verifyRequestOrigin/, "council mutations must verify request origin");
assert.match(api, /canRunManualCouncil/, "manual council runs must be rate limited");
assert.match(api, /path: "\/api\/halo-agent-team"/, "the council API must expose the expected route");
assert.match(scheduled, /schedule: "30 7 \* \* \*"/, "the council must run daily at 07:30 UTC");

assert.match(page, /Distinct eyes\. Shared evidence\./, "the dashboard must present the specialist council");
assert.match(page, /Nothing moves without approval\./, "the dashboard must communicate human authority");
assert.match(page, /id="actionQueue"/, "the dashboard must expose the owner decision queue");
assert.match(client, /update_action/, "the client must record owner decisions and outcomes");
assert.match(client, /action: "run"/, "the client must support an owner-triggered council run");
assert.match(docs, /cannot initiate a new ChatGPT conversation/, "daily delivery limitations must be explicit");
assert.match(radioRunbook, /mutually exclusive/, "the radio runbook must preserve one active audio source");
assert.match(radioRunbook, /public HTTPS HLS URL/, "the runbook must document the AzuraCast stream fix");

const parsedPackage = JSON.parse(packageJson);
assert.match(parsedPackage.scripts.test, /agent-team-contracts\.mjs/, "agent council contracts must run in the test suite");

console.log("HALO Agent Council contracts passed.");
