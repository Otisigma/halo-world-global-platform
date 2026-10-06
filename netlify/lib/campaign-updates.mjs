import {
  CampaignError, campaignId, campaignJson, campaignErrorResponse, readCampaignBody, verifyCampaignOrigin
} from "./master-campaigns.mjs";

export const UPDATE_PURPOSES = ["release_notes", "halo_updates"];
export function createCampaignUpdatesHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin }) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return campaignJson({ message: "Method not allowed" }, 405);
    try {
      if (request.method === "POST") await verifyCampaignOrigin(request, verifyRequestOrigin);
      const user = await getUser();
      if (!user?.id) throw new CampaignError("Sign in with your Creator Pass", 401);
      const db = await getDatabase();
      const membership = await ensureMembership(db, user);
      const memberId = membership.member_id;
      if (request.method === "POST") {
        const body = await readCampaignBody(request);
        await db.sql`SELECT halo_campaign_api_rate(${memberId},'preferences')`;
        if (["subscribe", "unsubscribe"].includes(body.action)) {
          if (!UPDATE_PURPOSES.includes(body.purpose)) throw new CampaignError("Choose release_notes or halo_updates");
          await db.sql`SELECT halo_campaign_preference(${memberId},${body.purpose},${body.action === "subscribe"})`;
          return campaignJson({ ok: true, purpose: body.purpose, subscribed: body.action === "subscribe" });
        }
        if (body.action !== "read") throw new CampaignError("Unknown update action");
        const id = campaignId(body.id);
        const rows = await db.sql`UPDATE halo_campaign_inbox SET read_at = COALESCE(read_at,NOW())
          WHERE id = ${id} AND member_id = ${memberId} RETURNING id`;
        if (!rows.length) throw new CampaignError("Inbox item not found", 404);
        return campaignJson({ ok: true, id });
      }
      const preferences = await db.sql`SELECT purpose,subscribed FROM halo_campaign_preferences WHERE member_id = ${memberId}`;
      const rows = await db.sql`SELECT i.id,i.purpose,i.output,i.read_at,i.created_at FROM halo_campaign_inbox i
        WHERE i.member_id = ${memberId}
          AND NOT EXISTS(SELECT 1 FROM halo_signal_blocks b WHERE
            (b.member_id = ${memberId} AND b.target_member_id = i.sender_member_id)
            OR (b.target_member_id = ${memberId} AND b.member_id = i.sender_member_id))
        ORDER BY i.created_at DESC,i.id LIMIT 101`;
      return campaignJson({
        preferences: UPDATE_PURPOSES.map(purpose => ({ purpose, subscribed: preferences.find(p => p.purpose === purpose)?.subscribed === true })),
        inbox: rows.slice(0, 100).map(row => ({
          id: row.id, purpose: row.purpose, output: row.output, readAt: row.read_at, createdAt: row.created_at
        })), hasMore: rows.length > 100
      });
    } catch (error) { return campaignErrorResponse(error); }
  };
}
