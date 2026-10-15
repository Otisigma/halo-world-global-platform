import { randomUUID } from "node:crypto";
import { releaseFingerprint } from "./release-conveyor.mjs";
import { retryReleaseWork } from "./release-conveyor-retry.mjs";

export async function loadReleaseSubmission(db, ownerMemberId, songId) {
  const songs = await db.sql`
    SELECT id, owner_member_id, source_release_id, title, artist_name, album_title, genre,
      isrc, upc, explicit_lyrics, rights_status, sale_status, sale_price_cents, currency,
      artwork_url, lyrics_text, notes, metadata_issues, updated_at,
      TO_CHAR(GREATEST(updated_at,
        (SELECT MAX(updated_at) FROM halo_song_versions WHERE song_id = halo_song_catalog.id))
        AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_updated_at
    FROM halo_song_catalog
    WHERE id = ${songId} AND owner_member_id = ${ownerMemberId} AND status = 'active'
  `;
  if (!songs[0]) return null;
  const versions = await db.sql`
    SELECT id, song_id, version_type, audio_url, audio_blob_prefix, audio_chunk_count,
      audio_storage_key, audio_content_type, audio_byte_size, audio_filename,
      duration_seconds, mastering_status, artwork_url, video_url, promo_video_url, updated_at
    FROM halo_song_versions
    WHERE song_id = ${songId} AND status = 'active'
    ORDER BY id
  `;
  return { song: songs[0], versions };
}

export async function loadConveyorState(db, ownerMemberId, songId) {
  const rows = await retryReleaseWork(() => db.sql`
    SELECT state, locked_until FROM halo_release_conveyor
    WHERE song_id = ${songId} AND owner_member_id = ${ownerMemberId}
  `);
  return rows[0] || null;
}

export async function claimConveyor(db, ownerMemberId, songId) {
  const token = randomUUID();
  const rows = await retryReleaseWork(() => db.sql`
    INSERT INTO halo_release_conveyor (song_id, owner_member_id, lease_token, locked_until)
    VALUES (${songId}, ${ownerMemberId}, ${token}, NOW() + INTERVAL '10 minutes')
    ON CONFLICT (song_id) DO UPDATE
      SET lease_token = EXCLUDED.lease_token, locked_until = EXCLUDED.locked_until
      WHERE halo_release_conveyor.owner_member_id = EXCLUDED.owner_member_id
        AND (halo_release_conveyor.lease_token = EXCLUDED.lease_token
          OR halo_release_conveyor.locked_until IS NULL OR halo_release_conveyor.locked_until < NOW())
    RETURNING state
  `);
  return rows[0] ? { token, previous: rows[0].state } : null;
}

export function conveyorPorts(db, ownerMemberId, songId, token, submission, options, prepareAudio) {
  const fingerprint = releaseFingerprint(submission.song, submission.versions, options);
  async function assertCurrent() {
    const current = await loadReleaseSubmission(db, ownerMemberId, songId);
    if (!current || releaseFingerprint(current.song, current.versions, options) !== fingerprint) {
      throw new Error("Submission changed");
    }
    const lease = await db.sql`
      SELECT song_id FROM halo_release_conveyor
      WHERE song_id = ${songId} AND owner_member_id = ${ownerMemberId}
        AND lease_token = ${token} AND locked_until > NOW()
    `;
    if (!lease.length) throw new Error("Lease expired");
  }
  async function save(state, completed, event) {
    const eventId = randomUUID();
    const stage = completed ? state.status : event || state.stages.at(-1).name;
    const details = completed ? state.receipt : event === "attempt"
      ? { attempt: state.automaticAttempts, nextRetryAt: state.nextRetryAt } : state.stages.at(-1);
    // Checkpoint and audit append are one statement: neither can persist alone.
    const rows = await retryReleaseWork(() => db.sql`
      WITH checkpoint AS (
        UPDATE halo_release_conveyor
        SET input_hash = ${state.inputHash}, state = ${JSON.stringify(state)}::jsonb,
          locked_until = CASE WHEN ${completed} THEN NULL ELSE NOW() + INTERVAL '10 minutes' END,
          lease_token = CASE WHEN ${completed} THEN NULL ELSE lease_token END, updated_at = NOW()
        WHERE song_id = ${songId} AND owner_member_id = ${ownerMemberId}
          AND lease_token = ${token} AND locked_until > NOW()
        RETURNING song_id
      )
      INSERT INTO halo_release_conveyor_events (id, song_id, owner_member_id, input_hash, stage, details)
      SELECT ${eventId}, song_id, ${ownerMemberId}, ${state.inputHash}, ${stage}, ${JSON.stringify(details)}::jsonb
      FROM checkpoint
      ON CONFLICT (id) DO NOTHING RETURNING id
    `);
    if (!rows.length) {
      // A connection may fail after commit, including a finish that released the lease.
      const committed = await db.sql`
        SELECT id FROM halo_release_conveyor_events
        WHERE id = ${eventId} AND song_id = ${songId} AND owner_member_id = ${ownerMemberId}
      `;
      if (!committed.length) throw new Error("Lease lost");
    }
  }
  return {
    prepareAudio, assertCurrent,
    checkpoint: state => save(state, false),
    beginAttempt: state => save(state, false, "attempt"),
    finish: state => save(state, true),
    handoff: async () => {
      // Preparation does not publish or alter mastering/rights approvals.
      return { status: "ready_for_publication", songId, publicationAction: "existing_catalog_controls",
        externalDistribution: "not_submitted", originalMasterPreserved: true };
    },
  };
}

export async function releaseConveyorLease(db, ownerMemberId, songId, token) {
  await db.sql`
    UPDATE halo_release_conveyor SET lease_token = NULL, locked_until = NULL
    WHERE song_id = ${songId} AND owner_member_id = ${ownerMemberId} AND lease_token = ${token}
  `;
}

export async function persistWatchdog(db, ownerMemberId, songId, token, submission, watchdog) {
  const radio = watchdog.actions.find(action => action.type === "auto_queue_radio");
  const metadata = watchdog.actions.find(action => action.type === "restore_isrc");
  const eventId = randomUUID();
  const rows = await db.sql`
    WITH lease AS MATERIALIZED (
      SELECT song_id FROM halo_release_conveyor
      WHERE song_id = ${songId} AND owner_member_id = ${ownerMemberId}
        AND lease_token = ${token} AND locked_until > NOW()
      FOR UPDATE
    ), catalog AS MATERIALIZED (
      SELECT song.* FROM halo_song_catalog song JOIN lease ON lease.song_id = song.id
      WHERE song.owner_member_id = ${ownerMemberId} AND song.status = 'active'
      FOR UPDATE OF song
    ), versions AS MATERIALIZED (
      SELECT version.* FROM halo_song_versions version JOIN catalog ON catalog.id = version.song_id
      FOR UPDATE OF version
    ), current AS MATERIALIZED (
      SELECT catalog.id FROM catalog
      WHERE TO_CHAR(GREATEST(catalog.updated_at, (SELECT MAX(updated_at) FROM versions))
        AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') = ${submission.song.source_updated_at}
    ), radio_update AS (
      UPDATE halo_song_versions SET mastering_status = 'queued', destination = 'radio',
        target_lufs = -16, true_peak_dbtp_tenths = -10,
        notes = CONCAT_WS(E'\\n', NULLIF(notes, ''), ${radio ? `HALO watchdog: prepare from sale master ${radio.sourceVersionId}; -16 LUFS / -1 dBTP targets only. Dedicated edit, clean-content review and mastering approval required.` : ""}::text),
        updated_at = NOW()
      WHERE id = ${radio?.versionId || ""} AND song_id IN (SELECT id FROM current)
        AND version_type IN ('radio_edit', 'clean') AND status = 'active'
        AND mastering_status = 'not_started' AND COALESCE(audio_url, '') = ''
      RETURNING id
    ), metadata_update AS (
      UPDATE halo_song_catalog SET isrc = ${metadata?.isrc || ""}, updated_at = NOW()
      WHERE id IN (SELECT id FROM current) AND ${Boolean(metadata)} AND BTRIM(isrc) = ''
      RETURNING id
    ), checkpoint AS (
      UPDATE halo_release_conveyor
      SET state = jsonb_set(jsonb_set(state, '{watchdog}', ${JSON.stringify(watchdog)}::jsonb),
        '{receipt,watchdog}', ${JSON.stringify(watchdog)}::jsonb), updated_at = NOW()
      WHERE song_id IN (SELECT id FROM current)
      RETURNING song_id
    )
    INSERT INTO halo_release_conveyor_events (id, song_id, owner_member_id, input_hash, stage, details)
    SELECT ${eventId}, song_id, ${ownerMemberId}, '', 'watchdog_pulse',
      ${JSON.stringify(watchdog)}::jsonb || jsonb_build_object(
        'appliedRadioVersionIds', (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM radio_update),
        'appliedMetadataSongIds', (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM metadata_update))
    FROM checkpoint RETURNING id
  `;
  if (!rows.length) throw new Error("Watchdog lease or submission changed");
}
