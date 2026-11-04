import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import { notifyOwnerSafely } from "../lib/owner-alerts.mjs";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createRelationshipEventHandler({
  database = getDatabase,
  currentUser = getUser,
  verifyOrigin = verifyRequestOrigin,
  membershipFor = ensureMembership,
  notify = notifyOwnerSafely
} = {}) {
  return async function relationshipEventHandler(request) {
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
    try {
      verifyOrigin(request);
    } catch {
      return json({ message: "Cross-origin activity is not accepted" }, 403);
    }

    try {
      const user = await currentUser();
      if (!user?.id) return json({ message: "Sign in required" }, 401);
      const db = await database();
      const membership = await membershipFor(db, user);
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ message: "Request body must be valid JSON" }, 400);
      }

      const eventType = cleanText(payload.eventType, 24).toLowerCase();
      const sessionKey = cleanText(payload.sessionKey, 80);
      if (!new Set(["signup", "login", "session", "recovery"]).has(eventType) || !/^[a-zA-Z0-9-]{8,80}$/.test(sessionKey)) {
        return json({ message: "Activity event is not valid" }, 400);
      }

      await db.sql`
        INSERT INTO halo_relationship_profiles (member_id)
        VALUES (${user.id})
        ON CONFLICT (member_id) DO NOTHING
      `;
      const inserted = await db.sql`
        INSERT INTO halo_relationship_auth_events (member_id, event_type, session_key)
        VALUES (${user.id}, ${eventType}, ${sessionKey})
        ON CONFLICT (member_id, event_type, session_key) DO NOTHING
        RETURNING member_id
      `;
      if (eventType === "signup" && inserted.length) {
        const signups = await db.sql`
          SELECT COUNT(*)::int AS count FROM halo_relationship_auth_events
          WHERE member_id = ${user.id} AND event_type = 'signup'
        `;
        if (Number(signups[0]?.count) === 1) {
          await notify({ title: "New HALO member signup", lines: [`Member: ${membership.display_name || "HALO member"}`] });
        }
      }
      return json({ recorded: true });
    } catch (error) {
      console.error("HALO relationship event failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "Activity could not be recorded" }, 500);
    }
  };
}

export default createRelationshipEventHandler();

export const config = {
  path: "/api/relationship-event"
};
