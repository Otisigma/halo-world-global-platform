// Owner-only soft archive for a catalog song. Nothing is deleted: analytics, events,
// reviews, publication sync history, conveyor receipts and every audio/artwork blob stay.
// One SQL statement keeps the song, version, release, release-audio and radio updates atomic.
// Shared or foreign records are never changed; they are counted so the owner can be told.
export const SONG_ARCHIVE_PRESERVED = Object.freeze([
  "listening analytics and release events",
  "Dreamweaver reviews and conveyor receipts",
  "publication sync history",
  "uploaded audio and artwork files",
]);

export async function archiveSong(db, ownerMemberId, songId) {
  if (!ownerMemberId || !songId) return { ok: false, status: 400, reason: "invalid_request" };
  const rows = await db.sql`
    WITH target AS MATERIALIZED (
      SELECT id, source_release_id
      FROM halo_song_catalog
      WHERE id = ${songId} AND owner_member_id = ${ownerMemberId} AND status = 'active'
      FOR UPDATE
    ), archived_song AS (
      UPDATE halo_song_catalog song
      SET status = 'archived', updated_at = NOW()
      FROM target
      WHERE song.id = target.id AND song.owner_member_id = ${ownerMemberId} AND song.status = 'active'
      RETURNING song.id
    ), archived_versions AS (
      UPDATE halo_song_versions version
      SET status = 'archived', updated_at = NOW()
      WHERE version.song_id IN (SELECT id FROM archived_song) AND version.status = 'active'
      RETURNING version.id
    ), song_blobs AS MATERIALIZED (
      SELECT version.audio_blob_prefix AS blob_key
      FROM halo_song_versions version
      JOIN target ON target.id = version.song_id
      WHERE COALESCE(version.audio_blob_prefix, '') <> ''
    ), linked_releases AS MATERIALIZED (
      SELECT target.source_release_id AS release_id FROM target WHERE target.source_release_id IS NOT NULL
      UNION
      SELECT sync.release_id FROM halo_song_publication_sync sync JOIN target ON target.id = sync.song_id
      WHERE sync.owner_member_id = ${ownerMemberId} AND sync.release_id IS NOT NULL
    ), exclusive_releases AS MATERIALIZED (
      SELECT release.id
      FROM halo_release_campaigns release
      JOIN linked_releases linked ON linked.release_id = release.id
      WHERE release.owner_member_id = ${ownerMemberId}
        AND NOT EXISTS (
          SELECT 1 FROM halo_song_catalog other
          WHERE other.source_release_id = release.id AND other.id <> ${songId} AND other.status = 'active'
        )
        AND NOT EXISTS (
          SELECT 1 FROM halo_song_publication_sync other_sync
          WHERE other_sync.release_id = release.id AND other_sync.song_id <> ${songId}
        )
        AND NOT EXISTS (
          SELECT 1 FROM halo_release_audio_versions audio
          WHERE audio.release_id = release.id AND audio.owner_member_id <> ${ownerMemberId}
        )
        AND NOT EXISTS (
          SELECT 1 FROM halo_radio_tracks track
          WHERE track.release_id = release.id
            AND (track.member_id <> ${ownerMemberId} OR track.master_song_id IS DISTINCT FROM ${songId})
        )
        AND NOT EXISTS (
          SELECT 1 FROM halo_artist_pages page
          WHERE page.current_release_id = release.id AND page.owner_member_id <> ${ownerMemberId}
        )
      FOR UPDATE OF release
    ), hidden_releases AS (
      UPDATE halo_release_campaigns release
      SET status = 'draft', visibility = 'private', release_stage = 'archived',
        is_chart_eligible = FALSE, updated_at = NOW()
      WHERE release.id IN (SELECT id FROM exclusive_releases)
        AND release.owner_member_id = ${ownerMemberId}
        AND EXISTS (SELECT 1 FROM archived_song)
      RETURNING release.id
    ), archived_release_audio AS (
      UPDATE halo_release_audio_versions audio
      SET status = 'archived', updated_at = NOW()
      WHERE audio.owner_member_id = ${ownerMemberId} AND audio.status = 'active'
        AND audio.blob_key IN (SELECT blob_key FROM song_blobs)
        AND EXISTS (SELECT 1 FROM archived_song)
      RETURNING audio.id
    ), held_radio AS (
      UPDATE halo_radio_tracks track
      SET status = 'held', updated_at = NOW()
      WHERE track.master_song_id = ${songId} AND track.member_id = ${ownerMemberId}
        AND track.status IN ('preview', 'rotation')
        AND EXISTS (SELECT 1 FROM archived_song)
      RETURNING track.id
    )
    SELECT
      (SELECT COUNT(*) FROM archived_song)::int AS songs_archived,
      (SELECT COUNT(*) FROM archived_versions)::int AS versions_archived,
      (SELECT COUNT(*) FROM hidden_releases)::int AS releases_hidden,
      (SELECT COUNT(*) FROM archived_release_audio)::int AS release_audio_archived,
      (SELECT COUNT(*) FROM held_radio)::int AS radio_tracks_held,
      (SELECT COUNT(*) FROM halo_release_campaigns release
        JOIN linked_releases linked ON linked.release_id = release.id
        WHERE release.status = 'published'
          AND release.id NOT IN (SELECT id FROM exclusive_releases))::int AS shared_releases_left,
      (SELECT COUNT(*) FROM halo_radio_tracks track
        WHERE track.master_song_id = ${songId} AND track.member_id <> ${ownerMemberId}
          AND track.status IN ('preview', 'rotation'))::int AS shared_radio_left
  `;
  const result = rows[0] || {};
  if (Number(result.songs_archived) !== 1) {
    const existing = await db.sql`
      SELECT status FROM halo_song_catalog
      WHERE id = ${songId} AND owner_member_id = ${ownerMemberId}
      LIMIT 1
    `;
    if (existing[0]?.status === "archived") return { ok: false, status: 409, reason: "already_archived" };
    return { ok: false, status: 404, reason: "not_found" };
  }
  return {
    ok: true,
    status: 200,
    versionsArchived: Number(result.versions_archived || 0),
    releasesHidden: Number(result.releases_hidden || 0),
    releaseAudioArchived: Number(result.release_audio_archived || 0),
    radioTracksHeld: Number(result.radio_tracks_held || 0),
    sharedReleasesLeft: Number(result.shared_releases_left || 0),
    sharedRadioLeft: Number(result.shared_radio_left || 0),
  };
}

export function archiveSongMessage(result) {
  if (!result.ok) {
    return result.reason === "already_archived"
      ? "That song is already archived"
      : result.reason === "invalid_request" ? "Choose a valid song to archive" : "That song was not found";
  }
  const shared = result.sharedReleasesLeft + result.sharedRadioLeft;
  return `Song archived and hidden from your active catalog and public distribution. History, analytics, and uploaded files were kept.${shared
    ? ` ${shared} shared release or radio record${shared === 1 ? " was" : "s were"} left unchanged because another artist or song still uses ${shared === 1 ? "it" : "them"}.`
    : ""}`;
}
