import { loadCreatorPass } from "./creator-pass.mjs";
import { readBoundedText, StudioGuardianError } from "./halo-ai-service.mjs";

export function createSmartSplitsHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin }) {
  const json = (body, status = 200) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
  return async request => {
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
    try {
      if (request.headers.get("Origin") !== new URL(request.url).origin ||
        request.headers.get("Sec-Fetch-Site") === "cross-site") return json({ message: "Cross-origin action rejected" }, 403);
      try {
        if (await verifyRequestOrigin(request) === false) return json({ message: "Cross-origin action rejected" }, 403);
      } catch { return json({ message: "Cross-origin action rejected" }, 403); }
      const user = await getUser(request);
      if (!user?.id) return json({ message: "Sign in to use smart splits" }, 401);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) {
        return json({ message: "Use a JSON request body" }, 415);
      }
      if (Number(request.headers.get("Content-Length")) > 4096) return json({ message: "Request is too large" }, 413);
      let body;
      try { body = JSON.parse(await readBoundedText(request, 4096)); }
      catch (error) {
        if (error instanceof StudioGuardianError) throw error;
        return json({ message: "Request body must be valid JSON" }, 400);
      }
      if (!body || Array.isArray(body) || typeof body !== "object" ||
        Object.keys(body).some(key => key !== "projectId") ||
        typeof body.projectId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.projectId)) {
        return json({ message: "Choose a valid project ID" }, 400);
      }
      const db = await getDatabase();
      const membership = await ensureMembership(db, user);
      if (!membership?.member_id) return json({ message: "Membership is required" }, 403);
      const memberId = membership.member_id;
      if (!(await loadCreatorPass(db, memberId)).entitlements.smartSplitsEnabled) {
        return json({ message: "An active Premium CreatorPass is required for smart splits" }, 403);
      }
      const projects = await db.sql`
        SELECT p.id, p.title, w.id AS work_id, w.work_type
        FROM halo_creator_projects p
        JOIN halo_artist_rights_works w ON w.id = p.rights_work_id AND w.owner_member_id = ${memberId}
        WHERE p.id = ${body.projectId} AND p.owner_member_id = ${memberId}
        LIMIT 1
      `;
      const project = projects[0];
      if (!project) return json({ message: "Owner project with linked rights work not found" }, 404);
      const rows = await db.sql`
        SELECT participant_name, role, share_bps FROM halo_artist_rights_participants
        WHERE work_id = ${project.work_id} ORDER BY id LIMIT 201
      `;
      const allocationsFor = role => rows.filter(row => row.role === role).map(row => ({
        participantName: row.participant_name, role: row.role, shareBps: Number(row.share_bps)
      }));
      const allocations = allocationsFor(project.work_type === "recording" ? "master_owner" : "songwriter");
      const publisherAllocations = project.work_type === "composition" ? allocationsFor("publisher") : [];
      const completePool = pool => pool.length > 0 && pool.every(row =>
        Number.isInteger(row.shareBps) && row.shareBps >= 0 && row.shareBps <= 10000
      ) && pool.reduce((sum, row) => sum + row.shareBps, 0) === 10000;
      if (rows.length > 200 || !completePool(allocations) ||
        (publisherAllocations.length > 0 && !completePool(publisherAllocations))) {
        return json({ message: "Record explicit allocations totaling 100% for this rights pool before drafting" }, 409);
      }
      return json({ draft: {
        projectId: project.id, title: project.title, rightsWorkId: project.work_id,
        pool: project.work_type === "recording" ? "master" : "publishing",
        allocations, publisherAllocations, status: "draft", requiresHumanApproval: true, consent: "not_recorded",
        terms: "Proposed allocations only. Each listed contributor must explicitly consent to a human-reviewed agreement before use. This draft does not clear rights, grant licenses, or approve a release."
      } });
    } catch (error) {
      return error instanceof StudioGuardianError
        ? json({ message: error.message }, error.status)
        : json({ message: "Smart splits are temporarily unavailable" }, 503);
    }
  };
}
