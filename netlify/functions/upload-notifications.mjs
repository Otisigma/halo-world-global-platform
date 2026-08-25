import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function notificationPayload(row) {
  return {
    id: row.id,
    title: row.title,
    creatorName: row.display_name,
    createdAt: new Date(row.created_at).toISOString(),
    unread: Boolean(row.unread),
    roomUrl: `/?room=mixes&mix=${encodeURIComponent(row.id)}#clubhouse`
  };
}

async function loadNotifications(db, membership) {
  const preferenceRows = await db.sql`
    SELECT enabled, enabled_at, last_seen_at
    FROM halo_upload_notification_preferences
    WHERE member_id = ${membership.member_id}
  `;
  const preference = preferenceRows[0];
  if (!preference) return { enabled: false, unreadCount: 0, notifications: [] };

  const rows = await db.sql`
    SELECT m.id, m.title, m.created_at, p.display_name,
      (m.created_at > ${preference.last_seen_at}) AS unread
    FROM halo_mixes m
    JOIN community_profiles p ON p.actor_id = m.actor_id
    WHERE m.visibility = 'room'
      AND m.member_id <> ${membership.member_id}
      AND m.created_at >= ${preference.enabled_at}
    ORDER BY m.created_at DESC
    LIMIT 20
  `;
  const notifications = rows.map(notificationPayload);
  return {
    enabled: Boolean(preference.enabled),
    unreadCount: preference.enabled ? notifications.filter(item => item.unread).length : 0,
    notifications: preference.enabled ? notifications : []
  };
}

async function updatePreference(request, db, membership) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }

  if (payload.action === "enable") {
    await db.sql`
      INSERT INTO halo_upload_notification_preferences (member_id, enabled, enabled_at, last_seen_at, updated_at)
      VALUES (${membership.member_id}, TRUE, NOW(), NOW(), NOW())
      ON CONFLICT (member_id) DO UPDATE SET
        enabled = TRUE,
        enabled_at = CASE WHEN halo_upload_notification_preferences.enabled THEN halo_upload_notification_preferences.enabled_at ELSE NOW() END,
        last_seen_at = CASE WHEN halo_upload_notification_preferences.enabled THEN halo_upload_notification_preferences.last_seen_at ELSE NOW() END,
        updated_at = NOW()
    `;
    return json({ ...(await loadNotifications(db, membership)), message: "New upload alerts are on" });
  }

  if (payload.action === "disable") {
    await db.sql`
      INSERT INTO halo_upload_notification_preferences (member_id, enabled, enabled_at, last_seen_at, updated_at)
      VALUES (${membership.member_id}, FALSE, NOW(), NOW(), NOW())
      ON CONFLICT (member_id) DO UPDATE SET enabled = FALSE, updated_at = NOW()
    `;
    return json({ enabled: false, unreadCount: 0, notifications: [], message: "New upload alerts are off" });
  }

  if (payload.action === "mark-seen") {
    await db.sql`
      UPDATE halo_upload_notification_preferences
      SET last_seen_at = NOW(), updated_at = NOW()
      WHERE member_id = ${membership.member_id}
    `;
    return json({ ...(await loadNotifications(db, membership)), unreadCount: 0 });
  }

  return json({ message: "Choose a supported notification action" }, 400);
}

export default async function uploadNotificationsHandler(request) {
  try {
    const user = await getUser();
    if (!user?.id) return json({ message: "Sign in to manage upload alerts" }, 401);
    const db = getDatabase();
    const membership = await ensureMembership(db, user);

    if (request.method === "GET") return json(await loadNotifications(db, membership));
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);

    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin notification updates are not accepted" }, 403);
    }
    return updatePreference(request, db, membership);
  } catch (error) {
    console.error("HALO upload notifications failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Upload alerts are unavailable right now" }, 500);
  }
}

export const config = {
  path: "/api/upload-notifications"
};
