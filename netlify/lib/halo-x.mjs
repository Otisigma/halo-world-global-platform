import { createHash, randomBytes } from "node:crypto";

const ownerRoles = new Set(["admin", "owner", "halo-admin", "halo-owner"]);
const dailyReportRecipient = "owena44@gmail.com";

function readEnvironment(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || "";
}

export function actorIdFor(userId) {
  return `member-${createHash("sha256").update(String(userId)).digest("hex").slice(0, 32)}`;
}

export function hashPassCode(code) {
  return createHash("sha256").update(String(code).trim().toUpperCase()).digest("hex");
}

export function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

export function displayNameFor(user) {
  return cleanText(user?.name || user?.userMetadata?.full_name || user?.user_metadata?.full_name, 64) || "HALO member";
}

export function isOwner(user) {
  if (!user?.id) return false;
  const roles = user.appMetadata?.roles || user.app_metadata?.roles || [];
  if (Array.isArray(roles) && roles.some(role => ownerRoles.has(String(role).toLowerCase()))) return true;
  const configured = String(process.env.HALO_OWNER_EMAILS || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return configured.includes(String(user.email || "").trim().toLowerCase());
}

export async function ensureMembership(db, user) {
  const actorId = actorIdFor(user.id);
  const displayName = displayNameFor(user);
  const email = cleanText(user.email, 320).toLowerCase();
  const owner = isOwner(user);

  await db.sql`
    INSERT INTO community_profiles (actor_id, display_name, badge)
    VALUES (${actorId}, ${displayName}, ${owner ? "HALO Founder" : "Member"})
    ON CONFLICT (actor_id) DO UPDATE SET
      display_name = CASE
        WHEN community_profiles.display_name LIKE 'Fan %' THEN EXCLUDED.display_name
        ELSE community_profiles.display_name
      END,
      last_seen_at = NOW()
  `;

  const rows = await db.sql`
    INSERT INTO halo_memberships (member_id, actor_id, email, display_name, tier, source)
    VALUES (${user.id}, ${actorId}, ${email}, ${displayName}, ${owner ? "founder" : "member"}, ${owner ? "owner" : "membership"})
    ON CONFLICT (member_id) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      tier = CASE WHEN ${owner} THEN 'founder' ELSE halo_memberships.tier END,
      source = CASE WHEN ${owner} THEN 'owner' ELSE halo_memberships.source END,
      last_seen_at = NOW(),
      updated_at = NOW()
    RETURNING member_id, actor_id, display_name, tier, source, access_ends_at, joined_at, last_seen_at
  `;
  return rows[0];
}

export function membershipPayload(row) {
  const accessEndsAt = row.access_ends_at ? new Date(row.access_ends_at).toISOString() : null;
  const fullAccess = row.tier === "founder" || ((row.tier === "gold" || row.tier === "backstage") && (!accessEndsAt || new Date(accessEndsAt) > new Date()));
  return {
    displayName: row.display_name,
    tier: row.tier,
    source: row.source,
    fullAccess,
    accessEndsAt,
    joinedAt: new Date(row.joined_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString()
  };
}

export function generatePassCode(passType) {
  const prefix = {
    gold_ticket: "GOLD",
    backstage_pass: "BACKSTAGE",
    founders_key: "FOUNDER",
    event_pass: "EVENT"
  }[passType] || "ACCESS";
  const token = randomBytes(8).toString("hex").toUpperCase();
  return `HALO-${prefix}-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}`;
}

export async function generateDailyReport(db, reportDate = new Date()) {
  const date = reportDate.toISOString().slice(0, 10);
  const [membershipRows, activityRows, redemptionRows, pinRows, messageRows, supportRows, sessionRows, recentJoins, analyticsRows, artistProRows] = await Promise.all([
    db.sql`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE joined_at::date = ${date}::date)::int AS joined_today,
        COUNT(*) FILTER (WHERE tier = 'founder')::int AS founders,
        COUNT(*) FILTER (WHERE tier IN ('gold', 'backstage') AND (access_ends_at IS NULL OR access_ends_at > NOW()))::int AS active_passes
      FROM halo_memberships
    `,
    db.sql`
      SELECT COUNT(*) FILTER (WHERE last_seen_at >= NOW() - INTERVAL '24 hours')::int AS active_24h,
        COUNT(*) FILTER (WHERE last_seen_at >= NOW() - INTERVAL '15 minutes')::int AS online_now
      FROM halo_memberships
    `,
    db.sql`SELECT COUNT(*)::int AS total FROM halo_pass_redemptions WHERE redeemed_at::date = ${date}::date`,
    db.sql`SELECT COUNT(*)::int AS total FROM halo_room_pins WHERE updated_at::date = ${date}::date`,
    db.sql`SELECT COUNT(*)::int AS total FROM community_messages WHERE created_at::date = ${date}::date`,
    db.sql`SELECT COUNT(*)::int AS total FROM community_support WHERE created_at::date = ${date}::date`,
    db.sql`SELECT COUNT(*)::int AS total FROM halo_dj_sessions WHERE updated_at::date = ${date}::date`,
    db.sql`
      SELECT display_name, tier, source, joined_at
      FROM halo_memberships
      WHERE joined_at >= ${date}::date - INTERVAL '6 days'
      ORDER BY joined_at DESC
      LIMIT 12
    `,
    db.sql`
      SELECT COUNT(*)::int AS total_events,
        COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS page_views,
        COUNT(DISTINCT anonymous_id)::int AS unique_visitors,
        COUNT(DISTINCT session_id)::int AS sessions
      FROM analytics_events
      WHERE created_at::date = ${date}::date
    `,
    db.sql`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE created_at::date = ${date}::date)::int AS submitted_today,
        COUNT(*) FILTER (WHERE status = 'new')::int AS awaiting_review
      FROM halo_artist_pro_leads
    `
  ]);

  const metrics = {
    totalMembers: Number(membershipRows[0]?.total || 0),
    joinedToday: Number(membershipRows[0]?.joined_today || 0),
    founders: Number(membershipRows[0]?.founders || 0),
    activePasses: Number(membershipRows[0]?.active_passes || 0),
    active24h: Number(activityRows[0]?.active_24h || 0),
    onlineNow: Number(activityRows[0]?.online_now || 0),
    passesRedeemedToday: Number(redemptionRows[0]?.total || 0),
    roomPinsUpdatedToday: Number(pinRows[0]?.total || 0),
    roomMessagesToday: Number(messageRows[0]?.total || 0),
    supportSignalsToday: Number(supportRows[0]?.total || 0),
    djSessionsSavedToday: Number(sessionRows[0]?.total || 0),
    siteEventsToday: Number(analyticsRows[0]?.total_events || 0),
    pageViewsToday: Number(analyticsRows[0]?.page_views || 0),
    uniqueVisitorsToday: Number(analyticsRows[0]?.unique_visitors || 0),
    siteSessionsToday: Number(analyticsRows[0]?.sessions || 0),
    artistProLeads: Number(artistProRows[0]?.total || 0),
    artistProLeadsToday: Number(artistProRows[0]?.submitted_today || 0),
    artistProAwaitingReview: Number(artistProRows[0]?.awaiting_review || 0)
  };
  const joins = recentJoins.map(row => ({
    displayName: row.display_name,
    tier: row.tier,
    source: row.source,
    joinedAt: new Date(row.joined_at).toISOString()
  }));

  await db.sql`
    INSERT INTO halo_daily_reports (report_date, metrics, recent_joins, generated_at)
    VALUES (${date}::date, ${JSON.stringify(metrics)}::jsonb, ${JSON.stringify(joins)}::jsonb, NOW())
    ON CONFLICT (report_date) DO UPDATE SET
      metrics = EXCLUDED.metrics,
      recent_joins = EXCLUDED.recent_joins,
      generated_at = NOW()
  `;

  return { date, generatedAt: new Date().toISOString(), metrics, recentJoins: joins };
}

export async function sendReportWebhook(report) {
  const webhookUrl = String(readEnvironment("HALO_DAILY_REPORT_WEBHOOK_URL")).trim();
  if (!webhookUrl) return false;
  let url;
  try {
    url = new URL(webhookUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "halo_daily_report", report })
  });
  return response.ok;
}

export function dailyReportEmailParameters(report) {
  const metrics = report?.metrics || {};
  return {
    reportDate: cleanText(report?.date, 10),
    totalMembers: Number(metrics.totalMembers || 0),
    joinedToday: Number(metrics.joinedToday || 0),
    active24h: Number(metrics.active24h || 0),
    onlineNow: Number(metrics.onlineNow || 0),
    uniqueVisitorsToday: Number(metrics.uniqueVisitorsToday || 0),
    pageViewsToday: Number(metrics.pageViewsToday || 0),
    siteSessionsToday: Number(metrics.siteSessionsToday || 0),
    passesRedeemedToday: Number(metrics.passesRedeemedToday || 0),
    roomMessagesToday: Number(metrics.roomMessagesToday || 0),
    roomPinsUpdatedToday: Number(metrics.roomPinsUpdatedToday || 0),
    supportSignalsToday: Number(metrics.supportSignalsToday || 0),
    djSessionsSavedToday: Number(metrics.djSessionsSavedToday || 0),
    artistProLeadsToday: Number(metrics.artistProLeadsToday || 0),
    artistProAwaitingReview: Number(metrics.artistProAwaitingReview || 0)
  };
}

export async function sendReportEmail(report) {
  const secret = String(readEnvironment("NETLIFY_EMAILS_SECRET")).trim();
  const siteUrl = String(readEnvironment("URL")).trim().replace(/\/$/, "");
  const from = String(readEnvironment("HALO_DAILY_REPORT_FROM_EMAIL")).trim();
  if (!secret || !siteUrl || !from) return false;

  let endpoint;
  try {
    endpoint = new URL("/.netlify/functions/emails/halo-daily-summary", siteUrl);
  } catch {
    return false;
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) return false;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "netlify-emails-secret": secret
    },
    body: JSON.stringify({
      from,
      to: dailyReportRecipient,
      subject: `HALO daily summary — ${report.date}`,
      parameters: dailyReportEmailParameters(report)
    }),
    signal: AbortSignal.timeout(8000)
  });
  return response.ok;
}
