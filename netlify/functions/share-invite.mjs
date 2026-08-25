import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const tokenPattern = /^[a-f0-9]{32}$/;
const sessionPattern = /^[a-zA-Z0-9-]{8,80}$/;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function inviteUrl(request, token) {
  const url = new URL(request.url);
  return `${url.origin}/halo-x.html?invite=${token}`;
}

async function requireMember(db) {
  const user = await getUser();
  if (!user?.id) return null;
  return ensureMembership(db, user);
}

export default async function shareInviteHandler(request) {
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin activity is not accepted" }, 403);
  }

  try {
    const payload = await request.json().catch(() => null);
    if (!payload) return json({ message: "Request body must be valid JSON" }, 400);
    const action = cleanText(payload.action, 16).toLowerCase();
    const db = getDatabase();

    if (action === "create") {
      const membership = await requireMember(db);
      if (!membership) return json({ message: "Sign in required" }, 401);
      const token = crypto.randomUUID().replaceAll("-", "");
      await db.sql`
        INSERT INTO halo_share_invites (token, created_by_member_id)
        VALUES (${token}, ${membership.member_id})
      `;
      await db.sql`
        INSERT INTO halo_share_invite_events (invite_token, event_type, member_id)
        VALUES (${token}, 'created', ${membership.member_id})
      `;
      return json({ token, url: inviteUrl(request, token) }, 201);
    }

    const token = cleanText(payload.token, 32).toLowerCase();
    if (!tokenPattern.test(token)) return json({ message: "Invite token is not valid" }, 400);
    const inviteRows = await db.sql`SELECT token FROM halo_share_invites WHERE token = ${token} LIMIT 1`;
    if (!inviteRows.length) return json({ message: "Invite not found" }, 404);

    if (action === "opened") {
      const eventKey = cleanText(payload.eventKey, 80);
      if (!sessionPattern.test(eventKey)) return json({ message: "Invite visit is not valid" }, 400);
      await db.sql`
        INSERT INTO halo_share_invite_events (invite_token, event_type, event_key)
        VALUES (${token}, 'opened', ${eventKey})
        ON CONFLICT (invite_token, event_type, event_key) WHERE event_key IS NOT NULL DO NOTHING
      `;
      return json({ recorded: true });
    }

    const membership = await requireMember(db);
    if (!membership) return json({ message: "Sign in required" }, 401);

    if (action === "shared") {
      await db.sql`
        INSERT INTO halo_share_invite_events (invite_token, event_type, member_id)
        VALUES (${token}, 'shared', ${membership.member_id})
      `;
      return json({ recorded: true });
    }

    if (action === "claim") {
      const inviteCreator = await db.sql`SELECT created_by_member_id FROM halo_share_invites WHERE token = ${token} LIMIT 1`;
      if (inviteCreator[0]?.created_by_member_id === membership.member_id) return json({ recorded: false, reason: "creator" });
      await db.sql`
        INSERT INTO halo_share_invite_events (invite_token, event_type, member_id)
        VALUES (${token}, 'joined', ${membership.member_id})
        ON CONFLICT (invite_token, member_id) WHERE event_type = 'joined' AND member_id IS NOT NULL DO NOTHING
      `;
      return json({ recorded: true });
    }

    return json({ message: "Invite action is not supported" }, 400);
  } catch (error) {
    console.error("HALO share invite failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The tracked invite could not be completed" }, 500);
  }
}

export const config = {
  path: "/api/share-invite"
};
