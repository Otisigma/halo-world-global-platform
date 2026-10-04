import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createStudioGuardianHandler } from "../lib/halo-ai-service.mjs";

/**
 * POST /api/studio-guardian (same-origin authenticated JSON):
 * { action: "health" | "council", projectId: string }; no client metrics or AI keys.
 * Health returns { provider: "checklist", health: { projectId, provider: "checklist",
 *   score, status, summary, audioInsights: string[], actionableNextSteps: string[],
 *   metrics, checklist: [{ id, status, message }], blockers: [{ id, message }], limitations } }.
 * The 0–100 score measures passed metadata checks, not audio quality or legal readiness.
 * Council returns { provider: "checklist" | "gemini",
 *   review: { projectId, provider: "checklist" | "gemini",
 *   model: null | "gemini-2.5-flash", status, summary, health,
 *   council: [{ agentName, role, content }], finalVerdict, recommendedActions: string[],
 *   voices: [{ role, message }], recommendations: string[], fallbackReason, limitations } }.
 * Status is "blocked" or "needs_review", never release approval. Checklist status is
 * "pass", "blocker", "review" or "not_applicable". Fallback reason is null,
 * "not_configured", "unavailable" or "rate_limited". Render all strings as text.
 * Metrics include stemCount (separated files, excluding "full"), stemTypes,
 * stemPackStatus, rightsAttested, rightsStatus, restrictionCount, allocations
 * [{ participantName, role, shareBps, collectionStatus }], allocationsTruncated,
 * allocationVisibility: "owner" | "redacted", masterShareBps, compositionShareBps,
 * consent: "not_recorded". Individual allocations are empty for accepted participants:
 * project acceptance permits aggregate advisory checks, not owner-private rights records.
 * Errors return { message } with 400/401/403/404/405/413/415/503, without internals.
 * Health never uses Gemini. Council optionally uses server GEMINI_API_KEY to
 * prioritize vetted tasks; paid calls require the usage migration and consume
 * at most six reservations/member/hour and sixty globally/hour (including failures).
 * Missing quota storage, exhausted quotas or provider failure return local council.
 */
export default createStudioGuardianHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin });
export const config = { path: "/api/studio-guardian" };
