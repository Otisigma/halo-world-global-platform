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

let databaseModulePromise;

async function loadDatabase() {
  if (!databaseModulePromise) databaseModulePromise = import("@netlify/database");
  const { getDatabase } = await databaseModulePromise;
  return getDatabase();
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

function readText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function readBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "t" || normalized === "1";
  }
  return false;
}

export function serializeRelease(row) {
  const artwork = resolveReleaseArtworkFields({
    artworkUrl: readText(row.artwork_url),
    importedArtworkUrl: readText(row.imported_artwork_url),
    artworkOverrideUrl: readText(row.artwork_override_url)
  });
  const videoUrl = cleanHttpsUrl(readText(row.video_url));
  const fallbackTrackId = readText(row.dreamweaver_fallback_track_id);
  const playbackStatus = videoUrl ? "real_video" : fallbackTrackId ? "dreamweaver_fallback" : "pending_video";
  const importedArtworkSource = importedArtworkSourceLabel(artwork.importedArtwork);
  return {
    id: readText(row.id),
    title: readText(row.title),
    artist: readText(row.artist),
    releaseDate: row.release_date ? String(row.release_date).slice(0, 10) : "",
    duration: readText(row.duration),
    genres: Array.isArray(row.genres) ? row.genres.map(value => readText(value)).filter(Boolean) : [],
    artwork: artwork.artwork,
    importedArtwork: artwork.importedArtwork,
    importedArtworkSource,
    artworkVerifiedImported: Boolean(artwork.importedArtwork),
    artworkOverride: artwork.artworkOverride,
    artworkSource: artwork.artworkSource,
    artworkLockState: artwork.artworkOverride ? "manual_lock" : artwork.importedArtwork ? "import_lock" : "unlocked",
    bpm: Number.isFinite(Number(row.bpm)) ? Number(row.bpm) : null,
    musicalKey: readText(row.musical_key),
    contentRating: readText(row.content_rating) || "unspecified",
    pitch: readText(row.pitch),
    availableVersions: Array.isArray(row.available_versions) ? row.available_versions.map(value => readText(value)).filter(Boolean) : [],
    isCleanVersion: readBoolean(row.is_clean_version),
    isChartEligible: readBoolean(row.is_chart_eligible),
    purchaseUrl: readText(row.purchase_url),
    streamUrl: readText(row.stream_url),
    featuredType: readText(row.featured_type),
    featuredUntil: row.featured_until ? String(row.featured_until).slice(0, 10) : "",
    videoTitle: readText(row.video_title),
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

export async function queryCatalogRows(db) {
  return db.sql`
      SELECT
        release.id,
        release.title,
        release.artist,
        release.release_date,
        release.duration,
        release.genres,
        release.artwork_url,
        to_jsonb(release) ->> 'imported_artwork_url' AS imported_artwork_url,
        to_jsonb(release) ->> 'artwork_override_url' AS artwork_override_url,
        to_jsonb(release) ->> 'video_title' AS video_title,
        to_jsonb(release) ->> 'video_url' AS video_url,
        release.bpm,
        release.musical_key,
        release.content_rating,
        release.pitch,
        release.available_versions,
        to_jsonb(release) ->> 'is_clean_version' AS is_clean_version,
        to_jsonb(release) ->> 'is_chart_eligible' AS is_chart_eligible,
        to_jsonb(release) ->> 'purchase_url' AS purchase_url,
        to_jsonb(release) ->> 'stream_url' AS stream_url,
        to_jsonb(release) ->> 'featured_type' AS featured_type,
        to_jsonb(release) ->> 'featured_until' AS featured_until,
        to_jsonb(fallback_track) ->> 'id' AS dreamweaver_fallback_track_id,
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
        WHERE COALESCE(to_jsonb(track) ->> 'release_id', '') = release.id
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

export default async function releaseCatalogHandler(request) {
  if (request.method !== "GET") {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET" });
  }

  try {
    const db = await loadDatabase();
    const rows = await queryCatalogRows(db);
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
