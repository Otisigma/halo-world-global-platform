import { normalizeVerificationMetadata } from "./verification-metadata.mjs";

const updateStatuses = new Set(["acknowledged", "in_progress", "healed", "failed", "ignored"]);

function cleanText(value, maximum) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

export function validateMaintenancePatchPayload(payload = {}) {
  const status = cleanText(payload.status, 24);
  if (!updateStatuses.has(status)) {
    return { ok: false, status, message: "Unsupported maintenance status" };
  }
  const verification = normalizeVerificationMetadata(payload.verification, {
    source: "maintenance_worker"
  });
  const verificationUnavailableReason = cleanText(payload.verificationUnavailableReason, 400);
  if (status === "healed" && !verification && !verificationUnavailableReason) {
    return {
      ok: false,
      status,
      verification,
      verificationUnavailableReason,
      message: "Healed updates require structured verification metadata or a verificationUnavailableReason"
    };
  }
  return { ok: true, status, verification, verificationUnavailableReason };
}

export { cleanText, updateStatuses };
