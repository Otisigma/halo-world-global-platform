import { releaseFingerprint } from "./release-conveyor.mjs";
import { loadConveyorState, loadReleaseSubmission } from "./release-conveyor-store.mjs";
import { processCatalogRelease } from "./release-conveyor-service.mjs";
import { cleanDreamweaverSongId } from "../../lib/dreamweaver-storefront.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export function createReleaseConveyorHandler({ getDatabase, getUser, verifyRequestOrigin, ensureMembership, prepareAudio, downloadAudio }) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
    let db, membership, songId;
    try {
      const user = await getUser();
      if (!user?.id) return json({ message: "Sign in to run your release conveyor." }, 401);
      if (request.method === "POST") {
        try { verifyRequestOrigin(request); } catch { return json({ message: "Cross-origin conveyor updates are not accepted." }, 403); }
      }
      db = await getDatabase();
      membership = await ensureMembership(db, user);
      const url = new URL(request.url);
      const payload = request.method === "POST" ? await request.json().catch(() => null) : null;
      if (request.method === "POST" && (!payload || payload.action !== "process_submission")) {
        return json({ message: "Choose process_submission with an existing catalog songId." }, 400);
      }
      songId = cleanDreamweaverSongId(payload?.songId || url.searchParams.get("songId"));
      if (!songId) return json({ message: "Choose a valid catalog song." }, 400);
      const submission = await loadReleaseSubmission(db, membership.member_id, songId);
      if (!submission) return json({ message: "Song not found." }, 404);
      if (request.method === "GET") {
        const stored = await loadConveyorState(db, membership.member_id, songId);
        if (!stored?.state?.inputHash) return json({ status: "not_started", releaseId: songId, receipt: null });
        const state = stored.state;
        const current = releaseFingerprint(submission.song, submission.versions, state.options) === state.inputHash;
        const artifact = url.searchParams.get("artifact");
        if (artifact && !current) return json({ message: "The song changed. Rerun the conveyor to regenerate this package." }, 409);
        if (artifact === "audio") return downloadAudio({ ...state, ownerMemberId: membership.member_id }, request);
        if (artifact === "package") {
          if (state.status !== "ready") return json({ message: "Resolve the release receipt before downloading a ready package." }, 409);
          return new Response(JSON.stringify({ receipt: state.receipt, ...state.package }, null, 2), { headers: {
            "Content-Type": "application/json", "Cache-Control": "private, no-store",
            "Content-Disposition": `attachment; filename="HALO-${songId}-release-package.json"`,
          } });
        }
        if (artifact) return json({ message: "Unknown release artifact." }, 400);
        const events = await db.sql`
          SELECT stage, details, created_at FROM halo_release_conveyor_events
          WHERE song_id = ${songId} AND owner_member_id = ${membership.member_id}
          ORDER BY created_at DESC LIMIT 50
        `;
        return json({ ...state, ...(current ? {} : { status: "stale", receipt: { ...state.receipt, ready: false, status: "stale" } }),
          busy: stored.locked_until && new Date(stored.locked_until) > new Date(), events });
      }
      const humHz = Number(payload.humHz ?? 0);
      if (![0, 50, 60].includes(humHz)) return json({ message: "Hum filtering must be off, 50 Hz or 60 Hz." }, 400);
      const options = { humHz };
      const result = await processCatalogRelease(db, membership.member_id, songId, prepareAudio, options);
      if (!result) return json({ message: "Song not found." }, 404);
      if (result.busy) return json({ message: "This song is already processing. Check its status before retrying.", status: "processing" }, 409);
      return json(result);
    } catch (error) {
      // Provider/database exception text is never sent back to a creator.
      return json({ message: "The release conveyor is temporarily unavailable. Your catalog song is safe; retry shortly.", retryable: true }, 503);
    }
  };
}
