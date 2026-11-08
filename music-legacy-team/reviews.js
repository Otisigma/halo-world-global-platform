const constraints = "Advisory only. Do not claim tests ran, files were recovered, production is live, or rights and ownership were verified. No private music, documents or credentials. Human approval required for changes.";
const approach = "Use existing council context to propose one bounded, human-reviewed work item; mark missing evidence as unknown.";

export const reviews = Object.freeze({
  guardian: {
    targetAgent: "sentinel",
    message: "Propose a recovery test plan for one-song and 50-song packs, including actual extracted file bytes, missing files, altered files, and offline verification. Do not claim tests were run.",
    intent: "Improve confidence in portable music recovery.",
    expectedBehavior: "A human can execute a reproducible restore plan and report complete, incomplete, and unknown outcomes.",
    acceptanceCriteria: "Identify the pack population, successful restorations, missing or different files, failure evidence, and regression guardrails."
  },
  builder: {
    targetAgent: "atlas",
    message: "Propose one small improvement for linking masters, stems, session files, version notes and rights or agreement references in recovery packs. Do not claim DAW sessions are portable.",
    intent: "Improve the completeness of artist handover context.",
    expectedBehavior: "A developer can review a scoped change with compatibility, privacy and verification considerations.",
    acceptanceCriteria: "Specify a reversible work item, versioned data relationships, missing dependencies and tests before implementation."
  },
  advocate: {
    targetAgent: "bridge",
    message: "Propose one artist-facing guidance improvement for recovery packs, explaining missing files, separate tested copies, unencrypted ZIPs and session portability limitations.",
    intent: "Reduce misleading or confusing recovery instructions for artists.",
    expectedBehavior: "An artist can distinguish a register, selected files and a tested backup, and knows the next action.",
    acceptanceCriteria: "Provide clear proposed copy, a reviewable source of evidence, and a way to check for misunderstandings."
  }
});

export function reviewRequest(key, useAI = false) {
  if (!Object.hasOwn(reviews, key) || typeof useAI !== "boolean") throw new Error("Choose a valid review.");
  const review = reviews[key];
  return {
    targetAgent: review.targetAgent,
    message: review.message,
    requestProposal: true,
    approvePaidCalls: useAI,
    request: {
      intent: review.intent,
      requestedApproach: approach,
      expectedBehavior: review.expectedBehavior,
      affectedSurface: "HALO catalog recovery workspace and portable pack",
      acceptanceCriteria: review.acceptanceCriteria,
      constraints
    }
  };
}
