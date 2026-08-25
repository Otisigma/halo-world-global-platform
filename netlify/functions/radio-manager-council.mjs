import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership, isOwner } from "../lib/halo-x.mjs";
import { decideManagerAction, loadManagerCouncil, runManagerCouncil } from "../lib/radio-manager-council.mjs";

const decisions = new Set(["approved", "rejected", "completed"]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export default async function radioManagerCouncil(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  let user;
  try {
    user = await getUser();
  } catch {
    return json({ message: "Station manager access could not be verified" }, 503);
  }
  if (!user?.id) return json({ message: "Sign in to open the manager council" }, 401);
  if (!isOwner(user)) return json({ message: "Owner access is required for the manager council" }, 403);

  try {
    const db = await getDatabase();
    const membership = await ensureMembership(db, user);
    if (request.method === "GET") return json({ council: await loadManagerCouncil(db) });

    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin manager actions are not accepted" }, 403);
    }
    if (Number(request.headers.get("content-length") || 0) > 12_000) return json({ message: "Manager request is too large" }, 413);
    const payload = await request.json().catch(() => null);
    if (!payload) return json({ message: "Request body must be valid JSON" }, 400);

    if (payload.action === "run_council") {
      const objective = cleanText(payload.objective, 500) || "Build HALO Radio into the most useful independent digital station for artists and listeners.";
      const horizonDays = Math.min(90, Math.max(7, Number.parseInt(payload.horizonDays, 10) || 30));
      return json({ council: await runManagerCouncil(db, membership.member_id, { objective, horizonDays }) }, 201);
    }
    if (payload.action === "decide_action") {
      const status = decisions.has(payload.status) ? payload.status : "";
      const actionId = cleanText(payload.actionId, 100);
      if (!actionId || !status) return json({ message: "Choose a valid manager action and decision" }, 400);
      const managerAction = await decideManagerAction(db, membership.member_id, actionId, status, cleanText(payload.decisionNote, 800));
      if (!managerAction) return json({ message: "The manager action was not found" }, 404);
      return json({ action: managerAction });
    }
    return json({ message: "Unknown manager council action" }, 400);
  } catch (error) {
    console.error("HALO radio manager council failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The manager council could not complete this request" }, 500);
  }
}

export const config = {
  path: "/api/radio/manager-council"
};
