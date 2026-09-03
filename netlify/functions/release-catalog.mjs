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

function cleanHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function importedArtworkSourceLabel(url) {
  const cleaned = cleanHttpsUrl(url);
  if (!cleaned) return "";
  const host = new URL(cleaned).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const isDistrokidImportHost = host === "distrokid.imgix.net" || host.endsWith(".distrokid.imgix.net")
    || host === "distrokid.com" || host.endsWith(".distrokid.com");
  if (isDistrokidImportHost) return "DistroKid import";
  return `Imported from ${host}`;
}

function serializeRelease(row) {
  const artwork = resolveReleaseArtworkFields({
    artworkUrl: row.artwork_url,
    importedArtworkUrl: row.imported_artwork_url,
    artworkOverrideUrl: row.artwork_override_url
  });
  const videoUrl = cleanHttpsUrl(row.video_url);
  const fallbackTrackId = typeof row.dreamweaver_fallback_track_id === "string" ? row.dreamweaver_fallback_track_id : "";
  const playbackStatus = videoUrl ? "real_video" : fallbackTrackId ? "dreamweaver_fallback" : "pending_video";
  const importedArtworkSource = importedArtworkSourceLabel(artwork.importedArtwork);
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    releaseDate: row.release_date ? String(row.release_date).slice(0, 10) : "",
    duration: row.duration || "",
    genres: Array.isArray(row.genres) ? row.genres : [],
    artwork: artwork.artwork,
    importedArtwork: artwork.importedArtwork,
    importedArtworkSource,
    artworkVerifiedImported: Boolean(artwork.importedArtwork),
    artworkOverride: artwork.artworkOverride,
    artworkSource: artwork.artworkSource,
    artworkLockState: artwork.artworkOverride ? "manual_lock" : artwork.importedArtwork ? "import_lock" : "unlocked",
    bpm: row.bpm === null ? null : Number(row.bpm),
    musicalKey: row.musical_key || "",
    contentRating: row.content_rating || "unspecified",
    pitch: row.pitch || "",
    availableVersions: Array.isArray(row.available_versions) ? row.available_versions : [],
    isCleanVersion: Boolean(row.is_clean_version),
    isChartEligible: Boolean(row.is_chart_eligible),
    purchaseUrl: row.purchase_url || "",
    streamUrl: row.stream_url || "",
    featuredType: row.featured_type || "",
    featuredUntil: row.featured_until ? String(row.featured_until).slice(0, 10) : "",
    videoTitle: row.video_title || "",
    videoUrl,
    dreamweaverFallbackTrackId: fallbackTrackId,
    dreamweaverFallbackAudioUrl: fallbackTrackId ? `/api/radio/audio?id=${encodeURIComponent(fallbackTrackId)}` : "",
    playbackStatus,
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

function isOptionalCatalogMetadataError(error) {
  const message = String(error instanceof Error ? error.message : error || "").toLowerCase();
  if (!message.includes("does not exist")) return false;
  const missingFallbackRelation = message.includes("halo_radio_tracks");
  const missingFallbackReleaseLink = missingFallbackRelation && message.includes("release_id");
  const missingFallbackAlias = message.includes("dreamweaver_fallback_track_id");
  const missingVideoColumns = isOptionalVideoMetadataError(error);
  return missingFallbackRelation || missingFallbackReleaseLink || missingFallbackAlias || missingVideoColumns;
}

function isOptionalVideoMetadataError(error) {
  const message = String(error instanceof Error ? error.message : error || "").toLowerCase();
  return message.includes("does not exist") && (message.includes("video_url") || message.includes("video_title"));
}

async function queryCatalogRowsWithFallback(db) {
  return db.sql`
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
      release.video_title,
      release.video_url,
      release.bpm,
      release.musical_key,
      release.content_rating,
      release.pitch,
      release.available_versions,
      release.is_clean_version,
      release.is_chart_eligible,
      release.purchase_url,
      release.stream_url,
      release.featured_type,
      release.featured_until,
      fallback_track.id AS dreamweaver_fallback_track_id,
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
    LEFT JOIN LATERAL (
      SELECT track.id
      FROM halo_radio_tracks track
      WHERE track.release_id = release.id
        AND track.status = 'rotation'
      ORDER BY track.updated_at DESC, track.created_at DESC
      LIMIT 1
    ) fallback_track ON TRUE
    LEFT JOIN halo_release_campaign_events event
      ON event.release_id = release.id
      AND event.created_at >= NOW() - INTERVAL '14 days'
    WHERE release.status = 'published'
    GROUP BY release.id, fallback_track.id
    ORDER BY release.release_date DESC NULLS LAST, release.updated_at DESC
    LIMIT 200
  `;
}

async function queryCatalogRowsWithoutFallback(db) {
  return db.sql`
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
      release.video_title,
      release.video_url,
      release.bpm,
      release.musical_key,
      release.content_rating,
      release.pitch,
      release.available_versions,
      release.is_clean_version,
      release.is_chart_eligible,
      release.purchase_url,
      release.stream_url,
      release.featured_type,
      release.featured_until,
      ''::text AS dreamweaver_fallback_track_id,
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
}

async function queryCatalogRowsWithoutFallbackOrVideo(db) {
  return db.sql`
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
      ''::text AS video_title,
      ''::text AS video_url,
      release.bpm,
      release.musical_key,
      release.content_rating,
      release.pitch,
      release.available_versions,
      release.is_clean_version,
      release.is_chart_eligible,
      release.purchase_url,
      release.stream_url,
      release.featured_type,
      release.featured_until,
      ''::text AS dreamweaver_fallback_track_id,
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
}

async function loadCatalogRows(db) {
  try {
    return await queryCatalogRowsWithFallback(db);
  } catch (error) {
    if (!isOptionalCatalogMetadataError(error)) throw error;
    console.warn("HALO release catalog optional fallback lookup unavailable; serving published releases without fallback tracks");
  }
  try {
    return await queryCatalogRowsWithoutFallback(db);
  } catch (error) {
    if (!isOptionalVideoMetadataError(error)) throw error;
    console.warn("HALO release catalog optional video columns unavailable; serving published releases without video metadata");
    return await queryCatalogRowsWithoutFallbackOrVideo(db);
  }
}

export default async function releaseCatalogHandler(request) {
  if (request.method !== "GET") {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET" });
  }

  try {
    const db = getDatabase();
    const rows = await loadCatalogRows(db);
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
