import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import OpenAI from "openai";
import { cleanText, ensureMembership, isOwner } from "../lib/halo-x.mjs";

const stages = new Set(["new", "welcomed", "engaged", "collaborator", "partner", "vip", "paused"]);
const channels = new Set(["none", "email", "community"]);
const assistantRoles = new Set(["welcome", "relationship", "community", "creator", "support"]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function cleanTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(tag => cleanText(tag, 32).toLowerCase()).filter(Boolean))].slice(0, 12);
}

function serializeMember(row) {
  return {
    id: row.member_id,
    name: row.display_name,
    email: row.email,
    tier: row.tier,
    source: row.source,
    joinedAt: iso(row.joined_at),
    lastSeenAt: iso(row.last_seen_at),
    lastSignInAt: iso(row.last_sign_in_at),
    sessionCount: Number(row.session_count || 0),
    stage: row.relationship_stage || "new",
    contactConsent: Boolean(row.contact_consent),
    preferredChannel: row.preferred_channel || "none",
    tags: row.tags || [],
    summary: row.relationship_summary || "",
    openTaskCount: Number(row.open_task_count || 0),
    noteCount: Number(row.note_count || 0),
    region: row.region || "Global",
    badge: row.badge || "Member",
    invitedByName: row.invited_by_name || "",
    inviteJoinedAt: iso(row.invite_joined_at)
  };
}

function serializeTask(row) {
  return {
    id: Number(row.id),
    memberId: row.member_id,
    memberName: row.member_name,
    title: row.title,
    status: row.status,
    dueAt: iso(row.due_at),
    createdAt: iso(row.created_at),
    completedAt: iso(row.completed_at)
  };
}

async function ensureRelationshipProfiles(db) {
  await db.sql`
    INSERT INTO halo_relationship_profiles (member_id)
    SELECT member_id FROM halo_memberships
    ON CONFLICT (member_id) DO NOTHING
  `;
}

async function loadWorkspace(db) {
  await ensureRelationshipProfiles(db);
  const [metricRows, memberRows, taskRows, activityRows] = await Promise.all([
    db.sql`
      SELECT
        COUNT(*)::int AS total_members,
        COUNT(*) FILTER (WHERE m.joined_at >= NOW() - INTERVAL '7 days')::int AS joined_7d,
        COUNT(*) FILTER (WHERE COALESCE(a.last_sign_in_at, m.last_seen_at) >= NOW() - INTERVAL '7 days')::int AS active_7d,
        COUNT(*) FILTER (WHERE r.contact_consent = TRUE)::int AS contactable,
        (SELECT COUNT(*)::int FROM halo_relationship_tasks WHERE status = 'open' AND due_at <= NOW()) AS overdue_tasks
      FROM halo_memberships m
      JOIN halo_relationship_profiles r ON r.member_id = m.member_id
      LEFT JOIN (
        SELECT member_id, MAX(occurred_at) AS last_sign_in_at
        FROM halo_relationship_auth_events
        WHERE event_type IN ('login', 'session', 'recovery')
        GROUP BY member_id
      ) a ON a.member_id = m.member_id
    `,
    db.sql`
      SELECT m.member_id, m.display_name, m.email, m.tier, m.source, m.joined_at,
        m.last_seen_at, p.region, p.badge, r.relationship_stage, r.contact_consent,
        r.preferred_channel, r.tags, r.relationship_summary,
        (SELECT creator.display_name
          FROM halo_share_invite_events invite_event
          JOIN halo_share_invites invite ON invite.token = invite_event.invite_token
          LEFT JOIN halo_memberships creator ON creator.member_id = invite.created_by_member_id
          WHERE invite_event.member_id = m.member_id AND invite_event.event_type = 'joined'
          ORDER BY invite_event.occurred_at DESC LIMIT 1) AS invited_by_name,
        (SELECT invite_event.occurred_at
          FROM halo_share_invite_events invite_event
          WHERE invite_event.member_id = m.member_id AND invite_event.event_type = 'joined'
          ORDER BY invite_event.occurred_at DESC LIMIT 1) AS invite_joined_at,
        MAX(a.occurred_at) FILTER (WHERE a.event_type IN ('login', 'session', 'recovery')) AS last_sign_in_at,
        COUNT(DISTINCT a.id) FILTER (WHERE a.event_type = 'session')::int AS session_count,
        COUNT(DISTINCT n.id)::int AS note_count,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'open')::int AS open_task_count
      FROM halo_memberships m
      JOIN community_profiles p ON p.actor_id = m.actor_id
      JOIN halo_relationship_profiles r ON r.member_id = m.member_id
      LEFT JOIN halo_relationship_auth_events a ON a.member_id = m.member_id
      LEFT JOIN halo_relationship_notes n ON n.member_id = m.member_id
      LEFT JOIN halo_relationship_tasks t ON t.member_id = m.member_id
      GROUP BY m.member_id, m.display_name, m.email, m.tier, m.source, m.joined_at,
        m.last_seen_at, p.region, p.badge, r.relationship_stage, r.contact_consent,
        r.preferred_channel, r.tags, r.relationship_summary
      ORDER BY COALESCE(MAX(a.occurred_at), m.last_seen_at) DESC
      LIMIT 300
    `,
    db.sql`
      SELECT t.id, t.member_id, m.display_name AS member_name, t.title, t.status,
        t.due_at, t.created_at, t.completed_at
      FROM halo_relationship_tasks t
      JOIN halo_memberships m ON m.member_id = t.member_id
      WHERE t.status = 'open'
      ORDER BY t.due_at ASC NULLS LAST, t.created_at DESC
      LIMIT 30
    `,
    db.sql`
      SELECT a.id, a.event_type, a.occurred_at, m.member_id, m.display_name
      FROM halo_relationship_auth_events a
      JOIN halo_memberships m ON m.member_id = a.member_id
      ORDER BY a.occurred_at DESC
      LIMIT 30
    `
  ]);

  const metrics = metricRows[0] || {};
  return {
    metrics: {
      totalMembers: Number(metrics.total_members || 0),
      joined7d: Number(metrics.joined_7d || 0),
      active7d: Number(metrics.active_7d || 0),
      contactable: Number(metrics.contactable || 0),
      overdueTasks: Number(metrics.overdue_tasks || 0)
    },
    members: memberRows.map(serializeMember),
    tasks: taskRows.map(serializeTask),
    activity: activityRows.map(row => ({
      id: Number(row.id),
      type: row.event_type,
      occurredAt: iso(row.occurred_at),
      memberId: row.member_id,
      memberName: row.display_name
    }))
  };
}

async function loadMember(db, memberId) {
  const memberRows = await db.sql`
    SELECT m.member_id, m.display_name, m.email, m.tier, m.source, m.joined_at,
      m.last_seen_at, p.region, p.badge, r.relationship_stage, r.contact_consent,
      r.preferred_channel, r.tags, r.relationship_summary,
      (SELECT creator.display_name
        FROM halo_share_invite_events invite_event
        JOIN halo_share_invites invite ON invite.token = invite_event.invite_token
        LEFT JOIN halo_memberships creator ON creator.member_id = invite.created_by_member_id
        WHERE invite_event.member_id = m.member_id AND invite_event.event_type = 'joined'
        ORDER BY invite_event.occurred_at DESC LIMIT 1) AS invited_by_name,
      (SELECT invite_event.occurred_at
        FROM halo_share_invite_events invite_event
        WHERE invite_event.member_id = m.member_id AND invite_event.event_type = 'joined'
        ORDER BY invite_event.occurred_at DESC LIMIT 1) AS invite_joined_at,
      MAX(a.occurred_at) FILTER (WHERE a.event_type IN ('login', 'session', 'recovery')) AS last_sign_in_at,
      COUNT(DISTINCT a.id) FILTER (WHERE a.event_type = 'session')::int AS session_count,
      COUNT(DISTINCT n.id)::int AS note_count,
      COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'open')::int AS open_task_count
    FROM halo_memberships m
    JOIN community_profiles p ON p.actor_id = m.actor_id
    JOIN halo_relationship_profiles r ON r.member_id = m.member_id
    LEFT JOIN halo_relationship_auth_events a ON a.member_id = m.member_id
    LEFT JOIN halo_relationship_notes n ON n.member_id = m.member_id
    LEFT JOIN halo_relationship_tasks t ON t.member_id = m.member_id
    WHERE m.member_id = ${memberId}
    GROUP BY m.member_id, m.display_name, m.email, m.tier, m.source, m.joined_at,
      m.last_seen_at, p.region, p.badge, r.relationship_stage, r.contact_consent,
      r.preferred_channel, r.tags, r.relationship_summary
    LIMIT 1
  `;
  if (!memberRows.length) return null;
  const [noteRows, taskRows, draftRows, eventRows] = await Promise.all([
    db.sql`
      SELECT n.id, n.body, n.created_at, author.display_name AS author_name
      FROM halo_relationship_notes n
      LEFT JOIN halo_memberships author ON author.member_id = n.author_member_id
      WHERE n.member_id = ${memberId}
      ORDER BY n.created_at DESC
      LIMIT 40
    `,
    db.sql`
      SELECT t.id, t.member_id, m.display_name AS member_name, t.title, t.status,
        t.due_at, t.created_at, t.completed_at
      FROM halo_relationship_tasks t
      JOIN halo_memberships m ON m.member_id = t.member_id
      WHERE t.member_id = ${memberId}
      ORDER BY (t.status = 'open') DESC, t.due_at ASC NULLS LAST, t.created_at DESC
      LIMIT 40
    `,
    db.sql`
      SELECT id, assistant_role, intent, content, status, created_at, updated_at
      FROM halo_relationship_drafts
      WHERE member_id = ${memberId}
      ORDER BY created_at DESC
      LIMIT 20
    `,
    db.sql`
      SELECT id, event_type, occurred_at
      FROM halo_relationship_auth_events
      WHERE member_id = ${memberId}
      ORDER BY occurred_at DESC
      LIMIT 30
    `
  ]);
  return {
    member: serializeMember(memberRows[0]),
    notes: noteRows.map(row => ({ id: Number(row.id), body: row.body, authorName: row.author_name || "HALO team", createdAt: iso(row.created_at) })),
    tasks: taskRows.map(serializeTask),
    drafts: draftRows.map(row => ({ id: Number(row.id), role: row.assistant_role, intent: row.intent, content: row.content, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) })),
    events: eventRows.map(row => ({ id: Number(row.id), type: row.event_type, occurredAt: iso(row.occurred_at) }))
  };
}

async function generateDraft(db, ownerMembership, memberId, payload) {
  const role = cleanText(payload.role, 24).toLowerCase();
  const intent = cleanText(payload.intent, 300);
  if (!assistantRoles.has(role) || intent.length < 2) return { error: json({ message: "Choose an assistant and describe the purpose" }, 400) };

  const detail = await loadMember(db, memberId);
  if (!detail) return { error: json({ message: "Member not found" }, 404) };
  if (!detail.member.contactConsent) return { error: json({ message: "Record explicit contact consent before drafting outreach" }, 409) };

  const context = {
    name: detail.member.name,
    stage: detail.member.stage,
    channel: detail.member.preferredChannel,
    tags: detail.member.tags,
    summary: detail.member.summary,
    recentNotes: detail.notes.slice(0, 4).map(note => note.body)
  };
  const openai = new OpenAI();
  const response = await openai.responses.create({
    model: "gpt-5.2",
    max_output_tokens: 500,
    input: [
      {
        role: "system",
        content: "You draft warm, concise relationship messages for HALO World. Never claim to be human, invent facts, pressure the recipient, infer sensitive traits, promise money or access, or state that a message was sent. Use only supplied context. Return only the message draft, under 180 words. A human reviews every draft before any contact."
      },
      {
        role: "user",
        content: `Assistant role: ${role}\nPurpose: ${intent}\nApproved relationship context: ${JSON.stringify(context)}`
      }
    ]
  });
  const content = cleanText(response.output_text, 2000);
  if (!content) return { error: json({ message: "The AI assistant returned an empty draft" }, 502) };
  const rows = await db.sql`
    INSERT INTO halo_relationship_drafts (member_id, created_by_member_id, assistant_role, intent, content)
    VALUES (${memberId}, ${ownerMembership.member_id}, ${role}, ${intent}, ${content})
    RETURNING id
  `;
  return { id: Number(rows[0].id), content };
}

async function handlePost(request, db, user, ownerMembership) {
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin relationship updates are not accepted" }, 403);
  }
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }
  const action = cleanText(payload.action, 40);
  const memberId = cleanText(payload.memberId, 160);
  if (!memberId) return json({ message: "Choose a member" }, 400);
  const exists = await db.sql`SELECT member_id FROM halo_memberships WHERE member_id = ${memberId} LIMIT 1`;
  if (!exists.length) return json({ message: "Member not found" }, 404);
  await db.sql`INSERT INTO halo_relationship_profiles (member_id) VALUES (${memberId}) ON CONFLICT (member_id) DO NOTHING`;

  if (action === "update_member") {
    const stage = cleanText(payload.stage, 24).toLowerCase();
    const preferredChannel = cleanText(payload.preferredChannel, 24).toLowerCase();
    const summary = cleanText(payload.summary, 500);
    const tags = cleanTags(payload.tags);
    if (!stages.has(stage) || !channels.has(preferredChannel)) return json({ message: "Relationship settings are not valid" }, 400);
    await db.sql`
      UPDATE halo_relationship_profiles SET
        relationship_stage = ${stage}, contact_consent = ${payload.contactConsent === true},
        preferred_channel = ${preferredChannel}, tags = ${tags}, relationship_summary = ${summary},
        updated_by_member_id = ${user.id}, updated_at = NOW()
      WHERE member_id = ${memberId}
    `;
  } else if (action === "add_note") {
    const body = cleanText(payload.body, 1200);
    if (body.length < 2) return json({ message: "Add a useful note" }, 400);
    await db.sql`
      INSERT INTO halo_relationship_notes (member_id, author_member_id, body)
      VALUES (${memberId}, ${user.id}, ${body})
    `;
  } else if (action === "create_task") {
    const title = cleanText(payload.title, 180);
    if (title.length < 2) return json({ message: "Add a task title" }, 400);
    const dueAt = payload.dueAt ? new Date(payload.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) return json({ message: "Choose a valid due date" }, 400);
    await db.sql`
      INSERT INTO halo_relationship_tasks (member_id, assigned_to_member_id, title, due_at)
      VALUES (${memberId}, ${user.id}, ${title}, ${dueAt ? dueAt.toISOString() : null})
    `;
  } else if (action === "complete_task") {
    const taskId = positiveId(payload.taskId);
    if (!taskId) return json({ message: "Choose a valid task" }, 400);
    await db.sql`
      UPDATE halo_relationship_tasks SET status = 'done', completed_at = NOW()
      WHERE id = ${taskId} AND member_id = ${memberId}
    `;
  } else if (action === "generate_draft") {
    const result = await generateDraft(db, ownerMembership, memberId, payload);
    if (result.error) return result.error;
    return json({ message: "Draft created for human review", draft: result, detail: await loadMember(db, memberId) });
  } else if (action === "update_draft") {
    const draftId = positiveId(payload.draftId);
    const status = cleanText(payload.status, 20);
    if (!draftId || !new Set(["approved", "discarded"]).has(status)) return json({ message: "Draft update is not valid" }, 400);
    await db.sql`
      UPDATE halo_relationship_drafts SET status = ${status}, updated_at = NOW()
      WHERE id = ${draftId} AND member_id = ${memberId}
    `;
  } else {
    return json({ message: "Unknown relationship action" }, 400);
  }

  return json({ message: "Relationship workspace updated", detail: await loadMember(db, memberId), workspace: await loadWorkspace(db) });
}

export default async function haloRelationsHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Sign in to open HALO Relations" }, 401);
    const ownerMembership = await ensureMembership(db, user);
    if (!isOwner(user)) return json({ message: "HALO Relations is limited to the owner team" }, 403);
    if (request.method === "POST") return handlePost(request, db, user, ownerMembership);
    const memberId = cleanText(new URL(request.url).searchParams.get("member"), 160);
    if (memberId) {
      const detail = await loadMember(db, memberId);
      return detail ? json({ detail }) : json({ message: "Member not found" }, 404);
    }
    return json({ workspace: await loadWorkspace(db), viewer: { name: ownerMembership.display_name } });
  } catch (error) {
    console.error("HALO Relations request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "HALO Relations is temporarily unavailable" }, 500);
  }
}

export const config = {
  path: "/api/halo-relations"
};
