import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";

const CHARTER_VERSION = "2026-08";
const roles = new Set(["artist", "producer", "dj", "writer", "fan", "industry", "creator"]);
const categories = new Set(["question", "experience", "proposal", "challenge"]);
const positions = new Set(["support", "needs_work", "concern"]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function cleanCharterText(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

export function cleanPrinciple(value) {
  const principle = Number(value);
  return Number.isSafeInteger(principle) && principle >= 1 && principle <= 7 ? principle : null;
}

function mapAcknowledgment(row) {
  if (!row) return null;
  return {
    version: row.charter_version,
    role: row.creator_role,
    toolFreedom: row.accepts_tool_freedom,
    rightsResponsibility: row.accepts_rights_responsibility,
    fairReview: row.accepts_fair_review,
    affirmedAt: new Date(row.affirmed_at).toISOString()
  };
}

async function readRoom(db, memberId = null) {
  const [summaryRows, voteRows, responseRows, acknowledgmentRows, viewerVoteRows] = await Promise.all([
    db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM halo_creator_charter_acknowledgments WHERE charter_version = ${CHARTER_VERSION}) AS affirmations,
        (SELECT COUNT(*)::int FROM halo_creator_charter_responses WHERE status = 'published') AS responses,
        (SELECT COUNT(*)::int FROM halo_creator_charter_votes) AS votes
    `,
    db.sql`
      SELECT principle, position, COUNT(*)::int AS total
      FROM halo_creator_charter_votes
      GROUP BY principle, position
      ORDER BY principle, position
    `,
    db.sql`
      SELECT response.id, response.category, response.body, response.created_at, membership.display_name
      FROM halo_creator_charter_responses response
      JOIN halo_memberships membership ON membership.member_id = response.member_id
      WHERE response.status = 'published'
      ORDER BY response.created_at DESC
      LIMIT 24
    `,
    memberId
      ? db.sql`SELECT * FROM halo_creator_charter_acknowledgments WHERE member_id = ${memberId}`
      : Promise.resolve([]),
    memberId
      ? db.sql`SELECT principle, position FROM halo_creator_charter_votes WHERE member_id = ${memberId}`
      : Promise.resolve([])
  ]);

  const votes = Array.from({ length: 7 }, (_, index) => ({
    principle: index + 1,
    support: 0,
    needsWork: 0,
    concern: 0
  }));
  for (const row of voteRows) {
    const vote = votes[Number(row.principle) - 1];
    if (!vote) continue;
    if (row.position === "support") vote.support = Number(row.total);
    if (row.position === "needs_work") vote.needsWork = Number(row.total);
    if (row.position === "concern") vote.concern = Number(row.total);
  }

  return {
    version: CHARTER_VERSION,
    summary: {
      affirmations: Number(summaryRows[0]?.affirmations || 0),
      responses: Number(summaryRows[0]?.responses || 0),
      votes: Number(summaryRows[0]?.votes || 0)
    },
    votes,
    responses: responseRows.map(row => ({
      id: Number(row.id),
      category: row.category,
      body: row.body,
      displayName: row.display_name,
      createdAt: new Date(row.created_at).toISOString()
    })),
    viewer: memberId ? {
      acknowledgment: mapAcknowledgment(acknowledgmentRows[0]),
      votes: Object.fromEntries(viewerVoteRows.map(row => [String(row.principle), row.position]))
    } : null
  };
}

async function handleAction(db, membership, payload) {
  const action = cleanCharterText(payload.action, 32);

  if (action === "affirm") {
    const role = cleanCharterText(payload.role, 24);
    const toolFreedom = payload.toolFreedom === true;
    const rightsResponsibility = payload.rightsResponsibility === true;
    const fairReview = payload.fairReview === true;
    if (!roles.has(role)) return json({ message: "Choose your role in the creative community." }, 400);
    if (!toolFreedom || !rightsResponsibility || !fairReview) {
      return json({ message: "Confirm all three charter commitments before affirming." }, 400);
    }
    await db.sql`
      INSERT INTO halo_creator_charter_acknowledgments (
        member_id, charter_version, creator_role, accepts_tool_freedom,
        accepts_rights_responsibility, accepts_fair_review
      ) VALUES (${membership.member_id}, ${CHARTER_VERSION}, ${role}, TRUE, TRUE, TRUE)
      ON CONFLICT (member_id) DO UPDATE SET
        charter_version = EXCLUDED.charter_version,
        creator_role = EXCLUDED.creator_role,
        accepts_tool_freedom = TRUE,
        accepts_rights_responsibility = TRUE,
        accepts_fair_review = TRUE,
        affirmed_at = NOW(),
        updated_at = NOW()
    `;
  } else if (action === "respond") {
    const category = cleanCharterText(payload.category, 24);
    const body = cleanCharterText(payload.body, 1000);
    if (!categories.has(category)) return json({ message: "Choose a response type." }, 400);
    if (body.length < 12) return json({ message: "Add a little more detail before publishing." }, 400);
    const recentRows = await db.sql`
      SELECT COUNT(*)::int AS total
      FROM halo_creator_charter_responses
      WHERE member_id = ${membership.member_id} AND created_at >= NOW() - INTERVAL '2 minutes'
    `;
    if (Number(recentRows[0]?.total || 0) >= 2) return json({ message: "Take a moment before adding another response." }, 429);
    await db.sql`
      INSERT INTO halo_creator_charter_responses (member_id, category, body)
      VALUES (${membership.member_id}, ${category}, ${body})
    `;
  } else if (action === "vote") {
    const principle = cleanPrinciple(payload.principle);
    const position = cleanCharterText(payload.position, 24);
    if (!principle || !positions.has(position)) return json({ message: "Choose a valid charter position." }, 400);
    await db.sql`
      INSERT INTO halo_creator_charter_votes (member_id, principle, position)
      VALUES (${membership.member_id}, ${principle}, ${position})
      ON CONFLICT (member_id, principle) DO UPDATE SET position = EXCLUDED.position, updated_at = NOW()
    `;
  } else {
    return json({ message: "Unknown charter action." }, 400);
  }

  return json(await readRoom(db, membership.member_id));
}

export default async function handler(request) {
  try {
    const db = getDatabase();
    const user = await getUser();
    const membership = user?.id ? await ensureMembership(db, user) : null;

    if (request.method === "GET") return json(await readRoom(db, membership?.member_id || null));
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
    if (!membership) return json({ message: "Join or sign in to participate in the Charter Room." }, 401);

    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin charter actions are not accepted." }, 403);
    }

    const payload = await request.json().catch(() => ({}));
    return handleAction(db, membership, payload);
  } catch (error) {
    console.error("Creator Charter request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The Charter Room is temporarily unavailable." }, 500);
  }
}

export const config = { path: "/api/creator-charter" };
