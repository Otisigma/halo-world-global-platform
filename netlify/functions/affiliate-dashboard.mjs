import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import { loadMemberRewards } from "../lib/track-drops.mjs";

export const AFFILIATE_TERMS = Object.freeze({
  revenueSharePercent: 10,
  activePaidMonthCap: 12,
  minimumPayoutMinor: 5000,
  currency: "USD",
  holdDays: 14,
  guidePoints: 5000,
  requestedGuideMultiplier: 1.5
});

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie", ...headers }
  });
}

export async function loadAffiliateInvitations(db, memberId) {
  const rows = await db.sql`
    SELECT
      (SELECT token FROM halo_share_invites
        WHERE created_by_member_id = ${memberId}
        ORDER BY created_at DESC, token LIMIT 1) AS token,
      (SELECT COUNT(DISTINCT event.member_id)::int
        FROM halo_share_invites invite
        JOIN halo_share_invite_events event ON event.invite_token = invite.token
        WHERE invite.created_by_member_id = ${memberId}
          AND event.event_type = 'joined'
          AND event.member_id <> ${memberId}) AS joined_members
  `;
  const row = rows[0];
  const count = Number(row?.joined_members);
  if (!row || row.joined_members == null || !Number.isSafeInteger(count) || count < 0
    || (row.token !== null && !/^[a-f0-9]{32}$/.test(row.token))) {
    throw new Error("Invalid invitation summary");
  }
  return {
    status: row.token ? "tracked_invite" : "no_invite",
    url: row.token ? `/halo-x.html?invite=${row.token}` : null,
    joinedMembers: count
  };
}

async function loadRewards(db, memberId) {
  const rows = await db.sql`
    SELECT rewards_enabled FROM halo_member_notification_preferences
    WHERE member_id = ${memberId}
  `;
  return loadMemberRewards(db, memberId, rows[0]?.rewards_enabled === true);
}

export function createAffiliateDashboardHandler({
  database = getDatabase,
  currentUser = getUser
} = {}) {
  return async function affiliateDashboardHandler(request) {
    if (request.method !== "GET") {
      return json({ message: "Method not allowed" }, 405, { Allow: "GET" });
    }
    try {
      const user = await currentUser();
      if (!user?.id) return json({ message: "Sign in to view your affiliate dashboard" }, 401);
      const db = await database();
      const [invitations, rewards] = await Promise.all([
        loadAffiliateInvitations(db, user.id).catch(() => ({ status: "unavailable", url: null, joinedMembers: null })),
        loadRewards(db, user.id).catch(() => null)
      ]);
      return json({
        terms: AFFILIATE_TERMS,
        invitations,
        rewards,
        // Share-invite joins and Creator Pass access are not paid-subscription attribution.
        affiliate: {
          status: "unavailable",
          referralUrl: null,
          activeReferrals: null,
          activePaidMonths: null,
          earnedMinor: null,
          heldMinor: null,
          availableMinor: null,
          paidMinor: null,
          payoutHistory: null,
          connect: "unavailable",
          tax: "unavailable",
          kyc: "unavailable",
          review: "unavailable"
        },
        guide: {
          status: "not_configured",
          awardedTier: null,
          appliedMultiplier: null,
          badge: null
        }
      });
    } catch {
      return json({ message: "Your affiliate dashboard is unavailable. Try again later." }, 503);
    }
  };
}

export default createAffiliateDashboardHandler();
export const config = { path: "/api/affiliate-dashboard" };
