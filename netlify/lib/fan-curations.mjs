import { FeedError, readBody, uuid } from "./signal-feed.mjs";
import { trackDropPublicPath } from "./track-drops.mjs";

export const FAN_CURATION_POLICY = Object.freeze({
  earnedPoints: 25, cardCost: 25, minTracks: 3, maxTracks: 12,
  maxCurations: 50, dailySaves: 10, dailyRewardGrants: 1,
  rewardId: "listening-card"
});
const readEnvironment = name => globalThis.Netlify?.env?.get(name) ?? process.env[name] ?? "";

export function constellationDatabaseUrl(environment = readEnvironment) {
  const endpoint = raw => {
    try {
      const url = new URL(raw);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname === "/") return null;
      return `${url.hostname.toLowerCase()}:${url.port || "5432"}/${decodeURIComponent(url.pathname.slice(1))}`;
    } catch { return null; }
  };
  const connectionString = environment("HALO_CONSTELLATION_DATABASE_URL");
  const preview = endpoint(connectionString);
  if (!preview || ["NETLIFY_DB_URL", "DATABASE_URL"].some(name => {
    const shared = endpoint(environment(name));
    return shared != null && shared === preview;
  })) return null;
  return connectionString;
}

export function constellationPilotAccess(memberId, environment = readEnvironment) {
  const context = environment("CONTEXT");
  if (!["dev", "deploy-preview", "branch-deploy"].includes(context)
    || environment("HALO_CONSTELLATION_ENABLED") !== "true") return false;
  const members = String(environment("HALO_CONSTELLATION_PILOT_MEMBERS")).split(",").map(id => id.trim()).filter(Boolean);
  return members.includes(memberId);
}
const releaseIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const json = (body, status = 200) => Response.json(body, {
  status, headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    ...(status === 429 ? { "Retry-After": "86400" } : {})
  }
});

export function curationInput(body) {
  const fields = body.action === "save" ? ["action", "title", "releaseIds"] : ["action", "curationId", "rewardId"];
  if (!["save", "redeem"].includes(body.action)
    || Object.keys(body).length !== fields.length || Object.keys(body).some(key => !fields.includes(key))) {
    throw new FeedError("Choose a supported curation action");
  }
  if (body.action === "redeem") {
    if (body.rewardId !== FAN_CURATION_POLICY.rewardId) throw new FeedError("Choose the listening card reward");
    return { action: body.action, curationId: uuid(body.curationId) };
  }
  if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 120
    || /[\u0000-\u001f\u007f]/.test(body.title)) throw new FeedError("Use a title of 1-120 characters");
  const ids = body.releaseIds;
  if (!Array.isArray(ids) || ids.length < 3 || ids.length > 12 || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== "string" || id.length < 2 || id.length > 96 || !releaseIdPattern.test(id))) {
    throw new FeedError("Choose 3-12 different public releases");
  }
  return { action: body.action, title: body.title.trim(), releaseIds: ids };
}

const track = row => ({
  id: row.id, title: row.title, artist: row.artist,
  publicPath: row.title == null ? null : trackDropPublicPath(row.id),
  available: row.title != null
});

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

async function listeningCard(db, memberId, curationId, origin) {
  const rows = await db.sql`
    SELECT c.title,
      (SELECT jsonb_agg(jsonb_build_object('id', item.release_id, 'title', r.title, 'artist', r.artist) ORDER BY item.position)
        FROM unnest(c.release_ids) WITH ORDINALITY item(release_id, position)
        LEFT JOIN halo_release_campaigns r ON r.id = item.release_id AND r.status = 'published' AND r.visibility = 'public') AS tracks
    FROM halo_fan_curations c
    JOIN halo_fan_reward_redemptions redemption
      ON redemption.curation_id = c.id AND redemption.member_id = ${memberId} AND redemption.reward_id = 'listening-card'
    WHERE c.id = ${curationId}::uuid AND c.member_id = ${memberId}
  `;
  const row = rows[0];
  if (!row) throw new FeedError("Unlock your own listening card before downloading", 404);
  if (!row.tracks?.length || row.tracks.some(item => item.title == null)) {
    throw new FeedError("One or more releases are no longer public. This card is unavailable", 409);
  }
  const tracks = row.tracks.map(item => `<li><strong>${escapeHtml(item.title)}</strong> &mdash; ${escapeHtml(item.artist)}
    <br><a href="${escapeHtml(origin + trackDropPublicPath(item.id))}">Listen on HALO</a></li>`).join("\n");
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(row.title)} - HALO listening card</title>
<style>body{font:18px/1.6 Georgia,serif;max-width:44rem;margin:3rem auto;padding:1.5rem;color:#201a12}
h1{font-size:2.5rem}li{margin:1rem 0}a{color:#60451d}footer{border-top:1px solid #c9b994;margin-top:2rem;font-size:14px}
@media print{body{margin:0}a{color:inherit}}</style></head>
<body><header><p>HALO / Personal listening collection</p><h1>${escapeHtml(row.title)}</h1></header>
<main><ol>${tracks}</ol></main><footer><p>Use your browser's Print command to keep this card.
This is a tracklist with public listening links, not an audio download, license, ownership transfer, or physical order.
All recordings remain with their respective rights holders.</p></footer></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": 'attachment; filename="halo-listening-card.html"',
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    }
  });
}

export async function loadFanCurationState(db, memberId) {
  const wallets = await db.sql`
    SELECT COALESCE((SELECT rewards_enabled FROM halo_member_notification_preferences WHERE member_id = ${memberId}), FALSE) AS enabled,
      (SELECT COALESCE(SUM(points), 0)::bigint FROM halo_member_reward_events WHERE member_id = ${memberId}) AS earned,
      (SELECT COALESCE(SUM(points), 0)::bigint FROM halo_fan_reward_redemptions WHERE member_id = ${memberId}) AS spent
  `;
  if (!wallets[0]) throw new Error("Missing reward wallet");
  const earned = Number(wallets[0].earned), spent = Number(wallets[0].spent);
  if (!Number.isSafeInteger(earned) || !Number.isSafeInteger(spent) || spent < 0 || earned < spent) {
    throw new Error("Invalid reward wallet");
  }
  const rows = await db.sql`
    SELECT c.id, c.title, c.created_at, redemption.id AS redemption_id,
      (SELECT jsonb_agg(jsonb_build_object('id', item.release_id, 'title', r.title, 'artist', r.artist) ORDER BY item.position)
        FROM unnest(c.release_ids) WITH ORDINALITY item(release_id, position)
        LEFT JOIN halo_release_campaigns r ON r.id = item.release_id AND r.status = 'published' AND r.visibility = 'public') AS tracks
    FROM halo_fan_curations c
    LEFT JOIN halo_fan_reward_redemptions redemption
      ON redemption.curation_id = c.id AND redemption.member_id = ${memberId} AND redemption.reward_id = 'listening-card'
    WHERE c.member_id = ${memberId}
    ORDER BY c.created_at DESC, c.id
    LIMIT 50
  `;
  const releases = await db.sql`
    SELECT id, title, artist FROM halo_release_campaigns
    WHERE status = 'published' AND visibility = 'public'
    ORDER BY release_date DESC NULLS LAST, id LIMIT 200
  `;
  return {
    policy: FAN_CURATION_POLICY,
    wallet: { enabled: wallets[0].enabled === true, earned, spent, available: earned - spent },
    releases: releases.map(track),
    curations: rows.map(row => ({
      id: row.id, title: row.title, createdAt: new Date(row.created_at).toISOString(),
      redeemed: Boolean(row.redemption_id), tracks: row.tracks.map(track)
    }))
  };
}

export function createFanCurationsHandler({
  getDatabase, getUser, ensureMembership, verifyRequestOrigin, environment = readEnvironment
}) {
  return async request => {
    if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
    try {
      // No production activation, authentication calls, or database access while disabled.
      if (!["dev", "deploy-preview", "branch-deploy"].includes(environment("CONTEXT"))
        || environment("HALO_CONSTELLATION_ENABLED") !== "true") {
        return json({ code: "pilot_disabled", message: "Live Constellation pilot is closed. The local demo does not use accounts or points." }, 503);
      }
      const connectionString = constellationDatabaseUrl(environment);
      if (!connectionString) {
        return json({ code: "pilot_database_required", message: "A dedicated preview database is required. The satellite will not use HALO's default database." }, 503);
      }
      const url = new URL(request.url), origin = request.headers.get("origin");
      const cardRequest = url.pathname === "/api/fan-curations/card";
      if ((!cardRequest && url.search) || (origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
        throw new FeedError("Same-origin request required", 403);
      }
      let cardId;
      if (cardRequest) {
        if (request.method !== "GET") throw new FeedError("Method not allowed", 405);
        if ([...url.searchParams.keys()].length !== 1 || !url.searchParams.has("curationId")) throw new FeedError("Choose a listening card");
        cardId = uuid(url.searchParams.get("curationId"));
      }
      if (request.method === "POST") {
        let valid = false;
        try { valid = origin === url.origin && (await verifyRequestOrigin(request)) !== false; } catch {}
        if (!valid) throw new FeedError("Same-origin request required", 403);
      }
      const user = await getUser();
      if (!user?.id) throw new FeedError("Sign in to save curations and redeem rewards", 401);
      if (!constellationPilotAccess(user.id, environment)) {
        return json({ code: "pilot_invitation_required", message: "This preview is limited to invited pilot accounts. No account data was loaded or changed." }, 403);
      }
      const input = request.method === "POST" ? curationInput(await readBody(request, 4096)) : null;
      const db = await getDatabase({ connectionString });
      await ensureMembership(db, user);
      if (cardRequest) return await listeningCard(db, user.id, cardId, url.origin);
      if (!input) return json(await loadFanCurationState(db, user.id));
      const rows = input.action === "save"
        ? await db.sql`SELECT halo_save_fan_curation(${user.id}, ${input.title}, ${input.releaseIds}::text[]) AS outcome`
        : await db.sql`SELECT halo_redeem_fan_card(${user.id}, ${input.curationId}::uuid) AS outcome`;
      const outcome = rows[0]?.outcome;
      const errors = {
        invalid: [400, "Choose a title and 3-12 different public releases"],
        limit: [429, "You can save 10 curations per UTC day, up to 50 total"],
        unavailable: [409, "One or more releases are no longer public. No reward was charged"],
        rewards_disabled: [409, "Turn on member rewards in Track Drops before redeeming"],
        not_found: [404, "Curation not found"],
        insufficient_points: [409, "You need 25 available Signal Points for this listening card"]
      };
      if (Object.hasOwn(errors, outcome?.result)) {
        const [status, message] = errors[outcome.result];
        return json({ message }, status);
      }
      if (!["saved", "duplicate", "claimed", "already_claimed"].includes(outcome?.result)) {
        throw new Error("Missing curation result");
      }
      // The mutation is already durable; clients refresh separately so a read failure cannot mask a successful debit.
      return json({
        curationId: input.curationId ?? outcome.id,
        result: outcome.result, rewardGranted: outcome.rewardGranted === true,
        message: outcome.result === "saved"
          ? outcome.rewardGranted ? "Curation saved. +25 verified Signal Points." : "Curation saved. No points awarded (rewards are off or today's bonus was already earned)."
          : outcome.result === "duplicate" ? "This track selection is already saved. No extra points awarded."
            : outcome.result === "claimed" ? "Listening card unlocked. 25 points spent." : "Listening card already unlocked. No extra points spent."
      }, ["saved", "claimed"].includes(outcome.result) ? 201 : 200);
    } catch (error) {
      if (error instanceof FeedError) return json({ message: error.message }, error.status);
      console.error("HALO fan curations unavailable");
      return json({ message: "Curations are temporarily unavailable. Refresh before retrying; a previous save or claim may have completed." }, 503);
    }
  };
}
