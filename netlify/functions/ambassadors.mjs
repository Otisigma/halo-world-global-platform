import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { createHash } from "node:crypto";
import { ensureMembership as ensureHaloMembership } from "../lib/halo-x.mjs";

const councilRoles = new Set(["admin", "owner", "moderator", "ambassador-council"]);
const focusAreas = new Set(["creator-support", "community-care", "events", "technology", "education", "global-outreach"]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanActorId(value) {
  const actorId = cleanText(value, 64);
  return /^[a-zA-Z0-9_-]{8,64}$/.test(actorId) ? actorId : "";
}

function cleanRecordId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function identityActorId(userId) {
  return `member-${createHash("sha256").update(String(userId)).digest("hex").slice(0, 32)}`;
}

function identityDisplayName(user, actorId) {
  const preferred = cleanText(user?.name || user?.userMetadata?.full_name, 32);
  return preferred.length >= 2 ? preferred : `Fan ${actorId.slice(-4).toUpperCase()}`;
}

function isCouncilMember(user) {
  const roles = Array.isArray(user?.roles)
    ? user.roles
    : Array.isArray(user?.appMetadata?.roles)
      ? user.appMetadata.roles
      : [];
  return roles.some(role => councilRoles.has(String(role).toLowerCase()));
}

async function ensureProfile(db, actorId, displayName) {
  await db.sql`
    INSERT INTO community_profiles (actor_id, display_name)
    VALUES (${actorId}, ${displayName})
    ON CONFLICT (actor_id) DO UPDATE SET last_seen_at = NOW()
  `;
}

async function getState(db, user = null) {
  const actorId = user?.id ? identityActorId(user.id) : null;
  const council = isCouncilMember(user);

  const [ambassadorRows, statsRows] = await Promise.all([
    db.sql`
      SELECT p.actor_id AS "actorId", p.display_name AS "displayName", p.avatar, p.region,
        p.vibe_status AS "vibeStatus", g.granted_at AS "grantedAt"
      FROM sovereign_ambassador_grants g
      JOIN community_profiles p ON p.actor_id = g.actor_id
      WHERE g.is_active = TRUE
      ORDER BY g.granted_at ASC, p.display_name ASC
    `,
    db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM sovereign_ambassador_grants WHERE is_active = TRUE) AS ambassadors,
        (SELECT COUNT(*)::int FROM sovereign_ambassador_applications WHERE status IN ('submitted', 'under_review')) AS pending,
        (SELECT COUNT(*)::int FROM sovereign_ambassador_nominations WHERE status = 'submitted') AS nominations
    `
  ]);

  const state = {
    authenticated: Boolean(actorId),
    council,
    ambassadors: ambassadorRows,
    stats: statsRows[0] || { ambassadors: 0, pending: 0, nominations: 0 },
    application: null,
    nominations: [],
    eligiblePeople: [],
    reviewQueue: []
  };

  if (!actorId) return state;

  const [applicationRows, nominationRows, peopleRows, grantRows] = await Promise.all([
    db.sql`
      SELECT id, statement, contributions, focus_area AS "focusArea", availability, status,
        review_notes AS "reviewNotes", submitted_at AS "submittedAt", reviewed_at AS "reviewedAt", updated_at AS "updatedAt"
      FROM sovereign_ambassador_applications
      WHERE actor_id = ${actorId}
    `,
    db.sql`
      SELECT n.id, n.reason, n.status, n.created_at AS "createdAt",
        p.display_name AS "nominatorName", p.avatar AS "nominatorAvatar"
      FROM sovereign_ambassador_nominations n
      JOIN community_profiles p ON p.actor_id = n.nominator_actor_id
      WHERE n.nominee_actor_id = ${actorId} AND n.status = 'submitted'
      ORDER BY n.created_at DESC
    `,
    db.sql`
      SELECT p.actor_id AS "actorId", p.display_name AS "displayName", p.avatar, p.region
      FROM community_profiles p
      WHERE p.actor_id <> ${actorId}
        AND NOT EXISTS (
          SELECT 1 FROM sovereign_ambassador_grants g
          WHERE g.actor_id = p.actor_id AND g.is_active = TRUE
        )
      ORDER BY p.last_seen_at DESC, p.display_name ASC
      LIMIT 30
    `,
    db.sql`
      SELECT granted_at AS "grantedAt" FROM sovereign_ambassador_grants
      WHERE actor_id = ${actorId} AND is_active = TRUE
    `
  ]);

  state.application = applicationRows[0] || null;
  state.nominations = nominationRows;
  state.eligiblePeople = peopleRows;
  state.isAmbassador = Boolean(grantRows.length);
  state.grantedAt = grantRows[0]?.grantedAt || null;

  if (council) {
    state.reviewQueue = await db.sql`
      SELECT a.id, a.actor_id AS "actorId", p.display_name AS "displayName", p.avatar, p.region,
        a.statement, a.contributions, a.focus_area AS "focusArea", a.availability, a.status,
        a.review_notes AS "reviewNotes", a.submitted_at AS "submittedAt", a.updated_at AS "updatedAt",
        COUNT(n.id)::int AS "nominationCount"
      FROM sovereign_ambassador_applications a
      JOIN community_profiles p ON p.actor_id = a.actor_id
      LEFT JOIN sovereign_ambassador_nominations n
        ON n.nominee_actor_id = a.actor_id AND n.status = 'submitted'
      WHERE a.status IN ('submitted', 'under_review')
      GROUP BY a.id, p.actor_id
      ORDER BY CASE a.status WHEN 'under_review' THEN 0 ELSE 1 END, a.submitted_at ASC
    `;
  }

  return state;
}

async function submitApplication(db, actorId, payload) {
  const statement = cleanText(payload.statement, 1200);
  const contributions = cleanText(payload.contributions, 1200);
  const focusArea = cleanText(payload.focusArea, 40);
  const availability = cleanText(payload.availability, 240);

  if (statement.length < 80) return { error: "Share at least 80 characters about why you want to serve.", status: 400 };
  if (contributions.length < 80) return { error: "Describe your contributions in at least 80 characters.", status: 400 };
  if (!focusAreas.has(focusArea)) return { error: "Choose a valid service focus.", status: 400 };

  const activeRows = await db.sql`SELECT 1 FROM sovereign_ambassador_grants WHERE actor_id = ${actorId} AND is_active = TRUE`;
  if (activeRows.length) return { error: "You already serve as a Sovereign Ambassador.", status: 409 };

  const existingRows = await db.sql`SELECT id, status FROM sovereign_ambassador_applications WHERE actor_id = ${actorId}`;
  const eventType = existingRows.length ? "resubmitted" : "applied";
  await db.sql`
    INSERT INTO sovereign_ambassador_applications (actor_id, statement, contributions, focus_area, availability)
    VALUES (${actorId}, ${statement}, ${contributions}, ${focusArea}, ${availability})
    ON CONFLICT (actor_id) DO UPDATE SET
      statement = EXCLUDED.statement,
      contributions = EXCLUDED.contributions,
      focus_area = EXCLUDED.focus_area,
      availability = EXCLUDED.availability,
      status = 'submitted',
      review_notes = '',
      reviewed_by = NULL,
      reviewed_at = NULL,
      submitted_at = NOW(),
      updated_at = NOW()
  `;
  await db.sql`
    INSERT INTO sovereign_ambassador_events (actor_id, performed_by, event_type)
    VALUES (${actorId}, ${actorId}, ${eventType})
  `;
  return { message: "Your application is with the Ambassador Council." };
}

async function nominateMember(db, actorId, payload) {
  const nomineeActorId = cleanActorId(payload.nomineeActorId);
  const reason = cleanText(payload.reason, 600);
  if (!nomineeActorId || nomineeActorId === actorId) return { error: "Choose another community member to nominate.", status: 400 };
  if (reason.length < 40) return { error: "Share at least 40 characters explaining the nomination.", status: 400 };

  const nomineeRows = await db.sql`
    SELECT display_name FROM community_profiles p
    WHERE p.actor_id = ${nomineeActorId}
      AND NOT EXISTS (
        SELECT 1 FROM sovereign_ambassador_grants g
        WHERE g.actor_id = p.actor_id AND g.is_active = TRUE
      )
  `;
  if (!nomineeRows.length) return { error: "That member is not available for nomination.", status: 404 };

  await db.sql`
    INSERT INTO sovereign_ambassador_nominations (nominee_actor_id, nominator_actor_id, reason)
    VALUES (${nomineeActorId}, ${actorId}, ${reason})
    ON CONFLICT (nominee_actor_id, nominator_actor_id) DO UPDATE SET
      reason = EXCLUDED.reason,
      status = 'submitted',
      updated_at = NOW()
  `;
  await db.sql`
    INSERT INTO sovereign_ambassador_events (actor_id, performed_by, event_type, notes)
    VALUES (${nomineeActorId}, ${actorId}, 'nominated', ${reason})
  `;
  await db.sql`
    INSERT INTO community_notifications (recipient_id, actor_id, kind, body)
    VALUES (${nomineeActorId}, ${actorId}, 'ambassador', 'A community member nominated you for the Sovereign Ambassador path.')
  `;
  return { message: `${nomineeRows[0].display_name} received your nomination.` };
}

async function reviewApplication(db, actorId, payload) {
  const applicationId = cleanRecordId(payload.applicationId);
  const decision = cleanText(payload.decision, 24);
  const notes = cleanText(payload.notes, 600);
  if (!applicationId || !["under_review", "approved", "declined"].includes(decision)) {
    return { error: "Choose a valid review decision.", status: 400 };
  }
  if (decision === "declined" && notes.length < 10) return { error: "Add a constructive review note before declining.", status: 400 };

  const applicationRows = await db.sql`
    SELECT id, actor_id FROM sovereign_ambassador_applications
    WHERE id = ${applicationId} AND status IN ('submitted', 'under_review')
  `;
  if (!applicationRows.length) return { error: "That application is no longer awaiting review.", status: 404 };
  const applicantActorId = applicationRows[0].actor_id;
  if (applicantActorId === actorId) return { error: "Council members cannot review their own applications.", status: 403 };

  await db.sql`
    UPDATE sovereign_ambassador_applications
    SET status = ${decision}, review_notes = ${notes}, reviewed_by = ${actorId},
      reviewed_at = CASE WHEN ${decision} = 'under_review' THEN reviewed_at ELSE NOW() END,
      updated_at = NOW()
    WHERE id = ${applicationId}
  `;

  if (decision === "approved") {
    const grantRows = await db.sql`SELECT is_active FROM sovereign_ambassador_grants WHERE actor_id = ${applicantActorId}`;
    const eventType = grantRows.length ? "restored" : "approved";
    await db.sql`
      INSERT INTO sovereign_ambassador_grants (actor_id, application_id, granted_by, grant_notes)
      VALUES (${applicantActorId}, ${applicationId}, ${actorId}, ${notes})
      ON CONFLICT (actor_id) DO UPDATE SET
        application_id = EXCLUDED.application_id,
        granted_by = EXCLUDED.granted_by,
        grant_notes = EXCLUDED.grant_notes,
        is_active = TRUE,
        granted_at = NOW(),
        revoked_at = NULL,
        revoked_by = NULL,
        revocation_notes = '',
        updated_at = NOW()
    `;
    await db.sql`
      INSERT INTO sovereign_ambassador_events (actor_id, performed_by, event_type, notes)
      VALUES (${applicantActorId}, ${actorId}, ${eventType}, ${notes})
    `;
    await db.sql`
      INSERT INTO community_notifications (recipient_id, actor_id, kind, body)
      VALUES (${applicantActorId}, ${actorId}, 'ambassador', 'You have been welcomed as a Sovereign Ambassador.')
    `;
  } else {
    const eventType = decision === "under_review" ? "review_started" : "declined";
    await db.sql`
      INSERT INTO sovereign_ambassador_events (actor_id, performed_by, event_type, notes)
      VALUES (${applicantActorId}, ${actorId}, ${eventType}, ${notes})
    `;
    if (decision === "declined") {
      await db.sql`
        INSERT INTO community_notifications (recipient_id, actor_id, kind, body)
        VALUES (${applicantActorId}, ${actorId}, 'ambassador', 'The Ambassador Council completed its review. Your private feedback is ready.')
      `;
    }
  }
  return { message: decision === "approved" ? "Ambassador role granted." : decision === "declined" ? "Review completed." : "Application moved into review." };
}

async function handleAction(db, user, actorId, payload) {
  const action = cleanText(payload.action, 40);

  if (action === "apply") return submitApplication(db, actorId, payload);

  if (action === "withdraw") {
    const rows = await db.sql`
      UPDATE sovereign_ambassador_applications
      SET status = 'withdrawn', updated_at = NOW()
      WHERE actor_id = ${actorId} AND status IN ('submitted', 'under_review')
      RETURNING id
    `;
    if (!rows.length) return { error: "There is no active application to withdraw.", status: 409 };
    await db.sql`
      INSERT INTO sovereign_ambassador_events (actor_id, performed_by, event_type)
      VALUES (${actorId}, ${actorId}, 'withdrawn')
    `;
    return { message: "Your application was withdrawn." };
  }

  if (action === "nominate") return nominateMember(db, actorId, payload);

  if (action === "dismiss_nomination") {
    const nominationId = cleanRecordId(payload.nominationId);
    const rows = await db.sql`
      UPDATE sovereign_ambassador_nominations
      SET status = 'dismissed', updated_at = NOW()
      WHERE id = ${nominationId} AND nominee_actor_id = ${actorId} AND status = 'submitted'
      RETURNING id
    `;
    if (!rows.length) return { error: "That nomination is no longer active.", status: 404 };
    await db.sql`
      INSERT INTO sovereign_ambassador_events (actor_id, performed_by, event_type)
      VALUES (${actorId}, ${actorId}, 'nomination_dismissed')
    `;
    return { message: "The nomination was dismissed privately." };
  }

  if (!isCouncilMember(user)) return { error: "Ambassador Council access is required.", status: 403 };

  if (action === "review") return reviewApplication(db, actorId, payload);

  if (action === "revoke") {
    const targetActorId = cleanActorId(payload.targetActorId);
    const notes = cleanText(payload.notes, 600);
    if (!targetActorId || notes.length < 10) return { error: "Choose an Ambassador and record the reason for revocation.", status: 400 };
    const rows = await db.sql`
      UPDATE sovereign_ambassador_grants
      SET is_active = FALSE, revoked_at = NOW(), revoked_by = ${actorId}, revocation_notes = ${notes}, updated_at = NOW()
      WHERE actor_id = ${targetActorId} AND is_active = TRUE
      RETURNING actor_id
    `;
    if (!rows.length) return { error: "That Ambassador grant is not active.", status: 404 };
    await db.sql`
      INSERT INTO sovereign_ambassador_events (actor_id, performed_by, event_type, notes)
      VALUES (${targetActorId}, ${actorId}, 'revoked', ${notes})
    `;
    await db.sql`
      INSERT INTO community_notifications (recipient_id, actor_id, kind, body)
      VALUES (${targetActorId}, ${actorId}, 'ambassador', 'Your Sovereign Ambassador service term has been closed. Private council notes are available on request.')
    `;
    return { message: "Ambassador role revoked and recorded." };
  }

  return { error: "Unknown Ambassador action.", status: 400 };
}

export default async function handler(request) {
  try {
    const db = getDatabase();
    const user = await getUser();
    const actorId = user?.id ? identityActorId(user.id) : null;

    if (user?.id) {
      await ensureHaloMembership(db, user);
      await ensureProfile(db, actorId, identityDisplayName(user, actorId));
    }

    if (request.method === "GET") return json(await getState(db, user));
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
    if (!actorId) return json({ message: "Join HALO before using the Ambassador path." }, 401);

    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin Ambassador actions are not accepted." }, 403);
    }

    const payload = await request.json().catch(() => ({}));
    const result = await handleAction(db, user, actorId, payload);
    if (result.error) return json({ message: result.error }, result.status);
    return json({ ...(await getState(db, user)), message: result.message });
  } catch (error) {
    console.error("Ambassador request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The Ambassador channel is temporarily unavailable." }, 500);
  }
}

export const config = { path: "/api/ambassadors" };
