import { randomUUID } from "node:crypto";
import { appendLedgerEntry } from "./halo-ledger.mjs";
import { DEFAULT_RELEASE_ARTWORK } from "./release-artwork.mjs";

// Track drops tell opted-in HALO members when a new track enters the shop.
// Everything rendered here is public-safe: title, artist, artwork, and public shop links only.
export const TRACK_DROP_SHOP_PATH = "/music/";
export const TRACK_DROP_PREFERENCES_PATH = "/track-drops/";
export const TRACK_DROP_EMAIL_TEMPLATE = "halo-track-drop";
export const TRACK_DROP_EMAIL_BATCH_SIZE = 50;
export const TRACK_DROP_EMAIL_MAX_AGE_DAYS = 7;
export const TRACK_DROP_MAX_ATTEMPTS = 3;

export const TRACK_DROP_COPY = Object.freeze({
  eyebrow: "New on HALO",
  headline: "A new release is ready",
  cta: "View on HALO",
  fallback: "Browse the HALO shop",
  manage: "Manage track drop alerts"
});

export const MEMBER_REWARDS = Object.freeze({
  optIn: Object.freeze({ key: "track-drops-opt-in", points: 50, reason: "Joined HALO track drops" }),
  openDrop: Object.freeze({ keyPrefix: "track-drop-open:", points: 10, reason: "Opened a new track drop" })
});

export const REWARD_TIERS = Object.freeze([
  Object.freeze({ id: "listener", label: "Listener", minPoints: 0 }),
  Object.freeze({ id: "insider", label: "Insider", minPoints: 100 }),
  Object.freeze({ id: "inner_circle", label: "Inner Circle", minPoints: 300 }),
  Object.freeze({ id: "halo_vip", label: "HALO VIP", minPoints: 750 })
]);

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,119}$/i;
const SAFE_ASSET_PATH = /^\/assets\/[a-z0-9._/-]+$/i;
const SAFE_ARTWORK_ENDPOINT = /^\/api\/song-catalog\/artwork\?songId=[0-9a-f-]{36}(?:&versionId=[0-9a-f-]{36})?$/i;
const BLOCKED_ARTWORK_HOSTS = /(^|\.)(drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com|localhost)$/i;

function readEnvironment(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || "";
}

/** Strips control characters and markup delimiters so payloads stay plain text. */
export function safeTrackDropText(value, maxLength = 160) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function safeTrackDropId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return SAFE_ID_PATTERN.test(id) ? id : "";
}

/** Public shop route for a release; anything unexpected falls back to the shop itself. */
export function trackDropPublicPath(releaseId) {
  const id = safeTrackDropId(releaseId);
  return id ? `${TRACK_DROP_SHOP_PATH}?song=${encodeURIComponent(id)}` : TRACK_DROP_SHOP_PATH;
}

/** Only public HTTPS artwork or HALO-hosted public artwork is shown; everything else uses the HALO placeholder. */
export function safeTrackDropArtwork(value) {
  const artwork = typeof value === "string" ? value.trim() : "";
  if (!artwork || artwork.length > 1200) return DEFAULT_RELEASE_ARTWORK;
  if (artwork.startsWith("/") && !artwork.startsWith("//")) {
    if (artwork.includes("..")) return DEFAULT_RELEASE_ARTWORK;
    return SAFE_ASSET_PATH.test(artwork) || SAFE_ARTWORK_ENDPOINT.test(artwork) ? artwork : DEFAULT_RELEASE_ARTWORK;
  }
  try {
    const url = new URL(artwork);
    if (url.protocol !== "https:" || url.username || url.password || BLOCKED_ARTWORK_HOSTS.test(url.hostname)) {
      return DEFAULT_RELEASE_ARTWORK;
    }
    return url.toString();
  } catch {
    return DEFAULT_RELEASE_ARTWORK;
  }
}

/** Builds an absolute same-origin HTTPS URL on the HALO site; external or unusable URLs return "". */
export function absoluteSiteUrl(path, siteUrl) {
  try {
    const base = new URL(String(siteUrl || "").trim());
    if (base.protocol !== "https:" || base.username || base.password) return "";
    const url = new URL(path, base.origin);
    return url.origin === base.origin ? url.toString() : "";
  } catch {
    return "";
  }
}

/** Member rewards summary. Only the member's own points, tier and next milestone are returned. */
export function rewardProgress(points, enabled = true) {
  const total = Math.max(0, Math.floor(Number(points) || 0));
  if (!enabled) {
    return { enabled: false, points: 0, tier: null, nextTier: null, message: "Turn on member rewards to collect points for new track drops." };
  }
  let tier = REWARD_TIERS[0];
  for (const candidate of REWARD_TIERS) if (total >= candidate.minPoints) tier = candidate;
  const next = REWARD_TIERS.find(candidate => candidate.minPoints > total) || null;
  return {
    enabled: true,
    points: total,
    tier: { id: tier.id, label: tier.label },
    nextTier: next ? { id: next.id, label: next.label, pointsToGo: next.minPoints - total } : null,
    message: next
      ? `You're ${next.minPoints - total} points from ${next.label}.`
      : `You've reached ${tier.label}. Thank you for being part of HALO.`
  };
}

/** Normalises a stored drop into the public-safe card shared by the in-app inbox and email. */
export function trackDropCard(drop, { unread = false } = {}) {
  const title = safeTrackDropText(drop?.title, 160) || "New HALO release";
  const artist = safeTrackDropText(drop?.artist, 120) || "HALO artist";
  const createdAt = new Date(drop?.created_at || drop?.createdAt || Date.now());
  return {
    id: safeTrackDropId(drop?.id) || "",
    type: "track_drop",
    eyebrow: TRACK_DROP_COPY.eyebrow,
    headline: TRACK_DROP_COPY.headline,
    title,
    artist,
    artworkUrl: safeTrackDropArtwork(drop?.artwork_url ?? drop?.artworkUrl),
    artworkAlt: `Artwork for ${title} by ${artist}`,
    ctaLabel: TRACK_DROP_COPY.cta,
    ctaUrl: trackDropPublicPath(drop?.release_id ?? drop?.releaseId),
    fallbackLabel: TRACK_DROP_COPY.fallback,
    fallbackUrl: TRACK_DROP_SHOP_PATH,
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date(0).toISOString() : createdAt.toISOString(),
    unread: Boolean(unread)
  };
}

/** Netlify Email Integration parameters for the Dreamweaver-style track drop card. */
export function trackDropEmailParameters(drop, { siteUrl, recipientName = "", rewards = null } = {}) {
  const card = trackDropCard(drop);
  // Only artwork may be external, and only after passing safeTrackDropArtwork; every link stays on HALO.
  const artwork = card.artworkUrl.startsWith("https://")
    ? card.artworkUrl
    : absoluteSiteUrl(card.artworkUrl, siteUrl) || absoluteSiteUrl(DEFAULT_RELEASE_ARTWORK, siteUrl);
  const rewardsSummary = rewards?.enabled ? rewards : null;
  return {
    eyebrow: card.eyebrow,
    headline: card.headline,
    greeting: safeTrackDropText(recipientName, 64) ? `Hi ${safeTrackDropText(recipientName, 64)},` : "Hi,",
    trackTitle: card.title,
    artistName: card.artist,
    artworkUrl: artwork,
    artworkAlt: card.artworkAlt,
    ctaLabel: card.ctaLabel,
    ctaUrl: absoluteSiteUrl(card.ctaUrl, siteUrl),
    fallbackLabel: card.fallbackLabel,
    fallbackUrl: absoluteSiteUrl(card.fallbackUrl, siteUrl),
    manageLabel: TRACK_DROP_COPY.manage,
    manageUrl: absoluteSiteUrl(TRACK_DROP_PREFERENCES_PATH, siteUrl),
    showRewards: Boolean(rewardsSummary),
    rewardTier: rewardsSummary?.tier?.label || "",
    rewardPoints: rewardsSummary ? rewardsSummary.points : 0,
    rewardMessage: rewardsSummary ? `${rewardsSummary.message} Open this drop on HALO to collect ${MEMBER_REWARDS.openDrop.points} points.` : ""
  };
}

export function trackDropEmailSubject(drop) {
  const card = trackDropCard(drop);
  return `New on HALO: ${card.title} by ${card.artist}`.slice(0, 200);
}

/**
 * Records the shop entry for a newly published song (once per song) and queues email cards
 * for members who opted in with email consent. The publisher never receives their own drop.
 */
export async function announceTrackDrop(db, { song, release, actorId = "system", actorType = "system" } = {}) {
  const songId = typeof song?.id === "string" ? song.id : "";
  const releaseId = typeof release?.id === "string" ? release.id.trim().slice(0, 120) : "";
  if (!songId || !releaseId) return { announced: false, reason: "missing_release" };
  const title = safeTrackDropText(song.title, 160);
  if (!title) return { announced: false, reason: "missing_title" };
  const artist = safeTrackDropText(song.artist_name, 120) || "HALO artist";
  const artworkUrl = safeTrackDropArtwork(release.artworkUrl || song.artwork_url);
  const publicPath = trackDropPublicPath(releaseId);

  const rows = await db.sql`
    INSERT INTO halo_track_drop_events (id, song_id, release_id, owner_member_id, title, artist, artwork_url, public_path)
    VALUES (${randomUUID()}, ${songId}, ${releaseId}, ${song.owner_member_id || null}, ${title}, ${artist}, ${artworkUrl}, ${publicPath})
    ON CONFLICT (song_id) DO NOTHING
    RETURNING id
  `;
  const dropId = rows[0]?.id;
  if (!dropId) return { announced: false, reason: "already_announced" };

  const queued = await db.sql`
    INSERT INTO halo_track_drop_deliveries (drop_id, member_id, channel)
    SELECT ${dropId}, preference.member_id, 'email'
    FROM halo_member_notification_preferences preference
    JOIN halo_memberships membership ON membership.member_id = preference.member_id
    WHERE preference.track_drops_email = TRUE
      AND preference.email_consent_at IS NOT NULL
      AND membership.email <> ''
      AND preference.member_id IS DISTINCT FROM ${song.owner_member_id || null}
    ON CONFLICT (drop_id, member_id, channel) DO NOTHING
    RETURNING member_id
  `;

  await appendLedgerEntry(db, {
    actorId,
    actorType,
    eventCategory: "system_event",
    refSongId: songId,
    refReleaseId: releaseId,
    summary: `Track drop announced for "${title}"`,
    details: { dropId, emailCardsQueued: queued.length },
    pipelineStage: "published",
    outcome: "success"
  });
  return { announced: true, dropId, emailCardsQueued: queued.length };
}

export async function loadMemberRewards(db, memberId, enabled) {
  if (!enabled) return rewardProgress(0, false);
  const rows = await db.sql`
    SELECT COALESCE(SUM(points), 0)::int AS points,
      COALESCE(SUM(points) FILTER (WHERE reward_key = 'track-drops-opt-in'), 0)::int AS opt_in_points,
      COALESCE(SUM(points) FILTER (WHERE reward_key LIKE 'track-drop-open:%'), 0)::int AS open_drop_points
    FROM halo_member_reward_events
    WHERE member_id = ${memberId}
  `;
  const points = Number(rows[0]?.points || 0);
  const optIn = Number(rows[0]?.opt_in_points || 0);
  const opened = Number(rows[0]?.open_drop_points || 0);
  const summary = rewardProgress(points, true);
  const next = REWARD_TIERS.find(tier => tier.minPoints > points);
  return {
    ...summary,
    breakdown: [
      { label: "Track drop opt-in", points: optIn },
      { label: "Opened track drops", points: opened },
      { label: "Other member rewards", points: points - optIn - opened }
    ],
    progress: next ? { value: points, max: next.minPoints, label: next.label } : null
  };
}

/** Grants a reward once per member and key; returns true only when new points were added. */
export async function grantMemberReward(db, memberId, { key, points, reason }) {
  const rows = await db.sql`
    INSERT INTO halo_member_reward_events (member_id, reward_key, points, reason)
    VALUES (${memberId}, ${key}, ${points}, ${reason})
    ON CONFLICT (member_id, reward_key) DO NOTHING
    RETURNING reward_key
  `;
  return rows.length > 0;
}

function emailSettings() {
  return {
    secret: String(readEnvironment("NETLIFY_EMAILS_SECRET")).trim(),
    siteUrl: String(readEnvironment("URL")).trim().replace(/\/$/, ""),
    from: String(readEnvironment("HALO_TRACK_DROP_FROM_EMAIL")).trim()
  };
}

/**
 * Sends queued track drop cards through the Netlify Email Integration. Stale cards always expire;
 * queued cards are only claimed and sent when the integration and sender are configured.
 * Rows are claimed atomically so overlapping runs never email the same member twice.
 */
export async function dispatchTrackDropEmails(db, {
  settings = emailSettings(),
  send = fetch,
  limit = TRACK_DROP_EMAIL_BATCH_SIZE
} = {}) {
  // Abandoned claims count as an attempt so a send that keeps crashing cannot retry forever.
  await db.sql`
    UPDATE halo_track_drop_deliveries
    SET attempts = attempts + 1,
      status = CASE WHEN attempts + 1 >= ${TRACK_DROP_MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
      last_error = 'claim_abandoned'
    WHERE status = 'sending' AND claimed_at < NOW() - INTERVAL '30 minutes'
  `;
  await db.sql`
    UPDATE halo_track_drop_deliveries
    SET status = 'skipped', last_error = 'expired'
    WHERE status = 'queued' AND created_at < NOW() - (${TRACK_DROP_EMAIL_MAX_AGE_DAYS} * INTERVAL '1 day')
  `;
  const endpoint = absoluteSiteUrl(`/.netlify/functions/emails/${TRACK_DROP_EMAIL_TEMPLATE}`, settings.siteUrl);
  if (!settings.secret || !settings.from || !endpoint) return { configured: false, sent: 0, failed: 0 };

  const rows = await db.sql`
    WITH claimed AS (
      UPDATE halo_track_drop_deliveries delivery
      SET status = 'sending', claimed_at = NOW()
      WHERE (delivery.drop_id, delivery.member_id, delivery.channel) IN (
        SELECT queued.drop_id, queued.member_id, queued.channel
        FROM halo_track_drop_deliveries queued
        JOIN halo_member_notification_preferences consent ON consent.member_id = queued.member_id
        WHERE queued.status = 'queued' AND queued.channel = 'email'
          AND consent.track_drops_email = TRUE AND consent.email_consent_at IS NOT NULL
        ORDER BY queued.created_at ASC
        LIMIT ${limit}
        FOR UPDATE OF queued SKIP LOCKED
      )
      RETURNING delivery.drop_id, delivery.member_id, delivery.attempts
    )
    SELECT claimed.drop_id, claimed.member_id, claimed.attempts,
      track_drop.id, track_drop.release_id, track_drop.title, track_drop.artist, track_drop.artwork_url, track_drop.created_at,
      membership.email, membership.display_name,
      COALESCE(preference.rewards_enabled, FALSE) AS rewards_enabled,
      reward_totals.points AS reward_points
    FROM claimed
    JOIN halo_track_drop_events track_drop ON track_drop.id = claimed.drop_id
    LEFT JOIN halo_memberships membership ON membership.member_id = claimed.member_id
    LEFT JOIN halo_member_notification_preferences preference ON preference.member_id = claimed.member_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(points), 0)::int AS points
      FROM halo_member_reward_events reward
      WHERE reward.member_id = claimed.member_id
    ) reward_totals ON TRUE
  `;
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row.email) {
      await db.sql`UPDATE halo_track_drop_deliveries SET status = 'skipped', last_error = 'no_email' WHERE drop_id = ${row.drop_id} AND member_id = ${row.member_id} AND channel = 'email' AND status = 'sending'`;
      continue;
    }
    const rewards = rewardProgress(row.reward_points, Boolean(row.rewards_enabled));
    let ok = false;
    try {
      const response = await send(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "netlify-emails-secret": settings.secret },
        body: JSON.stringify({
          from: settings.from,
          to: row.email,
          subject: trackDropEmailSubject(row),
          parameters: trackDropEmailParameters(row, { siteUrl: settings.siteUrl, recipientName: row.display_name, rewards })
        }),
        signal: AbortSignal.timeout(8000)
      });
      ok = Boolean(response?.ok);
    } catch {
      ok = false;
    }
    if (ok) {
      sent++;
      await db.sql`UPDATE halo_track_drop_deliveries SET status = 'sent', attempts = attempts + 1, last_error = '', sent_at = NOW() WHERE drop_id = ${row.drop_id} AND member_id = ${row.member_id} AND channel = 'email' AND status = 'sending'`;
    } else {
      failed++;
      const exhausted = Number(row.attempts || 0) + 1 >= TRACK_DROP_MAX_ATTEMPTS;
      await db.sql`UPDATE halo_track_drop_deliveries SET status = ${exhausted ? "failed" : "queued"}, attempts = attempts + 1, last_error = 'delivery_failed' WHERE drop_id = ${row.drop_id} AND member_id = ${row.member_id} AND channel = 'email' AND status = 'sending'`;
    }
  }
  return { configured: true, sent, failed };
}
