import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const board = await readFile(new URL("../HALO_AGENT_STATUS_BOARD.md", import.meta.url), "utf8");
const teamDoc = await readFile(new URL("../HALO_AGENT_TEAM.md", import.meta.url), "utf8");
const operatingModel = await readFile(new URL("../HALO_SITE_AI_OPERATING_MODEL.md", import.meta.url), "utf8");
const liveBoard = board.split("## Live board")[1] || "";
const exampleTeams = ["Music Agent", "Stripe / Payments Agent", "Supporter Experience Agent", "Monitoring / QA Agent", "Insights / Data Agent"];
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const exampleTeam of exampleTeams) {
  const teamSection = liveBoard.match(new RegExp(`### ${escapeRegExp(exampleTeam)}([\\s\\S]*?)(?=\\n### |$)`))?.[1] || "";
  assert.ok(teamSection, `status board must include ${exampleTeam} example entry`);

  for (const field of ["Focus", "Done", "Watching", "Impact", "Next"]) {
    assert.match(teamSection, new RegExp(`- ${field}:`), `${exampleTeam} must include ${field}`);
  }

  assert.match(teamSection, /- Change log:/, `${exampleTeam} must include a change log`);
  assert.match(teamSection, /\n\s*-\s*\d{4}-\d{2}-\d{2}:/, `${exampleTeam} must include at least one dated change entry`);
}

assert.match(board, /protects both the artist and the fan/i, "status board must state artist and fan protection");
assert.match(board, /do not exploit/i, "status board must reject exploitation");
assert.match(board, /use behavior and engagement data to improve/i, "status board must define ethical data use");
assert.match(board, /artist-owned music and software ecosystem/i, "status board must preserve HALO brand positioning");
assert.match(board, /fans become supporters, supporters are rewarded/i, "status board must preserve supporter reward positioning");

assert.match(teamDoc, /HALO_AGENT_STATUS_BOARD\.md/, "agent council handbook must point to the status board");
assert.match(operatingModel, /HALO_AGENT_STATUS_BOARD\.md/, "operating model handbook must point to the status board");

console.log("HALO agent status board contracts passed.");
