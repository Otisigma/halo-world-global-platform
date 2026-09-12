function cleanText(value, maximum) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

export function normalizeVerificationMetadata(value, fallback = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const checkIds = Array.isArray(value.checkIds)
    ? value.checkIds.map(item => cleanText(item, 120)).filter(Boolean).slice(0, 8)
    : [];
  const checkedAtValue = value.checkedAt || fallback.checkedAt || new Date().toISOString();
  const checkedAt = Number.isNaN(Date.parse(checkedAtValue)) ? null : new Date(checkedAtValue).toISOString();
  const verification = {
    command: cleanText(value.command || fallback.command, 240),
    checkIds,
    resultSummary: cleanText(value.resultSummary || fallback.resultSummary, 1200),
    confidence: (() => {
      const numeric = Number(value.confidence ?? fallback.confidence ?? 0.5);
      const safe = Number.isFinite(numeric) ? numeric : 0.5;
      return Math.max(0, Math.min(1, safe));
    })(),
    checkedAt,
    source: cleanText(value.source || fallback.source, 80)
  };
  if (!verification.command || !verification.resultSummary || !verification.checkedAt) return null;
  return verification;
}
