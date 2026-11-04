// Live readiness telemetry for catalog audio uploads.
// Preflight runs while chunks land so blockers surface early, but it can never mark a song ready:
// stream/catalog readiness is only reported after finalization verifies every persisted byte.

const PUBLISHED_RELEASE = new Set(["published"]);

function text(value) {
  return String(value ?? "").trim();
}

function requiredIssueFields(issues) {
  return (Array.isArray(issues) ? issues : [])
    .filter(issue => issue && issue.level === "required")
    .map(issue => ({ field: text(issue.field), message: text(issue.message) }));
}

export function evaluateUploadPreflight(row, { receivedChunks = 0, chunkCount = 0 } = {}) {
  if (!row) return { ownership: false, catalogReady: false, streamReady: false, blockers: [{ field: "ownership", message: "That song version was not found." }] };
  const blockers = [];
  if (!text(row.title) || !text(row.artist_name)) blockers.push({ field: "metadata", message: "Add the song title and artist before release." });
  if (text(row.rights_status) !== "cleared") blockers.push({ field: "rightsStatus", message: "Confirm ownership, samples, features, and splits before release." });
  const total = Math.max(0, Number(chunkCount) || 0);
  const received = Math.max(0, Math.min(total, Number(receivedChunks) || 0));
  return {
    ownership: true,
    versionType: text(row.version_type),
    checks: {
      metadata: !blockers.some(blocker => blocker.field === "metadata"),
      rights: text(row.rights_status) === "cleared",
      saleMasterRole: text(row.version_type) === "sale_master",
    },
    progress: total ? Math.round((received / total) * 100) : 0,
    status: "INGESTING",
    // Partial chunks are never playable; readiness waits for the verified finalize step.
    catalogReady: false,
    streamReady: false,
    clearsOnFinalize: blockers.length === 0,
    blockers,
  };
}

export async function loadUploadPreflight(db, ownerMemberId, songId, versionId, progress = {}) {
  const rows = await db.sql`
    SELECT song.title, song.artist_name, song.rights_status, version.version_type
    FROM halo_song_versions version
    JOIN halo_song_catalog song ON song.id = version.song_id
    WHERE version.id = ${versionId} AND song.id = ${songId}
      AND song.owner_member_id = ${ownerMemberId} AND song.status = 'active' AND version.status = 'active'
    LIMIT 1
  `;
  return evaluateUploadPreflight(rows[0] || null, progress);
}

export function summarizeUploadReadiness({ song, sync, persisted }) {
  if (!song) return { status: "MISSING", streamReady: false, catalogReady: false, published: false, dreamweaverReady: false, blockers: [] };
  const blockers = requiredIssueFields(song.metadata_issues);
  const streamReady = persisted === true;
  const catalogReady = streamReady && text(song.metadata_status) !== "needs_attention" && blockers.length === 0;
  const releaseStatus = text(sync?.release_status) || "pending";
  const dreamweaverStatus = text(sync?.dreamweaver_status) || "pending";
  const published = PUBLISHED_RELEASE.has(releaseStatus);
  const dreamweaverReady = published && dreamweaverStatus === "ready";
  // LIVE needs a clean review too, so a stale publication row cannot hide new blockers.
  const status = !streamReady ? "INGESTING"
    : !catalogReady ? "NEEDS_ATTENTION"
      : dreamweaverReady ? "LIVE"
        : "CATALOG_READY";
  return {
    status,
    streamReady,
    catalogReady,
    published,
    dreamweaverReady,
    releaseStatus,
    dreamweaverStatus,
    shareReason: text(sync?.details?.shareVerification?.reason),
    lastError: text(sync?.last_error),
    blockers,
  };
}

export async function loadUploadReadiness(db, ownerMemberId, songId, { persisted = true } = {}) {
  const [songs, syncs] = await Promise.all([
    db.sql`
      SELECT id, metadata_status, metadata_issues
      FROM halo_song_catalog
      WHERE id = ${songId} AND owner_member_id = ${ownerMemberId} AND status = 'active'
      LIMIT 1
    `,
    db.sql`
      SELECT release_status, dreamweaver_status, details, last_error
      FROM halo_song_publication_sync
      WHERE song_id = ${songId} AND owner_member_id = ${ownerMemberId}
      LIMIT 1
    `,
  ]);
  return summarizeUploadReadiness({ song: songs[0] || null, sync: syncs[0] || null, persisted });
}

// Readiness receipts are advisory: the upload is already locked in, so a lookup failure must not undo it.
export async function safeUploadReadiness(db, ownerMemberId, songId, options) {
  try {
    return await loadUploadReadiness(db, ownerMemberId, songId, options);
  } catch {
    return { status: "PENDING_RECHECK", streamReady: options?.persisted !== false, catalogReady: false, published: false, dreamweaverReady: false, blockers: [], lastError: "Readiness lookup is pending; scheduled recovery will refresh it." };
  }
}
