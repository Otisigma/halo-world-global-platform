import assert from "node:assert/strict";
import { validateMaintenancePatchPayload } from "../netlify/lib/maintenance-issues-validation.mjs";

const healedWithVerification = validateMaintenancePatchPayload({
  status: "healed",
  verification: {
    command: "halo-signal-check",
    checkIds: ["maintenance:demo"],
    resultSummary: "Synthetic maintenance check passed.",
    confidence: 0.9,
    checkedAt: "2026-01-01T00:00:00.000Z"
  }
});
assert.equal(healedWithVerification.ok, true, "healed updates must accept structured verification metadata");

const healedWithReason = validateMaintenancePatchPayload({
  status: "healed",
  verificationUnavailableReason: "Third-party verification endpoint was unavailable."
});
assert.equal(healedWithReason.ok, true, "healed updates must allow explicit unverified-heal reasons");

const healedWithoutEvidence = validateMaintenancePatchPayload({ status: "healed" });
assert.equal(healedWithoutEvidence.ok, false, "healed updates must reject payloads without verification evidence");
assert.match(healedWithoutEvidence.message, /verification/i, "rejection must explain verification requirements");

console.log("Maintenance issues contracts passed.");
