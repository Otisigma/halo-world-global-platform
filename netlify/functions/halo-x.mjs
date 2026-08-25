import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import {
  cleanText,
  ensureMembership,
  generateDailyReport,
  generatePassCode,
  hashPassCode,
  isOwner,
  membershipPayload
} from "../lib/halo-x.mjs";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanDestination(value, requestUrl) {
  const raw = cleanText(value, 500);
  if (!raw) return "";
  try {
    const url = new URL(raw, requestUrl);
    const requestOrigin = new URL(requestUrl).origin;
    if (url.origin !== requestOrigin && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.origin === requestOrigin ? `${url.pathname}${url.search}${url.hash}` : url.href;
  } catch {
    return "";
  }
}

async function loadDashboard(db, user, membership) {
  const owner = isOwner(user);
  const [pinRows, sessionRows, reportRows, passRows] = await Promise.all([
    db.sql`
      SELECT title, body, destination_url, cta_label, updated_at
      FROM halo_room_pins
      WHERE actor_id = ${membership.actor_id}
      LIMIT 1
    `,
    db.sql`
      SELECT session_name, revision, updated_at
      FROM halo_dj_sessions
      WHERE member_id = ${user.id}
      LIMIT 1
    `,
    owner
      ? db.sql`
          SELECT report_date, metrics, recent_joins, generated_at
          FROM halo_daily_reports
          ORDER BY report_date DESC
          LIMIT 14
        `
      : Promise.resolve([]),
    owner
      ? db.sql`
          SELECT id, label, pass_type, grants_tier, code_hint, duration_days, max_redemptions,
            redemption_count, expires_at, status, created_at
          FROM halo_access_passes
          ORDER BY created_at DESC
          LIMIT 20
        `
      : Promise.resolve([])
  ]);

  const pin = pinRows[0];
  const session = sessionRows[0];
  return {
    membership: membershipPayload(membership),
    canViewReports: owner,
    roomPin: pin ? {
      title: pin.title,
      body: pin.body,
      destinationUrl: pin.destination_url,
      ctaLabel: pin.cta_label,
      updatedAt: new Date(pin.updated_at).toISOString()
    } : null,
    savedSession: session ? {
      name: session.session_name,
      revision: Number(session.revision),
      updatedAt: new Date(session.updated_at).toISOString()
    } : null,
    reports: reportRows.map(row => ({
      date: String(row.report_date).slice(0, 10),
      metrics: row.metrics || {},
      recentJoins: row.recent_joins || [],
      generatedAt: new Date(row.generated_at).toISOString()
    })),
    passes: passRows.map(row => ({
      id: Number(row.id),
      label: row.label,
      type: row.pass_type,
      grantsTier: row.grants_tier,
      codeHint: row.code_hint,
      durationDays: row.duration_days == null ? null : Number(row.duration_days),
      maxRedemptions: Number(row.max_redemptions),
      redemptionCount: Number(row.redemption_count),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString()
    }))
  };
}

async function redeemPass(db, user, membership, rawCode) {
  const code = cleanText(rawCode, 96).replace(/^#/, "").toUpperCase();
  if (code.length < 8) return json({ message: "Enter the complete Gold Ticket or access key" }, 400);
  const codeHash = hashPassCode(code);
  const passRows = await db.sql`
    SELECT id, label, pass_type, grants_tier, duration_days, max_redemptions,
      redemption_count, expires_at, status
    FROM halo_access_passes
    WHERE code_hash = ${codeHash}
    LIMIT 1
  `;
  const pass = passRows[0];
  if (!pass || pass.status !== "active") return json({ message: "That pass is not active" }, 404);
  if (pass.expires_at && new Date(pass.expires_at) <= new Date()) return json({ message: "That pass has expired" }, 410);

  const existingRows = await db.sql`
    SELECT access_ends_at FROM halo_pass_redemptions
    WHERE pass_id = ${pass.id} AND member_id = ${user.id}
    LIMIT 1
  `;
  if (existingRows.length) {
    return json({ message: "This pass is already attached to your account", dashboard: await loadDashboard(db, user, membership) });
  }

  const claimedRows = await db.sql`
    UPDATE halo_access_passes
    SET redemption_count = redemption_count + 1
    WHERE id = ${pass.id}
      AND status = 'active'
      AND redemption_count < max_redemptions
      AND (expires_at IS NULL OR expires_at > NOW())
    RETURNING id
  `;
  if (!claimedRows.length) return json({ message: "That pass has reached its guest limit" }, 409);

  const durationDays = pass.duration_days == null ? null : Number(pass.duration_days);
  const accessEndsAt = durationDays ? new Date(Date.now() + durationDays * 86400000) : null;
  await db.sql`
    INSERT INTO halo_pass_redemptions (pass_id, member_id, access_ends_at)
    VALUES (${pass.id}, ${user.id}, ${accessEndsAt?.toISOString() || null})
  `;

  const tierRank = { member: 0, gold: 1, backstage: 2, founder: 3 };
  const currentAccessActive = membership.tier === "founder"
    || !membership.access_ends_at
    || new Date(membership.access_ends_at) > new Date();
  const currentTier = currentAccessActive ? membership.tier : "member";
  const currentAccessEndsAt = currentAccessActive ? membership.access_ends_at : null;
  const nextTier = tierRank[pass.grants_tier] > tierRank[currentTier] ? pass.grants_tier : currentTier;
  const nextAccessEndsAt = nextTier === "founder"
    ? null
    : currentAccessEndsAt && accessEndsAt
      ? new Date(Math.max(new Date(currentAccessEndsAt).getTime(), accessEndsAt.getTime()))
      : currentAccessEndsAt || accessEndsAt;
  const updatedRows = await db.sql`
    UPDATE halo_memberships
    SET tier = ${nextTier},
      source = ${pass.pass_type},
      access_ends_at = ${nextAccessEndsAt ? new Date(nextAccessEndsAt).toISOString() : null},
      updated_at = NOW(),
      last_seen_at = NOW()
    WHERE member_id = ${user.id}
    RETURNING member_id, actor_id, display_name, tier, source, access_ends_at, joined_at, last_seen_at
  `;
  return json({
    message: `${pass.label} is now attached to your account`,
    dashboard: await loadDashboard(db, user, updatedRows[0])
  });
}

async function saveRoomPin(request, db, membership, payload) {
  const title = cleanText(payload.title, 80);
  const body = cleanText(payload.body, 240);
  const ctaLabel = cleanText(payload.ctaLabel, 24) || "Open";
  const destinationUrl = cleanDestination(payload.destinationUrl, request.url);
  if (title.length < 2) return json({ message: "Give the room pin a short title" }, 400);
  if (payload.destinationUrl && !destinationUrl) return json({ message: "Use a secure HTTPS link or a HALO page" }, 400);
  await db.sql`
    INSERT INTO halo_room_pins (actor_id, title, body, destination_url, cta_label)
    VALUES (${membership.actor_id}, ${title}, ${body}, ${destinationUrl}, ${ctaLabel})
    ON CONFLICT (actor_id) DO UPDATE SET
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      destination_url = EXCLUDED.destination_url,
      cta_label = EXCLUDED.cta_label,
      updated_at = NOW()
  `;
  return json({ message: "Your room pin is live" });
}

async function createPass(db, user, payload) {
  if (!isOwner(user)) return json({ message: "Owner access is required" }, 403);
  const passType = ["gold_ticket", "backstage_pass", "founders_key", "event_pass"].includes(payload.passType)
    ? payload.passType
    : "gold_ticket";
  const defaults = {
    gold_ticket: { tier: "gold", days: 7 },
    backstage_pass: { tier: "backstage", days: 30 },
    founders_key: { tier: "founder", days: null },
    event_pass: { tier: "gold", days: 1 }
  }[passType];
  const label = cleanText(payload.label, 80) || {
    gold_ticket: "DJ HALO X Gold Ticket",
    backstage_pass: "DJ HALO X Backstage Pass",
    founders_key: "DJ HALO X Founders Key",
    event_pass: "DJ HALO X Event Pass"
  }[passType];
  const maxRedemptions = Math.min(10000, Math.max(1, Number.parseInt(payload.maxRedemptions, 10) || 1));
  const durationDays = defaults.days == null
    ? null
    : Math.min(3650, Math.max(1, Number.parseInt(payload.durationDays, 10) || defaults.days));
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) {
    return json({ message: "Choose a future expiration date" }, 400);
  }
  const code = generatePassCode(passType);
  await db.sql`
    INSERT INTO halo_access_passes (
      code_hash, code_hint, label, pass_type, grants_tier, duration_days,
      max_redemptions, expires_at, created_by_member_id
    )
    VALUES (
      ${hashPassCode(code)}, ${code.slice(-4)}, ${label}, ${passType}, ${defaults.tier},
      ${durationDays}, ${maxRedemptions}, ${expiresAt?.toISOString() || null}, ${user.id}
    )
  `;
  return json({ message: "Pass created. Copy it now; HALO stores only its secure fingerprint.", code });
}

async function handlePost(request, db, user, membership) {
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin membership actions are not accepted" }, 403);
  }
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }

  if (payload.action === "redeem_pass") return redeemPass(db, user, membership, payload.code);
  if (payload.action === "save_room_pin") {
    const result = await saveRoomPin(request, db, membership, payload);
    if (result.status !== 200) return result;
    return json({ message: "Your room pin is live", dashboard: await loadDashboard(db, user, membership) });
  }
  if (payload.action === "clear_room_pin") {
    await db.sql`DELETE FROM halo_room_pins WHERE actor_id = ${membership.actor_id}`;
    return json({ message: "Your room pin has been cleared", dashboard: await loadDashboard(db, user, membership) });
  }
  if (payload.action === "create_pass") return createPass(db, user, payload);
  if (payload.action === "refresh_report") {
    if (!isOwner(user)) return json({ message: "Owner access is required" }, 403);
    const report = await generateDailyReport(db);
    return json({ message: "Today’s report is current", report, dashboard: await loadDashboard(db, user, membership) });
  }
  return json({ message: "Unknown HALO X action" }, 400);
}

export default async function haloXHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Join or sign in to enter DJ HALO X" }, 401);
    const membership = await ensureMembership(db, user);
    if (request.method === "POST") return handlePost(request, db, user, membership);
    if (isOwner(user)) await generateDailyReport(db);
    return json(await loadDashboard(db, user, membership));
  } catch (error) {
    console.error("HALO X request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "DJ HALO X is temporarily unavailable" }, 500);
  }
}

export const config = {
  path: "/api/halo-x"
};
