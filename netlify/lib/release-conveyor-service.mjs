import { runReleaseConveyor } from "./release-conveyor.mjs";
import { claimConveyor, conveyorPorts, loadReleaseSubmission, releaseConveyorLease, persistWatchdog } from "./release-conveyor-store.mjs";
import { RELEASE_PIPELINE_VERSION } from "./release-conveyor.mjs";
import { inspectHaloRelease } from "./halo-watchdog.mjs";

export async function processCatalogRelease(db, ownerMemberId, songId, prepareAudio, options, { automatic = true, deadline = Infinity, infrastructure, assetAuditor } = {}) {
  if (!(await loadReleaseSubmission(db, ownerMemberId, songId))) return null;
  const claim = await claimConveyor(db, ownerMemberId, songId);
  if (!claim) return { status: "processing", busy: true };
  try {
    let submission = await loadReleaseSubmission(db, ownerMemberId, songId);
    if (!submission) return null;
    const settings = options || claim.previous?.options || { humHz: 0 };
    const assetChecks = assetAuditor ? await assetAuditor(submission) : claim.previous?.watchdog?.assetChecks || [];
    const watchdog = inspectHaloRelease({ ...submission, previous: claim.previous,
      assetChecks,
      infrastructure: infrastructure || claim.previous?.watchdog?.infrastructure || [] });
    await persistWatchdog(db, ownerMemberId, songId, claim.token, submission, watchdog);
    submission = await loadReleaseSubmission(db, ownerMemberId, songId);
    if (!submission) return null;
    const ports = conveyorPorts(db, ownerMemberId, songId, claim.token, submission, settings, prepareAudio);
    ports.deadline = deadline;
    return await runReleaseConveyor({ ...submission, previous: claim.previous, watchdog, ports, options: settings, automatic });
  } finally {
    await releaseConveyorLease(db, ownerMemberId, songId, claim.token).catch(() => {});
  }
}

export async function recoverCatalogReleases(db, prepareAudio, limit = 10, { budgetMilliseconds = 20_000, infrastructure, assetAuditor } = {}) {
  const deadline = Date.now() + Math.max(1, Math.min(20_000, budgetMilliseconds));
  const boundedLimit = Math.max(1, Math.min(10, Number.parseInt(limit, 10) || 10));
  const candidates = await db.sql`
    SELECT song.id, song.owner_member_id
    FROM halo_song_catalog song
    LEFT JOIN halo_release_conveyor conveyor ON conveyor.song_id = song.id
    WHERE song.status = 'active'
      AND (conveyor.locked_until IS NULL OR conveyor.locked_until < NOW())
      AND ((
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
      OR conveyor.state->'watchdog'->>'checkedAt' IS NULL
      OR (conveyor.state->'watchdog'->>'checkedAt')::timestamptz < NOW() - INTERVAL '5 minutes')
    ORDER BY COALESCE((conveyor.state->'watchdog'->>'checkedAt')::timestamptz, 'epoch'::timestamptz), song.id
    LIMIT ${boundedLimit}
  `;
  const results = [];
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    try {
      const state = await processCatalogRelease(db, candidate.owner_member_id, candidate.id, prepareAudio, undefined, { automatic: true, deadline, infrastructure, assetAuditor });
      results.push({ releaseId: candidate.id, status: state?.status || "not_found" });
    } catch {
      results.push({ releaseId: candidate.id, status: "retryable" });
    }
  }
  return { scanned: candidates.length, results };
}
