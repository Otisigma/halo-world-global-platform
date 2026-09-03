import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";

const MAX_BODY_BYTES = 18_000;
const listLimits = { roles: 8, genres: 12, skills: 12, lookingFor: 8 };
const availabilityValues = new Set(["open", "selective", "unavailable"]);
const accentValues = new Set(["gold", "cyan", "violet", "coral", "lime"]);
const responseStatuses = new Set(["accepted", "declined", "archived"]);

function json(payload, status = 200, headers = {}) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store", ...headers }
  });
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

export function cleanList(value, limit = 8, itemLength = 48) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => cleanText(item, itemLength)).filter(Boolean))].slice(0, limit);
}

export function cleanRegionCode(value) {
  return cleanText(value, 32).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cleanSlug(value) {
  const slug = cleanText(value, 96).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
}

export function cleanUuid(value) {
  const uuid = cleanText(value, 36).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid) ? uuid : "";
}

export function pairFor(memberId, targetMemberId) {
  return [String(memberId), String(targetMemberId)].sort((left, right) => left.localeCompare(right));
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function profilePayload(row, own = false) {
  if (!row) return null;
  return {
    memberId: row.member_id,
    displayName: row.display_name,
    tier: row.tier,
    headline: row.headline || "",
    bio: row.bio || "",
    roles: row.roles || [],
    genres: row.genres || [],
    skills: row.skills || [],
    lookingFor: row.looking_for || [],
    regionCode: row.region_code || "",
    regionLabel: row.region_label || "",
    availability: row.availability || "open",
    discoverable: own ? Boolean(row.discoverable) : undefined,
    mapVisible: own ? Boolean(row.map_visible) : undefined,
    accent: row.accent || "gold",
    lastSeenAt: iso(row.last_seen_at),
    updatedAt: iso(row.updated_at)
  };
}

function requestPayload(row) {
  return {
    id: row.id,
    direction: row.direction,
    kind: row.request_kind,
    subject: row.subject,
    body: row.body,
    campaignSlug: row.campaign_slug,
    status: row.status,
    memberId: row.other_member_id,
    displayName: row.other_display_name,
    headline: row.other_headline || "",
    accent: row.other_accent || "gold",
    conversationId: row.conversation_id || null,
    createdAt: iso(row.created_at),
    respondedAt: iso(row.responded_at)
  };
}

function conversationPayload(row) {
  return {
    id: row.id,
    memberId: row.other_member_id,
    displayName: row.other_display_name,
    headline: row.other_headline || "",
    accent: row.other_accent || "gold",
    lastMessage: row.last_message || "",
    lastMessageAt: iso(row.last_message_at),
    unread: Number(row.unread || 0)
  };
}

async function loadOwnProfile(db, memberId) {
  const rows = await db.sql`
    SELECT m.member_id, m.display_name, m.tier, m.last_seen_at,
      COALESCE(p.headline, '') AS headline, COALESCE(p.bio, '') AS bio,
      COALESCE(p.roles, '{}') AS roles, COALESCE(p.genres, '{}') AS genres,
      COALESCE(p.skills, '{}') AS skills, COALESCE(p.looking_for, '{}') AS looking_for,
      COALESCE(p.region_code, '') AS region_code, COALESCE(p.region_label, '') AS region_label,
      COALESCE(p.availability, 'open') AS availability,
      COALESCE(p.discoverable, TRUE) AS discoverable,
      COALESCE(p.map_visible, FALSE) AS map_visible,
      COALESCE(p.accent, 'gold') AS accent, p.updated_at
    FROM halo_memberships m
    LEFT JOIN halo_signal_profiles p ON p.member_id = m.member_id
    WHERE m.member_id = ${memberId}
    LIMIT 1
  `;
  return profilePayload(rows[0], true);
}

async function loadRequests(db, memberId) {
  const rows = await db.sql`
    SELECT r.*,
      CASE WHEN r.sender_member_id = ${memberId} THEN 'outbound' ELSE 'inbound' END AS direction,
      CASE WHEN r.sender_member_id = ${memberId} THEN r.recipient_member_id ELSE r.sender_member_id END AS other_member_id,
      other.display_name AS other_display_name,
      COALESCE(profile.headline, '') AS other_headline,
      COALESCE(profile.accent, 'gold') AS other_accent,
      conversation.id AS conversation_id
    FROM halo_signal_requests r
    JOIN halo_memberships other ON other.member_id = CASE
      WHEN r.sender_member_id = ${memberId} THEN r.recipient_member_id ELSE r.sender_member_id END
    LEFT JOIN halo_signal_profiles profile ON profile.member_id = other.member_id
    LEFT JOIN halo_signal_conversations conversation ON
      conversation.member_a_id = LEAST(r.sender_member_id, r.recipient_member_id)
      AND conversation.member_b_id = GREATEST(r.sender_member_id, r.recipient_member_id)
    WHERE (r.sender_member_id = ${memberId} OR r.recipient_member_id = ${memberId})
      AND NOT EXISTS (
        SELECT 1 FROM halo_signal_blocks block
        WHERE (block.member_id = ${memberId} AND block.target_member_id = CASE
          WHEN r.sender_member_id = ${memberId} THEN r.recipient_member_id ELSE r.sender_member_id END)
          OR (block.target_member_id = ${memberId} AND block.member_id = CASE
          WHEN r.sender_member_id = ${memberId} THEN r.recipient_member_id ELSE r.sender_member_id END)
      )
    ORDER BY r.created_at DESC
    LIMIT 40
  `;
  return rows.map(requestPayload);
}

async function loadConversations(db, memberId) {
  const rows = await db.sql`
    SELECT c.id, c.last_message_at,
      CASE WHEN c.member_a_id = ${memberId} THEN c.member_b_id ELSE c.member_a_id END AS other_member_id,
      other.display_name AS other_display_name,
      COALESCE(profile.headline, '') AS other_headline,
      COALESCE(profile.accent, 'gold') AS other_accent,
      COALESCE(latest.body, '') AS last_message,
      COUNT(unread.id)::int AS unread
    FROM halo_signal_conversations c
    JOIN halo_memberships other ON other.member_id = CASE
      WHEN c.member_a_id = ${memberId} THEN c.member_b_id ELSE c.member_a_id END
    LEFT JOIN halo_signal_profiles profile ON profile.member_id = other.member_id
    LEFT JOIN LATERAL (
      SELECT body FROM halo_signal_messages
      WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
    ) latest ON TRUE
    LEFT JOIN halo_signal_messages unread ON unread.conversation_id = c.id
      AND unread.sender_member_id <> ${memberId} AND unread.read_at IS NULL
    WHERE (c.member_a_id = ${memberId} OR c.member_b_id = ${memberId})
      AND NOT EXISTS (
        SELECT 1 FROM halo_signal_blocks block
        WHERE (block.member_id = ${memberId} AND block.target_member_id = other.member_id)
          OR (block.member_id = other.member_id AND block.target_member_id = ${memberId})
      )
    GROUP BY c.id, other.member_id, other.display_name, profile.headline, profile.accent, latest.body
    ORDER BY c.last_message_at DESC
    LIMIT 30
  `;
  return rows.map(conversationPayload);
}

async function loadCampaigns(db, memberId) {
  const rows = await db.sql`
    SELECT campaign.id, campaign.slug, campaign.title, campaign.subtitle, campaign.status,
      campaign.vote_goal, campaign.starts_at, campaign.ends_at,
      (SELECT COUNT(*)::int FROM halo_fan_vote_campaign_votes vote WHERE vote.campaign_id = campaign.id) AS votes,
      (SELECT COUNT(*)::int FROM halo_fan_vote_campaign_tracks track WHERE track.campaign_id = campaign.id) AS tracks
    FROM halo_fan_vote_campaigns campaign
    WHERE campaign.owner_member_id = ${memberId}
    ORDER BY campaign.updated_at DESC
    LIMIT 18
  `;
  return rows.map(row => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle || "",
    status: row.status,
    voteGoal: Number(row.vote_goal || 0),
    votes: Number(row.votes || 0),
    tracks: Number(row.tracks || 0),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at)
  }));
}

async function loadMap(db) {
  const rows = await db.sql`
    SELECT p.region_code, p.region_label,
      COUNT(*)::int AS members,
      COUNT(*) FILTER (WHERE m.last_seen_at >= NOW() - INTERVAL '15 minutes')::int AS active_now,
      COUNT(*) FILTER (WHERE m.last_seen_at >= NOW() - INTERVAL '24 hours')::int AS active_today
    FROM halo_signal_profiles p
    JOIN halo_memberships m ON m.member_id = p.member_id
    WHERE p.map_visible = TRUE AND p.region_code <> ''
    GROUP BY p.region_code, p.region_label
    ORDER BY active_now DESC, active_today DESC, members DESC, p.region_label
    LIMIT 24
  `;
  return rows.map(row => ({
    code: row.region_code,
    label: row.region_label,
    members: Number(row.members || 0),
    activeNow: Number(row.active_now || 0),
    activeToday: Number(row.active_today || 0)
  }));
}

async function loadDashboard(db, memberId) {
  const [profile, requests, conversations, campaigns, regions, countRows] = await Promise.all([
    loadOwnProfile(db, memberId),
    loadRequests(db, memberId),
    loadConversations(db, memberId),
    loadCampaigns(db, memberId),
    loadMap(db),
    db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM halo_signal_profiles profile
          WHERE profile.discoverable = TRUE AND profile.member_id <> ${memberId}
            AND NOT EXISTS (
              SELECT 1 FROM halo_signal_blocks block
              WHERE (block.member_id = ${memberId} AND block.target_member_id = profile.member_id)
                OR (block.member_id = profile.member_id AND block.target_member_id = ${memberId})
            )) AS collaborators,
        (SELECT COUNT(*)::int FROM halo_signal_requests WHERE recipient_member_id = ${memberId} AND status = 'pending') AS pending_signals,
        (SELECT COUNT(*)::int FROM halo_signal_messages message
          JOIN halo_signal_conversations conversation ON conversation.id = message.conversation_id
          WHERE (conversation.member_a_id = ${memberId} OR conversation.member_b_id = ${memberId})
            AND message.sender_member_id <> ${memberId} AND message.read_at IS NULL) AS unread_messages
    `
  ]);
  return {
    profile,
    summary: {
      collaborators: Number(countRows[0]?.collaborators || 0),
      pendingSignals: Number(countRows[0]?.pending_signals || 0),
      unreadMessages: Number(countRows[0]?.unread_messages || 0),
      activeRegions: regions.filter(region => region.activeToday > 0).length
    },
    requests,
    conversations,
    campaigns,
    regions
  };
}

async function discover(db, memberId, url) {
  const query = cleanText(url.searchParams.get("q"), 80);
  const availability = availabilityValues.has(url.searchParams.get("availability")) ? url.searchParams.get("availability") : "";
  const pattern = `%${query}%`;
  const rows = await db.sql`
    SELECT m.member_id, m.display_name, m.tier, m.last_seen_at, p.*
    FROM halo_signal_profiles p
    JOIN halo_memberships m ON m.member_id = p.member_id
    WHERE p.discoverable = TRUE AND p.member_id <> ${memberId}
      AND (${availability} = '' OR p.availability = ${availability})
      AND (${query} = '' OR m.display_name ILIKE ${pattern} OR p.headline ILIKE ${pattern}
        OR p.bio ILIKE ${pattern} OR array_to_string(p.roles, ' ') ILIKE ${pattern}
        OR array_to_string(p.genres, ' ') ILIKE ${pattern} OR array_to_string(p.skills, ' ') ILIKE ${pattern}
        OR array_to_string(p.looking_for, ' ') ILIKE ${pattern})
      AND NOT EXISTS (
        SELECT 1 FROM halo_signal_blocks block
        WHERE (block.member_id = ${memberId} AND block.target_member_id = p.member_id)
          OR (block.member_id = p.member_id AND block.target_member_id = ${memberId})
      )
    ORDER BY (m.last_seen_at >= NOW() - INTERVAL '15 minutes') DESC,
      (p.availability = 'open') DESC, p.updated_at DESC
    LIMIT 30
  `;
  return rows.map(row => profilePayload(row));
}

async function loadMessages(db, memberId, conversationId) {
  const conversationRows = await db.sql`
    SELECT c.id,
      CASE WHEN c.member_a_id = ${memberId} THEN c.member_b_id ELSE c.member_a_id END AS other_member_id,
      other.display_name AS other_display_name,
      COALESCE(profile.headline, '') AS other_headline,
      COALESCE(profile.accent, 'gold') AS other_accent
    FROM halo_signal_conversations c
    JOIN halo_memberships other ON other.member_id = CASE
      WHEN c.member_a_id = ${memberId} THEN c.member_b_id ELSE c.member_a_id END
    LEFT JOIN halo_signal_profiles profile ON profile.member_id = other.member_id
    WHERE c.id = ${conversationId} AND (c.member_a_id = ${memberId} OR c.member_b_id = ${memberId})
      AND NOT EXISTS (
        SELECT 1 FROM halo_signal_blocks block
        WHERE (block.member_id = ${memberId} AND block.target_member_id = other.member_id)
          OR (block.member_id = other.member_id AND block.target_member_id = ${memberId})
      )
    LIMIT 1
  `;
  if (!conversationRows.length) return null;
  const rows = await db.sql`
    SELECT id, sender_member_id, body, read_at, created_at
    FROM halo_signal_messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at ASC
    LIMIT 160
  `;
  return {
    conversation: conversationPayload({ ...conversationRows[0], last_message_at: null, unread: 0 }),
    messages: rows.map(row => ({
      id: row.id,
      mine: row.sender_member_id === memberId,
      body: row.body,
      readAt: iso(row.read_at),
      createdAt: iso(row.created_at)
    }))
  };
}

async function saveProfile(db, memberId, body) {
  const headline = cleanText(body.headline, 120);
  const bio = cleanText(body.bio, 900);
  const roles = cleanList(body.roles, listLimits.roles);
  const genres = cleanList(body.genres, listLimits.genres);
  const skills = cleanList(body.skills, listLimits.skills);
  const lookingFor = cleanList(body.lookingFor, listLimits.lookingFor);
  const regionCode = cleanRegionCode(body.regionCode || body.regionLabel);
  const regionLabel = cleanText(body.regionLabel, 80);
  const availability = availabilityValues.has(body.availability) ? body.availability : "open";
  const accent = accentValues.has(body.accent) ? body.accent : "gold";
  const discoverable = body.discoverable !== false;
  const mapVisible = Boolean(body.mapVisible && regionCode && regionLabel);

  await db.sql`
    INSERT INTO halo_signal_profiles (
      member_id, headline, bio, roles, genres, skills, looking_for, region_code,
      region_label, availability, discoverable, map_visible, accent
    ) VALUES (
      ${memberId}, ${headline}, ${bio}, ${roles}, ${genres}, ${skills}, ${lookingFor},
      ${regionCode}, ${regionLabel}, ${availability}, ${discoverable}, ${mapVisible}, ${accent}
    )
    ON CONFLICT (member_id) DO UPDATE SET
      headline = EXCLUDED.headline, bio = EXCLUDED.bio, roles = EXCLUDED.roles,
      genres = EXCLUDED.genres, skills = EXCLUDED.skills, looking_for = EXCLUDED.looking_for,
      region_code = EXCLUDED.region_code, region_label = EXCLUDED.region_label,
      availability = EXCLUDED.availability, discoverable = EXCLUDED.discoverable,
      map_visible = EXCLUDED.map_visible, accent = EXCLUDED.accent, updated_at = NOW()
  `;
  return loadOwnProfile(db, memberId);
}

async function sendSignal(db, memberId, body) {
  const targetMemberId = cleanText(body.targetMemberId, 128);
  const kind = body.kind === "collaboration" ? "collaboration" : "signal";
  const subject = cleanText(body.subject, 120);
  const message = cleanText(body.body, 1200);
  const rawCampaignSlug = cleanText(body.campaignSlug, 96).toLowerCase();
  const campaignSlug = cleanSlug(rawCampaignSlug) || null;
  if (!targetMemberId || targetMemberId === memberId) return { error: ["Choose another collaborator", 400] };
  if (subject.length < 2 || message.length < 2) return { error: ["Add a subject and a short note", 400] };
  if (rawCampaignSlug && !campaignSlug) return { error: ["Campaign slug must use lowercase letters, numbers, and hyphens", 400] };

  const targetRows = await db.sql`
    SELECT p.member_id FROM halo_signal_profiles p
    WHERE p.member_id = ${targetMemberId} AND p.discoverable = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM halo_signal_blocks block
        WHERE (block.member_id = ${memberId} AND block.target_member_id = p.member_id)
          OR (block.member_id = p.member_id AND block.target_member_id = ${memberId})
      )
    LIMIT 1
  `;
  if (!targetRows.length) return { error: ["That collaborator is not available", 404] };

  const rateRows = await db.sql`
    SELECT COUNT(*)::int AS total FROM halo_signal_requests
    WHERE sender_member_id = ${memberId} AND created_at >= NOW() - INTERVAL '1 hour'
  `;
  if (Number(rateRows[0]?.total || 0) >= 8) return { error: ["Signal limit reached. Try again later.", 429] };

  const duplicateRows = await db.sql`
    SELECT id FROM halo_signal_requests
    WHERE sender_member_id = ${memberId} AND recipient_member_id = ${targetMemberId}
      AND status = 'pending' AND created_at >= NOW() - INTERVAL '24 hours'
    LIMIT 1
  `;
  if (duplicateRows.length) return { error: ["A signal to this collaborator is already waiting", 409] };

  const rows = await db.sql`
    INSERT INTO halo_signal_requests (
      sender_member_id, recipient_member_id, request_kind, subject, body, campaign_slug
    ) VALUES (${memberId}, ${targetMemberId}, ${kind}, ${subject}, ${message}, ${campaignSlug})
    RETURNING id
  `;
  return { id: rows[0].id };
}

async function respondToSignal(db, memberId, body) {
  const requestId = cleanUuid(body.requestId);
  const status = responseStatuses.has(body.status) ? body.status : "";
  if (!requestId || !status) return { error: ["Choose a valid signal response", 400] };
  const rows = await db.sql`
    UPDATE halo_signal_requests SET status = ${status}, responded_at = NOW(), updated_at = NOW()
    WHERE id = ${requestId} AND recipient_member_id = ${memberId} AND status = 'pending'
    RETURNING id, sender_member_id, recipient_member_id
  `;
  if (!rows.length) return { error: ["That signal is no longer awaiting a response", 409] };
  if (status !== "accepted") return { status };
  const [memberA, memberB] = pairFor(rows[0].sender_member_id, rows[0].recipient_member_id);
  const conversationRows = await db.sql`
    INSERT INTO halo_signal_conversations (member_a_id, member_b_id, created_from_request_id)
    VALUES (${memberA}, ${memberB}, ${requestId})
    ON CONFLICT (member_a_id, member_b_id) DO UPDATE SET last_message_at = halo_signal_conversations.last_message_at
    RETURNING id
  `;
  return { status, conversationId: conversationRows[0].id };
}

async function sendMessage(db, memberId, body) {
  const conversationId = cleanUuid(body.conversationId);
  const message = cleanText(body.body, 2400);
  if (!conversationId || !message) return { error: ["Write a message before sending", 400] };
  const accessRows = await db.sql`
    SELECT c.id, CASE WHEN c.member_a_id = ${memberId} THEN c.member_b_id ELSE c.member_a_id END AS other_member_id
    FROM halo_signal_conversations c
    WHERE c.id = ${conversationId} AND (c.member_a_id = ${memberId} OR c.member_b_id = ${memberId})
    LIMIT 1
  `;
  if (!accessRows.length) return { error: ["Conversation not found", 404] };
  const otherMemberId = accessRows[0].other_member_id;
  const blockedRows = await db.sql`
    SELECT 1 FROM halo_signal_blocks
    WHERE (member_id = ${memberId} AND target_member_id = ${otherMemberId})
      OR (member_id = ${otherMemberId} AND target_member_id = ${memberId})
    LIMIT 1
  `;
  if (blockedRows.length) return { error: ["Messaging is unavailable for this connection", 403] };
  const rateRows = await db.sql`
    SELECT COUNT(*)::int AS total FROM halo_signal_messages
    WHERE sender_member_id = ${memberId} AND created_at >= NOW() - INTERVAL '5 minutes'
  `;
  if (Number(rateRows[0]?.total || 0) >= 24) return { error: ["Message limit reached. Take a short pause.", 429] };
  const rows = await db.sql`
    INSERT INTO halo_signal_messages (conversation_id, sender_member_id, body)
    VALUES (${conversationId}, ${memberId}, ${message})
    RETURNING id, created_at
  `;
  await db.sql`UPDATE halo_signal_conversations SET last_message_at = NOW() WHERE id = ${conversationId}`;
  return { id: rows[0].id, createdAt: iso(rows[0].created_at) };
}

async function handleSafetyAction(db, memberId, body) {
  const targetMemberId = cleanText(body.targetMemberId, 128);
  if (body.action === "block") {
    if (!targetMemberId || targetMemberId === memberId) return { error: ["Choose another member", 400] };
    const targetRows = await db.sql`SELECT member_id FROM halo_memberships WHERE member_id = ${targetMemberId} LIMIT 1`;
    if (!targetRows.length) return { error: ["Member not found", 404] };
    await db.sql`
      INSERT INTO halo_signal_blocks (member_id, target_member_id)
      VALUES (${memberId}, ${targetMemberId}) ON CONFLICT DO NOTHING
    `;
    await db.sql`
      UPDATE halo_signal_requests SET status = 'archived', updated_at = NOW()
      WHERE status = 'pending' AND ((sender_member_id = ${memberId} AND recipient_member_id = ${targetMemberId})
        OR (sender_member_id = ${targetMemberId} AND recipient_member_id = ${memberId}))
    `;
    return { blocked: true };
  }
  if (body.action === "unblock") {
    await db.sql`DELETE FROM halo_signal_blocks WHERE member_id = ${memberId} AND target_member_id = ${targetMemberId}`;
    return { blocked: false };
  }
  const reason = cleanText(body.reason, 800);
  const requestId = cleanUuid(body.requestId) || null;
  const messageId = cleanUuid(body.messageId) || null;
  if (reason.length < 3 || (!targetMemberId && !requestId && !messageId)) return { error: ["Add a short reason for the review team", 400] };
  if (targetMemberId) {
    const targetRows = await db.sql`SELECT member_id FROM halo_memberships WHERE member_id = ${targetMemberId} LIMIT 1`;
    if (!targetRows.length) return { error: ["Member not found", 404] };
  }
  await db.sql`
    INSERT INTO halo_signal_reports (reporter_member_id, target_member_id, request_id, message_id, reason)
    VALUES (${memberId}, ${targetMemberId || null}, ${requestId}, ${messageId}, ${reason})
  `;
  return { reported: true };
}

export default async function signalNetworkHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Sign in to open Signal Network" }, 401);
    const membership = await ensureMembership(db, user);
    const memberId = membership.member_id;
    const url = new URL(request.url);

    if (request.method === "GET") {
      const view = url.searchParams.get("view") || "dashboard";
      if (view === "discover") return json({ collaborators: await discover(db, memberId, url) });
      if (view === "messages") {
        const conversationId = cleanUuid(url.searchParams.get("conversation"));
        const result = await loadMessages(db, memberId, conversationId);
        return result ? json(result) : json({ message: "Conversation not found" }, 404);
      }
      return json({ dashboard: await loadDashboard(db, memberId) });
    }

    if (!(await verifyRequestOrigin(request))) return json({ message: "Cross-origin Signal Network actions are not accepted" }, 403);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ message: "Signal Network request is too large" }, 413);
    const body = await request.json().catch(() => null);
    if (!body) return json({ message: "Request body must be valid JSON" }, 400);

    let result;
    if (body.action === "profile") result = { profile: await saveProfile(db, memberId, body) };
    else if (body.action === "signal") result = await sendSignal(db, memberId, body);
    else if (body.action === "respond_signal") result = await respondToSignal(db, memberId, body);
    else if (body.action === "message") result = await sendMessage(db, memberId, body);
    else if (body.action === "mark_read") {
      const conversationId = cleanUuid(body.conversationId);
      await db.sql`
        UPDATE halo_signal_messages message SET read_at = NOW()
        FROM halo_signal_conversations conversation
        WHERE message.conversation_id = conversation.id AND conversation.id = ${conversationId}
          AND (conversation.member_a_id = ${memberId} OR conversation.member_b_id = ${memberId})
          AND message.sender_member_id <> ${memberId} AND message.read_at IS NULL
      `;
      result = { read: true };
    } else if (["block", "unblock", "report"].includes(body.action)) result = await handleSafetyAction(db, memberId, body);
    else return json({ message: "Choose a supported Signal Network action" }, 400);

    if (result?.error) return json({ message: result.error[0] }, result.error[1]);
    return json({ ...result, dashboard: await loadDashboard(db, memberId) });
  } catch (error) {
    console.error("Signal Network request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Signal Network is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/signal-network" };
