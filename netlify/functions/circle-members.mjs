import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";

// Circle Members directory API.
// GET  /api/circles/members           -> { members: [{ email, circle_name, role, status, self }] }
// POST /api/circles/members { action: "invite", email, circle_name, role }
//   Records a pending invitation in the signed-in member's own circle. Each member
//   only ever reads and writes their own circle rows (owner_member_id scoping).
const MAX_BODY_BYTES = 4_000;
const MAX_MEMBERS = 250;
const INVITES_PER_HOUR = 20;
const CIRCLES = new Set(["artist_core", "creative_team", "extended_world"]);
const ROLES = new Set(["admin", "collaborator", "viewer"]);
const EMAIL_PATTERN = /^[^\s@<>"']{1,64}@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

function json(payload, status = 200, headers = {}) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store", ...headers }
  });
}

function cleanEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase().slice(0, 320) : "";
  return EMAIL_PATTERN.test(email) ? email : "";
}

function memberPayload(row) {
  return {
    email: row.email,
    circle_name: row.circle_name,
    role: row.role,
    status: row.status,
    self: false
  };
}

async function loadMembers(db, memberId, ownEmail) {
  const rows = await db.sql`
    SELECT email, circle_name, role, status
    FROM halo_circle_members
    WHERE owner_member_id = ${memberId}
    ORDER BY circle_name, invited_at
    LIMIT ${MAX_MEMBERS}
  `;
  const members = rows.map(memberPayload).filter(member => member.email !== ownEmail);
  if (ownEmail) members.unshift({ email: ownEmail, circle_name: "artist_core", role: "admin", status: "active", self: true });
  return members;
}

async function inviteMember(db, memberId, ownEmail, body) {
  const email = cleanEmail(body.email);
  const circleName = typeof body.circle_name === "string" ? body.circle_name : "";
  const role = typeof body.role === "string" && body.role ? body.role : "collaborator";
  if (!email) return { error: ["Enter a valid email address", 400] };
  if (!CIRCLES.has(circleName)) return { error: ["Choose Artist Core, Creative Team, or Extended World", 400] };
  if (!ROLES.has(role)) return { error: ["Choose a supported access role", 400] };
  if (email === ownEmail) return { error: ["You already hold the Artist Core seat", 400] };

  const [rateRows, countRows] = await Promise.all([
    db.sql`
      SELECT COUNT(*)::int AS total FROM halo_circle_members
      WHERE owner_member_id = ${memberId} AND updated_at >= NOW() - INTERVAL '1 hour'
    `,
    db.sql`SELECT COUNT(*)::int AS total FROM halo_circle_members WHERE owner_member_id = ${memberId}`
  ]);
  if (Number(rateRows[0]?.total || 0) >= INVITES_PER_HOUR) return { error: ["Invite limit reached. Try again later.", 429] };
  if (Number(countRows[0]?.total || 0) >= MAX_MEMBERS) return { error: ["Your circle is full", 409] };

  await db.sql`
    INSERT INTO halo_circle_members (owner_member_id, email, circle_name, role)
    VALUES (${memberId}, ${email}, ${circleName}, ${role})
    ON CONFLICT (owner_member_id, email) DO UPDATE SET
      circle_name = EXCLUDED.circle_name,
      role = EXCLUDED.role,
      updated_at = NOW()
  `;
  return { invited: { email, circle_name: circleName, role } };
}

export default async function circleMembersHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Sign in to manage your circles" }, 401);
    const membership = await ensureMembership(db, user);
    const memberId = membership.member_id;
    const ownEmail = cleanEmail(user.email);

    if (request.method === "GET") return json({ members: await loadMembers(db, memberId, ownEmail) });

    if (!(await verifyRequestOrigin(request))) return json({ message: "Cross-origin circle actions are not accepted" }, 403);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ message: "Circle request is too large" }, 413);
    const body = await request.json().catch(() => null);
    if (!body) return json({ message: "Request body must be valid JSON" }, 400);
    if (body.action !== "invite") return json({ message: "Choose a supported circle action" }, 400);

    const result = await inviteMember(db, memberId, ownEmail, body);
    if (result.error) return json({ message: result.error[0] }, result.error[1]);
    return json({ ...result, members: await loadMembers(db, memberId, ownEmail) });
  } catch (error) {
    console.error("Circle members request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Circle directory is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/circles/members" };
