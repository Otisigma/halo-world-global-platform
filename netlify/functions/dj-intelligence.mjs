import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";

const MAX_BODY_BYTES = 24_000;
const MODES = new Set(["listening", "club", "chill"]);
const SIGNALS = new Set(["love", "lift", "hold", "skip", "vote"]);
const CURVES = new Set(["journey", "build", "steady", "wave", "double-peak", "emotional", "sunset", "afterhours"]);
const PHASES = new Set(["opening", "build", "peak", "release", "close"]);
const PERSONAS = new Set(["halo", "butterfly", "romy"]);
const EXTERNAL_PLATFORMS = new Set(["halo", "youtube", "tiktok", "spotify", "apple_music", "instagram", "import"]);
const EXTERNAL_METRICS = new Set(["likes", "saves", "shares", "views", "streams", "completions", "watch_seconds", "comments"]);
const EXTERNAL_SOURCES = new Set(["authorized_api", "owner_export", "halo"]);

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, ...extraHeaders } });
}

function text(value, maximum = 100) {
  return String(value || "").trim().slice(0, maximum);
}

async function memberContext() {
  const [db, user] = await Promise.all([getDatabase(), getUser()]);
  if (!user?.id) return { db, user: null };
  await ensureMembership(db, user);
  return { db, user };
}

async function readMemory(db, memberId, mode) {
  const rows = await db.sql`
    SELECT track_id,
      SUM(CASE WHEN signal IN ('love', 'vote', 'lift') THEN intensity ELSE 0 END)::int AS positive,
      SUM(CASE WHEN signal = 'skip' THEN intensity ELSE 0 END)::int AS negative,
      COUNT(*)::int AS observations
    FROM halo_dj_audience_signals
    WHERE member_id = ${memberId}
      AND mode = ${mode}
      AND created_at >= NOW() - INTERVAL '90 days'
    GROUP BY track_id
    ORDER BY (SUM(CASE WHEN signal IN ('love', 'vote', 'lift') THEN intensity ELSE 0 END)
      - SUM(CASE WHEN signal = 'skip' THEN intensity ELSE 0 END)) DESC,
      COUNT(*) DESC
    LIMIT 8
  `;

  const totals = await db.sql`
    SELECT signal, COUNT(*)::int AS total
    FROM halo_dj_audience_signals
    WHERE member_id = ${memberId}
      AND mode = ${mode}
      AND created_at >= NOW() - INTERVAL '90 days'
    GROUP BY signal
  `;

  return {
    mode,
    observations: totals.reduce((sum, row) => sum + Number(row.total || 0), 0),
    signals: Object.fromEntries(totals.map(row => [row.signal, Number(row.total || 0)])),
    preferredTracks: rows.map(row => ({
      trackId: row.track_id,
      affinity: Number(row.positive || 0) - Number(row.negative || 0),
      observations: Number(row.observations || 0)
    }))
  };
}

export default async function djIntelligence(request) {
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }

  if (request.method === "POST") {
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin DJ intelligence requests are not accepted" }, 403);
    }
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
      return json({ message: "DJ intelligence request is too large" }, 413);
    }
  }

  let context;
  try {
    context = await memberContext();
  } catch (error) {
    console.error("DJ intelligence membership failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "DJ intelligence could not verify membership" }, 503);
  }

  if (!context.user) return json({ message: "Sign in to save audience intelligence" }, 401);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const mode = MODES.has(url.searchParams.get("mode")) ? url.searchParams.get("mode") : "listening";
    try {
      return json({ memory: await readMemory(context.db, context.user.id, mode) });
    } catch (error) {
      console.error("DJ intelligence memory failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "Audience memory is unavailable" }, 503);
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }

  const action = text(body.action, 24);
  if (action === "session") {
    const id = text(body.sessionId, 100);
    const mode = MODES.has(body.mode) ? body.mode : "listening";
    const curve = CURVES.has(body.energyCurve) ? body.energyCurve : "journey";
    const phase = PHASES.has(body.phase) ? body.phase : "opening";
    if (id.length < 8) return json({ message: "A valid session ID is required" }, 422);
    try {
      await context.db.sql`
        INSERT INTO halo_dj_intelligence_sessions (id, member_id, mode, energy_curve, current_phase)
        VALUES (${id}, ${context.user.id}, ${mode}, ${curve}, ${phase})
        ON CONFLICT (id) DO UPDATE SET
          mode = EXCLUDED.mode,
          energy_curve = EXCLUDED.energy_curve,
          current_phase = EXCLUDED.current_phase,
          updated_at = NOW()
        WHERE halo_dj_intelligence_sessions.member_id = ${context.user.id}
      `;
      return json({ saved: true, sessionId: id });
    } catch (error) {
      console.error("DJ session save failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "DJ session could not be saved" }, 503);
    }
  }

  if (action === "transition") {
    const sessionId = text(body.sessionId, 100);
    const outgoingTrackId = text(body.outgoingTrackId, 120);
    const incomingTrackId = text(body.incomingTrackId, 120);
    const personaId = PERSONAS.has(body.personaId) ? body.personaId : null;
    const preflightId = /^[0-9a-f-]{36}$/i.test(String(body.preflightId || "")) ? String(body.preflightId).toLowerCase() : null;
    const transitionStyle = text(body.transitionStyle, 60) || "manual";
    const transitionBars = [4, 8, 16, 32, 64].includes(Number(body.transitionBars)) ? Number(body.transitionBars) : 16;
    const predictedScore = Math.max(0, Math.min(100, Number(body.predictedScore) || 0));
    const recipe = body.recipe && typeof body.recipe === "object" && !Array.isArray(body.recipe) ? body.recipe : {};
    if (sessionId.length < 8 || !outgoingTrackId || !incomingTrackId) {
      return json({ message: "Session, outgoing track, and incoming track are required" }, 422);
    }
    try {
      const rows = await context.db.sql`
        INSERT INTO halo_dj_transition_observations (
          member_id, persona_id, session_id, preflight_id, outgoing_track_id, incoming_track_id,
          transition_style, transition_bars, predicted_score, recipe, operator_overridden
        ) VALUES (
          ${context.user.id}, ${personaId}, ${sessionId}, ${preflightId}, ${outgoingTrackId}, ${incomingTrackId},
          ${transitionStyle}, ${transitionBars}, ${predictedScore}, ${JSON.stringify(recipe).slice(0, 12000)}::jsonb,
          ${Boolean(body.operatorOverridden)}
        )
        RETURNING id
      `;
      return json({ saved: true, transitionObservationId: Number(rows[0].id) }, 201);
    } catch (error) {
      console.error("DJ transition observation failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "Transition observation could not be saved" }, 503);
    }
  }

  if (action === "external_signal") {
    const personaId = PERSONAS.has(body.personaId) ? body.personaId : "";
    const platform = EXTERNAL_PLATFORMS.has(body.platform) ? body.platform : "";
    const metricName = EXTERNAL_METRICS.has(body.metricName) ? body.metricName : "";
    const source = EXTERNAL_SOURCES.has(body.source) ? body.source : "authorized_api";
    const contentId = text(body.contentId, 200);
    const metricValue = Math.max(0, Math.min(1_000_000_000, Number(body.metricValue) || 0));
    const audienceSize = Math.max(0, Math.min(1_000_000_000, Number(body.audienceSize) || 0));
    const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {};
    const observedAt = new Date(String(body.observedAt || Date.now()));
    if (!personaId || !platform || !metricName || !contentId || Number.isNaN(observedAt.valueOf())) {
      return json({ message: "Persona, platform, content, metric, and observation time are required" }, 422);
    }
    try {
      const rows = await context.db.sql`
        INSERT INTO halo_dj_external_signals (
          member_id, persona_id, platform, content_id, metric_name, metric_value, audience_size,
          source, metadata, observed_at
        )
        SELECT ${context.user.id}, ${personaId}, ${platform}, ${contentId}, ${metricName}, ${metricValue},
          ${audienceSize}, ${source}, ${JSON.stringify(metadata).slice(0, 8000)}::jsonb, ${observedAt.toISOString()}
        WHERE (
          SELECT COUNT(*) FROM halo_dj_external_signals
          WHERE member_id = ${context.user.id} AND created_at >= NOW() - INTERVAL '1 hour'
        ) < 500
        RETURNING id
      `;
      if (!rows.length) return json({ message: "External learning import has reached its hourly limit" }, 429, { "Retry-After": "3600" });
      return json({ saved: true, externalSignalId: Number(rows[0].id) }, 201);
    } catch (error) {
      console.error("DJ external learning signal failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "External learning signal could not be saved" }, 503);
    }
  }

  if (action !== "signal") return json({ message: "Unknown DJ intelligence action" }, 422);

  const trackId = text(body.trackId, 100);
  const decisionId = text(body.decisionId, 100) || null;
  const mode = MODES.has(body.mode) ? body.mode : "listening";
  const signal = SIGNALS.has(body.signal) ? body.signal : "";
  const intensity = Math.max(1, Math.min(5, Number(body.intensity) || 1));
  const transitionObservationId = Number.parseInt(body.transitionObservationId, 10) || null;
  if (!trackId || !signal) return json({ message: "Track and valid audience signal are required" }, 422);

  try {
    const decisionRows = decisionId ? await context.db.sql`
      SELECT id FROM halo_dj_decisions WHERE id = ${decisionId} AND member_id = ${context.user.id} LIMIT 1
    ` : [];
    const ownedDecisionId = decisionRows[0]?.id || null;
    const insertedRows = await context.db.sql`
      INSERT INTO halo_dj_audience_signals (member_id, decision_id, track_id, mode, signal, intensity)
      SELECT ${context.user.id}, ${ownedDecisionId}, ${trackId}, ${mode}, ${signal}, ${intensity}
      WHERE (
        SELECT COUNT(*)
        FROM halo_dj_audience_signals
        WHERE member_id = ${context.user.id}
          AND created_at >= NOW() - INTERVAL '1 hour'
      ) < 300
      RETURNING id
    `;
    if (!insertedRows.length) return json({ message: "Audience memory has reached its hourly limit" }, 429, { "Retry-After": "3600" });
    if (transitionObservationId) {
      const signalScores = { love: 92, lift: 86, hold: 76, vote: 96, skip: 18 };
      const nextScore = signalScores[signal] || 50;
      await context.db.sql`
        UPDATE halo_dj_transition_observations
        SET signals = signals || ${JSON.stringify({ [signal]: intensity })}::jsonb,
          outcome_score = CASE WHEN outcome_score IS NULL THEN ${nextScore} ELSE ROUND((outcome_score + ${nextScore}) / 2, 2) END,
          evaluated_at = NOW()
        WHERE id = ${transitionObservationId} AND member_id = ${context.user.id}
      `;
    }
    return json({ saved: true, memory: await readMemory(context.db, context.user.id, mode) });
  } catch (error) {
    console.error("DJ audience signal failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Audience response could not be saved" }, 503);
  }
}

export const config = {
  path: "/api/dj-intelligence"
};
