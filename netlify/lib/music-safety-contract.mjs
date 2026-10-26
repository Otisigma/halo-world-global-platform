// Offline policy contract only: callers must authenticate attestations and atomically persist audit + state.
export const MUSIC_SAFETY_STAGES = Object.freeze([
  "detected", "classified", "assigned", "planned", "simulated",
  "reviewed", "limited", "verified", "expanded", "closed"
]);

const SEVERITIES = ["critical", "high", "medium", "low"];
const text = value => typeof value === "string" && value.trim().length > 0;
const timestamp = value => typeof value === "string" && Number.isFinite(Date.parse(value));

/**
 * Plan one forward transition from a trusted server snapshot; never deploys or writes state.
 * proposalDigest binds the immutable issue, artifact, policy, environment, scope and recovery plan.
 * checks are authenticated, independently collected attestations, NOT client-supplied booleans.
 */
export function planMusicSafetyTransition(input = {}) {
  const { record, to, expectedRevision, actorId, requestId, now } = input ?? {};
  const checks = input?.checks ?? {};
  const errors = [];
  const evidenceRefs = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const stage = MUSIC_SAFETY_STAGES.indexOf(to);
  const current = MUSIC_SAFETY_STAGES.indexOf(record?.state);
  require(current >= 0 && stage === current + 1 && stage < MUSIC_SAFETY_STAGES.length, "Transition must advance exactly one lifecycle stage.");
  require(Number.isSafeInteger(record?.revision) && record.revision >= 0 && record.revision < Number.MAX_SAFE_INTEGER
    && record.revision === expectedRevision, "Expected revision must match the authoritative record.");
  require(text(record?.id) && text(actorId) && text(requestId) && timestamp(now), "Issue, actor, request and timestamp are required.");
  require(SEVERITIES.includes(record?.severity), "Severity must be explicitly classified.");
  require(text(record?.owner) && timestamp(record?.dueAt), "An accountable owner and deadline are required.");
  require(typeof record?.proposalDigest === "string" && /^[a-f0-9]{64}$/.test(record.proposalDigest), "An immutable proposal SHA-256 digest is required.");

  const proof = (value, label) => {
    const valid = value?.passed === true && text(value?.actorId) && text(value?.evidenceRef)
      && value?.proposalDigest === record?.proposalDigest
      && timestamp(value?.checkedAt) && timestamp(value?.expiresAt) && timestamp(now)
      && Date.parse(value.checkedAt) <= Date.parse(now) && Date.parse(value.expiresAt) > Date.parse(now);
    require(valid, `${label} requires current, proposal-bound evidence.`);
    if (valid) evidenceRefs.push(value.evidenceRef);
    return valid;
  };
  proof(checks.auditReady, "Durable audit readiness");

  if (stage >= 3) {
    require(text(record?.plan?.rollbackRef) && text(record?.plan?.verificationRef), "Plan requires rollback and verification procedures.");
    require(["shadow", "canary"].includes(record?.plan?.mode), "Limited rollout must use shadow or canary mode.");
  }
  if (stage >= 4) {
    proof(checks.simulation, "Simulation");
    proof(checks.compatibility, "Mixed-version compatibility");
    proof(checks.rollback, "Rollback rehearsal");
  }
  if (stage >= 5) {
    const votes = Array.isArray(checks.votes) ? checks.votes : [];
    // Fixed three-seat council: duplicate identities or strategies cannot manufacture quorum.
    require(votes.length === 3 && votes.every(vote => text(vote?.actorId) && text(vote?.validationPath))
      && new Set(votes.map(vote => vote?.actorId)).size === 3
      && new Set(votes.map(vote => vote?.validationPath)).size === 3,
    "Council requires three distinct identities and validation paths.");
    for (const vote of votes) proof(vote, "Council vote");
    require(votes.every(vote => vote?.passed === true), "Unresolved dissent blocks progression.");
    require(!votes.some(vote => vote?.actorId === record?.owner), "Fix owner cannot occupy a council seat.");
    proof(checks.safety, "Independent safety arbiter");
    require(checks.safety?.actorId !== record?.owner
      && !votes.some(vote => vote?.actorId === checks.safety?.actorId), "Arbiter must be independent of owner and council seats.");
    if (["critical", "high"].includes(record?.severity)) {
      proof(checks.human, "High-risk human approval");
      require(checks.human?.actorId !== checks.safety?.actorId
        && !votes.some(vote => vote?.actorId === checks.human?.actorId), "Human approver must be independent of automated reviewers.");
    }
  }
  if (stage >= 6) {
    require(checks.frozen === false, "Rollouts require an explicitly unfrozen control plane.");
  }
  if (stage >= 7) {
    proof(checks.limitedHealth, "Limited-rollout health");
    proof(checks.verification, "Independent verification");
    require(checks.verification?.actorId !== record?.owner, "Fix owner cannot be the independent verifier.");
  }
  if (stage >= 9) {
    proof(checks.expandedHealth, "Expanded-rollout observation");
    proof(checks.reconciliation, "Catalog, rights and replica reconciliation");
  }
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    auditIntent: {
      schemaVersion: 1, requestId, issueId: record.id, actorId, at: now,
      proposalDigest: record.proposalDigest, from: record.state, to,
      expectedRevision, nextRevision: expectedRevision + 1,
      evidenceRefs: [...new Set(evidenceRefs)]
    }
  };
}
