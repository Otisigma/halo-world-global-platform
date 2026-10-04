import { LISTING_TYPES } from "./creator-marketplace.js";

const listingPrices = {
  full_track: 12, instrumental: 20, stem_pack: 35,
  exclusive_license: 500, non_exclusive_license: 60, custom_edit: 120
};

export function validateStems(stems = [], requiredStems = []) {
  const issues = [];
  if (!Array.isArray(stems) || !Array.isArray(requiredStems)) {
    return { valid: false, missing: [], issues: ["Supply stem metadata and required stem names."] };
  }
  const names = new Set();
  for (const stem of stems) {
    const name = typeof stem?.name === "string" ? stem.name.trim() : "";
    if (!name) { issues.push("Every stem needs a name."); continue; }
    if (names.has(name.toLowerCase())) issues.push(`Duplicate stem: ${name}.`);
    names.add(name.toLowerCase());
    if (!["WAV", "AIFF", "FLAC"].includes(String(stem.format || "").toUpperCase())) issues.push(`${name}: supply a lossless format.`);
    if (stem.validated !== true) issues.push(`${name}: audio validation is still required.`);
  }
  const missing = requiredStems.filter(name => typeof name === "string" && !names.has(name.trim().toLowerCase()));
  if (requiredStems.some(name => typeof name !== "string" || !name.trim())) issues.push("Required stem names must be non-empty text.");
  if (!stems.length) issues.push("No stem metadata supplied.");
  return { valid: issues.length === 0 && missing.length === 0, missing, issues };
}

export function verifyFiftyFiftySplit(splits = []) {
  if (!Array.isArray(splits) || splits.length !== 2) {
    return { valid: false, status: "unverified", summary: "A 50/50 check requires two named participants." };
  }
  const names = splits.map(split => typeof split?.name === "string" ? split.name.trim().toLowerCase() : "");
  const equalShares = splits.every(split => typeof split?.share === "number" && split.share === 50);
  const valid = names.every(Boolean) && new Set(names).size === 2 && equalShares && splits.every(split => split.confirmed === true);
  return {
    valid, status: valid ? "confirmed-metadata" : "needs-confirmation",
    summary: valid ? "Two 50% shares are marked confirmed. Signed rights documents still require review."
      : "Confirm two distinct participants, each with a 50% share. This check does not alter rights."
  };
}

export function suggestListing(input = {}) {
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const suggestedListingType = LISTING_TYPES.some(type => type.id === input.listingType) ? input.listingType
    : Array.isArray(input.stems) && input.stems.length > 1 ? "stem_pack" : "full_track";
  return {
    suggestedListingType,
    suggestedPrice: listingPrices[suggestedListingType],
    currency: "USD",
    rationale: "Illustrative starting price only; confirm scope, demand, and license terms with the creator."
  };
}

function reviewProject(input = {}) {
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const completion = typeof input.completion === "number" && Number.isFinite(input.completion)
    ? Math.max(0, Math.min(100, input.completion)) : 0;
  const stemValidation = validateStems(input.stems, input.requiredStems);
  const splitVerification = verifyFiftyFiftySplit(input.splits);
  const rightsConfirmed = input.rightsConfirmed === true;
  const score = Math.round(completion * 0.4 + (stemValidation.valid ? 20 : 0) + (splitVerification.valid ? 20 : 0) + (rightsConfirmed ? 20 : 0));
  const nextSteps = [];
  if (completion < 100) nextSteps.push("Complete the arrangement and review the final master.");
  if (!stemValidation.valid) nextSteps.push("Supply and validate lossless stems; resolve missing or duplicate files.");
  if (!splitVerification.valid) nextSteps.push("Confirm the proposed 50/50 split with both participants, or review alternative splits in Artist Economy.");
  if (!rightsConfirmed) nextSteps.push("Review ownership, sample clearance, and signed license terms before listing.");
  nextSteps.push("Ask a human council reviewer to listen and approve the release.");
  const status = score === 100 ? "ready-for-human-review" : "needs-work";
  const summary = `${score}/100 metadata readiness. ${status === "needs-work" ? "Resolve the outstanding checks before release." : "Submit to human review; this is not release approval."}`;
  const recommendations = [
    "Mix: listen to the master and check clipping, balance, and playback translation.",
    rightsConfirmed ? "Rights: confirm the supplied assertions against signed documents." : "Rights: collect permissions and signed agreements.",
    "Release: confirm delivery formats, credits, and listing scope with the creator."
  ];
  return {
    score, status, summary, stemValidation, splitVerification, nextSteps,
    insights: [
      ...stemValidation.issues, ...stemValidation.missing.map(name => `Missing stem: ${name}.`),
      splitVerification.summary,
      "Studio Guardian uses local rules and supplied metadata, not audio analysis or a live AI provider."
    ],
    ...suggestListing(input),
    councilReview: { summary: "Council review preparation only; human listening and rights review remain required.", recommendations },
    source: "local-rules"
  };
}

export const HaloAIService = Object.freeze({
  reviewProject,
  scoreProjectHealth: input => reviewProject(input).score,
  validateStems,
  verifyFiftyFiftySplit,
  councilReview: input => reviewProject(input).councilReview,
  suggestListing
});
