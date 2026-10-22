import assert from "node:assert/strict";
import { MUSIC_SAFETY_STAGES, planMusicSafetyTransition } from "../netlify/lib/music-safety-contract.mjs";

const now = "2026-10-15T12:00:00.000Z";
const record = {
  id: "music-incident-1", revision: 4, state: "detected", severity: "high",
  owner: "ingestion-on-call", dueAt: "2026-10-15T12:15:00.000Z",
  proposalDigest: "a".repeat(64),
  plan: { rollbackRef: "runbook:restore-v1", verificationRef: "test:checksum-and-rights", mode: "shadow" }
};
const proof = actorId => ({
  actorId, evidenceRef: `evidence:${actorId}-report`, proposalDigest: record.proposalDigest,
  passed: true, checkedAt: "2026-10-15T11:00:00.000Z", expiresAt: "2026-10-15T13:00:00.000Z"
});
const checks = {
  frozen: false, simulation: proof("simulator"), compatibility: proof("schema-checker"),
  rollback: proof("recovery-tester"), safety: proof("safety-arbiter"), human: proof("release-manager"),
  votes: ["domain-rules", "adversarial-model", "replay-validator"].map(actorId => ({
    ...proof(actorId), validationPath: actorId
  })),
  auditReady: proof("audit-store"), limitedHealth: proof("runtime-monitor"),
  verification: proof("independent-verifier"), expandedHealth: proof("runtime-monitor"),
  reconciliation: proof("catalog-reconciler")
};
const input = (state = "reviewed", to = "limited") => ({
  record: { ...structuredClone(record), state }, to, expectedRevision: 4,
  actorId: "orchestrator", requestId: "request-1", now, checks: structuredClone(checks)
});
const denied = (value, reason) => {
  const result = planMusicSafetyTransition(value);
  assert.equal(result.ok, false, reason);
  assert.ok(result.errors.length > 0);
  assert.equal(result.auditIntent, undefined, "Rejected requests cannot produce transition intents");
};

for (let i = 1; i < MUSIC_SAFETY_STAGES.length; i += 1) {
  const value = input(MUSIC_SAFETY_STAGES[i - 1], MUSIC_SAFETY_STAGES[i]);
  const before = structuredClone(value);
  const result = planMusicSafetyTransition(value);
  assert.equal(result.ok, true, `${value.record.state} -> ${value.to}`);
  assert.equal(result.auditIntent.nextRevision, 5);
  assert.equal(result.auditIntent.proposalDigest, record.proposalDigest);
  assert.ok(result.auditIntent.evidenceRefs.includes(checks.auditReady.evidenceRef));
  assert.deepEqual(value, before, "Planning must not mutate authoritative inputs");
}
denied(undefined, "Missing inputs fail closed");
denied(null, "Null inputs fail closed");
const noChecks = input();
noChecks.checks = null;
denied(noChecks, "Null checks fail closed");
for (const [state, to] of [["planned", "limited"], ["verified", "planned"], ["closed", "closed"], ["unknown", "detected"], ["expanded", "unknown"]]) {
  denied(input(state, to), "Skipped, backward and unknown transitions fail closed");
}
for (const [key, value] of [["owner", ""], ["dueAt", "invalid"], ["severity", "urgent"], ["proposalDigest", ""], ["revision", -1]]) {
  const request = input();
  request.record[key] = value;
  denied(request, `Invalid ${key}`);
}
for (const key of ["actorId", "requestId", "now"]) {
  const request = input();
  request[key] = "";
  denied(request, `Missing ${key}`);
}
const stale = input();
stale.expectedRevision = 3;
denied(stale, "Stale revision");
for (const key of ["rollbackRef", "verificationRef", "mode"]) {
  const request = input("assigned", "planned");
  delete request.record.plan[key];
  denied(request, `Missing plan ${key}`);
}
for (const key of ["simulation", "compatibility", "rollback", "safety", "human", "auditReady"]) {
  const request = input();
  delete request.checks[key];
  denied(request, `Missing ${key}`);
}
for (const key of ["limitedHealth", "verification"]) {
  const request = input("limited", "verified");
  delete request.checks[key];
  denied(request, `Cannot verify without ${key}`);
}
for (const key of ["expandedHealth", "reconciliation"]) {
  const request = input("expanded", "closed");
  delete request.checks[key];
  denied(request, `Cannot close without ${key}`);
}
for (const [key, value] of [
  ["passed", false], ["evidenceRef", ""], ["proposalDigest", "b".repeat(64)],
  ["checkedAt", "2026-10-15T12:01:00.000Z"], ["expiresAt", now]
]) {
  const request = input();
  request.checks.safety[key] = value;
  denied(request, `Invalid or stale evidence: ${key}`);
}
for (const frozen of [true, undefined]) {
  const request = input();
  request.checks.frozen = frozen;
  denied(request, "Freeze or unavailable freeze status blocks rollout");
}
for (const duplicate of ["actorId", "validationPath"]) {
  const request = input();
  request.checks.votes[1][duplicate] = request.checks.votes[0][duplicate];
  denied(request, `Duplicate council ${duplicate}`);
}
const dissent = input();
dissent.checks.votes[2].passed = false;
denied(dissent, "A majority cannot suppress unresolved dissent");
const quorumLoss = input();
quorumLoss.checks.votes.pop();
denied(quorumLoss, "Unavailable reviewer blocks progression");
for (const key of ["safety", "human"]) {
  const request = input();
  request.checks[key].actorId = request.checks.votes[0].actorId;
  denied(request, `${key} must be independent`);
}
for (const role of ["council", "arbiter"]) {
  const request = input();
  if (role === "council") request.checks.votes[0].actorId = record.owner;
  else request.checks.safety.actorId = record.owner;
  denied(request, `Owner cannot act as ${role}`);
}
const noDetectionAudit = input("detected", "classified");
delete noDetectionAudit.checks.auditReady;
denied(noDetectionAudit, "Even early lifecycle transitions require audit readiness");
const selfVerified = input("expanded", "closed");
selfVerified.checks.verification.actorId = record.owner;
denied(selfVerified, "Owner cannot self-verify closure");
for (const severity of ["critical", "high"]) {
  const request = input();
  request.record.severity = severity;
  delete request.checks.human;
  denied(request, `${severity} requires human approval`);
}
const lowRisk = input();
lowRisk.record.severity = "low";
delete lowRisk.checks.human;
assert.equal(planMusicSafetyTransition(lowRisk).ok, true, "Low-risk changes still require council and arbiter, not mandatory human approval");
console.log("Music safety transition contracts passed.");
