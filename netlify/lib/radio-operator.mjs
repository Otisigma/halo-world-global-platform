import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { readRadioAudience } from "./radio-audience.mjs";

export const OPERATOR_MODEL = "gpt-5.4-mini";

const AUDIENCE_WINDOW_DAYS = 7;

/**
 * Netlify bills on credits; these are the published rates converted at the Pro credit-pack
 * price. They are estimates for reasoning about direction of travel, not an invoice — the
 * billing dashboard is authoritative.
 */
export const COST_ASSUMPTIONS = Object.freeze({
  bandwidthUsdPerGb: 0.13,
  computeUsdPerGbHour: 0.07,
  deployUsdEach: 0.1,
  requestsUsdPer10k: 0.01,
  assumedStreamBitrateKbps: 128,
  note: "Derived from Netlify credit pricing at the Pro pack rate. Verify against the billing dashboard."
});

/** Scheduled functions in this project, as invocations per 30 days. */
const SCHEDULED_INVOCATIONS_PER_MONTH =
  (30 * 24 * 60) / 5 + // radio-health-scout, every 5 minutes
  (30 * 24 * 60) / 15 + // health-scout, every 15 minutes
  30 * 4 + // radio-persona-planner, every 6 hours
  30 + // halo-daily-report
  30 + // halo-agent-daily
  30; // this operator

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(Number(value || 0) * factor) / factor;
}

function count(value) {
  return Number(value || 0);
}

function estimateStreamedGigabytes(listenerMinutes) {
  const bytesPerSecond = (COST_ASSUMPTIONS.assumedStreamBitrateKbps * 1000) / 8;
  return (Number(listenerMinutes || 0) * 60 * bytesPerSecond) / 1e9;
}

/**
 * Everything the operator reasons from, read straight out of the station's own tables.
 * No network calls: this runs unattended before dawn and must not fail on a flaky fetch.
 */
export async function gatherStationSignals(db) {
  const audience = await readRadioAudience(AUDIENCE_WINDOW_DAYS);

  const [catalogueRows, mixRows, showRows, playRows, issueRows, eventRows, submissionRows] = await Promise.all([
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'rotation')::int AS rotation_tracks,
        COUNT(*) FILTER (WHERE status = 'preview')::int AS preview_tracks,
        COUNT(*) FILTER (WHERE status = 'held')::int AS held_tracks,
        COALESCE(SUM(byte_size), 0)::bigint AS track_bytes
      FROM halo_radio_tracks
    `,
    db.sql`
      SELECT
        COUNT(*)::int AS mixes,
        COUNT(*) FILTER (WHERE visibility = 'room')::int AS public_mixes,
        COALESCE(SUM(byte_size), 0)::bigint AS mix_bytes
      FROM halo_mixes
    `,
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'published')::int AS published_shows,
        COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_shows,
        COALESCE(SUM(duration_minutes) FILTER (WHERE status = 'published'), 0)::int AS published_minutes_per_week
      FROM halo_radio_shows
    `,
    db.sql`
      SELECT
        COUNT(*)::int AS plays,
        COUNT(DISTINCT artist_slug)::int AS artists_played,
        COUNT(*) FILTER (WHERE artist_slug IS NULL)::int AS plays_without_artist_page
      FROM halo_radio_play_history
      WHERE started_at >= NOW() - INTERVAL '7 days'
    `,
    db.sql`
      SELECT severity, COUNT(*)::int AS issues
      FROM maintenance_issues
      WHERE status = 'open'
      GROUP BY severity
    `,
    db.sql`
      SELECT COUNT(*)::int AS events
      FROM analytics_events
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `,
    db.sql`
      SELECT COUNT(*)::int AS awaiting_review
      FROM halo_radio_tracks
      WHERE status = 'preview'
        AND created_at >= NOW() - INTERVAL '30 days'
    `
  ]);

  const catalogue = catalogueRows[0] || {};
  const mixes = mixRows[0] || {};
  const shows = showRows[0] || {};
  const plays = playRows[0] || {};

  const storedGb = (count(catalogue.track_bytes) + count(mixes.mix_bytes)) / 1e9;
  const streamedGbPerWeek = estimateStreamedGigabytes(audience.totals.listenerMinutes);
  const projectedMonthlyStreamedGb = streamedGbPerWeek * (30 / AUDIENCE_WINDOW_DAYS);
  const projectedMonthlyBandwidthUsd = projectedMonthlyStreamedGb * COST_ASSUMPTIONS.bandwidthUsdPerGb;
  const projectedMonthlyRequestUsd =
    ((count(eventRows[0]?.events) * (30 / AUDIENCE_WINDOW_DAYS) + SCHEDULED_INVOCATIONS_PER_MONTH) / 10_000) *
    COST_ASSUMPTIONS.requestsUsdPer10k;

  return {
    windowDays: AUDIENCE_WINDOW_DAYS,
    audience: {
      concurrentListenersNow: audience.live.concurrentListeners,
      tuneIns: audience.totals.tuneIns,
      uniqueListeners: audience.totals.uniqueListeners,
      listenerMinutes: audience.totals.listenerMinutes,
      averageSessionMinutes: audience.totals.averageSessionMinutes,
      skips: audience.totals.skips,
      skipRate: audience.totals.skipRate,
      heartbeats: audience.totals.heartbeats,
      rooms: audience.rooms,
      topArtists: audience.artists.slice(0, 10),
      topMixCreators: audience.mixCreators.slice(0, 10),
      daily: audience.daily.slice(0, 14),
      attributionCoverage: audience.coverage
    },
    catalogue: {
      rotationTracks: count(catalogue.rotation_tracks),
      previewTracks: count(catalogue.preview_tracks),
      heldTracks: count(catalogue.held_tracks),
      tracksAwaitingReview: count(submissionRows[0]?.awaiting_review),
      mixes: count(mixes.mixes),
      publicMixes: count(mixes.public_mixes)
    },
    programming: {
      publishedShows: count(shows.published_shows),
      draftShows: count(shows.draft_shows),
      publishedMinutesPerWeek: count(shows.published_minutes_per_week),
      playsLastWeek: count(plays.plays),
      artistsPlayedLastWeek: count(plays.artists_played),
      playsWithoutArtistPage: count(plays.plays_without_artist_page)
    },
    reliability: {
      openIssuesBySeverity: Object.fromEntries(issueRows.map(row => [row.severity, count(row.issues)])),
      openIssues: issueRows.reduce((total, row) => total + count(row.issues), 0)
    },
    cost: {
      assumptions: COST_ASSUMPTIONS,
      storedAudioGb: round(storedGb, 3),
      analyticsEventsLastWeek: count(eventRows[0]?.events),
      scheduledInvocationsPerMonth: SCHEDULED_INVOCATIONS_PER_MONTH,
      estimatedStreamedGbLastWeek: round(streamedGbPerWeek, 3),
      projectedMonthlyStreamedGb: round(projectedMonthlyStreamedGb, 2),
      projectedMonthlyBandwidthUsd: round(projectedMonthlyBandwidthUsd),
      projectedMonthlyRequestUsd: round(projectedMonthlyRequestUsd),
      projectedMonthlyUsageUsd: round(projectedMonthlyBandwidthUsd + projectedMonthlyRequestUsd)
    }
  };
}

const BRIEFING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "stationGrade",
    "headline",
    "summary",
    "confidence",
    "costWatch",
    "programmingMoves",
    "artistSpotlights",
    "priorities",
    "blindSpots"
  ],
  properties: {
    stationGrade: { type: "string", enum: ["healthy", "watch", "at-risk"] },
    headline: { type: "string" },
    summary: { type: "string" },
    confidence: { type: "number" },
    costWatch: {
      type: "object",
      additionalProperties: false,
      required: ["assessment", "biggestDriver", "actions"],
      properties: {
        assessment: { type: "string" },
        biggestDriver: { type: "string" },
        actions: { type: "array", items: { type: "string" } }
      }
    },
    programmingMoves: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["move", "rationale", "evidence", "priority"],
        properties: {
          move: { type: "string" },
          rationale: { type: "string" },
          evidence: { type: "string" },
          priority: { type: "string", enum: ["critical", "high", "medium", "low"] }
        }
      }
    },
    artistSpotlights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["artistName", "why", "suggestedAction"],
        properties: {
          artistName: { type: "string" },
          why: { type: "string" },
          suggestedAction: { type: "string" }
        }
      }
    },
    priorities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "rationale", "expectedMetric", "priority", "needsApproval"],
        properties: {
          title: { type: "string" },
          rationale: { type: "string" },
          expectedMetric: { type: "string" },
          priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
          needsApproval: { type: "boolean" }
        }
      }
    },
    blindSpots: { type: "array", items: { type: "string" } }
  }
};

const SYSTEM_PROMPT = `You are Dawn, HALO Radio's station operator. You run before the owner wakes up and hand them a short, decisive briefing about the radio station and what it costs to run.

Work only from the supplied evidence. Never invent listeners, revenue, rights clearance, contracts, or completed work. If a number is zero or missing, say the measurement is missing rather than implying the audience is zero — telemetry only recently started collecting.

Everything you produce is a proposal for the owner. Never claim to have sent a message, spent money, published content, changed a schedule, contacted an artist, or taken any external action.

Judge the station on listener minutes and returning listeners, not raw tune-ins. Treat a high skip rate as a programming signal. Watch cost as a trend, and be clear that audio bandwidth and deploy count dominate the bill, not the number of functions.

Prefer three to six concrete priorities over a long list. Name what you cannot see. Return JSON only.`;

function fallbackBriefing(signals) {
  const { audience, cost, reliability, catalogue } = signals;
  const noTelemetry = audience.heartbeats === 0;
  const priorities = [];

  if (noTelemetry) {
    priorities.push({
      title: "Confirm radio telemetry is reporting",
      rationale:
        "No listening heartbeats were recorded in the window, so listener minutes cannot be measured yet. This is expected immediately after the telemetry rollout and should resolve once the radio page receives traffic.",
      expectedMetric: "radio_heartbeat events greater than zero",
      priority: "high",
      needsApproval: false
    });
  }
  if (catalogue.tracksAwaitingReview > 0) {
    priorities.push({
      title: `Review ${catalogue.tracksAwaitingReview} submitted tracks waiting on a decision`,
      rationale: "Submissions sitting in preview are supply the station has already attracted but is not broadcasting.",
      expectedMetric: "rotation track count",
      priority: "medium",
      needsApproval: true
    });
  }
  if (reliability.openIssues > 0) {
    priorities.push({
      title: `Clear ${reliability.openIssues} open maintenance issues`,
      rationale: "Open issues recorded by the maintenance scouts are unresolved reliability risk.",
      expectedMetric: "open maintenance issue count",
      priority: "high",
      needsApproval: false
    });
  }

  return {
    stationGrade: reliability.openIssues > 0 ? "watch" : "unknown",
    headline: noTelemetry ? "Station running, audience measurement not yet reporting" : "Automated summary only",
    summary:
      "The AI operator could not complete a briefing, so this is a deterministic summary generated directly from the station's own numbers. Treat it as a status readout rather than analysis.",
    confidence: 0.2,
    costWatch: {
      assessment: `Projected usage cost is about $${cost.projectedMonthlyUsageUsd} per month on current listening, before deploys and the plan fee.`,
      biggestDriver: cost.projectedMonthlyBandwidthUsd >= cost.projectedMonthlyRequestUsd ? "audio bandwidth" : "request volume",
      actions: ["Compare this projection against the Netlify billing dashboard."]
    },
    programmingMoves: [],
    artistSpotlights: [],
    priorities,
    blindSpots: ["The AI operator did not run for this briefing."]
  };
}

function normalizeBriefing(raw, signals) {
  const grades = new Set(["healthy", "watch", "at-risk"]);
  const priorities = new Set(["critical", "high", "medium", "low"]);
  const text = (value, limit) => String(value || "").trim().slice(0, limit);
  const list = value => (Array.isArray(value) ? value : []);

  return {
    stationGrade: grades.has(raw?.stationGrade) ? raw.stationGrade : "unknown",
    headline: text(raw?.headline, 200) || "Radio operator briefing",
    summary: text(raw?.summary, 4000),
    confidence: Math.min(Math.max(Number(raw?.confidence) || 0.5, 0), 1),
    costWatch: {
      assessment: text(raw?.costWatch?.assessment, 800),
      biggestDriver: text(raw?.costWatch?.biggestDriver, 200),
      actions: list(raw?.costWatch?.actions).slice(0, 6).map(item => text(item, 300)).filter(Boolean)
    },
    programmingMoves: list(raw?.programmingMoves)
      .slice(0, 8)
      .map(item => ({
        move: text(item?.move, 300),
        rationale: text(item?.rationale, 600),
        evidence: text(item?.evidence, 400),
        priority: priorities.has(item?.priority) ? item.priority : "medium"
      }))
      .filter(item => item.move),
    artistSpotlights: list(raw?.artistSpotlights)
      .slice(0, 6)
      .map(item => ({
        artistName: text(item?.artistName, 140),
        why: text(item?.why, 500),
        suggestedAction: text(item?.suggestedAction, 300)
      }))
      .filter(item => item.artistName),
    priorities: list(raw?.priorities)
      .slice(0, 8)
      .map(item => ({
        title: text(item?.title, 200),
        rationale: text(item?.rationale, 600),
        expectedMetric: text(item?.expectedMetric, 200),
        priority: priorities.has(item?.priority) ? item.priority : "medium",
        // Every real-world action stays behind owner approval regardless of what the model says.
        needsApproval: item?.needsApproval !== false
      }))
      .filter(item => item.title),
    blindSpots: list(raw?.blindSpots).slice(0, 8).map(item => text(item, 300)).filter(Boolean),
    signalsUsed: signals.windowDays
  };
}

/**
 * Runs the model over the gathered signals. Falls back to a deterministic readout so the
 * briefing still lands if inference is unavailable.
 */
export async function composeBriefing(signals, briefingDate = new Date().toISOString().slice(0, 10)) {
  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create(
      {
        model: OPERATOR_MODEL,
        max_completion_tokens: 1600,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              date: briefingDate,
              stationMission:
                "Prove HALO Radio can measurably deliver an audience to independent artists, and keep the running cost proportionate to that audience.",
              signals
            })
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "halo_radio_operator_briefing", strict: true, schema: BRIEFING_SCHEMA }
        }
      },
      { signal: AbortSignal.timeout(20_000) }
    );
    return {
      briefing: normalizeBriefing(JSON.parse(completion.choices[0]?.message?.content || "{}"), signals),
      usedFallback: false,
      errorSummary: ""
    };
  } catch (error) {
    return {
      briefing: normalizeBriefing(fallbackBriefing(signals), signals),
      usedFallback: true,
      errorSummary: error instanceof Error ? error.message.slice(0, 1000) : "unknown error"
    };
  }
}

/**
 * Runs the dawn briefing and stores it. One briefing per date: a manual re-run replaces
 * that day's row rather than stacking duplicates.
 */
export async function runRadioOperator(db, { triggerType = "scheduled" } = {}) {
  const id = randomUUID();
  const briefingDate = new Date().toISOString().slice(0, 10);
  const signals = await gatherStationSignals(db);
  const { briefing, usedFallback, errorSummary } = await composeBriefing(signals, briefingDate);

  const rows = await db.sql`
    INSERT INTO halo_radio_operator_briefings (
      id, briefing_date, trigger_type, status, model, station_grade, headline, summary,
      confidence, signals, cost_watch, programming_moves, artist_spotlights, priorities,
      blind_spots, used_fallback, error_summary
    )
    VALUES (
      ${id}, ${briefingDate}::date, ${triggerType}, 'complete', ${OPERATOR_MODEL},
      ${briefing.stationGrade}, ${briefing.headline}, ${briefing.summary}, ${briefing.confidence},
      ${JSON.stringify(signals)}::jsonb, ${JSON.stringify(briefing.costWatch)}::jsonb,
      ${JSON.stringify(briefing.programmingMoves)}::jsonb, ${JSON.stringify(briefing.artistSpotlights)}::jsonb,
      ${JSON.stringify(briefing.priorities)}::jsonb, ${JSON.stringify(briefing.blindSpots)}::jsonb,
      ${usedFallback}, ${errorSummary}
    )
    ON CONFLICT (briefing_date) DO UPDATE SET
      trigger_type = EXCLUDED.trigger_type,
      status = EXCLUDED.status,
      model = EXCLUDED.model,
      station_grade = EXCLUDED.station_grade,
      headline = EXCLUDED.headline,
      summary = EXCLUDED.summary,
      confidence = EXCLUDED.confidence,
      signals = EXCLUDED.signals,
      cost_watch = EXCLUDED.cost_watch,
      programming_moves = EXCLUDED.programming_moves,
      artist_spotlights = EXCLUDED.artist_spotlights,
      priorities = EXCLUDED.priorities,
      blind_spots = EXCLUDED.blind_spots,
      used_fallback = EXCLUDED.used_fallback,
      error_summary = EXCLUDED.error_summary,
      updated_at = NOW()
    RETURNING id, briefing_date
  `;

  return {
    id: rows[0]?.id || id,
    briefingDate,
    triggerType,
    model: OPERATOR_MODEL,
    usedFallback,
    ...briefing,
    signals
  };
}

export function serializeBriefingRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    briefingDate: row.briefing_date instanceof Date
      ? row.briefing_date.toISOString().slice(0, 10)
      : String(row.briefing_date).slice(0, 10),
    triggerType: row.trigger_type,
    status: row.status,
    model: row.model,
    stationGrade: row.station_grade,
    headline: row.headline,
    summary: row.summary,
    confidence: Number(row.confidence),
    costWatch: row.cost_watch || {},
    programmingMoves: row.programming_moves || [],
    artistSpotlights: row.artist_spotlights || [],
    priorities: row.priorities || [],
    blindSpots: row.blind_spots || [],
    usedFallback: row.used_fallback,
    signals: row.signals || {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}
