import { getDatabase } from "@netlify/database";

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

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function signalScore(release) {
  const votes = Number(release.votes || 0);
  const listens = Number(release.listens || 0);
  const opens = Number(release.opens || 0);
  return votes * 2 + listens + opens;
}

function serializeRelease(row) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    status: normalizeStatus(row.status),
    votes: Number(row.votes || 0),
    listens: Number(row.listens || 0),
    opens: Number(row.opens || 0),
    signalScore: signalScore(row),
    audioUrl: row.audio_url || row.stream_url || "",
    coverArtUrl: row.cover_art_url || row.artwork_url || "",
    description: row.description || "",
    artistSlug: row.artist_slug || "",
    releaseDate: row.release_date ? String(row.release_date).slice(0, 10) : ""
  };
}

export default async function chartHandler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (request.method === "GET") {
    try {
      const db = getDatabase();
      const rows = await db.sql`
        SELECT
          release.id,
          release.title,
          release.artist,
          release.status,
          release.release_date,
          release.artist_slug,
          release.audio_url,
          release.stream_url,
          release.artwork_url,
          release.description,
          COALESCE(chart.votes, 0)::int AS votes,
          COALESCE(chart.listens, 0)::int AS listens,
          COALESCE(chart.opens, 0)::int AS opens
        FROM halo_release_campaigns release
        LEFT JOIN halo_chart_votes chart ON chart.release_id = release.id
        WHERE release.status = 'published'
        ORDER BY votes DESC, listens DESC, opens DESC, release.release_date DESC NULLS LAST
        LIMIT 50
      `;
      return json({ releases: rows.map(serializeRelease) });
    } catch (error) {
      console.error("HALO chart load failed", error instanceof Error ? error.message : error);
      return json({ message: "The chart is temporarily unavailable" }, 500);
    }
  }

  if (request.method === "POST") {
    try {
      const body = await request.json().catch(() => ({}));
      const trackId = String(body.trackId || "").trim();
      if (!trackId) return json({ message: "Missing trackId" }, 400);

      const db = getDatabase();
      const result = await db.sql`
        INSERT INTO halo_chart_votes (release_id, votes, listens, opens, updated_at)
        VALUES (${trackId}, 1, 0, 0, NOW())
        ON CONFLICT (release_id)
        DO UPDATE SET votes = halo_chart_votes.votes + 1, updated_at = NOW()
        RETURNING release_id AS "releaseId", votes
      `;

      return json({ success: true, releaseId: result[0]?.releaseId || trackId, votes: Number(result[0]?.votes || 1) });
    } catch (error) {
      console.error("HALO vote update failed", error instanceof Error ? error.message : error);
      return json({ message: "The vote could not be recorded" }, 500);
    }
  }

  return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST, OPTIONS" });
}

export const config = {
  path: "/api/catalog/chart"
};
