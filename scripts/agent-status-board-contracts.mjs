import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const board = await readFile(new URL("../HALO_AGENT_STATUS_BOARD.md", import.meta.url), "utf8");
const teamDoc = await readFile(new URL("../HALO_AGENT_TEAM.md", import.meta.url), "utf8");
const operatingModel = await readFile(new URL("../HALO_SITE_AI_OPERATING_MODEL.md", import.meta.url), "utf8");
const committeeWorkflow = await readFile(new URL("../HALO_AI_COMMITTEE_WORKFLOW.md", import.meta.url), "utf8");
const pullRequestTemplate = await readFile(new URL("../.github/pull_request_template.md", import.meta.url), "utf8");
const liveBoard = board.split("## Live board")[1] || "";
const exampleTeams = ["Music Agent", "Stripe / Payments Agent", "Supporter Experience Agent", "Monitoring / QA Agent", "Insights / Data Agent"];
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const exampleTeam of exampleTeams) {
  const teamSection = liveBoard.match(new RegExp(`### ${escapeRegExp(exampleTeam)}([\\s\\S]*?)(?=\\n### |$)`))?.[1] || "";
  assert.ok(teamSection, `status board must include ${exampleTeam} example entry`);

  for (const field of ["Focus", "Done", "Watching", "Impact", "Next"]) {
    assert.match(teamSection, new RegExp(`- ${field}:`), `${exampleTeam} must include ${field}`);
  }

  assert.match(teamSection, /- Change log:\r?\n\s*-\s*\d{4}-\d{2}-\d{2}:/, `${exampleTeam} must include a change log with a dated entry`);
}

assert.match(board, /protects both the artist and the fan/i, "status board must state artist and fan protection");
assert.match(board, /do not exploit/i, "status board must reject exploitation");
assert.match(board, /use behavior and engagement data to improve/i, "status board must define ethical data use");
assert.match(board, /artist-owned music and software ecosystem/i, "status board must preserve HALO brand positioning");
assert.match(board, /fans become supporters, supporters are rewarded/i, "status board must preserve supporter reward positioning");

assert.match(teamDoc, /HALO_AGENT_STATUS_BOARD\.md/, "agent council handbook must point to the status board");
assert.match(operatingModel, /HALO_AGENT_STATUS_BOARD\.md/, "operating model handbook must point to the status board");
assert.match(teamDoc, /HALO_AI_COMMITTEE_WORKFLOW\.md/, "agent council handbook must point to the AI committee workflow");
assert.match(operatingModel, /HALO_AI_COMMITTEE_WORKFLOW\.md/, "operating model handbook must point to the AI committee workflow");
assert.match(teamDoc, /\.github\/pull_request_template\.md/, "agent council handbook must require the committee PR template");
assert.match(operatingModel, /\.github\/pull_request_template\.md/, "operating model handbook must require the committee PR template");

assert.match(committeeWorkflow, /## Purpose/, "committee workflow must define purpose");
assert.match(committeeWorkflow, /### Builder/, "committee workflow must define the Builder role");
assert.match(committeeWorkflow, /### Verifier/, "committee workflow must define the Verifier role");
assert.match(committeeWorkflow, /### Committee/, "committee workflow must define the Committee role");
assert.match(committeeWorkflow, /## Verification rules/, "committee workflow must define verification rules");
assert.match(committeeWorkflow, /\*\*Accept:?/, "committee workflow must define Accept outcome");
assert.match(committeeWorkflow, /\*\*Accept with caveat:?/, "committee workflow must define Accept with caveat outcome");
assert.match(committeeWorkflow, /\*\*Send back:?/, "committee workflow must define Send back outcome");
assert.match(committeeWorkflow, /\*\*Reject:?/, "committee workflow must define Reject outcome");
assert.match(committeeWorkflow, /evidence over claims/i, "committee workflow must preserve evidence-first skepticism");
assert.match(committeeWorkflow, /live-state checks over code-only claims/i, "committee workflow must prefer live-state verification");
assert.match(committeeWorkflow, /\.github\/pull_request_template\.md/, "committee workflow must define PR template handoff");

assert.match(pullRequestTemplate, /^# Summary/m, "PR template must include a Summary section");
assert.match(pullRequestTemplate, /^## Builder evidence/m, "PR template must include Builder evidence section");
assert.match(pullRequestTemplate, /^## Verifier findings/m, "PR template must include Verifier findings section");
assert.match(pullRequestTemplate, /^## Committee decision/m, "PR template must include Committee decision section");
assert.match(pullRequestTemplate, /^## Verification checklist/m, "PR template must include verification checklist section");
assert.match(pullRequestTemplate, /^## Remaining risks/m, "PR template must include remaining risks section");
assert.match(pullRequestTemplate, /evidence over claims/i, "PR template must preserve evidence-first language");
assert.match(pullRequestTemplate, /no acceptance without Builder evidence and Verifier evidence/i, "PR template must require builder and verifier proof before acceptance");
assert.match(pullRequestTemplate, /live-state checks/i, "PR template must require live-state checks for user-facing claims when possible");

console.log("HALO agent status board contracts passed.");
