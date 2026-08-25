import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export default async function haloSessionHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Sign in to save this set to your HALO account" }, 401);
    await ensureMembership(db, user);

    if (request.method === "GET") {
      const rows = await db.sql`
        SELECT session_name, snapshot, revision, updated_at
        FROM halo_dj_sessions
        WHERE member_id = ${user.id}
        LIMIT 1
      `;
      const row = rows[0];
      return json({ session: row ? {
        name: row.session_name,
        snapshot: row.snapshot || {},
        revision: Number(row.revision),
        updatedAt: new Date(row.updated_at).toISOString()
      } : null });
    }

    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin session saves are not accepted" }, 403);
    }
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ message: "Request body must be valid JSON" }, 400);
    }
    if (!payload.snapshot || typeof payload.snapshot !== "object" || Array.isArray(payload.snapshot)) {
      return json({ message: "The session snapshot is not valid" }, 400);
    }
    const serialized = JSON.stringify(payload.snapshot);
    if (serialized.length > 120000) return json({ message: "The session snapshot is too large" }, 413);
    const sessionName = cleanText(payload.name, 80) || "My HALO set";
    const rows = await db.sql`
      INSERT INTO halo_dj_sessions (member_id, session_name, snapshot)
      VALUES (${user.id}, ${sessionName}, ${serialized}::jsonb)
      ON CONFLICT (member_id) DO UPDATE SET
        session_name = EXCLUDED.session_name,
        snapshot = EXCLUDED.snapshot,
        revision = halo_dj_sessions.revision + 1,
        updated_at = NOW()
      RETURNING revision, updated_at
    `;
    return json({
      message: "Session saved to HALO",
      revision: Number(rows[0].revision),
      updatedAt: new Date(rows[0].updated_at).toISOString()
    });
  } catch (error) {
    console.error("HALO session request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "This session could not be saved right now" }, 500);
  }
}

export const config = {
  path: "/api/halo-session"
};
