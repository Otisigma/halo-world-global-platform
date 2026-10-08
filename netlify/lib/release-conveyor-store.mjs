import { randomUUID } from "node:crypto";
import { releaseFingerprint } from "./release-conveyor.mjs";

export async function loadReleaseSubmission(db, ownerMemberId, songId) {
  const songs = await db.sql`
    SELECT id, owner_member_id, source_release_id, title, artist_name, album_title, genre,
      isrc, upc, explicit_lyrics, rights_status, sale_status, sale_price_cents, currency,
      artwork_url, lyrics_text, notes, metadata_issues
    FROM halo_song_catalog
    WHERE id = ${songId} AND owner_member_id = ${ownerMemberId} AND status = 'active'
  `;
  if (!songs[0]) return null;
  const versions = await db.sql`
    SELECT id, song_id, version_type, audio_url, audio_blob_prefix, audio_chunk_count,
      audio_storage_key, audio_content_type, audio_byte_size, audio_filename,
      duration_seconds, mastering_status, artwork_url, updated_at
    FROM halo_song_versions
    WHERE song_id = ${songId} AND status = 'active'
    ORDER BY id
  `;
  return { song: songs[0], versions };
}

export async function loadConveyorState(db, ownerMemberId, songId) {
  const rows = await db.sql`
    SELECT state, locked_until FROM halo_release_conveyor
    WHERE song_id = ${songId} AND owner_member_id = ${ownerMemberId}
  `;
  return rows[0] || null;
}

export async function claimConveyor(db, ownerMemberId, songId) {
  const token = randomUUID();
  const rows = await db.sql`
    INSERT INTO halo_release_conveyor (song_id, owner_member_id, lease_token, locked_until)
    VALUES (${songId}, ${ownerMemberId}, ${token}, NOW() + INTERVAL '10 minutes')
    ON CONFLICT (song_id) DO UPDATE
      SET lease_token = EXCLUDED.lease_token, locked_until = EXCLUDED.locked_until
      WHERE halo_release_conveyor.owner_member_id = EXCLUDED.owner_member_id
        AND (halo_release_conveyor.locked_until IS NULL OR halo_release_conveyor.locked_until < NOW())
    RETURNING state
  `;
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
  async function save(state, completed) {
    const eventId = randomUUID();
    const stage = completed ? state.status : state.stages.at(-1).name;
    const details = completed ? state.receipt : state.stages.at(-1);
    // Checkpoint and audit append are one statement: neither can persist alone.
    const rows = await db.sql`
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
      FROM checkpoint RETURNING id
    `;
    if (!rows.length) throw new Error("Lease lost");
  }
  return {
    prepareAudio, assertCurrent,
    checkpoint: state => save(state, false),
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
