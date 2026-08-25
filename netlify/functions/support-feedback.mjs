import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { isOwner } from "../lib/halo-x.mjs";

const categories = new Set(["bug", "feature", "support"]);
const statuses = new Set(["received", "reviewing", "planned", "in_progress", "resolved", "closed"]);

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function cleanSupportText(value, maximum) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

export function cleanSupportCategory(value) {
  const category = cleanSupportText(value, 16).toLowerCase();
  return categories.has(category) ? category : "";
}

export function cleanSupportStatus(value) {
  const status = cleanSupportText(value, 24).toLowerCase();
  return statuses.has(status) ? status : "";
}

function cleanPageUrl(value) {
  const pageUrl = cleanSupportText(value, 500);
  if (!pageUrl) return null;
  try {
    const parsed = new URL(pageUrl);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function mapRequest(row) {
  return {
    requestKey: row.request_key,
    category: row.category,
    title: row.title,
    details: row.details,
    pageUrl: row.page_url,
    visibility: row.visibility,
    status: row.status,
    staffNote: row.staff_note,
    voteCount: Number(row.vote_count || 0),
    viewerVoted: Boolean(row.viewer_voted),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function bodyFrom(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 12_000) throw new Error("payload_too_large");
  return request.json();
}

async function loadPublicRequests(db, userId) {
  const rows = userId
    ? await db.sql`
        SELECT request.*, EXISTS (
          SELECT 1 FROM halo_support_votes vote
          WHERE vote.request_key = request.request_key AND vote.voter_id = ${userId}
        ) AS viewer_voted
        FROM halo_support_requests request
        WHERE request.visibility = 'public' AND request.category = 'feature' AND request.status <> 'closed'
        ORDER BY request.vote_count DESC, request.updated_at DESC
        LIMIT 40
      `
    : await db.sql`
        SELECT request.*, FALSE AS viewer_voted
        FROM halo_support_requests request
        WHERE request.visibility = 'public' AND request.category = 'feature' AND request.status <> 'closed'
        ORDER BY request.vote_count DESC, request.updated_at DESC
        LIMIT 40
      `;
  return rows.map(mapRequest);
}

export default async function supportFeedbackHandler(request) {
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }

  try {
    const [db, user] = await Promise.all([getDatabase(), getUser().catch(() => null)]);
    const userId = cleanSupportText(user?.id, 180);

    if (request.method === "GET") {
      const url = new URL(request.url);
      if (url.searchParams.get("scope") === "mine") {
        if (!userId) return json({ message: "Sign in to view your requests" }, 401);
        const rows = await db.sql`
          SELECT request.*, FALSE AS viewer_voted
          FROM halo_support_requests request
          WHERE request.submitter_id = ${userId}
          ORDER BY request.created_at DESC
          LIMIT 60
        `;
        return json({ requests: rows.map(mapRequest), viewer: { owner: isOwner(user) } });
      }
      return json({ requests: await loadPublicRequests(db, userId) });
    }

    if (!(await verifyRequestOrigin(request))) {
      return json({ message: "Request origin could not be verified" }, 403);
    }
    if (!userId) return json({ message: "Sign in to send feedback or vote" }, 401);

    let body;
    try {
      body = await bodyFrom(request);
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === "payload_too_large";
      return json({ message: tooLarge ? "Request is too large" : "Invalid request body" }, tooLarge ? 413 : 400);
    }

    if (body?.action === "vote") {
      const requestKey = cleanSupportText(body.requestKey, 80);
      if (!requestKey) return json({ message: "Choose a public request to support" }, 400);
      const rows = await db.sql`
        WITH inserted AS (
          INSERT INTO halo_support_votes (request_key, voter_id)
          SELECT request_key, ${userId}
          FROM halo_support_requests
          WHERE request_key = ${requestKey} AND visibility = 'public' AND category = 'feature'
          ON CONFLICT DO NOTHING
          RETURNING 1
        )
        UPDATE halo_support_requests
        SET vote_count = vote_count + (SELECT COUNT(*) FROM inserted),
            updated_at = CASE WHEN EXISTS (SELECT 1 FROM inserted) THEN NOW() ELSE updated_at END
        WHERE request_key = ${requestKey} AND visibility = 'public' AND category = 'feature'
        RETURNING *, TRUE AS viewer_voted
      `;
      if (!rows.length) return json({ message: "That community request is unavailable" }, 404);
      return json({ request: mapRequest(rows[0]) });
    }

    if (body?.action === "update_status") {
      if (!isOwner(user)) return json({ message: "Only the HALO team can update request status" }, 403);
      const requestKey = cleanSupportText(body.requestKey, 80);
      const status = cleanSupportStatus(body.status);
      const staffNote = cleanSupportText(body.staffNote, 1000) || null;
      if (!requestKey || !status) return json({ message: "Choose a request and valid status" }, 400);
      const rows = await db.sql`
        UPDATE halo_support_requests
        SET status = ${status}, staff_note = ${staffNote}, updated_at = NOW()
        WHERE request_key = ${requestKey}
        RETURNING *, FALSE AS viewer_voted
      `;
      if (!rows.length) return json({ message: "Request not found" }, 404);
      return json({ request: mapRequest(rows[0]) });
    }

    const category = cleanSupportCategory(body?.category);
    const title = cleanSupportText(body?.title, 120);
    const details = cleanSupportText(body?.details, 4000);
    const visibility = category === "feature" && body?.public === true ? "public" : "private";
    if (!category) return json({ message: "Choose bug, feature, or support" }, 422);
    if (title.length < 4) return json({ message: "Add a clear title" }, 422);
    if (details.length < 12) return json({ message: "Add enough detail for the team to act" }, 422);

    const recent = await db.sql`
      SELECT COUNT(*)::int AS count
      FROM halo_support_requests
      WHERE submitter_id = ${userId} AND created_at > NOW() - INTERVAL '10 minutes'
    `;
    if (Number(recent[0]?.count || 0) >= 3) {
      return json({ message: "You have sent several requests. Please wait a few minutes before sending another." }, 429, { "Retry-After": "600" });
    }

    const requestKey = crypto.randomUUID();
    const rows = await db.sql`
      INSERT INTO halo_support_requests (
        request_key, submitter_id, category, title, details, page_url, visibility
      ) VALUES (
        ${requestKey}, ${userId}, ${category}, ${title}, ${details}, ${cleanPageUrl(body?.pageUrl)}, ${visibility}
      )
      RETURNING *, FALSE AS viewer_voted
    `;
    return json({ request: mapRequest(rows[0]) }, 201);
  } catch (error) {
    console.error("HALO support request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The feedback desk is temporarily unavailable" }, 503);
  }
}

export const config = {
  path: "/api/support-feedback"
};
