import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership, isOwner } from "../lib/halo-x.mjs";
import { cleanDreamweaverSongId } from "../../lib/dreamweaver-storefront.js";
import { reconcilePublishedSong } from "../lib/song-publication.mjs";

const MAX_BODY_BYTES = 80_000;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function createForcePushTrackHandler({
  database = getDatabase,
  currentUser = getUser,
  verifyOrigin = verifyRequestOrigin,
  membershipFor = ensureMembership,
  reconcile = reconcilePublishedSong,
} = {}) {
  return async function forcePushTrackHandler(request) {
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405, { Allow: "POST" });
    try {
      const user = await currentUser();
      if (!user?.id) return json({ message: "Sign in to publish a track" }, 401);
      if (!isOwner(user)) return json({ message: "Admin access is required to force publication" }, 403);
      try {
        if ((await verifyOrigin(request)) === false) throw new Error("Invalid origin");
      } catch {
        return json({ message: "Cross-origin catalog actions are not accepted" }, 403);
      }
      if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        return json({ message: "Send the track as JSON" }, 415);
      }
      if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
        return json({ message: "This catalog update is too large" }, 413);
      }
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
        return json({ message: "This catalog update is too large" }, 413);
      }
      let payload;
      try { payload = JSON.parse(text); } catch { return json({ message: "Request body must be valid JSON" }, 400); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return json({ message: "Send a track with an id or title" }, 400);
      }
      const id = cleanDreamweaverSongId(payload.id);
      const title = cleanText(payload.title, 160);
      if ((!id && !title) || (payload.id != null && !id) || (typeof payload.title === "string" && payload.title.length > 160)) {
        return json({ message: "A valid track id or title is required" }, 400);
      }
      const db = await database();
      const membership = await membershipFor(db, user);
      const matches = id
        ? await db.sql`
            SELECT id, rights_status FROM halo_song_catalog
            WHERE id = ${id} AND owner_member_id = ${membership.member_id} AND status = 'active'
          `
        : await db.sql`
            SELECT id, rights_status FROM halo_song_catalog
            WHERE LOWER(title) = LOWER(${title}) AND owner_member_id = ${membership.member_id} AND status = 'active'
            LIMIT 2
          `;
      if (!matches.length) return json({ message: "That saved track was not found in your catalog" }, 404);
      if (matches.length !== 1) return json({ message: "More than one track has that title. Send its id instead." }, 409);
      if (matches[0].rights_status === "disputed") {
        return json({ message: "Resolve the rights dispute before pushing this song to the shop" }, 409);
      }

      // Publish the saved canonical record, not potentially stale browser metadata.
      const rows = await db.sql`
        UPDATE halo_song_catalog
        SET pipeline_status = 'published', pipeline_updated_at = NOW(), sale_status = 'for_sale',
          currency = CASE WHEN sale_price_cents IS NULL OR sale_price_cents <= 0 THEN 'USD' ELSE currency END,
          sale_price_cents = CASE WHEN sale_price_cents IS NULL OR sale_price_cents <= 0 THEN 129 ELSE sale_price_cents END,
          updated_at = NOW()
        WHERE id = ${matches[0].id} AND owner_member_id = ${membership.member_id} AND status = 'active'
        RETURNING id, title, sale_price_cents, currency, pipeline_updated_at
      `;
      if (!rows.length) return json({ message: "That saved track was not found in your catalog" }, 404);
      const song = rows[0];
      const publication = await reconcile(db, {
        songId: song.id, ownerMemberId: membership.member_id,
        actorId: membership.actor_id, actorType: "member",
        preserveReleaseMetadata: true,
      });
      if (!publication.ok) return json({ message: "Publication was not completed. Refresh the catalog and retry." }, 409);
      return json({
        success: true,
        message: `"${song.title}" published to Shop & Charts.`,
        songId: song.id,
        releaseId: publication.releaseId,
        track: {
          id: song.id, title: song.title,
          releaseStatus: "PUBLISHED", status: "PUBLISHED", inChart: true, isLiveVisible: true,
          salePriceCents: Number(song.sale_price_cents), currency: song.currency,
          pushedToLiveAt: new Date(song.pipeline_updated_at).toISOString(),
        },
      });
    } catch (error) {
      console.error("Shop and Charts publication failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "The live push could not be confirmed. Refresh the catalog and retry." }, 503);
    }
  };
}

export default createForcePushTrackHandler();
export const config = { path: "/api/catalog/force-push-track" };
