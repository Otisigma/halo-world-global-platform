import { isOwner } from "./halo-x.mjs";

// Shared by the owner-authorized Control Center handler only. Every source is a
// member-attributed table keyed by the verified Identity user id (member_id /
// submitter_id / owner_member_id). Anonymous analytics are never joined to members.
export const MEMBER_DIRECTORY_LIMIT = 30;
export const MEMBER_SOURCE_LIMIT = 20;
export const SUPPORT_EXCERPT_LIMIT = 280;
export const ANONYMOUS_PAGE_LIMIT = 10;
export const ANONYMOUS_PAGE_DAYS = 7;

const iso = value => value ? new Date(value).toISOString() : null;

function requireOwner(user) {
  if (!isOwner(user)) throw new Error("Owner access is required");
}

async function source(load, serialize) {
  try {
    const rows = await load();
    return { status: "available", rows: rows.map(serialize) };
  } catch {
    // Missing tables and failed queries must not masquerade as empty history.
    return { status: "unavailable", rows: null };
  }
}

export function cleanMemberId(value) {
  if (typeof value !== "string" || value.length > 160) return "";
  const id = value.trim();
  return /^[A-Za-z0-9_.:|-]{1,160}$/.test(id) ? id : "";
}

// Only the path is kept: query strings and fragments can carry tokens or private context.
export function pagePathFrom(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    return new URL(value).pathname.slice(0, 256) || "/";
  } catch {
    return null;
  }
}

function excerpt(value) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > SUPPORT_EXCERPT_LIMIT ? `${text.slice(0, SUPPORT_EXCERPT_LIMIT - 1)}…` : text;
}

export async function loadOwnerMemberDirectory(db, user) {
  requireOwner(user);
  const members = await source(() => db.sql`
    SELECT member_id, display_name, email, tier, joined_at, last_seen_at
    FROM halo_memberships
    ORDER BY last_seen_at DESC, member_id ASC
    LIMIT 30
  `, row => ({
    id: row.member_id,
    name: row.display_name,
    email: row.email,
    tier: row.tier,
    joinedAt: iso(row.joined_at),
    lastSeenAt: iso(row.last_seen_at)
  }));
  const ids = members.rows?.map(member => member.id) || [];
  const [requestCounts, anonymousPages] = await Promise.all([
    ids.length ? source(() => db.sql`
      SELECT submitter_id,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int AS open
      FROM halo_support_requests
      WHERE submitter_id = ANY(${ids})
      GROUP BY submitter_id
      LIMIT 30
    `, row => row) : { status: members.status, rows: [] },
    source(() => db.sql`
      SELECT page_path, COUNT(*)::int AS views, COUNT(DISTINCT session_id)::int AS sessions
      FROM analytics_events
      WHERE event_name = 'page_view' AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY page_path
      ORDER BY views DESC, page_path ASC
      LIMIT 10
    `, row => ({ pagePath: row.page_path, views: Number(row.views || 0), sessions: Number(row.sessions || 0) }))
  ]);
  if (members.rows) {
    const counts = new Map((requestCounts.rows || []).map(row => [row.submitter_id, row]));
    for (const member of members.rows) {
      const count = counts.get(member.id);
      member.requests = requestCounts.status === "available"
        ? { total: Number(count?.total || 0), open: Number(count?.open || 0) }
        : null;
    }
  }
  return {
    limit: MEMBER_DIRECTORY_LIMIT,
    refreshedAt: new Date().toISOString(),
    members,
    anonymousPages: { ...anonymousPages, windowDays: ANONYMOUS_PAGE_DAYS, limit: ANONYMOUS_PAGE_LIMIT }
  };
}

export async function loadOwnerMemberActivity(db, user, value) {
  requireOwner(user);
  const memberId = cleanMemberId(value);
  if (!memberId) return null;
  const memberRows = await db.sql`
    SELECT member_id, display_name, email, tier, source, joined_at, last_seen_at
    FROM halo_memberships
    WHERE member_id = ${memberId}
    LIMIT 1
  `;
  const row = memberRows[0];
  if (!row) return null;
  const [accountEvents, requests, rewards, releaseHouse, listening, dreamweaver, trackDrops] = await Promise.all([
    source(() => db.sql`
      SELECT id, event_type, occurred_at
      FROM halo_relationship_auth_events
      WHERE member_id = ${memberId}
      ORDER BY occurred_at DESC, id DESC
      LIMIT 20
    `, event => ({ type: event.event_type, occurredAt: iso(event.occurred_at) })),
    // Only this member's own requests; staff notes are deliberately not selected.
    source(() => db.sql`
      SELECT request_key, category, title, details, page_url, visibility, status, vote_count, created_at, updated_at
      FROM halo_support_requests
      WHERE submitter_id = ${memberId}
      ORDER BY created_at DESC, request_key ASC
      LIMIT 20
    `, request => ({
      category: request.category,
      title: request.title,
      excerpt: excerpt(request.details),
      pagePath: pagePathFrom(request.page_url),
      visibility: request.visibility,
      status: request.status,
      voteCount: Number(request.vote_count || 0),
      createdAt: iso(request.created_at),
      updatedAt: iso(request.updated_at)
    })),
    source(() => db.sql`
      SELECT reward_key, points, reason, created_at
      FROM halo_member_reward_events
      WHERE member_id = ${memberId}
      ORDER BY created_at DESC, reward_key ASC
      LIMIT 20
    `, reward => ({ reason: reward.reason, points: Number(reward.points || 0), createdAt: iso(reward.created_at) })),
    source(() => db.sql`
      SELECT id, pathway, artist_name, track_title, status, created_at, updated_at
      FROM halo_release_house_submissions
      WHERE owner_member_id = ${memberId}
      ORDER BY updated_at DESC, id ASC
      LIMIT 20
    `, submission => ({
      pathway: submission.pathway,
      artistName: submission.artist_name,
      trackTitle: submission.track_title,
      status: submission.status,
      createdAt: iso(submission.created_at),
      updatedAt: iso(submission.updated_at)
    })),
    // Listening reports exist only while the member's opt-in is active; revocation deletes them.
    source(() => db.sql`
      SELECT s.id, s.outcome, s.started_at, r.title
      FROM halo_listening_sessions s
      JOIN halo_release_campaigns r ON r.id = s.release_id
      JOIN halo_listening_preferences p ON p.member_id = s.member_id
      WHERE s.member_id = ${memberId} AND p.enabled = TRUE AND p.consent_at IS NOT NULL
      ORDER BY s.started_at DESC, s.id ASC
      LIMIT 20
    `, session => ({ releaseTitle: session.title, outcome: session.outcome || "started", startedAt: iso(session.started_at) })),
    source(() => db.sql`
      SELECT source, status, consent_at, first_signup_at, last_signup_at
      FROM halo_relationship_signups
      WHERE linked_member_id = ${memberId}
      ORDER BY last_signup_at DESC, email ASC
      LIMIT 20
    `, signup => ({
      source: signup.source,
      status: signup.status,
      consentAt: iso(signup.consent_at),
      firstSignupAt: iso(signup.first_signup_at),
      lastSignupAt: iso(signup.last_signup_at)
    })),
    source(() => db.sql`
      SELECT track_drops_in_app, track_drops_email, email_consent_at, updated_at
      FROM halo_member_notification_preferences
      WHERE member_id = ${memberId}
      LIMIT 1
    `, preference => ({
      inApp: preference.track_drops_in_app === true,
      emailOptIn: preference.track_drops_email === true && Boolean(preference.email_consent_at),
      consentAt: preference.track_drops_email === true ? iso(preference.email_consent_at) : null,
      updatedAt: iso(preference.updated_at)
    }))
  ]);
  return {
    member: {
      id: row.member_id,
      name: row.display_name,
      email: row.email,
      tier: row.tier,
      source: row.source,
      joinedAt: iso(row.joined_at),
      lastSeenAt: iso(row.last_seen_at)
    },
    limitPerSource: MEMBER_SOURCE_LIMIT,
    refreshedAt: new Date().toISOString(),
    sources: { accountEvents, requests, rewards, releaseHouse, listening, dreamweaver, trackDrops },
    pageHistory: {
      status: "unavailable",
      reason: "HALO does not record page visits against member accounts. Site analytics use anonymous browser and session IDs that are not linked to members, so this member's page history is not known."
    },
    artistPro: {
      status: "not_linked",
      reason: "Artist Pro applications are stored by application email and are not linked to member accounts. Review them in the Signups panel."
    }
  };
}
