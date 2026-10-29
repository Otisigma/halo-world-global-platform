import { randomUUID } from "node:crypto";
import { appendLedgerEntry } from "./halo-ledger.mjs";
import { announceTrackDrop } from "./track-drops.mjs";
import { resolveDreamweaverPageFlow } from "./dreamweaver-page-manager.mjs";
import { dreamweaverStorefrontPath } from "./dreamweaver-satellite.mjs";
import { PUBLICATION_ESCALATION_THRESHOLD, buildPublicationHealth, isShopBlockingIssue } from "./song-publication-health.mjs";
import { cleanDreamweaverSongId as cleanId } from "../../lib/dreamweaver-storefront.js";
import { proposedRadioRoom } from "./radio-preparation.mjs";
import { isOwnedMasterObjectKey } from "./direct-upload-storage.mjs";
import { nextShowStart } from "./radio-programming.mjs";

const VERSION_LABELS = {
  sale_master: "Sale master",
  radio_edit: "Radio edit",
  clean: "Clean radio edit",
  instrumental: "Instrumental",
  stems: "Stems package",
  extended: "Extended mix",
  demo: "Demo",
  alternate: "Alternate version",
};

const RADIO_VERSION_PRIORITY = ["radio_edit", "clean"];

export function releaseVersionType(type) {
  const types = {
    sale_master: "master", radio_edit: "radio_edit", clean: "clean", instrumental: "instrumental",
    extended: "extended", demo: "demo", stems: "other", alternate: "other",
  };
  return Object.hasOwn(types, type) ? types[type] : "other";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function publicationPath(releaseId) {
  return `/music/?song=${encodeURIComponent(releaseId)}`;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function isLegacySongCatalogAudioUrl(value) {
  const url = cleanText(value, 1200);
  if (!url) return false;
  try {
    const parsed = new URL(url, "https://halo.world");
    return /^\/api\/song-catalog\/audio$/i.test(parsed.pathname) && Boolean(cleanId(parsed.searchParams.get("versionId")));
  } catch {
    return false;
  }
}

function isLegacyDreamweaverSatelliteUrl(value) {
  const url = cleanText(value, 1200);
  if (!url) return false;
  try {
    const parsed = new URL(url, "https://halo.world");
    return /^\/dreamweaver\/satellite\/[0-9a-f-]+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function verifiedVersion(version, song) {
  const prefix = String(version?.audio_blob_prefix || "");
  const ownedChunks = song && prefix.startsWith(`${song.owner_member_id}/${version.id}/`)
    && prefix.endsWith("/parts/") && !prefix.includes("..");
  const ownedObject = song && version?.audio_storage_key && isOwnedMasterObjectKey(version.audio_storage_key, {
    ownerMemberId: song.owner_member_id, songId: song.id, versionId: version.id,
  });
  return version?.song_id === song?.id && version?.status === "active" && version.mastering_status === "approved"
    && Boolean(ownedChunks || ownedObject)
    && !(prefix && version.audio_storage_key)
    && (!prefix || ownedChunks) && (!version.audio_storage_key || ownedObject)
    && /^audio\//.test(version.audio_content_type || "")
    && Number.isSafeInteger(Number(version.audio_byte_size)) && Number(version.audio_byte_size) > 0
    && Number.isFinite(Number(version.duration_seconds)) && Number(version.duration_seconds) > 0
    && (!prefix
      || (Number.isSafeInteger(Number(version.audio_chunk_count)) && Number(version.audio_chunk_count) > 0));
}

function safeReviewedUrl(value, kind, scope = {}) {
  const text = cleanText(value, 1200);
  if (!text || /[\\\s]/.test(text)) return "";
  if (kind === "artwork" && /^\/assets\/[a-zA-Z0-9/_.-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(text)
    && !text.includes("..")) return text;
  if (kind === "artwork" && text.startsWith("/api/song-catalog/artwork?")) {
    const url = new URL(text, "https://halo.world");
    const keys = [...url.searchParams.keys()];
    if (scope.songId && !url.hash && url.searchParams.get("songId") === scope.songId
      && keys.length === 1 && keys[0] === "songId") return `/api/song-catalog/artwork?songId=${encodeURIComponent(scope.songId)}`;
    if (scope.songId && scope.versionId && !url.hash && keys.length === 2
      && new Set(keys).size === 2 && keys.every(key => ["songId", "versionId"].includes(key))
      && url.searchParams.get("songId") === scope.songId && url.searchParams.get("versionId") === scope.versionId) {
      return `/api/song-catalog/artwork?songId=${encodeURIComponent(scope.songId)}&versionId=${encodeURIComponent(scope.versionId)}`;
    }
    return "";
  }
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return "";
    if (kind === "official" && ["distrokid.com", "www.distrokid.com"].includes(url.hostname)
      && /^\/hyperfollow\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\/?$/.test(url.pathname)
      && [...url.searchParams.keys()].every(key => ["ref", "utm_source", "utm_medium", "utm_campaign"].includes(key))) {
      return `${url.origin}${url.pathname}`;
    }
    if (kind === "artwork" && ["halo.world", "www.halo.world", "cdn.halo.world", "assets.halo.world"].includes(url.hostname)
      && !url.search && !/(?:^|\/)(?:private|signed|auth|token)(?:\/|$)/i.test(url.pathname)
      && /^\/[a-zA-Z0-9/_.-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(url.pathname)
      && !text.includes("..")) return url.href;
  } catch {}
  return "";
}

function verifiedSaleMaster(song, versions) {
  const masters = versions.filter(version => version.version_type === "sale_master");
  if (song.rights_status !== "cleared" || !song.owner_member_id || masters.length !== 1
    || !verifiedVersion(masters[0], song) || masters[0].song_id !== song.id
    || (Array.isArray(song.metadata_issues) && song.metadata_issues.some(isShopBlockingIssue))) {
    throw Object.assign(new Error("Publication requires cleared rights and one approved, active, uploaded sale master with verified duration"), { status: 409 });
  }
  return masters[0];
}

function versionLabel(versionType, label) {
  return cleanText(label, 100) || VERSION_LABELS[versionType] || "Release version";
}

async function loadPublishedSong(db, songId, ownerMemberId, requirePublished = true) {
  const rows = await db.sql`
    SELECT
      song.id,
      song.owner_member_id,
      song.source_release_id,
      song.artist_name,
      song.title,
      song.album_title,
      song.genre,
      song.explicit_lyrics,
      song.rights_status,
      song.sale_status,
      song.sale_price_cents,
      song.currency,
      song.notes,
      song.metadata_status,
      song.metadata_score,
      song.metadata_issues,
      song.artwork_url,
      song.pipeline_status,
      song.broadcast_requested,
      TO_CHAR(song.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS publication_revision,
      membership.actor_id AS owner_actor_id,
      page.slug AS artist_slug
    FROM halo_song_catalog song
    LEFT JOIN halo_memberships membership ON membership.member_id = song.owner_member_id
    LEFT JOIN LATERAL (
      SELECT slug
      FROM halo_artist_pages
      WHERE owner_member_id = song.owner_member_id
        AND (
          LOWER(artist_name) = LOWER(song.artist_name)
          OR LOWER(release_title) = LOWER(song.title)
        )
      ORDER BY CASE WHEN LOWER(release_title) = LOWER(song.title) THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1
    ) page ON TRUE
    WHERE song.id = ${songId}
      AND song.owner_member_id = ${ownerMemberId}
      AND song.status = 'active'
    LIMIT 1
  `;
  if (!rows[0] || (requirePublished && rows[0].pipeline_status !== "published")) return null;
  const versions = await db.sql`
    SELECT
      id,
      song_id,
      version_type,
      label,
      audio_url,
      audio_blob_prefix,
      audio_storage_key,
      audio_chunk_count,
      audio_content_type,
      audio_byte_size,
      audio_filename,
      duration_seconds,
      mastering_status,
      clean_lyrics,
      sale_enabled,
      artwork_url,
      artwork_blob_prefix,
      artwork_content_type,
      updated_at,
      TO_CHAR(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS publication_revision,
      status
    FROM halo_song_versions
    WHERE song_id = ${songId}
      AND status = 'active'
    ORDER BY updated_at DESC
  `;
  return { song: rows[0], versions };
}

async function loadPublicationSyncRow(db, songId) {
  const rows = await db.sql`
    SELECT
      song_id,
      release_id,
      radio_track_id,
      canonical_url,
      release_status,
      radio_status,
      dreamweaver_status,
      details,
      last_error,
      last_reconciled_at
    FROM halo_song_publication_sync
    WHERE song_id = ${songId}
    LIMIT 1
  `;
  return rows[0] || null;
}

function publicationHealthSong(song, versions) {
  return {
    id: song.id,
    sourceReleaseId: song.source_release_id || "",
    artistName: song.artist_name,
    title: song.title,
    rightsStatus: song.rights_status,
    broadcastRequested: song.broadcast_requested === true,
    explicitLyrics: song.explicit_lyrics === true,
    metadataStatus: song.metadata_status,
    metadataIssues: Array.isArray(song.metadata_issues) ? song.metadata_issues : [],
    versions: versions.map(version => ({
      id: version.id,
      updatedAt: version.updated_at ? new Date(version.updated_at).toISOString() : "",
      versionType: version.version_type,
      audioUrl: verifiedVersion(version, song) ? "persisted" : "",
      masteringStatus: version.mastering_status,
      cleanLyrics: version.clean_lyrics === true,
      status: version.status,
      durationSeconds: Number(version.duration_seconds),
      persistedAudio: verifiedVersion(version, song)
    }))
  };
}

async function resolveReleaseId(db, song) {
  const desiredId = song.source_release_id || slugify(`${song.artist_name}-${song.title}`) || slugify(song.title) || song.id;
  const existingById = await db.sql`
    SELECT id, owner_member_id
    FROM halo_release_campaigns
    WHERE id = ${desiredId}
    LIMIT 1
  `;
  if (!existingById[0] || existingById[0].owner_member_id === song.owner_member_id) {
    return desiredId;
  }
  const fallbackId = `${desiredId.slice(0, 80)}-${song.id.slice(0, 8)}`.replace(/-+/g, "-").slice(0, 96);
  return fallbackId;
}

function resolveReleaseDreamweaverFlow(songId, {
  releaseId,
  publicUrl,
  streamUrl,
  officialUrl = "",
} = {}) {
  return resolveDreamweaverPageFlow(songId, {
    mixId: releaseId,
    publicUrl,
    streamUrl,
    officialUrl,
  });
}

async function ensureReleaseCampaign(db, song, versions, preserveReleaseMetadata = false) {
  const releaseId = await resolveReleaseId(db, song);
  const saleMaster = verifiedSaleMaster(song, versions);
  const artworkScope = { songId: song.id, versionId: saleMaster.id };
  const reviewedRows = await db.sql`
    SELECT artwork_url, official_url
    FROM halo_release_campaigns
    WHERE id = ${releaseId} AND owner_member_id = ${song.owner_member_id}
    LIMIT 1
  `;
  const reviewedArtwork = safeReviewedUrl(reviewedRows[0]?.artwork_url, "artwork", artworkScope);
  const reviewedOfficial = safeReviewedUrl(reviewedRows[0]?.official_url, "official");
  const releaseMixId = cleanText(song.source_release_id || releaseId, 120);
  const publicUrl = publicationPath(releaseId);
  for (const version of versions.filter(version => verifiedVersion(version, song) && version.audio_blob_prefix)) {
    const existing = await db.sql`
      SELECT owner_member_id, release_id, version_type, status
      FROM halo_release_audio_versions WHERE blob_key = ${version.audio_blob_prefix}
      LIMIT 1
    `;
    if (existing[0] && (existing[0].owner_member_id !== song.owner_member_id
      || existing[0].release_id !== releaseId || existing[0].version_type !== releaseVersionType(version.version_type)
      || existing[0].status !== "active")) throw new Error("Release audio ownership or archived blob conflict");
  }
  const streamUrl = `/api/song-catalog/audio?versionId=${encodeURIComponent(saleMaster.id)}&dreamweaver=1&songId=${encodeURIComponent(song.id)}`;
  const dreamweaver = resolveReleaseDreamweaverFlow(song.id, { releaseId: releaseMixId, publicUrl, streamUrl });
  const storefrontUrl = dreamweaverStorefrontPath(song.id, { mixId: releaseMixId }) || dreamweaver.page?.storefrontUrl || "";
  const officialUrl = reviewedOfficial || storefrontUrl || publicUrl;
  const artworkUrl = (preserveReleaseMetadata && reviewedArtwork) || (saleMaster.artwork_blob_prefix
    ? `/api/song-catalog/artwork?songId=${encodeURIComponent(song.id)}&versionId=${encodeURIComponent(saleMaster.id)}`
    : safeReviewedUrl(saleMaster.artwork_url, "artwork", artworkScope)
      || safeReviewedUrl(song.artwork_url, "artwork", artworkScope) || reviewedArtwork);
  const availableVersions = [...new Set(
    versions
      .map(version => versionLabel(version.version_type, version.label))
      .filter(Boolean)
  )];
  const pitch = cleanText(song.notes, 500) || `Open ${song.title} by ${song.artist_name} across HALO.`;
  let releaseRows = [];
  if (!releaseRows.length) releaseRows = await db.sql`
    INSERT INTO halo_release_campaigns (
      id,
      owner_member_id,
      artist_slug,
      title,
      artist,
      release_date,
      genres,
      artwork_url,
      official_url,
      pitch,
      available_versions,
      content_rating,
      status,
      release_stage,
      visibility,
      is_clean_version,
      is_chart_eligible,
      purchase_url,
      stream_url
    ) VALUES (
      ${releaseId},
      ${song.owner_member_id},
      ${song.artist_slug || null},
      ${song.title},
      ${song.artist_name},
      CURRENT_DATE,
      ${song.genre ? [song.genre] : []},
      ${artworkUrl},
      ${officialUrl},
      ${pitch},
      ${availableVersions},
      ${song.explicit_lyrics ? "explicit" : "clean"},
      'draft',
      'unreleased',
      'private',
      ${!song.explicit_lyrics},
      FALSE,
      '',
      ${streamUrl}
    )
    ON CONFLICT (id) DO UPDATE SET
      artist_slug = COALESCE(EXCLUDED.artist_slug, halo_release_campaigns.artist_slug),
      title = EXCLUDED.title,
      artist = EXCLUDED.artist,
      genres = EXCLUDED.genres,
      artwork_url = EXCLUDED.artwork_url,
      official_url = EXCLUDED.official_url,
      pitch = CASE
        WHEN halo_release_campaigns.pitch = '' THEN EXCLUDED.pitch
        ELSE halo_release_campaigns.pitch
      END,
      available_versions = EXCLUDED.available_versions,
      content_rating = EXCLUDED.content_rating,
      is_clean_version = EXCLUDED.is_clean_version,
      stream_url = EXCLUDED.stream_url,
      updated_at = NOW()
    WHERE halo_release_campaigns.owner_member_id = EXCLUDED.owner_member_id
    RETURNING id, official_url, stream_url
  `;
  if (!releaseRows[0]) throw new Error("Release ownership conflict");
  if (song.source_release_id !== releaseId) {
    const updatedSong = await db.sql`
      UPDATE halo_song_catalog
      SET source_release_id = ${releaseId}, updated_at = NOW()
      WHERE id = ${song.id}
        AND owner_member_id = ${song.owner_member_id}
        AND updated_at = ${song.publication_revision || null}::timestamptz
      RETURNING TO_CHAR(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS publication_revision
    `;
    if (!updatedSong[0]?.publication_revision) throw new Error("Song ownership changed during publication");
    song.publication_revision = updatedSong[0].publication_revision;
    song.source_release_id = releaseId;
  }
  return {
    id: releaseRows[0]?.id || releaseId,
    officialUrl: releaseRows[0]?.official_url || officialUrl,
    streamUrl: releaseRows[0]?.stream_url || streamUrl,
    publicUrl,
    artworkUrl,
    dreamweaver: resolveReleaseDreamweaverFlow(song.id, {
      releaseId,
      publicUrl,
      streamUrl,
      officialUrl: releaseRows[0]?.official_url || officialUrl,
    }),
  };
}

async function syncReleaseAudioVersions(db, song, versions, releaseId) {
  const versionRows = [];
  for (const version of versions) {
    if (song.rights_status !== "cleared" || version.song_id !== song.id
      || !verifiedVersion(version, song) || !version.audio_blob_prefix) continue;
    const rows = await db.sql`
      INSERT INTO halo_release_audio_versions (
        id,
        release_id,
        owner_member_id,
        version_type,
        version_label,
        blob_key,
        chunk_count,
        content_type,
        byte_size,
        duration_seconds,
        source_filename,
        artwork_key,
        artwork_content_type,
        rights_confirmed,
        status
      ) VALUES (
        ${randomUUID()},
        ${releaseId},
        ${song.owner_member_id},
        ${releaseVersionType(version.version_type)},
        ${cleanText(versionLabel(version.version_type, version.label), 80)},
        ${version.audio_blob_prefix},
        ${Number(version.audio_chunk_count || 1)},
        ${version.audio_content_type},
        ${Number(version.audio_byte_size || 0)},
        ${Number(version.duration_seconds || 0)},
        ${cleanText(version.audio_filename, 255)},
        ${version.artwork_blob_prefix || ""},
        ${version.artwork_content_type || ""},
        TRUE,
        'active'
      )
      ON CONFLICT (blob_key) DO UPDATE SET
        version_label = EXCLUDED.version_label,
        chunk_count = EXCLUDED.chunk_count,
        content_type = EXCLUDED.content_type,
        byte_size = EXCLUDED.byte_size,
        duration_seconds = EXCLUDED.duration_seconds,
        source_filename = EXCLUDED.source_filename,
        artwork_key = EXCLUDED.artwork_key,
        artwork_content_type = EXCLUDED.artwork_content_type,
        rights_confirmed = TRUE,
        updated_at = NOW()
      WHERE halo_release_audio_versions.owner_member_id = EXCLUDED.owner_member_id
        AND halo_release_audio_versions.release_id = EXCLUDED.release_id
        AND halo_release_audio_versions.version_type = EXCLUDED.version_type
        AND halo_release_audio_versions.status = 'active'
      RETURNING id, version_type, blob_key, chunk_count, content_type, byte_size, duration_seconds, source_filename, artwork_key, artwork_content_type
    `;
    if (!rows[0]) throw new Error("Release audio ownership or archived blob conflict");
    versionRows.push({ ...rows[0], source_version_id: version.id, source_revision: version.publication_revision,
      source_clean_lyrics: version.clean_lyrics === true,
      source_updated_at: version.updated_at ? new Date(version.updated_at).toISOString() : "" });
  }
  return versionRows;
}

export async function planRadioShowProposal(db, room, previous = {}, now = new Date()) {
  const shows = await db.sql`
    SELECT id, room, day_of_week, start_time_utc
    FROM halo_radio_shows
    WHERE room = ${room} AND status = 'published'
    ORDER BY id
  `;
  const candidates = shows.map(show => ({ show, startsAt: nextShowStart(show.day_of_week, show.start_time_utc, now) }))
    .filter(candidate => Number.isFinite(candidate.startsAt.getTime()) && candidate.startsAt > now);
  const retained = candidates.find(candidate => previous?.proposedRoom === room
    && candidate.show.id === previous.proposedShowId
    && candidate.startsAt.toISOString() === previous.proposedStartsAt);
  const selected = retained || candidates.sort((left, right) => left.startsAt - right.startsAt
    || String(left.show.id).localeCompare(String(right.show.id)))[0];
  return {
    proposedShowId: selected?.show.id || "",
    proposedStartsAt: selected?.startsAt.toISOString() || "",
    proposedRoom: room,
    approvalRequired: true,
    proposalReason: selected ? "compatible_room_show" : "no_compatible_show",
    ...(!selected ? { nextAction: `Ask the radio operator to publish or resume a compatible show in the ${room} room.` } : {}),
  };
}

async function ensureRadioTrack(db, song, syncedVersions, release, leaseToken, previousProposal = {}) {
  if (song.broadcast_requested !== true) {
    return { status: "queued", trackId: "", details: { reason: "broadcast_not_requested" } };
  }
  const room = proposedRadioRoom(song.genre);
  if (!room) return { status: "queued", trackId: "", details: { reason: "genre_unassigned" } };
  if (!song.owner_actor_id) {
    return {
      status: "queued",
      trackId: "",
      details: { reason: "owner_membership_missing" },
    };
  }
  const existing = await db.sql`
    SELECT id, status, member_id, release_id, audio_version_id, blob_key,
      rights_confirmed, duration_seconds, chunk_count, content_type, byte_size, room,
      reviewed_at, reviewed_by_member_id
    FROM halo_radio_tracks
    WHERE master_song_id = ${song.id}
      AND status IN ('preview', 'rotation', 'held', 'rejected')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (existing[0]?.status === "rejected") {
    return {
      status: "queued",
      trackId: existing[0].id,
      details: { reason: "radio_submission_rejected", verified: false, approvalRequired: true },
    };
  }
  const preferredVersion = RADIO_VERSION_PRIORITY
    .map(type => syncedVersions.find(version => version.version_type === type
      && (!song.explicit_lyrics || version.source_clean_lyrics === true)))
    .find(Boolean);
  if (!preferredVersion) {
    return {
      status: "queued",
      trackId: "",
      details: {
        reason: "radio_master_missing_or_not_uploaded",
        requiredVersionTypes: RADIO_VERSION_PRIORITY,
      },
    };
  }
  const proposal = await planRadioShowProposal(db, room, previousProposal);
  if (existing[0]) {
    const track = existing[0];
    const current = await db.sql`
      SELECT track.id, track.status, track.reviewed_at, track.reviewed_by_member_id
      FROM halo_radio_tracks track
      JOIN halo_song_catalog catalog ON catalog.id = track.master_song_id
      JOIN halo_song_versions source ON source.song_id = catalog.id
      JOIN halo_release_audio_versions persisted ON persisted.id = track.audio_version_id
      JOIN halo_release_campaigns campaign ON campaign.id = persisted.release_id
      WHERE track.id = ${track.id} AND catalog.id = ${song.id}
        AND catalog.owner_member_id = ${song.owner_member_id} AND catalog.status = 'active'
        AND catalog.pipeline_status = 'published' AND catalog.broadcast_requested = TRUE AND catalog.rights_status = 'cleared'
        AND source.id = ${preferredVersion.source_version_id} AND source.status = 'active'
        AND source.mastering_status = 'approved' AND source.version_type = ${preferredVersion.version_type}
        AND source.updated_at = ${preferredVersion.source_revision || null}::timestamptz
        AND (catalog.explicit_lyrics = FALSE OR source.clean_lyrics = TRUE)
        AND source.audio_blob_prefix = ${preferredVersion.blob_key}
        AND source.audio_byte_size = ${Number(preferredVersion.byte_size)}
        AND source.audio_chunk_count = ${Number(preferredVersion.chunk_count)}
        AND source.duration_seconds = ${Number(preferredVersion.duration_seconds)}
        AND source.audio_content_type = ${preferredVersion.content_type}
        AND persisted.id = ${preferredVersion.id} AND persisted.status = 'active' AND persisted.rights_confirmed = TRUE
        AND persisted.owner_member_id = catalog.owner_member_id AND persisted.version_type = source.version_type
        AND campaign.id = ${release.id} AND campaign.owner_member_id = catalog.owner_member_id
        AND campaign.status = 'published' AND campaign.visibility = 'public'
        AND persisted.blob_key = source.audio_blob_prefix AND persisted.byte_size = source.audio_byte_size
        AND persisted.chunk_count = source.audio_chunk_count AND persisted.duration_seconds = source.duration_seconds
        AND persisted.content_type = source.audio_content_type
        AND track.member_id = catalog.owner_member_id AND track.release_id = campaign.id
        AND track.blob_key = persisted.blob_key AND track.byte_size = persisted.byte_size
        AND track.chunk_count = persisted.chunk_count AND track.duration_seconds = persisted.duration_seconds
        AND track.content_type = persisted.content_type AND track.rights_confirmed = TRUE
        AND track.room = ${room} AND track.status IN ('preview', 'rotation', 'held')
        AND catalog.updated_at = ${song.publication_revision || null}::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(catalog.metadata_issues, '[]'::jsonb)) issue
          WHERE issue->>'level' = 'required'
            AND COALESCE(issue->>'field', '') NOT IN ('radio_edit', 'radio_audio', 'radio_master')
        )
    `;
    const operatorReviewed = Boolean(current[0]?.reviewed_at)
      && Boolean(cleanText(current[0]?.reviewed_by_member_id, 120));
    const operatorReviewRequired = (current[0]?.status || track.status) === "rotation" && !operatorReviewed;
    const matches = Boolean(current[0]) && !operatorReviewRequired
      && track.member_id === song.owner_member_id && track.release_id === release.id
      && track.audio_version_id === preferredVersion.id && track.blob_key === preferredVersion.blob_key
      && track.rights_confirmed === true && Number(track.duration_seconds) === Number(preferredVersion.duration_seconds)
      && Number(track.byte_size) === Number(preferredVersion.byte_size)
      && Number(track.chunk_count) === Number(preferredVersion.chunk_count)
      && track.content_type === preferredVersion.content_type && track.room === room;
    return {
      status: matches ? current[0].status : "queued",
      trackId: track.id,
      details: { reason: operatorReviewRequired ? "operator_review_required"
        : proposal.proposalReason === "no_compatible_show" ? "no_compatible_show"
        : matches ? "existing_track_verified" : "existing_track_requires_operator_review", verified: matches,
        operatorReviewed,
        ...proposal,
        sourceVersionId: preferredVersion.source_version_id, sourceUpdatedAt: preferredVersion.source_updated_at },
    };
  }
  const trackId = randomUUID();
  const inserted = await db.sql`
    WITH lease AS (
      UPDATE halo_song_publication_leases SET expires_at = NOW() + INTERVAL '5 minutes'
      WHERE song_id = ${song.id} AND token = ${leaseToken} AND expires_at > NOW()
      RETURNING song_id
    )
    INSERT INTO halo_radio_tracks (
      id,
      member_id,
      actor_id,
      artist_slug,
      release_id,
      master_song_id,
      audio_version_id,
      room,
      title,
      artist_name,
      description,
      genre,
      blob_key,
      chunk_count,
      content_type,
      byte_size,
      duration_seconds,
      rights_confirmed,
      status,
      source_filename,
      artwork_key,
      artwork_content_type,
      source_url
    ) SELECT
      ${trackId},
      ${song.owner_member_id},
      ${song.owner_actor_id},
      ${song.artist_slug || null},
      ${release.id},
      ${song.id},
      ${preferredVersion.id},
      ${room},
      ${song.title},
      ${song.artist_name},
      ${cleanText(song.notes, 500)},
      ${cleanText(song.genre, 80)},
      ${preferredVersion.blob_key},
      ${Number(preferredVersion.chunk_count || 1)},
      ${preferredVersion.content_type},
      ${Number(preferredVersion.byte_size || 0)},
      ${Number(preferredVersion.duration_seconds || 0)},
      TRUE,
      'preview',
      ${preferredVersion.source_filename || ""},
      ${preferredVersion.artwork_key || ""},
      ${preferredVersion.artwork_content_type || ""},
      ${release.publicUrl}
    FROM lease
    WHERE NOT EXISTS (
      SELECT 1 FROM halo_radio_tracks
      WHERE master_song_id = ${song.id} AND status IN ('preview', 'rotation', 'held', 'rejected')
    )
      AND EXISTS (
        SELECT 1
        FROM halo_song_catalog catalog
        JOIN halo_song_versions source ON source.song_id = catalog.id
        JOIN halo_release_audio_versions persisted ON persisted.id = ${preferredVersion.id}
        JOIN halo_release_campaigns campaign ON campaign.id = persisted.release_id
        WHERE catalog.id = ${song.id} AND catalog.owner_member_id = ${song.owner_member_id}
          AND catalog.status = 'active' AND catalog.pipeline_status = 'published'
          AND catalog.broadcast_requested = TRUE AND catalog.rights_status = 'cleared'
          AND source.id = ${preferredVersion.source_version_id} AND source.status = 'active'
          AND source.mastering_status = 'approved' AND source.version_type = ${preferredVersion.version_type}
          AND source.updated_at = ${preferredVersion.source_revision || null}::timestamptz
          AND (catalog.explicit_lyrics = FALSE OR source.clean_lyrics = TRUE)
          AND source.audio_blob_prefix = ${preferredVersion.blob_key}
          AND source.audio_byte_size = ${Number(preferredVersion.byte_size)}
          AND source.audio_chunk_count = ${Number(preferredVersion.chunk_count)}
          AND source.duration_seconds = ${Number(preferredVersion.duration_seconds)}
          AND source.audio_content_type = ${preferredVersion.content_type}
          AND persisted.status = 'active' AND persisted.rights_confirmed = TRUE
          AND persisted.owner_member_id = catalog.owner_member_id AND persisted.version_type = source.version_type
          AND persisted.blob_key = source.audio_blob_prefix AND persisted.byte_size = source.audio_byte_size
          AND persisted.chunk_count = source.audio_chunk_count AND persisted.duration_seconds = source.duration_seconds
          AND persisted.content_type = source.audio_content_type
          AND campaign.id = ${release.id} AND campaign.owner_member_id = catalog.owner_member_id
          AND campaign.status = 'published' AND campaign.visibility = 'public'
          AND catalog.updated_at = ${song.publication_revision || null}::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(catalog.metadata_issues, '[]'::jsonb)) issue
            WHERE issue->>'level' = 'required'
              AND COALESCE(issue->>'field', '') NOT IN ('radio_edit', 'radio_audio', 'radio_master')
          )
        FOR UPDATE OF catalog, source, persisted, campaign
      )
    RETURNING id
  `;
  if (!inserted[0]) throw new Error("Publication lease expired, radio eligibility changed, or radio track already exists");
  return { status: "preview", trackId: inserted[0].id, details: {
    reason: proposal.proposalReason === "no_compatible_show" ? "no_compatible_show" : "radio_preview_requires_operator_approval", verified: true,
    operatorReviewed: false,
    ...proposal,
    sourceVersionId: preferredVersion.source_version_id, sourceUpdatedAt: preferredVersion.source_updated_at } };
}

async function upsertPublicationSync(db, song, values) {
  await db.sql`
    INSERT INTO halo_song_publication_sync (
      song_id,
      owner_member_id,
      release_id,
      radio_track_id,
      canonical_url,
      release_status,
      radio_status,
      dreamweaver_status,
      details,
      last_error,
      last_reconciled_at,
      updated_at
    ) VALUES (
      ${song.id},
      ${song.owner_member_id},
      ${values.releaseId || null},
      ${values.radioTrackId || null},
      ${values.canonicalUrl || ""},
      ${values.releaseStatus || "pending"},
      ${values.radioStatus || "pending"},
      ${values.dreamweaverStatus || "pending"},
      ${JSON.stringify(values.details || {})}::jsonb,
      ${values.lastError || ""},
      NOW(),
      NOW()
    )
    ON CONFLICT (song_id) DO UPDATE SET
      owner_member_id = EXCLUDED.owner_member_id,
      release_id = EXCLUDED.release_id,
      radio_track_id = EXCLUDED.radio_track_id,
      canonical_url = EXCLUDED.canonical_url,
      release_status = EXCLUDED.release_status,
      radio_status = EXCLUDED.radio_status,
      dreamweaver_status = EXCLUDED.dreamweaver_status,
      details = EXCLUDED.details,
      last_error = EXCLUDED.last_error,
      last_reconciled_at = NOW(),
      updated_at = NOW()
  `;
}

export async function forcePushTrack(db, payload, membership) {
  const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("Provide a track id or title", 400);
  const id = cleanId(payload.id);
  const title = cleanText(payload.title, 180);
  if (payload.id && !id) fail("Choose a valid track id", 400);
  if (!id && !title) fail("Provide a track id or title", 400);
  const matches = id
    ? await db.sql`SELECT id, rights_status FROM halo_song_catalog WHERE id = ${id} AND owner_member_id = ${membership.member_id} AND status = 'active'`
    : await db.sql`SELECT id, rights_status FROM halo_song_catalog WHERE LOWER(title) = LOWER(${title}) AND owner_member_id = ${membership.member_id} AND status = 'active' LIMIT 2`;
  if (!matches.length) fail("That track was not found in your catalog. Save it first.", 404);
  if (matches.length !== 1) fail("More than one track has this title. Use its id.", 409);
  if (matches[0].rights_status === "disputed") fail("Resolve the rights dispute before pushing this song to the shop", 409);
  const context = await loadPublishedSong(db, matches[0].id, membership.member_id, false);
  if (!context) fail("That track was not found", 404);
  verifiedSaleMaster(context.song, context.versions);
  const [song] = await db.sql`
    UPDATE halo_song_catalog
    SET pipeline_status = 'published',
        pipeline_updated_at = NOW(),
        updated_at = NOW(),
        sale_status = 'for_sale',
        currency = CASE WHEN sale_price_cents IS NULL OR sale_price_cents <= 0 THEN 'USD' ELSE currency END,
        sale_price_cents = CASE WHEN sale_price_cents IS NULL OR sale_price_cents <= 0 THEN 129 ELSE sale_price_cents END
    WHERE id = ${matches[0].id} AND owner_member_id = ${membership.member_id} AND status = 'active'
    RETURNING id, title, sale_price_cents, currency, pipeline_updated_at
  `;
  if (!song) fail("That track was not found", 404);
  const result = await reconcilePublishedSong(db, {
    songId: song.id,
    ownerMemberId: membership.member_id,
    actorId: membership.actor_id,
    actorType: "member",
    preserveReleaseMetadata: true,
    announceDrop: true,
  });
  if (!result.ok) fail("Publication could not be confirmed. Retry the push.", 409);
  return {
    success: true,
    message: `"${song.title}" pushed to Shop & Charts`,
    track: {
      id: song.id,
      title: song.title,
      releaseStatus: "PUBLISHED",
      status: "PUBLISHED",
      inChart: true,
      isLiveVisible: true,
      salePriceCents: Number(song.sale_price_cents),
      price: `${song.currency === "USD" ? "US$" : `${song.currency} `}${(Number(song.sale_price_cents) / 100).toFixed(2)}`,
      pushedToLiveAt: new Date(song.pipeline_updated_at).toISOString(),
      releaseId: result.releaseId,
    },
  };
}

async function announceTrackDropSafely(db, input) {
  try {
    return await announceTrackDrop(db, input);
  } catch (error) {
    console.warn("HALO track drop announcement deferred", error instanceof Error ? error.message : "unknown error");
    return { announced: false, reason: "unavailable" };
  }
}

export async function reconcilePublishedSong(db, {
  songId,
  ownerMemberId,
  ...options
} = {}) {
  const token = randomUUID();
  const claimed = await db.sql`
    INSERT INTO halo_song_publication_leases (song_id, token, expires_at)
    SELECT id, ${token}, NOW() + INTERVAL '5 minutes'
    FROM halo_song_catalog
    WHERE id = ${songId} AND owner_member_id = ${ownerMemberId}
      AND status = 'active' AND pipeline_status = 'published'
    ON CONFLICT (song_id) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
    WHERE halo_song_publication_leases.expires_at <= NOW()
    RETURNING song_id
  `;
  if (!claimed[0]) return { ok: false, skipped: true, reason: "publication_busy_or_not_published" };
  try {
    return await reconcilePublishedSongWithLease(db, { songId, ownerMemberId, ...options, leaseToken: token });
  } finally {
    await db.sql`DELETE FROM halo_song_publication_leases WHERE song_id = ${songId} AND token = ${token}`;
  }
}

async function reconcilePublishedSongWithLease(db, {
  songId,
  ownerMemberId,
  actorId = "system",
  actorType = "system",
  recordLedger = true,
  preserveReleaseMetadata = false,
  announceDrop = false,
  leaseToken,
} = {}) {
  const context = await loadPublishedSong(db, songId, ownerMemberId);
  if (!context) return { ok: false, skipped: true, reason: "song_not_published_or_missing" };
  const { song, versions } = context;
  const existingSync = await loadPublicationSyncRow(db, song.id);
  const existingDetails = existingSync?.details && typeof existingSync.details === "object" ? existingSync.details : {};
  const keepReleaseMetadata = preserveReleaseMetadata || existingDetails.preserveReleaseMetadata === true;
  try {
    const master = verifiedSaleMaster(song, versions);
    const masterVerification = {
      masterVersionId: master.id,
      masterUpdatedAt: master.updated_at ? new Date(master.updated_at).toISOString() : "",
    };
    const release = await ensureReleaseCampaign(db, song, versions, keepReleaseMetadata);
    const syncedVersions = await syncReleaseAudioVersions(db, song, versions, release.id);
    const published = await db.sql`
      UPDATE halo_release_campaigns release
      SET status = 'published', release_stage = 'released', visibility = 'public',
        is_chart_eligible = TRUE, updated_at = NOW()
      WHERE release.id = ${release.id} AND release.owner_member_id = ${song.owner_member_id}
        AND EXISTS (
          SELECT 1 FROM halo_song_catalog catalog
          JOIN halo_song_versions master ON master.song_id = catalog.id
          WHERE catalog.id = ${song.id} AND catalog.owner_member_id = ${song.owner_member_id}
            AND catalog.status = 'active' AND catalog.pipeline_status = 'published' AND catalog.rights_status = 'cleared'
            AND master.id = ${master.id} AND master.version_type = 'sale_master'
            AND master.status = 'active' AND master.mastering_status = 'approved'
            AND COALESCE(master.audio_blob_prefix, '') = ${master.audio_blob_prefix || ""}
            AND COALESCE(master.audio_storage_key, '') = ${master.audio_storage_key || ""}
            AND master.updated_at = ${master.publication_revision || null}::timestamptz
            AND COALESCE(master.audio_chunk_count, 0) = ${Number(master.audio_chunk_count || 0)}
            AND master.duration_seconds = ${Number(master.duration_seconds)}
            AND master.audio_byte_size = ${Number(master.audio_byte_size)}
            AND master.audio_content_type = ${master.audio_content_type}
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(catalog.metadata_issues, '[]'::jsonb)) issue
              WHERE issue->>'level' = 'required'
                AND COALESCE(issue->>'field', '') NOT IN ('radio_edit', 'radio_audio', 'radio_master')
            )
            AND NOT EXISTS (
              SELECT 1 FROM halo_song_versions other
              WHERE other.song_id = catalog.id AND other.version_type = 'sale_master'
                AND other.status = 'active' AND other.id <> master.id
            )
            AND catalog.updated_at = ${song.publication_revision || null}::timestamptz
          FOR UPDATE OF catalog, master
        )
        AND EXISTS (
          SELECT 1 FROM halo_song_publication_leases
          WHERE song_id = ${song.id} AND token = ${leaseToken} AND expires_at > NOW()
        )
      RETURNING release.id
    `;
    if (!published[0]) throw new Error("Release ownership or master approval changed during publication");
    const radio = await ensureRadioTrack(db, song, syncedVersions, release, leaseToken, existingDetails.radio);
    // Route calculation is not evidence that the share surface was delivered.
    const dreamweaverStatus = "pending";
    const healthInput = {
      releaseId: release.id,
      radioTrackId: radio.trackId,
      canonicalUrl: release.publicUrl,
      releaseStatus: "published",
      radioStatus: radio.status,
      dreamweaverStatus,
      details: {
        ...existingDetails,
        releaseVerified: true,
        radioVerified: radio.details.verified === true,
        dreamweaverConfirmed: false,
        ...masterVerification,
        radio: radio.details,
        errorStreak: 0,
        firstFailureAt: "",
        escalatedAt: ""
      },
      lastError: "",
      lastReconciledAt: new Date().toISOString()
    };
    const health = buildPublicationHealth(publicationHealthSong(song, versions), healthInput);
    const details = {
      preserveReleaseMetadata: keepReleaseMetadata,
      releaseVerified: true,
      radioVerified: radio.details.verified === true,
      dreamweaverConfirmed: false,
      ...masterVerification,
      availableVersions: versions.map(version => version.version_type),
      syncedAudioVersionCount: syncedVersions.length,
      radio: radio.details,
      dreamweaver: {
        managed: release.dreamweaver.managed,
        hasHyperfollow: release.dreamweaver.hasHyperfollow,
        hyperfollowUrl: release.dreamweaver.hyperfollowUrl,
        hubUrl: release.dreamweaver.hubUrl || "",
        launchUrl: release.dreamweaver.launchUrl,
        loop: release.dreamweaver.loop || null,
        managerId: release.dreamweaver.manager?.id || "",
        linkedSongPages: release.dreamweaver.manager?.linkedSongPages || [],
        routeMode: release.dreamweaver.routeMode || "",
        destinationUrl: release.dreamweaver.destinationUrl || "",
      },
      errorStreak: 0,
      firstFailureAt: "",
      escalatedAt: "",
      lastSuccessfulReconcileAt: new Date().toISOString(),
      health,
    };
    await upsertPublicationSync(db, song, {
      releaseId: release.id,
      radioTrackId: radio.trackId,
      canonicalUrl: release.publicUrl,
      releaseStatus: "published",
      radioStatus: radio.status,
      dreamweaverStatus,
      details,
    });
    if (recordLedger) {
      await appendLedgerEntry(db, {
        actorId,
        actorType,
        eventCategory: "system_event",
        refSongId: song.id,
        refReleaseId: release.id,
        summary: `Published song fan-out reconciled for "${song.title}"`,
        details: {
          releaseId: release.id,
          canonicalUrl: release.publicUrl,
          radioStatus: radio.status,
          syncedAudioVersionCount: syncedVersions.length,
        },
        pipelineStage: "published",
        outcome: "success",
      });
    }
    // Only explicit publish actions announce a new shop entry; scheduled repairs never re-notify.
    const trackDrop = announceDrop ? await announceTrackDropSafely(db, { song, release, actorId, actorType }) : null;
    return {
      ok: true,
      songId: song.id,
      releaseId: release.id,
      canonicalUrl: release.publicUrl,
      radioStatus: radio.status,
      radioTrackId: radio.trackId,
      syncedAudioVersionCount: syncedVersions.length,
      publicationHealth: health,
      ...(trackDrop ? { trackDrop } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const errorStreak = Math.max(1, Number.parseInt(String(existingDetails.errorStreak || "0"), 10) + 1 || 1);
    const firstFailureAt = String(existingDetails.firstFailureAt || new Date().toISOString());
    const escalatedAt = String(existingDetails.escalatedAt || (errorStreak >= PUBLICATION_ESCALATION_THRESHOLD ? new Date().toISOString() : ""));
    const fallbackReleaseId = existingSync?.release_id || song.source_release_id || null;
    const fallbackRadioTrackId = existingSync?.radio_track_id || null;
    const fallbackCanonicalUrl = fallbackReleaseId ? publicationPath(fallbackReleaseId) : "";
    const healthInput = {
      releaseId: fallbackReleaseId,
      radioTrackId: fallbackRadioTrackId,
      canonicalUrl: fallbackCanonicalUrl,
      releaseStatus: "error",
      radioStatus: "error",
      dreamweaverStatus: "error",
      details: {
        ...existingDetails,
        errorStreak,
        firstFailureAt,
        escalatedAt
      },
      lastError: message,
      lastReconciledAt: new Date().toISOString()
    };
    const health = buildPublicationHealth(publicationHealthSong(song, versions), healthInput);
    await upsertPublicationSync(db, song, {
      releaseId: fallbackReleaseId,
      radioTrackId: fallbackRadioTrackId,
      canonicalUrl: fallbackCanonicalUrl,
      releaseStatus: "error",
      radioStatus: "error",
      dreamweaverStatus: "error",
      details: {
        preserveReleaseMetadata: keepReleaseMetadata,
        ...(existingDetails.radio?.proposedShowId ? { radio: {
          proposedShowId: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(existingDetails.radio.proposedShowId)
            ? existingDetails.radio.proposedShowId : "",
          proposedStartsAt: Number.isFinite(Date.parse(existingDetails.radio.proposedStartsAt))
            ? new Date(existingDetails.radio.proposedStartsAt).toISOString() : "",
          proposedRoom: ["club", "chill", "lounge"].includes(existingDetails.radio.proposedRoom)
            ? existingDetails.radio.proposedRoom : "",
          approvalRequired: true,
        } } : {}),
        error: message,
        errorStreak,
        firstFailureAt,
        escalatedAt,
        lastFailureAt: new Date().toISOString(),
        health
      },
      lastError: message,
    });
    if (recordLedger) {
      await appendLedgerEntry(db, {
        actorId,
        actorType,
        eventCategory: "system_event",
        refSongId: song.id,
        refReleaseId: song.source_release_id || null,
        summary: `Published song fan-out failed for "${song.title}"`,
        details: { error: message },
        pipelineStage: "published",
        outcome: "failure",
      });
    }
    throw error;
  }
}

export async function reconcilePublishedSongs(db, {
  songId = "",
  ownerMemberId = "",
  limit = 50,
  actorId = "system",
  actorType = "system",
} = {}) {
  const rows = songId
    ? await db.sql`
        SELECT id, owner_member_id
        FROM halo_song_catalog
        WHERE id = ${songId}
          AND status = 'active'
          AND pipeline_status = 'published'
          AND (${ownerMemberId || ""} = '' OR owner_member_id = ${ownerMemberId || ""})
        LIMIT 1
      `
    : await db.sql`
        SELECT song.id, song.owner_member_id
        FROM halo_song_catalog song
        LEFT JOIN halo_song_publication_sync sync ON sync.song_id = song.id
        LEFT JOIN halo_release_campaigns release ON release.id = sync.release_id
        LEFT JOIN halo_radio_tracks radio ON radio.id = sync.radio_track_id
        WHERE song.status = 'active'
          AND song.pipeline_status = 'published'
          AND (
            sync.song_id IS NULL
            OR COALESCE(sync.details->>'escalatedAt', '') = ''
            OR song.updated_at > sync.updated_at
            OR EXISTS (
              SELECT 1 FROM halo_song_versions version
              WHERE version.song_id = song.id AND version.updated_at > sync.updated_at
            )
            OR sync.last_reconciled_at < NOW() - INTERVAL '1 day'
          )
          AND (
            sync.song_id IS NULL
            OR sync.release_id IS NULL
            OR release.id IS NULL
            OR sync.release_status <> 'published'
            OR (sync.radio_track_id IS NOT NULL AND radio.id IS NULL)
            OR sync.radio_status IN ('pending', 'queued', 'error')
            OR sync.dreamweaver_status <> 'ready'
            OR sync.canonical_url = ''
            OR sync.last_reconciled_at IS NULL
            OR sync.last_reconciled_at < NOW() - INTERVAL '15 minutes'
            OR song.updated_at > sync.updated_at
            OR EXISTS (
              SELECT 1 FROM halo_song_versions version
              WHERE version.song_id = song.id AND version.updated_at > sync.updated_at
            )
          )
        ORDER BY sync.last_reconciled_at ASC NULLS FIRST, song.updated_at DESC
        LIMIT ${limit}
      `;
  const results = [];
  for (const row of rows) {
    try {
      results.push(await reconcilePublishedSong(db, {
        songId: row.id,
        ownerMemberId: row.owner_member_id,
        actorId,
        actorType,
      }));
    } catch (error) {
      results.push({
        ok: false,
        songId: row.id,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
  return results;
}

export function canonicalPublishedSongUrl(releaseId) {
  return publicationPath(releaseId);
}
