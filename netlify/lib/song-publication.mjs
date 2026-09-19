import { randomUUID } from "node:crypto";
import { appendLedgerEntry } from "./halo-ledger.mjs";
import { buildPublicationHealth, PUBLICATION_MONITOR_WINDOW_MINUTES } from "./publication-health.mjs";

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

function radioRoomForGenre(genre) {
  const normalized = cleanText(genre, 80).toLowerCase();
  if (!normalized) return "lounge";
  if (/(house|dance|electronic|techno|garage|club|afrobeat|afrobeats|amapiano|drill|grime|hip hop|hip-hop|rap)/.test(normalized)) return "club";
  if (/(ambient|neo soul|neo-soul|soul|r&b|rnb|gospel|worship|acoustic|ballad|chill)/.test(normalized)) return "chill";
  return "lounge";
}

function versionLabel(versionType, label) {
  return cleanText(label, 100) || VERSION_LABELS[versionType] || "Release version";
}

async function loadPublishedSong(db, songId, ownerMemberId) {
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
      song.artwork_url,
      song.pipeline_status,
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
  if (!rows[0] || rows[0].pipeline_status !== "published") return null;
  const versions = await db.sql`
    SELECT
      id,
      version_type,
      label,
      audio_url,
      audio_blob_prefix,
      audio_chunk_count,
      audio_content_type,
      audio_byte_size,
      audio_filename,
      duration_seconds,
      mastering_status,
      sale_enabled,
      artwork_url,
      artwork_blob_prefix,
      artwork_content_type,
      status
    FROM halo_song_versions
    WHERE song_id = ${songId}
      AND status = 'active'
    ORDER BY updated_at DESC
  `;
  return { song: rows[0], versions };
}

async function resolveReleaseId(db, song) {
  const desiredId = song.source_release_id || slugify(`${song.artist_name}-${song.title}`) || slugify(song.title) || song.id;
  const existingById = await db.sql`
    SELECT id, owner_member_id
    FROM halo_release_campaigns
    WHERE id = ${desiredId}
    LIMIT 1
  `;
  if (!existingById[0] || existingById[0].owner_member_id === song.owner_member_id || !existingById[0].owner_member_id) {
    return desiredId;
  }
  const fallbackId = `${desiredId.slice(0, 80)}-${song.id.slice(0, 8)}`.replace(/-+/g, "-").slice(0, 96);
  return fallbackId;
}

async function ensureReleaseCampaign(db, song, versions) {
  const releaseId = await resolveReleaseId(db, song);
  const publicUrl = publicationPath(releaseId);
  const saleMaster = versions.find(version => version.version_type === "sale_master" && version.audio_url);
  const firstPlayableVersion = versions.find(version => version.audio_url);
  const streamUrl = cleanText(saleMaster?.audio_url || firstPlayableVersion?.audio_url, 1200);
  const officialUrl = streamUrl || publicUrl;
  const artworkUrl = cleanText(
    saleMaster?.artwork_url
      || firstPlayableVersion?.artwork_url
      || song.artwork_url,
    1200
  );
  const availableVersions = [...new Set(
    versions
      .map(version => versionLabel(version.version_type, version.label))
      .filter(Boolean)
  )];
  const pitch = cleanText(song.notes, 500) || `Open ${song.title} by ${song.artist_name} across HALO.`;
  const releaseRows = await db.sql`
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
      'published',
      'released',
      'public',
      ${!song.explicit_lyrics},
      TRUE,
      '',
      ${streamUrl}
    )
    ON CONFLICT (id) DO UPDATE SET
      owner_member_id = COALESCE(halo_release_campaigns.owner_member_id, EXCLUDED.owner_member_id),
      artist_slug = COALESCE(EXCLUDED.artist_slug, halo_release_campaigns.artist_slug),
      title = EXCLUDED.title,
      artist = EXCLUDED.artist,
      artwork_url = COALESCE(NULLIF(EXCLUDED.artwork_url, ''), halo_release_campaigns.artwork_url),
      official_url = CASE
        WHEN halo_release_campaigns.official_url = ''
          OR halo_release_campaigns.official_url = ${publicUrl}
          OR halo_release_campaigns.official_url = ${streamUrl}
        THEN EXCLUDED.official_url
        ELSE halo_release_campaigns.official_url
      END,
      pitch = CASE
        WHEN halo_release_campaigns.pitch = '' THEN EXCLUDED.pitch
        ELSE halo_release_campaigns.pitch
      END,
      available_versions = EXCLUDED.available_versions,
      content_rating = EXCLUDED.content_rating,
      status = 'published',
      release_stage = 'released',
      visibility = 'public',
      is_clean_version = EXCLUDED.is_clean_version,
      is_chart_eligible = TRUE,
      stream_url = CASE
        WHEN halo_release_campaigns.stream_url = '' THEN EXCLUDED.stream_url
        ELSE halo_release_campaigns.stream_url
      END,
      updated_at = NOW()
    RETURNING id, official_url, stream_url
  `;
  if (song.source_release_id !== releaseId) {
    await db.sql`
      UPDATE halo_song_catalog
      SET source_release_id = ${releaseId}, updated_at = NOW()
      WHERE id = ${song.id}
    `;
  }
  return {
    id: releaseRows[0]?.id || releaseId,
    officialUrl: releaseRows[0]?.official_url || officialUrl,
    streamUrl: releaseRows[0]?.stream_url || streamUrl,
    publicUrl,
  };
}

async function syncReleaseAudioVersions(db, song, versions, releaseId) {
  const versionRows = [];
  for (const version of versions) {
    if (!version.audio_blob_prefix || !version.audio_content_type || Number(version.audio_byte_size || 0) <= 0) continue;
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
        ${version.version_type},
        ${versionLabel(version.version_type, version.label)},
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
        release_id = EXCLUDED.release_id,
        owner_member_id = EXCLUDED.owner_member_id,
        version_type = EXCLUDED.version_type,
        version_label = EXCLUDED.version_label,
        chunk_count = EXCLUDED.chunk_count,
        content_type = EXCLUDED.content_type,
        byte_size = EXCLUDED.byte_size,
        duration_seconds = EXCLUDED.duration_seconds,
        source_filename = EXCLUDED.source_filename,
        artwork_key = EXCLUDED.artwork_key,
        artwork_content_type = EXCLUDED.artwork_content_type,
        rights_confirmed = TRUE,
        status = 'active',
        updated_at = NOW()
      RETURNING id, version_type, blob_key, chunk_count, content_type, byte_size, duration_seconds, source_filename, artwork_key, artwork_content_type
    `;
    if (rows[0]) versionRows.push(rows[0]);
  }
  return versionRows;
}

async function ensureRadioTrack(db, song, syncedVersions, release) {
  if (!song.owner_actor_id) {
    return {
      status: "queued",
      trackId: "",
      details: { reason: "owner_membership_missing" },
    };
  }
  const existing = await db.sql`
    SELECT id, status
    FROM halo_radio_tracks
    WHERE master_song_id = ${song.id}
      AND status IN ('preview', 'rotation', 'held')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (existing[0]) {
    await db.sql`
      UPDATE halo_radio_tracks
      SET release_id = COALESCE(release_id, ${release.id}),
          source_url = CASE WHEN source_url = '' THEN ${release.officialUrl || release.publicUrl} ELSE source_url END,
          status = CASE WHEN status = 'preview' THEN 'rotation' ELSE status END,
          updated_at = NOW()
      WHERE id = ${existing[0].id}
    `;
    const status = existing[0].status === "preview" ? "rotation" : existing[0].status;
    return { status, trackId: existing[0].id, details: { reason: "existing_track_reused" } };
  }
  const preferredVersion = RADIO_VERSION_PRIORITY
    .map(type => syncedVersions.find(version => version.version_type === type))
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
  const trackId = randomUUID();
  await db.sql`
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
    ) VALUES (
      ${trackId},
      ${song.owner_member_id},
      ${song.owner_actor_id},
      ${song.artist_slug || null},
      ${release.id},
      ${song.id},
      ${preferredVersion.id},
      ${radioRoomForGenre(song.genre)},
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
      'rotation',
      ${preferredVersion.source_filename || ""},
      ${preferredVersion.artwork_key || ""},
      ${preferredVersion.artwork_content_type || ""},
      ${release.officialUrl || release.publicUrl}
    )
  `;
  return { status: "rotation", trackId, details: { reason: "radio_track_created" } };
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

export async function reconcilePublishedSong(db, {
  songId,
  ownerMemberId,
  actorId = "system",
  actorType = "system",
  recordLedger = true,
} = {}) {
  const context = await loadPublishedSong(db, songId, ownerMemberId);
  if (!context) return { ok: false, skipped: true, reason: "song_not_published_or_missing" };
  const { song, versions } = context;
  try {
    const release = await ensureReleaseCampaign(db, song, versions);
    const syncedVersions = await syncReleaseAudioVersions(db, song, versions, release.id);
    const radio = await ensureRadioTrack(db, song, syncedVersions, release);
    const details = {
      availableVersions: versions.map(version => version.version_type),
      syncedAudioVersionCount: syncedVersions.length,
      radio: radio.details,
    };
    const publicationHealth = buildPublicationHealth({
      song,
      versions,
      releaseId: release.id,
      canonicalUrl: release.publicUrl,
      releaseStatus: "published",
      radioStatus: radio.status,
      dreamweaverStatus: release.publicUrl ? "ready" : "pending",
      radioTrackId: radio.trackId,
      radioDetails: radio.details,
    });
    details.publicationHealth = publicationHealth;
    await upsertPublicationSync(db, song, {
      releaseId: release.id,
      radioTrackId: radio.trackId,
      canonicalUrl: release.publicUrl,
      releaseStatus: "published",
      radioStatus: radio.status,
      dreamweaverStatus: release.publicUrl ? "ready" : "pending",
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
    return {
      ok: true,
      songId: song.id,
      releaseId: release.id,
      canonicalUrl: release.publicUrl,
      radioStatus: radio.status,
      radioTrackId: radio.trackId,
      syncedAudioVersionCount: syncedVersions.length,
      publicationHealth,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const existingSync = await db.sql`
    SELECT canonical_url
    FROM halo_song_publication_sync
    WHERE song_id = ${song.id}
    LIMIT 1
    `;
    const lastKnownCanonicalUrl = existingSync[0]?.canonical_url || "";
    const details = {
    error: message,
    publicationHealth: buildPublicationHealth({
      song,
      versions,
      releaseId: song.source_release_id || "",
      canonicalUrl: lastKnownCanonicalUrl,
      releaseStatus: "error",
      radioStatus: "error",
      dreamweaverStatus: "error",
      lastError: message,
    }),
    };
    await upsertPublicationSync(db, song, {
    releaseId: song.source_release_id || null,
    radioTrackId: null,
    canonicalUrl: lastKnownCanonicalUrl,
    releaseStatus: "error",
    radioStatus: "error",
    dreamweaverStatus: "error",
    details,
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
            OR sync.release_id IS NULL
            OR release.id IS NULL
            OR sync.release_status <> 'published'
            OR (sync.radio_track_id IS NOT NULL AND radio.id IS NULL)
            OR sync.radio_status IN ('pending', 'queued', 'error')
            OR sync.dreamweaver_status <> 'ready'
            OR sync.canonical_url = ''
            OR sync.last_reconciled_at IS NULL
            OR sync.last_reconciled_at < NOW() - (${PUBLICATION_MONITOR_WINDOW_MINUTES} * INTERVAL '1 minute')
          )
        ORDER BY song.updated_at DESC
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
