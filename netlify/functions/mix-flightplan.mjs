import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";

const MAX_BODY_BYTES = 28_000;
const FORMATS = new Set(["free_stream", "paid_mix", "mix_album"]);
const MASTERING_STATUSES = new Set(["not_started", "mix_review", "mastering_booked", "mastered", "approved"]);
const SIGNAL_SOURCES = new Set(["listener_request", "search", "club", "chart", "social", "radio", "operator"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const responseHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...responseHeaders, ...extraHeaders } });
}

function text(value, maximum = 160) {
  return String(value || "").trim().slice(0, maximum);
}

function number(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function safeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function publicPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    mixId: row.mix_id || "",
    title: row.title,
    currentStep: Number(row.current_step || 1),
    releaseFormat: row.release_format,
    masteringStatus: row.mastering_status,
    targetLufs: Number(row.target_lufs),
    truePeakDbtp: Number(row.true_peak_dbtp),
    rightsConfirmed: Boolean(row.rights_confirmed),
    saleReady: Boolean(row.sale_ready),
    metadata: row.metadata || {},
    demandBrief: row.demand_brief || {},
    updatedAt: row.updated_at
  };
}

async function memberContext() {
  const [db, user] = await Promise.all([getDatabase(), getUser().catch(() => null)]);
  if (!user?.id) return { db, user: null };
  await ensureMembership(db, user);
  return { db, user };
}

async function loadFlightplan(db, memberId) {
  const [plans, manualSignals, audienceSignals, externalSignals, radioSignals, reviewCycles] = await Promise.all([
    db.sql`
      SELECT * FROM halo_mix_release_plans
      WHERE member_id = ${memberId}
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    db.sql`
      SELECT id, query, source, demand_score, evidence, observed_at
      FROM halo_mix_market_signals
      WHERE member_id = ${memberId}
      ORDER BY observed_at DESC
      LIMIT 20
    `,
    db.sql`
      SELECT track_id AS query,
        'audience'::text AS source,
        LEAST(100, GREATEST(1, 50 + SUM(CASE WHEN signal IN ('love', 'lift', 'vote') THEN intensity * 5 WHEN signal = 'skip' THEN intensity * -6 ELSE 0 END)))::int AS demand_score,
        COUNT(*)::int AS observations
      FROM halo_dj_audience_signals
      WHERE member_id = ${memberId} AND created_at >= NOW() - INTERVAL '90 days'
      GROUP BY track_id
      ORDER BY demand_score DESC, observations DESC
      LIMIT 8
    `,
    db.sql`
      SELECT platform, content_id AS query, metric_name,
        LEAST(100, GREATEST(1, ROUND(LOG(10, metric_value + 1) * 22)))::int AS demand_score,
        observed_at
      FROM halo_dj_external_signals
      WHERE member_id = ${memberId} AND observed_at >= NOW() - INTERVAL '90 days'
      ORDER BY metric_value DESC, observed_at DESC
      LIMIT 8
    `,
    db.sql`
      SELECT title, artist, energy, moods, created_at
      FROM halo_radio_tracks
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 8
    `,
    db.sql`
      SELECT rc.id, rc.status, rc.overall_score, rc.final_summary, rc.cycle_number, rc.updated_at
      FROM halo_mix_review_cycles rc
      INNER JOIN halo_mixes m ON m.id = rc.mix_id
      WHERE m.member_id = ${memberId}
      ORDER BY rc.cycle_number DESC
      LIMIT 1
    `
  ]);

  const cycle = reviewCycles[0] || null;
  return {
    plan: publicPlan(plans[0]),
    latestCycle: cycle ? {
      id: cycle.id,
      cycleNumber: Number(cycle.cycle_number),
      status: cycle.status,
      overallScore: cycle.overall_score !== null ? Number(cycle.overall_score) : null,
      finalSummary: cycle.final_summary || "",
      updatedAt: cycle.updated_at
    } : null,
    radar: {
      manual: manualSignals.map(row => ({
        id: Number(row.id), query: row.query, source: row.source,
        demandScore: Number(row.demand_score), evidence: row.evidence, observedAt: row.observed_at
      })),
      audience: audienceSignals.map(row => ({
        query: row.query, source: "HALO audience", demandScore: Number(row.demand_score),
        evidence: `${Number(row.observations)} response${Number(row.observations) === 1 ? "" : "s"}`
      })),
      external: externalSignals.map(row => ({
        query: row.query, source: row.platform, demandScore: Number(row.demand_score),
        evidence: row.metric_name, observedAt: row.observed_at
      })),
      catalog: radioSignals.map(row => ({
        query: `${row.title} — ${row.artist}`, source: "HALO Radio", demandScore: Number(row.energy || 50),
        evidence: Array.isArray(row.moods) && row.moods.length ? row.moods.join(", ") : "recent catalog signal"
      }))
    }
  };
}

async function savePlan(db, memberId, body) {
  const id = UUID.test(String(body.id || "")) ? body.id : crypto.randomUUID();
  const title = text(body.title, 140) || "Untitled DJ mix";
  const mixId = UUID.test(String(body.mixId || "")) ? body.mixId : null;
  const currentStep = Math.round(number(body.currentStep, 1, 5, 1));
  const releaseFormat = FORMATS.has(body.releaseFormat) ? body.releaseFormat : "paid_mix";
  const masteringStatus = MASTERING_STATUSES.has(body.masteringStatus) ? body.masteringStatus : "not_started";
  const targetLufs = number(body.targetLufs, -24, -5, -14);
  const truePeakDbtp = number(body.truePeakDbtp, -6, 0, -1);
  const rightsConfirmed = body.rightsConfirmed === true;
  const metadata = safeObject(body.metadata);
  const demandBrief = safeObject(body.demandBrief);
  const requiredMetadata = [metadata.djName, metadata.projectTitle, metadata.genre, metadata.releaseDate, metadata.price]
    .every(value => text(value, 180));
  const saleReady = ["mastered", "approved"].includes(masteringStatus) && rightsConfirmed && requiredMetadata;

  const rows = await db.sql`
    INSERT INTO halo_mix_release_plans (
      id, member_id, mix_id, title, current_step, release_format, mastering_status,
      target_lufs, true_peak_dbtp, rights_confirmed, sale_ready, metadata, demand_brief
    ) VALUES (
      ${id}, ${memberId}, ${mixId}, ${title}, ${currentStep}, ${releaseFormat}, ${masteringStatus},
      ${targetLufs}, ${truePeakDbtp}, ${rightsConfirmed}, ${saleReady}, ${JSON.stringify(metadata)}::jsonb,
      ${JSON.stringify(demandBrief)}::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      mix_id = EXCLUDED.mix_id,
      title = EXCLUDED.title,
      current_step = EXCLUDED.current_step,
      release_format = EXCLUDED.release_format,
      mastering_status = EXCLUDED.mastering_status,
      target_lufs = EXCLUDED.target_lufs,
      true_peak_dbtp = EXCLUDED.true_peak_dbtp,
      rights_confirmed = EXCLUDED.rights_confirmed,
      sale_ready = EXCLUDED.sale_ready,
      metadata = EXCLUDED.metadata,
      demand_brief = EXCLUDED.demand_brief,
      updated_at = NOW()
    WHERE halo_mix_release_plans.member_id = ${memberId}
    RETURNING *
  `;
  if (!rows[0]) return null;
  if (mixId) {
    const salesStatus = saleReady ? "ready" : ["mastered", "approved"].includes(masteringStatus) ? "rights_review" : "mastering";
    await db.sql`
      UPDATE halo_mixes
      SET sales_status = ${salesStatus}
      WHERE id = ${mixId} AND member_id = ${memberId}
    `;
  }
  return publicPlan(rows[0]);
}

export default async function mixFlightplan(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  if (request.method === "POST") {
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin flightplan updates are not accepted" }, 403);
    }
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ message: "Flightplan request is too large" }, 413);
  }

  let context;
  try {
    context = await memberContext();
  } catch {
    return json({ message: "Mix Flightplan could not verify membership" }, 503);
  }
  if (!context.user) return json({ message: "Sign in to save a Mix Flightplan" }, 401);

  if (request.method === "GET") {
    try {
      return json(await loadFlightplan(context.db, context.user.id));
    } catch (error) {
      console.error("Mix Flightplan read failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "Mix Flightplan is unavailable right now" }, 503);
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }

  try {
    if (body.action === "signal") {
      const query = text(body.query, 180);
      const source = SIGNAL_SOURCES.has(body.source) ? body.source : "listener_request";
      const demandScore = Math.round(number(body.demandScore, 1, 100, 50));
      const evidence = text(body.evidence, 500);
      if (query.length < 2) return json({ message: "Add what the audience is asking for" }, 422);
      await context.db.sql`
        INSERT INTO halo_mix_market_signals (member_id, query, source, demand_score, evidence)
        VALUES (${context.user.id}, ${query}, ${source}, ${demandScore}, ${evidence})
      `;
      return json(await loadFlightplan(context.db, context.user.id), 201);
    }
    if (body.action !== "save_plan") return json({ message: "Unknown Mix Flightplan action" }, 422);
    const plan = await savePlan(context.db, context.user.id, body);
    if (!plan) return json({ message: "That Mix Flightplan does not belong to this member" }, 403);
    return json({ plan, message: plan.saleReady ? "Mix package is ready for sale review" : "Mix Flightplan saved" });
  } catch (error) {
    console.error("Mix Flightplan update failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Mix Flightplan could not be saved" }, 503);
  }
}

export const config = { path: "/api/mix-flightplan" };
