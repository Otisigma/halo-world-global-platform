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
    importedArtworkUrl: row.imported_artwork_url,
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
    isCleanVersion: Boolean(row.is_clean_version),
    isChartEligible: Boolean(row.is_chart_eligible),
    purchaseUrl: row.purchase_url || "",
    streamUrl: row.stream_url || "",
    featuredType: row.featured_type || "",
    featuredUntil: row.featured_until ? String(row.featured_until).slice(0, 10) : "",
    artistSlug: row.artist_slug || "",
    catalog: {
      source: row.catalog_song_id ? "song-catalog" : "release-catalog",
      songId: row.catalog_song_id || "",
      artistName: row.catalog_artist_name || row.artist,
      title: row.catalog_title || row.title,
      rightsStatus: row.catalog_rights_status || "",
      saleStatus: row.catalog_sale_status || "",
      metadataStatus: row.catalog_metadata_status || "",
      salePriceCents: row.catalog_sale_price_cents === null ? null : Number(row.catalog_sale_price_cents),
      currency: row.catalog_currency || "USD",
      versionCount: Number(row.catalog_version_count || 0),
      saleEnabledVersionCount: Number(row.catalog_sale_enabled_count || 0)
    },
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
        release.artist_slug,
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
        release.is_clean_version,
        release.is_chart_eligible,
        release.purchase_url,
        release.stream_url,
        release.featured_type,
        release.featured_until,
        engagement.recent_opens,
        engagement.recent_listens,
        engagement.previous_opens,
        engagement.previous_listens,
        catalog.catalog_song_id,
        catalog.catalog_artist_name,
        catalog.catalog_title,
        catalog.catalog_rights_status,
        catalog.catalog_sale_status,
        catalog.catalog_metadata_status,
        catalog.catalog_sale_price_cents,
        catalog.catalog_currency,
        catalog_versions.catalog_version_count,
        catalog_versions.catalog_sale_enabled_count
      FROM halo_release_campaigns release
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (
            WHERE event.event_type = 'kit_open'
              AND event.created_at >= NOW() - INTERVAL '7 days'
          )::int AS recent_opens,
          COUNT(*) FILTER (
            WHERE event.event_type = 'outbound_click'
              AND event.created_at >= NOW() - INTERVAL '7 days'
          )::int AS recent_listens,
          COUNT(*) FILTER (
            WHERE event.event_type = 'kit_open'
              AND event.created_at >= NOW() - INTERVAL '14 days'
              AND event.created_at < NOW() - INTERVAL '7 days'
          )::int AS previous_opens,
          COUNT(*) FILTER (
            WHERE event.event_type = 'outbound_click'
              AND event.created_at >= NOW() - INTERVAL '14 days'
              AND event.created_at < NOW() - INTERVAL '7 days'
          )::int AS previous_listens
        FROM halo_release_campaign_events event
        WHERE event.release_id = release.id
          AND event.created_at >= NOW() - INTERVAL '14 days'
      ) engagement ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          song.id AS catalog_song_id,
          song.artist_name AS catalog_artist_name,
          song.title AS catalog_title,
          song.rights_status AS catalog_rights_status,
          song.sale_status AS catalog_sale_status,
          song.metadata_status AS catalog_metadata_status,
          song.sale_price_cents AS catalog_sale_price_cents,
          song.currency AS catalog_currency
        FROM halo_song_catalog song
        WHERE song.source_release_id = release.id
          AND song.status = 'active'
        ORDER BY song.updated_at DESC
        LIMIT 1
      ) catalog ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS catalog_version_count,
          COUNT(*) FILTER (
            WHERE version.sale_enabled = TRUE
          )::int AS catalog_sale_enabled_count
        FROM halo_song_versions version
        WHERE version.song_id = catalog.catalog_song_id
          AND version.status = 'active'
      ) catalog_versions ON TRUE
      WHERE release.status = 'published'
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
