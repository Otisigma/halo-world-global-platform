import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership, isOwner } from "../lib/halo-x.mjs";

const reviewAreas = new Set([
  "creative_intent",
  "technical_sound",
  "transitions_breaks",
  "audience_programming",
  "rights_credits",
  "release_readiness"
]);
const outcomes = new Set(["scored", "abstain", "blocker"]);
const confidences = new Set(["low", "medium", "high"]);
const breakTypes = new Set(["transition", "breakdown", "drop", "blend", "energy_shift", "other"]);
const severities = new Set(["note", "strength", "question", "risk"]);
const finalDecisions = new Set(["approved", "revise", "hold"]);
const confidenceWeights = { low: 0.65, medium: 1, high: 1.25 };

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function reviewPayload(row, breaks = []) {
  return {
    id: row.id,
    area: row.area,
    outcome: row.outcome,
    score: row.score === null ? null : Number(row.score),
    confidence: row.confidence,
    evidence: row.evidence,
    recommendation: row.recommendation,
    updatedAt: new Date(row.updated_at).toISOString(),
    breaks
  };
}

function cyclePayload(row, reviews) {
  return {
    id: row.id,
    mixId: row.mix_id,
    title: row.title,
    creatorName: row.display_name,
    artworkUrl: row.artwork_url || "/assets/releases/salty.jpg",
    audioUrl: `/api/mixes/audio?id=${encodeURIComponent(row.mix_id)}`,
    uploadedAt: new Date(row.mix_created_at).toISOString(),
    isOwner: Boolean(row.is_owner),
    creatorContext: {
      intent: row.review_intent || "",
      context: row.review_context || "",
      protectedMoments: row.protected_moments || ""
    },
    cycleNumber: Number(row.cycle_number),
    status: row.status,
    overallScore: row.overall_score === null ? null : Number(row.overall_score),
    scoredAreaCount: Number(row.scored_area_count || 0),
    abstainedAreaCount: Number(row.abstained_area_count || 0),
    blockerCount: Number(row.blocker_count || 0),
    finalSummary: row.final_summary,
    finalizedAt: row.finalized_at ? new Date(row.finalized_at).toISOString() : null,
    reviews
  };
}

async function loadCycles(db, membership, canReview) {
  const cycles = canReview
    : await db.sql`
        SELECT c.*, m.title, m.artwork_url, m.review_intent, m.review_context, m.protected_moments,
          m.created_at AS mix_created_at, p.display_name,
          (m.member_id = ${membership.member_id}) AS is_owner
        FROM halo_mix_review_cycles c
        JOIN halo_mixes m ON m.id = c.mix_id
        JOIN community_profiles p ON p.actor_id = m.actor_id
        ORDER BY
          CASE c.status WHEN 'needs_context' THEN 0 WHEN 'ready' THEN 1 WHEN 'in_review' THEN 2 WHEN 'queued' THEN 3 ELSE 4 END,
          m.created_at DESC
        LIMIT 60
      `
    : await db.sql`
        SELECT c.*, m.title, m.artwork_url, m.review_intent, m.review_context, m.protected_moments,
          m.created_at AS mix_created_at, p.display_name, TRUE AS is_owner
        FROM halo_mix_review_cycles c
        JOIN halo_mixes m ON m.id = c.mix_id
        JOIN community_profiles p ON p.actor_id = m.actor_id
        WHERE m.member_id = ${membership.member_id}
        ORDER BY c.created_at DESC
        LIMIT 30
      `;

  const reviews = canReview
    ? await db.sql`
        SELECT r.* FROM halo_mix_area_reviews r
        JOIN halo_mix_review_cycles c ON c.id = r.cycle_id
        WHERE r.cycle_id IN (
          SELECT id FROM halo_mix_review_cycles ORDER BY updated_at DESC LIMIT 60
        )
        ORDER BY r.updated_at DESC
      `
    : await db.sql`
        SELECT r.* FROM halo_mix_area_reviews r
        JOIN halo_mix_review_cycles c ON c.id = r.cycle_id
        JOIN halo_mixes m ON m.id = c.mix_id
        WHERE m.member_id = ${membership.member_id}
        ORDER BY r.updated_at DESC
      `;
  const breaks = canReview
    ? await db.sql`
        SELECT b.* FROM halo_mix_break_observations b
        JOIN halo_mix_area_reviews r ON r.id = b.review_id
        WHERE r.cycle_id IN (
          SELECT id FROM halo_mix_review_cycles ORDER BY updated_at DESC LIMIT 60
        )
        ORDER BY b.timestamp_seconds
      `
    : await db.sql`
        SELECT b.* FROM halo_mix_break_observations b
        JOIN halo_mix_area_reviews r ON r.id = b.review_id
        JOIN halo_mix_review_cycles c ON c.id = r.cycle_id
        JOIN halo_mixes m ON m.id = c.mix_id
        WHERE m.member_id = ${membership.member_id}
        ORDER BY b.timestamp_seconds
      `;
  const breaksByReview = Map.groupBy(breaks, row => row.review_id);
  const reviewsByCycle = Map.groupBy(reviews, row => row.cycle_id);
  return cycles.map(cycle => cyclePayload(cycle, (reviewsByCycle.get(cycle.id) || []).map(review => reviewPayload(review, (breaksByReview.get(review.id) || []).map(item => ({
    id: item.id,
    timestampSeconds: Number(item.timestamp_seconds),
    breakType: item.break_type,
    observation: item.observation,
    severity: item.severity,
    intentUnderstood: Boolean(item.intent_understood)
  }))))));
}

async function recalculateCycle(db, cycleId) {
  const rows = await db.sql`
    SELECT outcome, score, confidence FROM halo_mix_area_reviews WHERE cycle_id = ${cycleId}
  `;
  const scored = rows.filter(row => row.outcome === "scored" && Number.isFinite(Number(row.score)));
  const abstainedAreaCount = rows.filter(row => row.outcome === "abstain").length;
  const blockerCount = rows.filter(row => row.outcome === "blocker").length;
  const weightedTotal = scored.reduce((total, row) => total + Number(row.score) * confidenceWeights[row.confidence], 0);
  const totalWeight = scored.reduce((total, row) => total + confidenceWeights[row.confidence], 0);
  const overallScore = totalWeight ? Math.round((weightedTotal / totalWeight) * 100) / 100 : null;
  const status = blockerCount > 0 ? "needs_context" : rows.length === reviewAreas.size ? "ready" : rows.length ? "in_review" : "queued";
  await db.sql`
    UPDATE halo_mix_review_cycles SET
      status = ${status}, overall_score = ${overallScore}, scored_area_count = ${scored.length},
      abstained_area_count = ${abstainedAreaCount}, blocker_count = ${blockerCount},
      final_summary = '', finalized_by_member_id = NULL, finalized_at = NULL, updated_at = NOW()
    WHERE id = ${cycleId}
  `;
}

function cleanBreaks(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map(item => ({
    timestampSeconds: Math.max(0, Math.min(43200, Number.parseInt(item?.timestampSeconds, 10) || 0)),
    breakType: breakTypes.has(item?.breakType) ? item.breakType : "other",
    observation: cleanText(item?.observation, 600),
    severity: severities.has(item?.severity) ? item.severity : "note",
    intentUnderstood: item?.intentUnderstood === true
  })).filter(item => item.observation.length >= 3);
}

async function saveAreaReview(db, membership, payload) {
  const cycleId = cleanText(payload.cycleId, 100);
  const area = reviewAreas.has(payload.area) ? payload.area : "";
  const outcome = outcomes.has(payload.outcome) ? payload.outcome : "";
  const confidence = confidences.has(payload.confidence) ? payload.confidence : "medium";
  const evidence = cleanText(payload.evidence, 2000);
  const recommendation = cleanText(payload.recommendation, 1200);
  const score = outcome === "scored" ? Number.parseInt(payload.score, 10) : null;
  if (!cycleId || !area || !outcome || evidence.length < 5) return json({ message: "Choose an area and record the evidence behind the review" }, 400);
  if (outcome === "scored" && (!Number.isInteger(score) || score < 1 || score > 100)) return json({ message: "Scored reviews need a quality score from 1 to 100" }, 400);
  const cycles = await db.sql`SELECT id FROM halo_mix_review_cycles WHERE id = ${cycleId}`;
  if (!cycles[0]) return json({ message: "That review cycle was not found" }, 404);

  const reviewId = randomUUID();
  const reviewRows = await db.sql`
    INSERT INTO halo_mix_area_reviews (
      id, cycle_id, area, reviewer_member_id, outcome, score, confidence, evidence, recommendation
    ) VALUES (
      ${reviewId}, ${cycleId}, ${area}, ${membership.member_id}, ${outcome}, ${score}, ${confidence}, ${evidence}, ${recommendation}
    )
    ON CONFLICT (cycle_id, area) DO UPDATE SET
      reviewer_member_id = EXCLUDED.reviewer_member_id, outcome = EXCLUDED.outcome, score = EXCLUDED.score,
      confidence = EXCLUDED.confidence, evidence = EXCLUDED.evidence, recommendation = EXCLUDED.recommendation,
      updated_at = NOW()
    RETURNING id
  `;
  const savedReviewId = reviewRows[0].id;
  await db.sql`DELETE FROM halo_mix_break_observations WHERE review_id = ${savedReviewId}`;
  for (const item of cleanBreaks(payload.breaks)) {
    await db.sql`
      INSERT INTO halo_mix_break_observations (
        id, review_id, timestamp_seconds, break_type, observation, severity, intent_understood
      ) VALUES (
        ${randomUUID()}, ${savedReviewId}, ${item.timestampSeconds}, ${item.breakType}, ${item.observation}, ${item.severity}, ${item.intentUnderstood}
      )
    `;
  }
  await recalculateCycle(db, cycleId);
  return json({ message: outcome === "abstain" ? "Pass recorded without lowering the mix score" : "Area review saved" });
}

async function finalizeReview(db, membership, payload) {
  const cycleId = cleanText(payload.cycleId, 100);
  const decision = finalDecisions.has(payload.decision) ? payload.decision : "";
  const summary = cleanText(payload.summary, 2000);
  if (!cycleId || !decision || summary.length < 10) return json({ message: "Choose a final decision and explain it clearly" }, 400);
  const rows = await db.sql`
    SELECT c.scored_area_count, c.blocker_count, c.mix_id, m.client_sale_enabled, m.rights_attested,
      m.product_info_complete, m.price_minor, m.production_route
    FROM halo_mix_review_cycles c
    JOIN halo_mixes m ON m.id = c.mix_id
    WHERE c.id = ${cycleId}
  `;
  if (!rows[0]) return json({ message: "That review cycle was not found" }, 404);
  if (decision === "approved" && Number(rows[0].scored_area_count) < 3) return json({ message: "Approval needs evidence-backed scores from at least three areas" }, 409);
  if (decision === "approved" && Number(rows[0].blocker_count) > 0) return json({ message: "Resolve or reclassify the open blockers before approval" }, 409);
  if (decision === "approved" && rows[0].client_sale_enabled) {
    const requiredReviews = await db.sql`
      SELECT area, outcome FROM halo_mix_area_reviews
      WHERE cycle_id = ${cycleId} AND area IN ('rights_credits', 'release_readiness')
    `;
    const approvedAreas = new Set(requiredReviews.filter(row => row.outcome === "scored").map(row => row.area));
    if (!approvedAreas.has("rights_credits") || !approvedAreas.has("release_readiness")) {
      return json({ message: "Paid mixes need scored rights and release-readiness reviews before approval" }, 409);
    }
    if (!rows[0].rights_attested) return json({ message: "The creator rights attestation is still missing" }, 409);
    if (!rows[0].product_info_complete || Number(rows[0].price_minor) < 100) {
      return json({ message: "Complete the product information and confirm the price before approval" }, 409);
    }
  }
  await db.sql`
    UPDATE halo_mix_review_cycles SET status = ${decision}, final_summary = ${summary},
      finalized_by_member_id = ${membership.member_id}, finalized_at = NOW(), updated_at = NOW()
    WHERE id = ${cycleId}
  `;
  if (decision === "approved") {
    const saleReady = Boolean(rows[0].client_sale_enabled && rows[0].rights_attested && rows[0].product_info_complete && Number(rows[0].price_minor) >= 100);
    await db.sql`
      UPDATE halo_mixes SET
        master_approved = TRUE,
        rights_clearance_status = CASE WHEN rights_attested THEN 'confirmed' ELSE 'pending' END,
        sales_status = CASE WHEN ${saleReady} THEN 'ready' WHEN client_sale_enabled THEN 'rights_review' ELSE 'stream_only' END
      WHERE id = ${rows[0].mix_id}
    `;
    await db.sql`
      UPDATE halo_mix_release_plans SET
        mastering_status = 'approved', rights_confirmed = ${Boolean(rows[0].rights_attested)}, sale_ready = ${saleReady},
        current_step = CASE WHEN ${saleReady} THEN 5 ELSE current_step END, updated_at = NOW()
      WHERE mix_id = ${rows[0].mix_id}
    `;
  } else {
    await db.sql`
      UPDATE halo_mixes SET master_approved = FALSE,
        sales_status = CASE WHEN client_sale_enabled THEN 'mastering' ELSE 'stream_only' END
      WHERE id = ${rows[0].mix_id}
    `;
    await db.sql`
      UPDATE halo_mix_release_plans SET sale_ready = FALSE, updated_at = NOW()
      WHERE mix_id = ${rows[0].mix_id}
    `;
  }
  return json({ message: `Mix review marked ${decision}` });
}

export default async function mixReviews(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  const user = await getUser().catch(() => null);
  if (!user?.id) return json({ message: "Sign in to open mix quality review" }, 401);
  try {
    const db = getDatabase();
    const membership = await ensureMembership(db, user);
    const canReview = isOwner(user);
    if (request.method === "GET") return json({ canReview, cycles: await loadCycles(db, membership, canReview) });
    if (!canReview) return json({ message: "Only the HALO review team can submit quality decisions" }, 403);
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin review updates are not accepted" }, 403);
    }
    if (Number(request.headers.get("content-length") || 0) > 30_000) return json({ message: "That review is too large" }, 413);
    const payload = await request.json().catch(() => null);
    if (!payload) return json({ message: "Request body must be valid JSON" }, 400);
    if (payload.action === "save_area_review") return saveAreaReview(db, membership, payload);
    if (payload.action === "finalize_review") return finalizeReview(db, membership, payload);
    return json({ message: "Unknown mix review action" }, 400);
  } catch (error) {
    console.error("HALO mix review failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The mix quality room could not be updated right now" }, 500);
  }
}

export const config = {
  path: "/api/mix-reviews"
};
