import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { createHash } from "node:crypto";
import { ensureMembership as ensureHaloMembership } from "../lib/halo-x.mjs";

const allowedActions = new Set(["profile", "message", "follow", "reaction", "support", "control", "report", "room_post", "room_vote"]);
const allowedVisibility = new Set(["private", "circle", "community", "public"]);
const allowedPersonaTypes = new Set(["", "listener", "creator", "dj", "collector", "advocate", "wanderer", "oracle", "architect"]);
const allowedEmojis = new Set(["✨", "💜", "🔥", "🌊"]);
const allowedGifts = new Set(["comet", "butterfly", "vinyl", "rose", "sunrise", "crowd-wave"]);
const allowedControls = new Set(["block", "mute"]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanActorId(value) {
  const actorId = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9_-]{8,64}$/.test(actorId) ? actorId : "";
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

export function cleanOptionalRecordId(value) {
  if (value === null || value === undefined || value === "") return null;
  const recordId = Number(value);
  return Number.isSafeInteger(recordId) && recordId > 0 ? recordId : null;
}

function cleanYouTubeUrl(value) {
  const raw = cleanText(value, 500);
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (!["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function defaultName(actorId) {
  return `Fan ${actorId.slice(-4).toUpperCase()}`;
}

function identityActorId(userId) {
  return `member-${createHash("sha256").update(String(userId)).digest("hex").slice(0, 32)}`;
}

function identityDisplayName(user, actorId) {
  const preferred = cleanText(user?.name || user?.userMetadata?.full_name, 32);
  return preferred.length >= 2 ? preferred : defaultName(actorId);
}

async function ensureProfile(db, actorId, displayName = defaultName(actorId)) {
  await db.sql`
    INSERT INTO community_profiles (actor_id, display_name)
    VALUES (${actorId}, ${displayName})
    ON CONFLICT (actor_id) DO UPDATE SET last_seen_at = NOW()
  `;
}

async function getCommunity(db, actorId = null) {
  const viewerActorId = actorId || "__public__";
  if (actorId) await ensureProfile(db, actorId);

  const [profileRows, peopleRows, messageRows, followRows, controlRows, supportRows, roomRows, notificationRows, pinRows] = await Promise.all([
    db.sql`
      SELECT p.actor_id, p.display_name, p.avatar, p.region, p.favorite_genres, p.vibe_status,
        p.persona_name, p.persona_type, p.persona_bio, p.visibility_level,
        CASE WHEN EXISTS (
          SELECT 1 FROM sovereign_ambassador_grants g WHERE g.actor_id = p.actor_id AND g.is_active = TRUE
        ) THEN 'Sovereign Ambassador' ELSE p.badge END AS badge,
        EXISTS (
          SELECT 1 FROM sovereign_ambassador_grants g WHERE g.actor_id = p.actor_id AND g.is_active = TRUE
        ) AS is_sovereign_ambassador,
        p.is_host, p.last_seen_at >= NOW() - INTERVAL '15 minutes' AS is_online
      FROM community_profiles p WHERE p.actor_id = ${viewerActorId}
    `,
    db.sql`
      SELECT p.actor_id, p.display_name, p.avatar, p.region, p.favorite_genres, p.vibe_status,
        CASE WHEN EXISTS (
          SELECT 1 FROM sovereign_ambassador_grants g WHERE g.actor_id = p.actor_id AND g.is_active = TRUE
        ) THEN 'Sovereign Ambassador' ELSE p.badge END AS badge,
        EXISTS (
          SELECT 1 FROM sovereign_ambassador_grants g WHERE g.actor_id = p.actor_id AND g.is_active = TRUE
        ) AS is_sovereign_ambassador,
        p.is_host,
        p.last_seen_at >= NOW() - INTERVAL '15 minutes' AS is_online,
        COUNT(DISTINCT f.follower_id)::int AS follower_count,
        COUNT(DISTINCT s.id) FILTER (WHERE s.kind = 'light')::int AS light_count,
        COUNT(DISTINCT s.id) FILTER (WHERE s.kind = 'boost')::int AS boost_count
      FROM community_profiles p
      LEFT JOIN community_follows f ON f.followed_id = p.actor_id
      LEFT JOIN community_support s ON s.recipient_id = p.actor_id
      WHERE p.actor_id <> ${viewerActorId}
        AND NOT EXISTS (
          SELECT 1 FROM community_relationship_controls c
          WHERE c.actor_id = ${viewerActorId} AND c.target_id = p.actor_id AND c.kind IN ('block', 'mute')
        )
      GROUP BY p.actor_id
      ORDER BY p.is_host DESC, is_online DESC, light_count DESC, follower_count DESC, p.display_name ASC
      LIMIT 12
    `,
    db.sql`
      SELECT m.id, m.actor_id, p.display_name, p.avatar,
        CASE WHEN EXISTS (
          SELECT 1 FROM sovereign_ambassador_grants g WHERE g.actor_id = p.actor_id AND g.is_active = TRUE
        ) THEN 'Sovereign Ambassador' ELSE p.badge END AS badge,
        EXISTS (
          SELECT 1 FROM sovereign_ambassador_grants g WHERE g.actor_id = p.actor_id AND g.is_active = TRUE
        ) AS is_sovereign_ambassador,
        p.is_host, m.body, m.reply_to,
        m.is_spotlighted, m.created_at,
        COALESCE(jsonb_object_agg(r.emoji, r.total) FILTER (WHERE r.emoji IS NOT NULL), '{}'::jsonb) AS reactions
      FROM community_messages m
      JOIN community_profiles p ON p.actor_id = m.actor_id
      LEFT JOIN (
        SELECT message_id, emoji, COUNT(*)::int AS total
        FROM community_reactions GROUP BY message_id, emoji
      ) r ON r.message_id = m.id
      WHERE NOT EXISTS (
        SELECT 1 FROM community_relationship_controls c
          WHERE c.actor_id = ${viewerActorId} AND c.target_id = m.actor_id AND c.kind IN ('block', 'mute')
      )
      GROUP BY m.id, p.actor_id
      ORDER BY m.created_at DESC
      LIMIT 40
    `,
    db.sql`SELECT followed_id FROM community_follows WHERE follower_id = ${viewerActorId}`,
    db.sql`SELECT target_id, kind FROM community_relationship_controls WHERE actor_id = ${viewerActorId}`,
    db.sql`
      SELECT kind, COUNT(*)::int AS total
      FROM community_support
      WHERE actor_id = ${viewerActorId} AND created_at >= date_trunc('day', NOW())
      GROUP BY kind
    `,
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE kind = 'light' AND created_at >= NOW() - INTERVAL '7 days')::int AS lights,
        COUNT(*) FILTER (WHERE kind = 'gift' AND created_at >= NOW() - INTERVAL '7 days')::int AS gifts,
        COUNT(*) FILTER (WHERE kind = 'boost' AND created_at >= NOW() - INTERVAL '7 days')::int AS boosts
      FROM community_support
    `,
    db.sql`
      SELECT id, kind, body, created_at
      FROM community_notifications
      WHERE recipient_id = ${viewerActorId}
      ORDER BY created_at DESC
      LIMIT 8
    `,
    db.sql`
      SELECT r.actor_id, p.display_name, p.avatar,
        CASE WHEN EXISTS (
          SELECT 1 FROM sovereign_ambassador_grants g WHERE g.actor_id = p.actor_id AND g.is_active = TRUE
        ) THEN 'Sovereign Ambassador' ELSE p.badge END AS badge,
        EXISTS (
          SELECT 1 FROM sovereign_ambassador_grants g WHERE g.actor_id = p.actor_id AND g.is_active = TRUE
        ) AS is_sovereign_ambassador,
        r.title, r.body,
        r.destination_url, r.cta_label, r.updated_at
      FROM halo_room_pins r
      JOIN community_profiles p ON p.actor_id = r.actor_id
      WHERE NOT EXISTS (
        SELECT 1 FROM community_relationship_controls c
        WHERE c.actor_id = ${viewerActorId} AND c.target_id = r.actor_id AND c.kind IN ('block', 'mute')
      )
      ORDER BY r.updated_at DESC
      LIMIT 8
    `
  ]);

  const daily = Object.fromEntries(supportRows.map(row => [row.kind, Number(row.total)]));
  const room = roomRows[0] || {};
  const goalPoints = Number(room.lights || 0) + Number(room.gifts || 0) + Number(room.boosts || 0);
  const mediaRows = await db.sql`
    SELECT post.id, post.actor_id, profile.display_name, profile.avatar, post.title, post.description,
      post.video_url, post.created_at,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', option.id,
        'label', option.label,
        'position', option.position,
        'votes', COALESCE(vote_totals.total, 0),
        'selected', viewer_vote.actor_id IS NOT NULL
      ) ORDER BY option.position) FILTER (WHERE option.id IS NOT NULL), '[]'::jsonb) AS options
    FROM community_room_posts post
    JOIN community_profiles profile ON profile.actor_id = post.actor_id
    LEFT JOIN community_room_poll_options option ON option.post_id = post.id
    LEFT JOIN (
      SELECT option_id, COUNT(*)::int AS total FROM community_room_votes GROUP BY option_id
    ) vote_totals ON vote_totals.option_id = option.id
    LEFT JOIN community_room_votes viewer_vote
      ON viewer_vote.post_id = post.id AND viewer_vote.option_id = option.id AND viewer_vote.actor_id = ${viewerActorId}
    WHERE NOT EXISTS (
      SELECT 1 FROM community_relationship_controls control
      WHERE control.actor_id = ${viewerActorId} AND control.target_id = post.actor_id AND control.kind IN ('block', 'mute')
    )
    GROUP BY post.id, profile.actor_id
    ORDER BY post.created_at DESC
    LIMIT 8
  `;

  return {
    authenticated: Boolean(actorId),
    profile: profileRows[0] || null,
    people: peopleRows,
    messages: [...messageRows].reverse(),
    following: followRows.map(row => row.followed_id),
    controls: controlRows,
    allowances: {
      boost: Math.max(0, 1 - (daily.boost || 0)),
      light: Math.max(0, 1 - (daily.light || 0)),
      gifts: Math.max(0, 10 - (daily.gift || 0))
    },
    roomGoal: {
      points: goalPoints,
      target: 24,
      unlocked: goalPoints >= 24,
      reward: "Aftershow preview + host Q&A"
    },
    notifications: notificationRows,
    roomPins: pinRows.map(row => ({ ...row, is_owner: row.actor_id === actorId })),
    roomMedia: mediaRows.map(row => ({ ...row, is_owner: row.actor_id === actorId }))
  };
}

async function handleAction(db, actorId, payload) {
  const action = cleanText(payload.action, 32);
  if (!allowedActions.has(action)) return json({ message: "Unknown community action" }, 400);
  await ensureProfile(db, actorId);

  if (action === "profile") {
    const displayName = cleanText(payload.displayName, 32);
    const avatar = cleanText(payload.avatar, 4);
    const region = cleanText(payload.region, 48);
    const vibeStatus = cleanText(payload.vibeStatus, 80);
    const personaName = cleanText(payload.personaName, 48);
    const personaType = allowedPersonaTypes.has(cleanText(payload.personaType, 24)) ? cleanText(payload.personaType, 24) : "";
    const personaBio = cleanText(payload.personaBio, 280);
    const visibilityLevel = allowedVisibility.has(cleanText(payload.visibilityLevel, 16)) ? cleanText(payload.visibilityLevel, 16) : "community";
    const favoriteGenres = Array.isArray(payload.favoriteGenres)
      ? payload.favoriteGenres.map(value => cleanText(value, 24)).filter(Boolean).slice(0, 4)
      : [];
    if (displayName.length < 2) return json({ message: "Display name must be at least 2 characters" }, 400);
    await db.sql`
      UPDATE community_profiles SET
        display_name = ${displayName}, avatar = ${avatar || "🌙"}, region = ${region || "Global"},
        favorite_genres = ${favoriteGenres}, vibe_status = ${vibeStatus || "Finding the frequency"},
        persona_name = ${personaName}, persona_type = ${personaType},
        persona_bio = ${personaBio}, visibility_level = ${visibilityLevel},
        updated_at = NOW(), last_seen_at = NOW()
      WHERE actor_id = ${actorId}
    `;
  }

  if (action === "message") {
    const body = cleanText(payload.body, 320);
    const replyTo = cleanOptionalRecordId(payload.replyTo);
    if (!body) return json({ message: "Write something before sending" }, 400);
    const recentRows = await db.sql`
      SELECT COUNT(*)::int AS total FROM community_messages
      WHERE actor_id = ${actorId} AND created_at >= NOW() - INTERVAL '20 seconds'
    `;
    if (Number(recentRows[0]?.total || 0) >= 4) return json({ message: "Slow mode is active. Take a breath before posting again." }, 429);
    await db.sql`INSERT INTO community_messages (actor_id, body, reply_to) VALUES (${actorId}, ${body}, ${replyTo})`;
    const senderRows = await db.sql`SELECT display_name FROM community_profiles WHERE actor_id = ${actorId}`;
    await db.sql`
      INSERT INTO community_notifications (recipient_id, actor_id, kind, body)
      SELECT p.actor_id, ${actorId}, 'mention', ${`${senderRows[0]?.display_name || "A fan"} mentioned you in the room.`}
      FROM community_profiles p
      WHERE p.actor_id <> ${actorId}
        AND ${body} ILIKE ('%@' || replace(p.display_name, ' ', '') || '%')
    `;
  }

  if (action === "room_post") {
    const title = cleanText(payload.title, 100);
    const description = cleanText(payload.description, 500);
    const videoUrl = cleanYouTubeUrl(payload.videoUrl);
    const options = Array.isArray(payload.options)
      ? [...new Set(payload.options.map(value => cleanText(value, 80)).filter(Boolean))].slice(0, 6)
      : [];
    if (title.length < 2) return json({ message: "Add a title for the room video" }, 400);
    if (!videoUrl) return json({ message: "Use a valid YouTube video or playlist link" }, 400);
    if (options.length === 1) return json({ message: "Add at least two choices for a vote" }, 400);
    const postRows = await db.sql`
      INSERT INTO community_room_posts (actor_id, title, description, video_url)
      VALUES (${actorId}, ${title}, ${description}, ${videoUrl})
      RETURNING id
    `;
    for (const [index, label] of options.entries()) {
      await db.sql`
        INSERT INTO community_room_poll_options (post_id, label, position)
        VALUES (${postRows[0].id}, ${label}, ${index + 1})
      `;
    }
  }

  if (action === "room_vote") {
    const postId = Number(payload.postId);
    const optionId = Number(payload.optionId);
    if (!Number.isSafeInteger(postId) || !Number.isSafeInteger(optionId)) return json({ message: "Choose a valid song option" }, 400);
    const optionRows = await db.sql`
      SELECT id FROM community_room_poll_options WHERE id = ${optionId} AND post_id = ${postId}
    `;
    if (!optionRows.length) return json({ message: "That song option is no longer available" }, 404);
    await db.sql`
      INSERT INTO community_room_votes (post_id, option_id, actor_id)
      VALUES (${postId}, ${optionId}, ${actorId})
      ON CONFLICT (post_id, actor_id) DO UPDATE SET option_id = EXCLUDED.option_id, created_at = NOW()
    `;
  }

  if (action === "follow") {
    const targetId = cleanActorId(payload.targetId);
    if (!targetId || targetId === actorId) return json({ message: "Choose another community member" }, 400);
    if (payload.enabled === false) {
      await db.sql`DELETE FROM community_follows WHERE follower_id = ${actorId} AND followed_id = ${targetId}`;
    } else {
      await db.sql`
        INSERT INTO community_follows (follower_id, followed_id) VALUES (${actorId}, ${targetId})
        ON CONFLICT DO NOTHING
      `;
      const actorRows = await db.sql`SELECT display_name FROM community_profiles WHERE actor_id = ${actorId}`;
      await db.sql`
        INSERT INTO community_notifications (recipient_id, actor_id, kind, body)
        VALUES (${targetId}, ${actorId}, 'follow', ${`${actorRows[0]?.display_name || "A fan"} followed your signal.`})
      `;
    }
  }

  if (action === "reaction") {
    const messageId = Number(payload.messageId);
    const emoji = cleanText(payload.emoji, 4);
    if (!Number.isInteger(messageId) || !allowedEmojis.has(emoji)) return json({ message: "Invalid reaction" }, 400);
    await db.sql`
      INSERT INTO community_reactions (message_id, actor_id, emoji) VALUES (${messageId}, ${actorId}, ${emoji})
      ON CONFLICT DO NOTHING
    `;
  }

  if (action === "support") {
    const targetId = cleanActorId(payload.targetId);
    const kind = cleanText(payload.kind, 16);
    const gift = kind === "gift" ? cleanText(payload.gift, 24) : null;
    if (!targetId || targetId === actorId || !["boost", "gift", "light"].includes(kind)) return json({ message: "Invalid support action" }, 400);
    if (kind === "gift" && !allowedGifts.has(gift)) return json({ message: "Choose a HALO gift" }, 400);
    const limit = kind === "gift" ? 10 : 1;
    const usedRows = await db.sql`
      SELECT COUNT(*)::int AS total FROM community_support
      WHERE actor_id = ${actorId} AND kind = ${kind} AND created_at >= date_trunc('day', NOW())
    `;
    if (Number(usedRows[0]?.total || 0) >= limit) return json({ message: kind === "gift" ? "Daily gift limit reached" : `Today’s ${kind} has already been passed` }, 429);
    await db.sql`
      INSERT INTO community_support (actor_id, recipient_id, kind, gift)
      VALUES (${actorId}, ${targetId}, ${kind}, ${gift})
    `;
    const actorRows = await db.sql`SELECT display_name FROM community_profiles WHERE actor_id = ${actorId}`;
    const notificationBody = kind === "gift"
      ? `${actorRows[0]?.display_name || "A fan"} sent you a ${gift}.`
      : `${actorRows[0]?.display_name || "A fan"} passed you a ${kind}.`;
    await db.sql`
      INSERT INTO community_notifications (recipient_id, actor_id, kind, body)
      VALUES (${targetId}, ${actorId}, ${kind}, ${notificationBody})
    `;
  }

  if (action === "control") {
    const targetId = cleanActorId(payload.targetId);
    const kind = cleanText(payload.kind, 16);
    if (!targetId || targetId === actorId || !allowedControls.has(kind)) return json({ message: "Invalid safety control" }, 400);
    if (payload.enabled === false) {
      await db.sql`DELETE FROM community_relationship_controls WHERE actor_id = ${actorId} AND target_id = ${targetId} AND kind = ${kind}`;
    } else {
      await db.sql`
        INSERT INTO community_relationship_controls (actor_id, target_id, kind) VALUES (${actorId}, ${targetId}, ${kind})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  if (action === "report") {
    const targetId = cleanActorId(payload.targetId) || null;
    const messageId = cleanOptionalRecordId(payload.messageId);
    const reason = cleanText(payload.reason, 240);
    if (reason.length < 3) return json({ message: "Add a short reason for the review team" }, 400);
    await db.sql`
      INSERT INTO community_reports (reporter_id, target_id, message_id, reason)
      VALUES (${actorId}, ${targetId}, ${messageId}, ${reason})
    `;
  }

  return json(await getCommunity(db, actorId));
}

export default async function handler(request) {
  try {
    const db = getDatabase();
    const user = await getUser();
    const actorId = user?.id ? identityActorId(user.id) : null;
    if (user?.id) await ensureHaloMembership(db, user);

    if (request.method === "GET") {
      if (actorId) await ensureProfile(db, actorId, identityDisplayName(user, actorId));
      return json(await getCommunity(db, actorId));
    }
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
    if (!actorId) return json({ message: "Join HALO to participate in the clubhouse" }, 401);

    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin community actions are not accepted" }, 403);
    }

    await ensureProfile(db, actorId, identityDisplayName(user, actorId));
    const payload = await request.json().catch(() => ({}));
    return handleAction(db, actorId, payload);
  } catch (error) {
    console.error("Community request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The clubhouse signal is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/community" };
