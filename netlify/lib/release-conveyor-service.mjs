import { runReleaseConveyor } from "./release-conveyor.mjs";
import { claimConveyor, conveyorPorts, loadReleaseSubmission, releaseConveyorLease, persistWatchdog } from "./release-conveyor-store.mjs";
import { RELEASE_PIPELINE_VERSION, releaseFingerprint } from "./release-conveyor.mjs";
import { inspectHaloRelease, auditHaloAssets } from "./halo-watchdog.mjs";
import { healCatalogRelease, releaseWatchdogDiagnostics, createInfrastructureChecker, WATCHDOG_ROUTES } from "./release-conveyor-watchdog.mjs";

export async function processCatalogRelease(db, ownerMemberId, songId, prepareAudio, options, {
  automatic = true, deadline = Infinity, check, routes = [], infrastructure, assetAuditor,
} = {}) {
  if (!(await loadReleaseSubmission(db, ownerMemberId, songId))) return null;
  const claim = await claimConveyor(db, ownerMemberId, songId);
  if (!claim) return { status: "processing", busy: true };
  try {
    let submission = await loadReleaseSubmission(db, ownerMemberId, songId);
    if (!submission) return null;
    const settings = options || claim.previous?.options || { humHz: 0 };
    const watchdogDue = releaseFingerprint(submission.song, submission.versions, settings) !== claim.previous?.inputHash
      || !claim.previous?.watchdog?.assetGraph
      || !(Date.now() - new Date(claim.previous?.watchdog?.checkedAt).getTime() < 5 * 60_000);
    const healing = watchdogDue
      ? await healCatalogRelease(db, ownerMemberId, songId, claim.token, submission, settings) : null;
    if (healing?.repairs.length) submission = await loadReleaseSubmission(db, ownerMemberId, songId);
    if (!submission) return null;
    const diagnosticRoutes = routes.length ? routes : claim.previous?.watchdog?.routes || [];
    const diagnostics = watchdogDue ? await releaseWatchdogDiagnostics(submission, healing, check, diagnosticRoutes) : null;
    if (diagnostics && !check && claim.previous?.watchdog?.graph?.locked
      && diagnostics.graph.revision === claim.previous.watchdog.graph.revision
      && !diagnostics.issues.some(issue => ["asset", "artwork", "video", "sale_master_audio"].includes(issue.field))) {
      diagnostics.graph = claim.previous.watchdog.graph;
      diagnostics.issues = diagnostics.issues.filter(issue => issue.field !== "asset_verification");
    }
    if (diagnostics?.graph.locked && (!claim.previous?.watchdog?.graph?.locked
      || diagnostics.graph.revision !== claim.previous.watchdog.graph.revision)) {
      diagnostics.repairs.push("lock_dreamweaver_graph");
    }
    const assetChecks = watchdogDue && assetAuditor ? await assetAuditor(submission) : claim.previous?.watchdog?.assetChecks || [];
    const watchdog = watchdogDue ? { ...diagnostics, ...inspectHaloRelease({ ...submission, previous: claim.previous,
      assetChecks, infrastructure: infrastructure || claim.previous?.watchdog?.infrastructure || [] }) } : claim.previous?.watchdog;
    const metadata = watchdogDue ? watchdog.actions.find(action => action.type === "restore_isrc") : null;
    const radio = watchdogDue ? watchdog.actions.find(action => action.type === "auto_queue_radio") : null;
    const expected = releaseFingerprint(
      metadata ? { ...submission.song, isrc: metadata.isrc } : submission.song,
      submission.versions.map(version => version.id === radio?.versionId ? { ...version, mastering_status: "queued" } : version),
      settings);
    if (watchdogDue) await persistWatchdog(db, ownerMemberId, songId, claim.token, submission, watchdog);
    submission = await loadReleaseSubmission(db, ownerMemberId, songId);
    if (!submission) return null;
    if (releaseFingerprint(submission.song, submission.versions, settings) !== expected) {
      throw new Error("Submission changed during watchdog repair");
    }
    const ports = conveyorPorts(db, ownerMemberId, songId, claim.token, submission, settings, prepareAudio);
    ports.deadline = deadline;
    if (watchdogDue) ports.watchdog = watchdog;
    return await runReleaseConveyor({ ...submission, previous: claim.previous, watchdog, ports, options: settings, automatic });
  } finally {
    await releaseConveyorLease(db, ownerMemberId, songId, claim.token).catch(() => {});
  }
}

export async function recoverCatalogReleases(db, prepareAudio, limit = 10, { budgetMilliseconds = 20_000,
  origin = process.env.URL, fetcher = fetch, infrastructure,
  assetAuditor = submission => auditHaloAssets(submission, origin, { fetcher }) } = {}) {
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
      const state = await processCatalogRelease(db, candidate.owner_member_id, candidate.id, prepareAudio, undefined,
        { automatic: true, deadline, check, routes, infrastructure, assetAuditor });
      results.push({ releaseId: candidate.id, status: state?.status || "not_found" });
    } catch {
      results.push({ releaseId: candidate.id, status: "retryable" });
    }
  }
  return { scanned: candidates.length, results };
}
