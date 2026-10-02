import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { ForcePushError, forcePushTrack } from "../lib/catalog-force-push.mjs";

const MAX_BODY_BYTES = 20_000;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export default async function catalogForcePushHandler(request) {
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405, { Allow: "POST" });
  try {
    const user = await getUser();
    if (!user?.id) return json({ message: "Sign in to push songs to the shop" }, 401);
    try { verifyRequestOrigin(request); } catch { return json({ message: "Cross-origin catalog updates are not accepted" }, 403); }
    if (!String(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
      return json({ message: "Send the track as JSON" }, 415);
    }
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ message: "This track payload is too large" }, 413);
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ message: "This track payload is too large" }, 413);
    let payload = null;
    try { payload = JSON.parse(raw); } catch { return json({ message: "Request body must be valid JSON" }, 400); }
    const db = getDatabase();
    const membership = await ensureMembership(db, user);
    const result = await forcePushTrack(db, {
      ownerMemberId: membership.member_id,
      actorId: membership.actor_id,
      payload
    });
    return json(result);
  } catch (error) {
    if (error instanceof ForcePushError) return json({ success: false, message: error.message }, error.status);
    console.error("HALO force push failed", error instanceof Error ? error.message : "unknown error");
    return json({ success: false, message: "The song could not be pushed to the shop. Try again shortly." }, 502);
  }
}

export const config = { path: "/api/catalog/force-push-track" };
