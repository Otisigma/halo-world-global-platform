const FIELDS = ["intent", "requestedApproach", "expectedBehavior", "affectedSurface", "acceptanceCriteria", "constraints"];
export const APPROVAL_BOUNDARIES = Object.freeze([
  "deployment", "production data mutation", "credentials changes", "paid calls",
  "destructive actions", "approach substitution"
]);

export function parseRequest(input) {
  if (typeof input === "string") input = { originalRequest: input };
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Request must be text or an object");
  const result = {};
  for (const key of ["originalRequest", ...FIELDS]) {
    const value = input[key] ?? "";
    if (typeof value !== "string" || value.length > 3000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
      throw new Error(`Invalid ${key}`);
    }
    result[key] = value;
  }
  if (!result.originalRequest.trim() && !result.intent.trim()) throw new Error("Write the original request or intent");
  // Unstructured requests are retained verbatim, not interpreted as permission to change approach.
  if (!result.intent) result.intent = result.originalRequest;
  if (!result.requestedApproach && /\biframe\b/i.test(result.originalRequest)) {
    result.requestedApproach = result.originalRequest;
  }
  return result;
}

export function requestPreflight(input, { proposedApproach = "" } = {}) {
  const request = parseRequest(input);
  const missing = FIELDS.filter(key => !request[key].trim());
  const substitution = Boolean(proposedApproach && proposedApproach !== request.requestedApproach) ||
    (/\biframe\b/i.test(request.originalRequest) && !/\biframe\b/i.test(request.requestedApproach));
  const drive = /\b(?:drive|iframe|dreamweaver|catalog|audio)\b/i.test(Object.values(request).join(" "));
  return {
    guard: "HALO Guard / ReleaseGuardAgent",
    request,
    status: substitution || missing.length ? "blocked" : "not tested",
    checks: [{
      command: "requestPreflight: schema and approach comparison",
      source: "static", mocked: false,
      outcome: substitution || missing.length ? "blocked" : "passed",
      observation: substitution ? "Proposed approach differs; ask the owner before switching."
        : missing.length ? "Request preserved but incomplete; ask for the missing acceptance fields."
          : "Request preserved; no runtime experiment has run."
    }],
    grounding: drive ? [
      "release-guard-agent.js",
      "lib/catalog-curator.js",
      "lib/catalog-session.js",
      "dreamweaver/dreamweaver.js",
      "netlify/lib/drive-catalog.mjs"
    ] : ["release-guard-agent.js", "netlify/lib/control-center.mjs"],
    cheapChecks: drive ? [
      "npm run test:release-guard",
      "npm run test:drive-catalog",
      "npm run test:dreamweaver-assets"
    ] : ["npm run test:release-guard", "npm run contracts:ai-maintenance"],
    unknowns: [
      ...missing.map(key => `Owner clarification needed: ${key}`),
      ...(drive ? ["Actual public canonical catalog availability; iframe controls, audible playback, CORS, autoplay policy and mobile compatibility."] : ["Requested behavior has not been exercised."]),
      "Static checks and mocked fixtures do not establish live behavior."
    ],
    approvalsRequired: [...APPROVAL_BOUNDARIES],
    executionAuthorized: false,
    paidCalls: 0,
    expectedCost: "No model/API charges; local deterministic checks only by default.",
    risk: "Advisory only. Preview contacts the canonical catalog and Google only after an owner gesture.",
    nextStep: substitution ? "Ask the owner to approve the alternative; keep the requested approach in scope."
      : missing.length ? `Ask the owner to supply ${missing.join(", ")}; do not infer missing requirements.`
        : drive ? "Run the isolated owner preview with a genuine eligible canonical entry, then review browser/device evidence before implementation."
          : "Run the listed cheap checks and a bounded experiment for the acceptance criteria before broad implementation."
  };
}
