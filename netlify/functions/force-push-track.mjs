import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { forcePushTrack } from "../lib/song-publication.mjs";

const MAX_BODY_BYTES = 80_000;
const json = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", ...headers },
});

export default async function forcePushTrackHandler(request) {
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405, { Allow: "POST" });
  try {
    const user = await getUser();
    if (!user?.id) return json({ message: "Sign in to publish a track" }, 401);
    try { verifyRequestOrigin(request); } catch {
      return json({ message: "Cross-origin catalog actions are not accepted" }, 403);
    }
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
      return json({ message: "This catalog update is too large" }, 413);
    }
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return json({ message: "This catalog update is too large" }, 413);
    let payload;
    try { payload = JSON.parse(body); } catch {
      return json({ message: "Request body must be valid JSON" }, 400);
    }
    const db = getDatabase();
    const membership = await ensureMembership(db, user);
    return json(await forcePushTrack(db, payload, membership));
  } catch (error) {
    if ([400, 404, 409].includes(error?.status)) return json({ message: error.message }, error.status);
    console.error("Track force-push failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Publication was not confirmed. Please retry or check publication health." }, 500);
  }
}

export const config = { path: "/api/catalog/force-push-track" };
