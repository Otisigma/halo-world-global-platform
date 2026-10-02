import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership, isOwner } from "../lib/halo-x.mjs";
import { cleanDreamweaverSongId } from "../../lib/dreamweaver-storefront.js";
import { reconcilePublishedSong } from "../lib/song-publication.mjs";

const MAX_BODY_BYTES = 80_000;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createForcePushTrackHandler({
  database = getDatabase,
  currentUser = getUser,
  verifyOrigin = verifyRequestOrigin,
  membershipFor = ensureMembership,
  reconcile = reconcilePublishedSong,
} = {}) {
  return async function forcePushTrackHandler(request) {
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
    try {
      const user = await currentUser();
      if (!user?.id) return json({ message: "Sign in to publish a track" }, 401);
      if (!isOwner(user)) return json({ message: "Admin access is required to force publication" }, 403);
      try { verifyOrigin(request); } catch { return json({ message: "Cross-origin catalog updates are not accepted" }, 403); }
      if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ message: "This catalog update is too large" }, 413);
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return json({ message: "This catalog update is too large" }, 413);
      let payload;
      try { payload = JSON.parse(body); } catch { return json({ message: "Send valid track JSON" }, 400); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ message: "Send a track object" }, 400);
      const id = cleanDreamweaverSongId(payload.id);
      const title = cleanText(payload.title, 160);
      if ((payload.id && !id) || (!id && !title)) return json({ message: "A valid track id or title is required" }, 400);

      const db = await database();
      const membership = await membershipFor(db, user);
      // Resolve only saved, owned tracks; the browser cannot replace catalog metadata.
      const matches = id
        ? await db.sql`SELECT id FROM halo_song_catalog WHERE id = ${id} AND owner_member_id = ${membership.member_id} AND status = 'active'`
        : await db.sql`SELECT id FROM halo_song_catalog WHERE LOWER(title) = LOWER(${title}) AND owner_member_id = ${membership.member_id} AND status = 'active' LIMIT 2`;
      if (!matches.length) return json({ message: "Save this track in your catalog before pushing it" }, 404);
      if (matches.length !== 1) return json({ message: "More than one track has this title; use its id" }, 409);
      const songId = matches[0].id;
      const rows = await db.sql`
        UPDATE halo_song_catalog SET
          pipeline_status = 'published', pipeline_updated_at = NOW(),
          sale_status = 'for_sale',
          sale_price_cents = CASE WHEN sale_price_cents IS NULL OR sale_price_cents <= 0 THEN 129 ELSE sale_price_cents END,
          updated_at = NOW()
        WHERE id = ${songId} AND owner_member_id = ${membership.member_id} AND status = 'active'
        RETURNING id, title, sale_price_cents, currency, pipeline_updated_at
      `;
      if (!rows.length) return json({ message: "That track is no longer available" }, 409);
      const result = await reconcile(db, {
        songId, ownerMemberId: membership.member_id,
        actorId: membership.actor_id, actorType: "member",
      });
      if (!result.ok) return json({ message: "Publication is not confirmed. Recheck the track and try again." }, 409);
      const song = rows[0];
      return json({
        success: true,
        message: `"${song.title}" is live on Shop & Charts`,
        track: {
          id: song.id, title: song.title, releaseId: result.releaseId,
          releaseStatus: "PUBLISHED", status: "PUBLISHED",
          inChart: true, isLiveVisible: true,
          price: `${song.currency === "USD" ? "US$" : `${song.currency} `}${(Number(song.sale_price_cents) / 100).toFixed(2)}`,
          pushedToLiveAt: new Date(song.pipeline_updated_at).toISOString(),
        },
      });
    } catch (error) {
      console.error("Force publication failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "Live publication could not be confirmed. Check publication health and retry; no local-only publication was made." }, 502);
    }
  };
}

export default createForcePushTrackHandler();
export const config = { path: "/api/catalog/force-push-track" };
