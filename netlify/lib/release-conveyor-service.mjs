import { runReleaseConveyor } from "./release-conveyor.mjs";
import { claimConveyor, conveyorPorts, loadReleaseSubmission, releaseConveyorLease } from "./release-conveyor-store.mjs";
import { RELEASE_PIPELINE_VERSION } from "./release-conveyor.mjs";

export async function processCatalogRelease(db, ownerMemberId, songId, prepareAudio, options, { automatic = true } = {}) {
  if (!(await loadReleaseSubmission(db, ownerMemberId, songId))) return null;
  const claim = await claimConveyor(db, ownerMemberId, songId);
  if (!claim) return { status: "processing", busy: true };
  try {
    const submission = await loadReleaseSubmission(db, ownerMemberId, songId);
    if (!submission) return null;
    const settings = options || claim.previous?.options || { humHz: 0 };
    const ports = conveyorPorts(db, ownerMemberId, songId, claim.token, submission, settings, prepareAudio);
    return await runReleaseConveyor({ ...submission, previous: claim.previous, ports, options: settings, automatic });
  } finally {
    await releaseConveyorLease(db, ownerMemberId, songId, claim.token).catch(() => {});
  }
}

export async function recoverCatalogReleases(db, prepareAudio, limit = 10) {
  const boundedLimit = Math.max(1, Math.min(10, Number.parseInt(limit, 10) || 10));
  const candidates = await db.sql`
    SELECT song.id, song.owner_member_id
    FROM halo_song_catalog song
    LEFT JOIN halo_release_conveyor conveyor ON conveyor.song_id = song.id
    WHERE song.status = 'active'
      AND EXISTS (
        SELECT 1 FROM halo_song_versions version
        WHERE version.song_id = song.id AND version.status = 'active'
          AND version.version_type = 'sale_master' AND COALESCE(version.audio_url, '') <> ''
      )
      AND (conveyor.locked_until IS NULL OR conveyor.locked_until < NOW())
      AND (
        conveyor.song_id IS NULL
        OR song.updated_at > COALESCE((conveyor.state->>'sourceUpdatedAt')::timestamptz, conveyor.updated_at)
        OR COALESCE(conveyor.state->>'pipelineVersion', '') <> ${String(RELEASE_PIPELINE_VERSION)}
        OR EXISTS (
          SELECT 1 FROM halo_song_versions version WHERE version.song_id = song.id
            AND version.updated_at > COALESCE((conveyor.state->>'sourceUpdatedAt')::timestamptz, conveyor.updated_at)
        )
        OR COALESCE(conveyor.state->>'status', '') IN ('processing', 'retryable', '')
      )
      AND (conveyor.state->>'nextRetryAt' IS NULL OR (conveyor.state->>'nextRetryAt')::timestamptz <= NOW())
    ORDER BY COALESCE(conveyor.updated_at, song.updated_at), song.id
    LIMIT ${boundedLimit}
  `;
  const results = [];
  for (const candidate of candidates) {
    try {
      const state = await processCatalogRelease(db, candidate.owner_member_id, candidate.id, prepareAudio, undefined, { automatic: true });
      results.push({ releaseId: candidate.id, status: state?.status || "not_found" });
    } catch {
      results.push({ releaseId: candidate.id, status: "retryable" });
    }
  }
  return { scanned: candidates.length, results };
}
