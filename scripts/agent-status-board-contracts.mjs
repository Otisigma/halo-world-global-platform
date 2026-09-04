import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const board = await readFile(new URL("../HALO_AGENT_STATUS_BOARD.md", import.meta.url), "utf8");
const teamDoc = await readFile(new URL("../HALO_AGENT_TEAM.md", import.meta.url), "utf8");
const operatingModel = await readFile(new URL("../HALO_SITE_AI_OPERATING_MODEL.md", import.meta.url), "utf8");

for (const field of ["Focus", "Done", "Watching", "Impact", "Next"]) {
  assert.match(board, new RegExp(`\\*\\*${field}\\*\\*`), `status board must include ${field} updates`);
}

assert.match(board, /Change log/, "status board must track dated changes over time");
assert.match(board, /protects both the artist and the fan/i, "status board must state artist and fan protection");
assert.match(board, /do not exploit/i, "status board must reject exploitation");
assert.match(board, /use behavior and engagement data to improve/i, "status board must define ethical data use");
assert.match(board, /artist-owned music and software ecosystem/i, "status board must preserve HALO brand positioning");
assert.match(board, /fans become supporters, supporters are rewarded/i, "status board must preserve supporter reward positioning");

for (const exampleTeam of ["Music Agent", "Stripe / Payments Agent", "Supporter Experience Agent", "Monitoring / QA Agent", "Insights / Data Agent"]) {
  assert.ok(board.includes(exampleTeam), `status board must include ${exampleTeam} example entry`);
}

assert.match(teamDoc, /HALO_AGENT_STATUS_BOARD\.md/, "agent council handbook must point to the status board");
assert.match(operatingModel, /HALO_AGENT_STATUS_BOARD\.md/, "operating model handbook must point to the status board");

console.log("HALO agent status board contracts passed.");
