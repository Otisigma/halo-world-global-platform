import { runReleaseConveyor, releaseFingerprint } from "./release-conveyor.mjs";
import { claimConveyor, conveyorPorts, loadReleaseSubmission, releaseConveyorLease } from "./release-conveyor-store.mjs";
import { RELEASE_PIPELINE_VERSION } from "./release-conveyor.mjs";
import { healCatalogRelease, releaseWatchdogDiagnostics, createInfrastructureChecker, WATCHDOG_ROUTES } from "./release-conveyor-watchdog.mjs";

export async function processCatalogRelease(db, ownerMemberId, songId, prepareAudio, options, { automatic = true, deadline = Infinity, check, routes = [] } = {}) {
  if (!(await loadReleaseSubmission(db, ownerMemberId, songId))) return null;
  const claim = await claimConveyor(db, ownerMemberId, songId);
  if (!claim) return { status: "processing", busy: true };
  try {
    let submission = await loadReleaseSubmission(db, ownerMemberId, songId);
    if (!submission) return null;
    const settings = options || claim.previous?.options || { humHz: 0 };
    const watchdogDue = releaseFingerprint(submission.song, submission.versions, settings) !== claim.previous?.inputHash
      || !(Date.now() - new Date(claim.previous?.watchdog?.checkedAt).getTime() < 5 * 60_000);
    const healing = watchdogDue
      ? await healCatalogRelease(db, ownerMemberId, songId, claim.token, submission, settings) : null;
    if (healing?.repairs.length) submission = await loadReleaseSubmission(db, ownerMemberId, songId);
    if (!submission) return null;
    const diagnosticRoutes = routes.length ? routes : claim.previous?.watchdog?.routes || [];
    const watchdog = watchdogDue ? await releaseWatchdogDiagnostics(submission, healing, check, diagnosticRoutes) : null;
    if (watchdog && !check && claim.previous?.watchdog?.graph?.locked
      && watchdog.graph.revision === claim.previous.watchdog.graph.revision
      && !watchdog.issues.some(issue => ["asset", "artwork", "video", "sale_master_audio"].includes(issue.field))) {
      watchdog.graph = claim.previous.watchdog.graph;
      watchdog.issues = watchdog.issues.filter(issue => issue.field !== "asset_verification");
    }
    if (watchdog?.graph.locked && (!claim.previous?.watchdog?.graph?.locked
      || watchdog.graph.revision !== claim.previous.watchdog.graph.revision)) {
      watchdog.repairs.push("lock_dreamweaver_graph");
    }
    const ports = conveyorPorts(db, ownerMemberId, songId, claim.token, submission, settings, prepareAudio);
    ports.deadline = deadline;
    if (watchdog) ports.watchdog = watchdog;
    return await runReleaseConveyor({ ...submission, previous: claim.previous, ports, options: settings, automatic });
  } finally {
    await releaseConveyorLease(db, ownerMemberId, songId, claim.token).catch(() => {});
  }
}

export async function recoverCatalogReleases(db, prepareAudio, limit = 10, { budgetMilliseconds = 20_000,
  origin = process.env.URL, fetcher = fetch } = {}) {
  const deadline = Date.now() + Math.max(1, Math.min(20_000, budgetMilliseconds));
  const boundedLimit = Math.max(1, Math.min(10, Number.parseInt(limit, 10) || 10));
  const check = createInfrastructureChecker(origin, fetcher, { deadline });
  const routes = check ? await Promise.all(WATCHDOG_ROUTES.map(check))
    : WATCHDOG_ROUTES.map(url => ({ url, status: "not_configured" }));
  const candidates = await db.sql`
    SELECT song.id, song.owner_member_id
    FROM halo_song_catalog song
    LEFT JOIN halo_release_conveyor conveyor ON conveyor.song_id = song.id
    WHERE song.status = 'active'
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
        OR conveyor.updated_at < NOW() - INTERVAL '5 minutes'
      )
      AND (conveyor.state->>'nextRetryAt' IS NULL OR (conveyor.state->>'nextRetryAt')::timestamptz <= NOW())
    ORDER BY COALESCE(conveyor.updated_at, song.updated_at), song.id
    LIMIT ${boundedLimit}
  `;
  const results = [];
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    try {
      const state = await processCatalogRelease(db, candidate.owner_member_id, candidate.id, prepareAudio, undefined, { automatic: true, deadline, check, routes });
      results.push({ releaseId: candidate.id, status: state?.status || "not_found" });
    } catch {
      results.push({ releaseId: candidate.id, status: "retryable" });
    }
  }
  return { scanned: candidates.length, results };
}
