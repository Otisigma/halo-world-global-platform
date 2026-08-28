import { getDatabase } from "@netlify/database";
import { resolveReleaseArtworkFields } from "../lib/release-artwork.mjs";

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      ...headers
    }
  });
}

function serializeRelease(row) {
  const artwork = resolveReleaseArtworkFields({
    artworkUrl: row.artwork_url,
    importedArtworkUrl: row.imported_artwork_url || row.artwork_url,
    artworkOverrideUrl: row.artwork_override_url
  });
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    releaseDate: row.release_date ? String(row.release_date).slice(0, 10) : "",
    duration: row.duration || "",
    genres: Array.isArray(row.genres) ? row.genres : [],
    artwork: artwork.artwork,
    importedArtwork: artwork.importedArtwork,
    artworkOverride: artwork.artworkOverride,
    artworkSource: artwork.artworkSource,
    bpm: row.bpm === null ? null : Number(row.bpm),
    musicalKey: row.musical_key || "",
    contentRating: row.content_rating || "unspecified",
    pitch: row.pitch || "",
    availableVersions: Array.isArray(row.available_versions) ? row.available_versions : [],
    chartActivity: {
      recentOpens: Number(row.recent_opens || 0),
      recentListens: Number(row.recent_listens || 0),
      previousOpens: Number(row.previous_opens || 0),
      previousListens: Number(row.previous_listens || 0)
    },
    listenUrl: `/api/release-link?slug=${encodeURIComponent(row.id)}&audience=fan`,
    kitUrl: `/release-kit.html?slug=${encodeURIComponent(row.id)}&audience=fan`
  };
}

export default async function releaseCatalogHandler(request) {
  if (request.method !== "GET") {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET" });
  }

  try {
    const db = getDatabase();
    const rows = await db.sql`
      SELECT
        release.id,
        release.title,
        release.artist,
        release.release_date,
        release.duration,
        release.genres,
        release.artwork_url,
        release.imported_artwork_url,
        release.artwork_override_url,
        release.bpm,
        release.musical_key,
        release.content_rating,
        release.pitch,
        release.available_versions,
        COUNT(event.id) FILTER (
          WHERE event.event_type = 'kit_open'
            AND event.created_at >= NOW() - INTERVAL '7 days'
        )::int AS recent_opens,
        COUNT(event.id) FILTER (
          WHERE event.event_type = 'outbound_click'
            AND event.created_at >= NOW() - INTERVAL '7 days'
        )::int AS recent_listens,
        COUNT(event.id) FILTER (
          WHERE event.event_type = 'kit_open'
            AND event.created_at >= NOW() - INTERVAL '14 days'
            AND event.created_at < NOW() - INTERVAL '7 days'
        )::int AS previous_opens,
        COUNT(event.id) FILTER (
          WHERE event.event_type = 'outbound_click'
            AND event.created_at >= NOW() - INTERVAL '14 days'
            AND event.created_at < NOW() - INTERVAL '7 days'
        )::int AS previous_listens
      FROM halo_release_campaigns release
      LEFT JOIN halo_release_campaign_events event
        ON event.release_id = release.id
        AND event.created_at >= NOW() - INTERVAL '14 days'
      WHERE release.status = 'published'
      GROUP BY release.id
      ORDER BY release.release_date DESC NULLS LAST, release.updated_at DESC
      LIMIT 200
    `;
    const releases = rows.map(serializeRelease);
    return json({ releases, count: releases.length });
  } catch (error) {
    console.error("HALO release catalog failed", error instanceof Error ? error.message : "unknown error");
    return json(
      { message: "The HALO music catalog is temporarily unavailable" },
      500,
      { "Cache-Control": "no-store" }
    );
  }
}

export const config = { path: "/api/release-catalog" };
