import { runReleaseConveyor } from "./release-conveyor.mjs";
import { claimConveyor, conveyorPorts, loadReleaseSubmission, releaseConveyorLease } from "./release-conveyor-store.mjs";

export async function processCatalogRelease(db, ownerMemberId, songId, prepareAudio, options) {
  if (!(await loadReleaseSubmission(db, ownerMemberId, songId))) return null;
  const claim = await claimConveyor(db, ownerMemberId, songId);
  if (!claim) return { status: "processing", busy: true };
  try {
    const submission = await loadReleaseSubmission(db, ownerMemberId, songId);
    if (!submission) return null;
    const settings = options || claim.previous?.options || { humHz: 0 };
    const ports = conveyorPorts(db, ownerMemberId, songId, claim.token, submission, settings, prepareAudio);
    return await runReleaseConveyor({ ...submission, previous: claim.previous, ports, options: settings });
  } finally {
    await releaseConveyorLease(db, ownerMemberId, songId, claim.token).catch(() => {});
  }
}
