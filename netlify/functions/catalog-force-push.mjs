import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership, isOwner } from "../lib/halo-x.mjs";
import { reconcilePublishedSong } from "../lib/song-publication.mjs";
import { forcePushTrack } from "../lib/catalog-force-push.mjs";

const MAX_BODY_BYTES = 16_000;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export default async function catalogForcePushHandler(request) {
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405, { Allow: "POST" });
  try { verifyRequestOrigin(request); } catch { return json({ success: false, message: "Cross-origin catalog actions are not accepted" }, 403); }
  if (!String(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    return json({ success: false, message: "Tracks must be sent as JSON" }, 415);
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return json({ success: false, message: "This track update is too large" }, 413);
  }
  try {
    const user = await getUser();
    if (!user?.id) return json({ success: false, message: "Sign in to push tracks to the shop" }, 401);
    const payload = await request.json().catch(() => null);
    if (!payload) return json({ success: false, message: "Request body must be valid JSON" }, 400);
    const db = getDatabase();
    const membership = await ensureMembership(db, user);
    const result = await forcePushTrack(db, payload, {
      memberId: membership.member_id,
      actorId: membership.actor_id,
      isAdmin: isOwner(user),
      reconcile: reconcilePublishedSong
    });
    return json(result.body, result.status);
  } catch (error) {
    console.error("HALO force push failed", error instanceof Error ? error.message : "unknown error");
    return json({ success: false, message: "The track could not be pushed to the shop right now" }, 500);
  }
}

export const config = { path: "/api/catalog/force-push-track" };
