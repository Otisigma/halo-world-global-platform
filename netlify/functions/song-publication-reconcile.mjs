import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { reconcilePublishedSongs } from "../lib/song-publication.mjs";
import { ensureMembership } from "../lib/halo-x.mjs";
import { cleanDreamweaverSongId } from "../../lib/dreamweaver-storefront.js";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function runReconcile(limit = 50) {
  const db = await getDatabase();
  const results = await reconcilePublishedSongs(db, {
    limit,
    actorId: "system",
    actorType: "system",
  });
  const repaired = results.filter(result => result?.ok).length;
  const failed = results.filter(result => result && result.ok === false).length;
  return { repaired, failed, scanned: results.length, results };
}

export function createPublicationReconcileHandler({
  database = getDatabase,
  currentUser = getUser,
  verifyOrigin = verifyRequestOrigin,
  membershipFor = ensureMembership,
  reconcile = reconcilePublishedSongs,
} = {}) {
  return async function songPublicationReconcileHandler(request) {
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
    try {
      const user = await currentUser();
      if (!user?.id) return json({ message: "Sign in to recheck a published song" }, 401);
      try {
        if ((await verifyOrigin(request)) === false) throw new Error("Invalid origin");
      } catch {
        return json({ message: "Cross-origin publication actions are not accepted" }, 403);
      }
      if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        return json({ message: "Send the song id as JSON" }, 415);
      }
      if (Number(request.headers.get("content-length") || 0) > 4096) return json({ message: "Request is too large" }, 413);
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 4096) return json({ message: "Request is too large" }, 413);
      let payload;
      try { payload = JSON.parse(text); } catch { return json({ message: "Request body must be valid JSON" }, 400); }
      const songId = payload && !Array.isArray(payload) && typeof payload === "object"
        ? cleanDreamweaverSongId(payload.songId) : "";
      if (!songId) return json({ message: "Choose a valid published song id" }, 400);
      const db = await database();
      const membership = await membershipFor(db, user);
      if (!membership?.member_id) return json({ message: "Catalog membership is required" }, 403);
      const results = await reconcile(db, {
        songId, ownerMemberId: membership.member_id, limit: 1,
        actorId: membership.actor_id, actorType: "member",
      });
      if (!results.length) return json({ message: "That published song was not found in your catalog" }, 404);
      const repaired = results.filter(result => result?.ok).length;
      return json({ repaired, failed: results.length - repaired, scanned: results.length, results }, repaired ? 200 : 409);
    } catch (error) {
      console.error("Song publication reconcile failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "Song publication reconcile failed" }, 500);
    }
  };
}

export default createPublicationReconcileHandler();

export const config = {
  path: "/api/song-publication-reconcile"
};
