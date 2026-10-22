import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import {
  MEMBER_REWARDS,
  grantMemberReward,
  loadMemberRewards,
  safeTrackDropId,
  trackDropCard
} from "../lib/track-drops.mjs";

const MAX_BODY_BYTES = 4_000;
const INBOX_LIMIT = 20;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function preferencesPayload(row) {
  return {
    trackDropsInApp: Boolean(row?.track_drops_in_app),
    trackDropsEmail: Boolean(row?.track_drops_email),
    rewardsEnabled: Boolean(row?.rewards_enabled),
    emailConsentGiven: Boolean(row?.email_consent_at)
  };
}

async function loadPreferenceRow(db, memberId) {
  const rows = await db.sql`
    SELECT track_drops_in_app, track_drops_email, rewards_enabled, email_consent_at, enabled_at, last_seen_at
    FROM halo_member_notification_preferences
    WHERE member_id = ${memberId}
  `;
  return rows[0] || null;
}

export async function loadTrackDropState(db, memberId) {
  const preference = await loadPreferenceRow(db, memberId);
  const preferences = preferencesPayload(preference);
  const rewards = await loadMemberRewards(db, memberId, preferences.rewardsEnabled);
  if (!preference?.track_drops_in_app) return { preferences, unreadCount: 0, notifications: [], rewards };
  const rows = await db.sql`
    SELECT id, release_id, title, artist, artwork_url, created_at,
      (created_at > ${preference.last_seen_at}) AS unread
    FROM halo_track_drop_events
    WHERE created_at >= ${preference.enabled_at}
      AND owner_member_id IS DISTINCT FROM ${memberId}
    ORDER BY created_at DESC
    LIMIT ${INBOX_LIMIT}
  `;
  const notifications = rows.map(row => trackDropCard(row, { unread: row.unread }));
  return { preferences, unreadCount: notifications.filter(item => item.unread).length, notifications, rewards };
}

async function updatePreferences(db, memberId, payload) {
  for (const field of ["trackDropsInApp", "trackDropsEmail", "rewardsEnabled"]) {
    if (typeof payload[field] !== "boolean") return json({ message: "Choose on or off for each alert setting" }, 400);
  }
  if (payload.trackDropsEmail && payload.emailConsent !== true) {
    return json({ message: "Confirm you want track drop emails to turn them on" }, 400);
  }
  const { trackDropsInApp, trackDropsEmail, rewardsEnabled } = payload;
  await db.sql`
    INSERT INTO halo_member_notification_preferences (
      member_id, track_drops_in_app, track_drops_email, rewards_enabled, email_consent_at, enabled_at, last_seen_at, updated_at
    ) VALUES (
      ${memberId}, ${trackDropsInApp}, ${trackDropsEmail}, ${rewardsEnabled},
      CASE WHEN ${trackDropsEmail} THEN NOW() ELSE NULL END, NOW(), NOW(), NOW()
    )
    ON CONFLICT (member_id) DO UPDATE SET
      enabled_at = CASE
        WHEN EXCLUDED.track_drops_in_app AND NOT halo_member_notification_preferences.track_drops_in_app THEN NOW()
        ELSE halo_member_notification_preferences.enabled_at
      END,
      last_seen_at = CASE
        WHEN EXCLUDED.track_drops_in_app AND NOT halo_member_notification_preferences.track_drops_in_app THEN NOW()
        ELSE halo_member_notification_preferences.last_seen_at
      END,
      email_consent_at = CASE
        WHEN NOT EXCLUDED.track_drops_email THEN NULL
        ELSE COALESCE(halo_member_notification_preferences.email_consent_at, NOW())
      END,
      track_drops_in_app = EXCLUDED.track_drops_in_app,
      track_drops_email = EXCLUDED.track_drops_email,
      rewards_enabled = EXCLUDED.rewards_enabled,
      updated_at = NOW()
  `;
  if (!trackDropsEmail) {
    // Turning email off also withdraws any card that has not been sent yet.
    await db.sql`
      UPDATE halo_track_drop_deliveries
      SET status = 'skipped', last_error = 'opted_out'
      WHERE member_id = ${memberId} AND status IN ('queued', 'sending')
    `;
  }
  let rewardGranted = false;
  if (rewardsEnabled && (trackDropsInApp || trackDropsEmail)) {
    rewardGranted = await grantMemberReward(db, memberId, MEMBER_REWARDS.optIn);
  }
  const state = await loadTrackDropState(db, memberId);
  return json({
    ...state,
    rewardGranted,
    message: rewardGranted
      ? `Track drop alerts saved. You've unlocked a new member reward: +${MEMBER_REWARDS.optIn.points} points.`
      : "Track drop alerts saved."
  });
}

async function openDrop(db, memberId, payload) {
  const dropId = safeTrackDropId(payload.dropId);
  if (!dropId) return json({ message: "Choose a valid track drop" }, 400);
  const preference = await loadPreferenceRow(db, memberId);
  if (!preference?.track_drops_in_app && !preference?.track_drops_email) {
    return json({ message: "Turn on track drop alerts first" }, 409);
  }
  // Rewards only cover drops announced after the member opted in.
  const optedInAt = new Date(Math.min(...[
    preference.track_drops_in_app ? preference.enabled_at : null,
    preference.track_drops_email ? preference.email_consent_at : null
  ].filter(Boolean).map(value => new Date(value).getTime())));
  if (Number.isNaN(optedInAt.getTime())) return json({ message: "Turn on track drop alerts first" }, 409);
  const rows = await db.sql`
    SELECT id, release_id, title, artist, artwork_url, created_at
    FROM halo_track_drop_events
    WHERE id = ${dropId}
      AND owner_member_id IS DISTINCT FROM ${memberId}
      AND created_at >= ${optedInAt.toISOString()}::timestamptz
    LIMIT 1
  `;
  if (!rows[0]) return json({ message: "That track drop is no longer available" }, 404);
  const card = trackDropCard(rows[0]);
  let rewardGranted = false;
  if (preference.rewards_enabled) {
    rewardGranted = await grantMemberReward(db, memberId, {
      key: `${MEMBER_REWARDS.openDrop.keyPrefix}${card.id}`,
      points: MEMBER_REWARDS.openDrop.points,
      reason: MEMBER_REWARDS.openDrop.reason
    });
  }
  const rewards = await loadMemberRewards(db, memberId, Boolean(preference.rewards_enabled));
  return json({
    ctaUrl: card.ctaUrl,
    rewardGranted,
    rewards,
    message: rewardGranted ? `+${MEMBER_REWARDS.openDrop.points} points. ${rewards.message}` : ""
  });
}

export function createTrackDropsHandler({
  database = getDatabase,
  currentUser = getUser,
  verifyOrigin = verifyRequestOrigin,
  membershipFor = ensureMembership
} = {}) {
  return async function trackDropsHandler(request) {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
    try {
      const user = await currentUser();
      if (!user?.id) return json({ message: "Sign in to manage track drop alerts" }, 401);
      const db = await database();
      const membership = await membershipFor(db, user);
      const memberId = membership.member_id;

      if (request.method === "GET") return json(await loadTrackDropState(db, memberId));

      try {
        if ((await verifyOrigin(request)) === false) throw new Error("Invalid origin");
      } catch {
        return json({ message: "Cross-origin alert updates are not accepted" }, 403);
      }
      if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        return json({ message: "Send alert settings as JSON" }, 415);
      }
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json({ message: "That request is too large" }, 413);
      let payload;
      try { payload = JSON.parse(text); } catch { return json({ message: "Request body must be valid JSON" }, 400); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ message: "Choose a supported alert action" }, 400);

      if (payload.action === "update-preferences") return updatePreferences(db, memberId, payload);
      if (payload.action === "mark-seen") {
        await db.sql`
          UPDATE halo_member_notification_preferences
          SET last_seen_at = NOW(), updated_at = NOW()
          WHERE member_id = ${memberId}
        `;
        return json({ ...(await loadTrackDropState(db, memberId)), unreadCount: 0 });
      }
      if (payload.action === "open-drop") return openDrop(db, memberId, payload);
      return json({ message: "Choose a supported alert action" }, 400);
    } catch (error) {
      console.error("HALO track drop alerts failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "Track drop alerts are unavailable right now" }, 503);
    }
  };
}

export default createTrackDropsHandler();
export const config = { path: "/api/track-drops" };
