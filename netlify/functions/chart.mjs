import { getDatabase } from "@netlify/database";
import {
  chartVoterKey,
  isValidReleaseId,
  normalizeChartSort,
  rankChartReleases,
  serializeChartRelease
} from "../lib/catalog-chart.mjs";

const CHART_PATH = "/api/catalog/chart";
const VOTE_PATH = "/api/catalog/vote";
const CHART_LIMIT = 50;

const CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Length"
});

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

async function loadChart(request) {
  const sort = normalizeChartSort(new URL(request.url).searchParams.get("sort"));
  const db = getDatabase();
  const rows = await db.sql`
    SELECT
      release.id,
      release.title,
      release.artist,
      release.status,
      release.release_date,
      release.genres,
      release.artist_slug,
      release.artwork_url,
      release.imported_artwork_url,
      release.artwork_override_url,
      release.stream_url,
      release.pitch,
      COALESCE(votes.votes, 0)::int AS votes,
      COALESCE(engagement.recent_listens, 0)::int AS recent_listens,
      COALESCE(engagement.recent_opens, 0)::int AS recent_opens
    FROM halo_release_campaigns release
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS votes
      FROM halo_chart_votes vote
      WHERE vote.release_id = release.id
    ) votes ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE event.event_type = 'outbound_click')::int AS recent_listens,
        COUNT(*) FILTER (WHERE event.event_type = 'kit_open')::int AS recent_opens
      FROM halo_release_campaign_events event
      WHERE event.release_id = release.id
        AND event.created_at >= NOW() - INTERVAL '7 days'
    ) engagement ON TRUE
    WHERE release.status = 'published'
      AND release.is_chart_eligible = TRUE
    ORDER BY release.release_date DESC NULLS LAST, release.id ASC
    LIMIT 200
  `;
  const releases = rankChartReleases(rows.map(serializeChartRelease), sort).slice(0, CHART_LIMIT);
  return json({ sort, releases, count: releases.length });
}

async function recordVote(request, context) {
  if (!String(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    return json({ message: "Votes must be sent as JSON" }, 415);
  }
  const body = await request.json().catch(() => ({}));
  const releaseId = String(body?.releaseId || body?.trackId || "").trim();
  if (!isValidReleaseId(releaseId)) return json({ message: "A valid releaseId is required" }, 400);

  const voterKey = chartVoterKey({
    ip: context?.ip || request.headers.get("x-nf-client-connection-ip") || "",
    userAgent: request.headers.get("user-agent") || ""
  });
  const db = getDatabase();
  const inserted = await db.sql`
    INSERT INTO halo_chart_votes (release_id, voter_key)
    SELECT release.id, ${voterKey}
    FROM halo_release_campaigns release
    WHERE release.id = ${releaseId}
      AND release.status = 'published'
      AND release.is_chart_eligible = TRUE
    ON CONFLICT (release_id, voter_key, vote_day) DO NOTHING
    RETURNING release_id
  `;
  const totals = await db.sql`
    SELECT release.id, COUNT(vote.release_id)::int AS votes
    FROM halo_release_campaigns release
    LEFT JOIN halo_chart_votes vote ON vote.release_id = release.id
    WHERE release.id = ${releaseId}
      AND release.status = 'published'
      AND release.is_chart_eligible = TRUE
    GROUP BY release.id
  `;
  if (!totals.length) return json({ message: "That release is not on the chart" }, 404);
  const counted = inserted.length > 0;
  return json({
    success: true,
    releaseId,
    votes: Number(totals[0].votes || 0),
    counted,
    alreadyVoted: !counted
  }, counted ? 201 : 200);
}

export default async function chartHandler(request, context) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  const { pathname } = new URL(request.url);

  if (pathname === VOTE_PATH) {
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405, { Allow: "POST, OPTIONS" });
    try {
      return await recordVote(request, context);
    } catch (error) {
      console.error("HALO chart vote failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "The vote could not be recorded" }, 500);
    }
  }

  if (request.method !== "GET") return json({ message: "Method not allowed" }, 405, { Allow: "GET, OPTIONS" });
  try {
    return await loadChart(request);
  } catch (error) {
    console.error("HALO chart load failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The chart is temporarily unavailable" }, 500);
  }
}

export const config = {
  path: ["/api/catalog/chart", "/api/catalog/vote"]
};
