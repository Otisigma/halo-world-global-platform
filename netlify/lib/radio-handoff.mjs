import { reconcilePublishedSong } from "./song-publication.mjs";

// HALO Radio only broadcasts dedicated radio versions; the sale master is never streamed directly.
// This mirrors RADIO_VERSION_PRIORITY in song-publication.mjs (ensureRadioTrack).
export const RADIO_HANDOFF_VERSION_TYPES = Object.freeze(["radio_edit", "clean"]);
export const HANDOFF_TRACKED_VERSION_TYPES = Object.freeze(["sale_master", "radio_edit", "clean", "demo"]);

function summarizeVersion(versions, versionType) {
  const rows = versions.filter(version => version?.version_type === versionType);
  const withAudio = rows.find(version => String(version.audio_url || "").trim());
  return {
    provisioned: rows.length > 0,
    hasAudio: Boolean(withAudio),
    // Radio playback streams chunked Netlify Blobs; direct object-storage audio cannot be synced to rotation yet.
    radioStreamable: Boolean(withAudio && String(withAudio.audio_blob_prefix || "").trim()),
    masteringStatus: String((withAudio || rows[0])?.mastering_status || "not_started"),
  };
}

/**
 * Pure description of where a song sits in the master → radio handoff.
 * Inputs are snake_case database rows so the contract suite can exercise it without a database.
 */
export function describeRadioHandoff({ song, versions = [], sync = null, reconcileError = "" } = {}) {
  const list = Array.isArray(versions) ? versions : [];
  const summary = Object.fromEntries(HANDOFF_TRACKED_VERSION_TYPES.map(type => [type, summarizeVersion(list, type)]));
  const radioVersions = RADIO_HANDOFF_VERSION_TYPES.map(type => summary[type]);
  const published = song?.pipeline_status === "published";
  const blockers = [];
  if (!summary.sale_master.hasAudio) blockers.push("Sale master audio is not uploaded yet.");
  if (!radioVersions.some(version => version.provisioned)) blockers.push("No radio_edit or clean version exists for this song.");
  else if (!radioVersions.some(version => version.hasAudio)) blockers.push("Upload a radio edit or clean radio version. HALO Radio never broadcasts the sale master directly.");
  else if (!radioVersions.some(version => version.radioStreamable)) blockers.push("Radio versions stored in direct object storage cannot be streamed by HALO Radio yet. Upload the radio edit through the standard chunked upload.");
  if (radioVersions.some(version => version.hasAudio) && !radioVersions.some(version => version.masteringStatus === "approved")) {
    blockers.push("Approve mastering on the radio edit or clean version so Dream Weaver clears it for broadcast.");
  }
  if (song && song.rights_status !== "cleared") blockers.push("Confirm rights before the song can be routed to radio.");
  if (song && !published) blockers.push("Publish the song (Upload pipeline → Published, or Force push) to trigger radio fan-out.");

  const radioStatus = String(sync?.radio_status || "");
  const radioTrackId = String(sync?.radio_track_id || "");
  let status;
  if (!song) status = "unknown";
  else if (reconcileError) status = "error";
  else if (published && radioTrackId && ["rotation", "preview", "held"].includes(radioStatus)) status = radioStatus === "rotation" ? "in_rotation" : radioStatus;
  else if (published && radioStatus === "error") status = "error";
  else if (published) status = "queued";
  else if (!summary.sale_master.hasAudio) status = "awaiting_master";
  else if (!radioVersions.some(version => version.hasAudio)) status = "awaiting_radio_version";
  else status = "awaiting_publication";

  const messages = {
    unknown: "Radio handoff status is unavailable right now.",
    error: `Radio handoff failed: ${reconcileError || String(sync?.last_error || "publication reconcile reported an error")}`,
    in_rotation: "Song is routed into HALO Radio rotation.",
    preview: "Song is in the HALO Radio preview pool.",
    held: "Song is held by radio programming.",
    queued: "Song is published; radio fan-out is queued until a streamable radio edit or clean version is available.",
    awaiting_master: "Upload the sale master to start the radio handoff.",
    awaiting_radio_version: "Master locked. Radio routing is waiting for a radio edit or clean version.",
    awaiting_publication: "Radio version ready. Publish the song to route it into rotation.",
  };

  return {
    status,
    routed: status === "in_rotation" || status === "preview" || status === "held",
    manualSteps: status === "in_rotation" ? [] : blockers,
    blockers,
    versions: summary,
    radioStatus,
    radioTrackId,
    reason: String(sync?.details?.radio?.reason || ""),
    message: messages[status],
  };
}

async function loadHandoffRows(db, songId, ownerMemberId) {
  const songs = await db.sql`
    SELECT id, pipeline_status, rights_status, metadata_status, explicit_lyrics
    FROM halo_song_catalog
    WHERE id = ${songId} AND owner_member_id = ${ownerMemberId} AND status = 'active'
    LIMIT 1
  `;
  if (!songs[0]) return { song: null, versions: [], sync: null };
  const [versions, syncRows] = await Promise.all([
    db.sql`
      SELECT version_type, audio_url, audio_blob_prefix, mastering_status
      FROM halo_song_versions
      WHERE song_id = ${songId} AND status = 'active'
    `,
    db.sql`
      SELECT radio_status, radio_track_id, last_error, details
      FROM halo_song_publication_sync
      WHERE song_id = ${songId}
      LIMIT 1
    `,
  ]);
  return { song: songs[0], versions, sync: syncRows[0] || null };
}

/**
 * Runs the master → radio handoff after an upload is persisted. Published songs are reconciled
 * immediately (instead of waiting for the 15-minute scheduled reconcile). Never throws: uploads
 * must stay successful even when the downstream handoff cannot complete.
 */
export async function runRadioHandoff(db, { songId, ownerMemberId, actorId = "system", actorType = "member" } = {}) {
  try {
    let rows = await loadHandoffRows(db, songId, ownerMemberId);
    let reconcileError = "";
    if (rows.song?.pipeline_status === "published") {
      try {
        await reconcilePublishedSong(db, { songId, ownerMemberId, actorId, actorType });
      } catch (error) {
        reconcileError = error instanceof Error ? error.message : "unknown error";
        console.error("Radio handoff reconcile failed", reconcileError);
      }
      rows = await loadHandoffRows(db, songId, ownerMemberId);
    }
    return describeRadioHandoff({ ...rows, reconcileError });
  } catch (error) {
    console.error("Radio handoff status failed", error instanceof Error ? error.message : "unknown error");
    return { ...describeRadioHandoff({ song: null }), status: "unknown" };
  }
}
