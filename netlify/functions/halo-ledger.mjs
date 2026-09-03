import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import { appendLedgerEntry, LEDGER_CATEGORIES } from "../lib/halo-ledger.mjs";

const MAX_BODY_BYTES = 32_000;
const PAGE_SIZE = 50;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function serializeEntry(row) {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorType: row.actor_type,
    eventCategory: row.event_category,
    refSongId: row.ref_song_id || null,
    refIssueId: row.ref_issue_id || null,
    refReleaseId: row.ref_release_id || null,
    refAgentId: row.ref_agent_id || null,
    summary: row.summary || "",
    details: row.details || {},
    body: row.body || "",
    pipelineStage: row.pipeline_stage || null,
    outcome: row.outcome || "success",
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** GET /api/halo-ledger — list and search ledger entries. */
async function handleGet(request, db) {
  const url = new URL(request.url);
  const entryId = cleanId(url.searchParams.get("id"));
  if (entryId) {
    const rows = await db.sql`
      SELECT * FROM halo_ledger WHERE id = ${entryId} LIMIT 1
    `;
    if (!rows[0]) return json({ message: "Ledger entry not found" }, 404);
    return json({ entry: serializeEntry(rows[0]) });
  }

  const category = url.searchParams.get("category") || "";
  const q = cleanText(url.searchParams.get("q") || "", 200);
  const refSongId = cleanId(url.searchParams.get("refSongId") || "");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || PAGE_SIZE), 1), 200);
  const before = url.searchParams.get("before") || "";

  const validCategory = LEDGER_CATEGORIES.has(category) ? category : null;
  const validBefore = before && !Number.isNaN(Date.parse(before)) ? before : null;

  let rows;
  if (validCategory && q && refSongId) {
    const likeQ = `%${q}%`;
    rows = await db.sql`
      SELECT * FROM halo_ledger
      WHERE event_category = ${validCategory}
        AND ref_song_id = ${refSongId}
        AND (summary ILIKE ${likeQ} OR body ILIKE ${likeQ})
        ${validBefore ? db.sql`AND created_at < ${validBefore}` : db.sql``}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
  } else if (validCategory && q) {
    const likeQ = `%${q}%`;
    rows = await db.sql`
      SELECT * FROM halo_ledger
      WHERE event_category = ${validCategory}
        AND (summary ILIKE ${likeQ} OR body ILIKE ${likeQ})
        ${validBefore ? db.sql`AND created_at < ${validBefore}` : db.sql``}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
  } else if (validCategory && refSongId) {
    rows = await db.sql`
      SELECT * FROM halo_ledger
      WHERE event_category = ${validCategory}
        AND ref_song_id = ${refSongId}
        ${validBefore ? db.sql`AND created_at < ${validBefore}` : db.sql``}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
  } else if (validCategory) {
    rows = await db.sql`
      SELECT * FROM halo_ledger
      WHERE event_category = ${validCategory}
        ${validBefore ? db.sql`AND created_at < ${validBefore}` : db.sql``}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
  } else if (q) {
    const likeQ = `%${q}%`;
    rows = await db.sql`
      SELECT * FROM halo_ledger
      WHERE (summary ILIKE ${likeQ} OR body ILIKE ${likeQ})
        ${validBefore ? db.sql`AND created_at < ${validBefore}` : db.sql``}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
  } else if (refSongId) {
    rows = await db.sql`
      SELECT * FROM halo_ledger
      WHERE ref_song_id = ${refSongId}
        ${validBefore ? db.sql`AND created_at < ${validBefore}` : db.sql``}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
  } else {
    rows = await db.sql`
      SELECT * FROM halo_ledger
      ${validBefore ? db.sql`WHERE created_at < ${validBefore}` : db.sql``}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
  }

  const entries = rows.map(serializeEntry);
  const nextBefore = entries.length === limit ? entries[entries.length - 1].createdAt : null;
  return json({ entries, nextBefore, categories: [...LEDGER_CATEGORIES] });
}

/** POST /api/halo-ledger — manually append a ledger entry (admin/agent use). */
async function handlePost(request, db, membership) {
  try { verifyRequestOrigin(request); } catch {
    return json({ message: "Cross-origin ledger writes are not accepted" }, 403);
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return json({ message: "Ledger payload is too large" }, 413);
  }
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return json({ message: "Request body must be valid JSON" }, 400);
  }

  const eventCategory = String(payload.eventCategory || "").trim();
  if (!LEDGER_CATEGORIES.has(eventCategory)) {
    return json({ message: `eventCategory must be one of: ${[...LEDGER_CATEGORIES].join(", ")}` }, 422);
  }

  const summary = cleanText(payload.summary || "", 500);
  if (!summary) return json({ message: "A summary is required" }, 422);

  try {
    const id = await appendLedgerEntry(db, {
      actorId: membership.member_id,
      actorType: "member",
      eventCategory,
      refSongId: cleanId(payload.refSongId || "") || null,
      refIssueId: cleanId(payload.refIssueId || "") || null,
      refReleaseId: cleanId(payload.refReleaseId || "") || null,
      refAgentId: cleanText(payload.refAgentId || "", 100) || null,
      summary,
      details: typeof payload.details === "object" ? payload.details : {},
      body: cleanText(payload.body || "", 10000),
      pipelineStage: cleanText(payload.pipelineStage || "", 50) || null,
      outcome: payload.outcome || "success",
    });
    return json({ message: "Ledger entry created", id }, 201);
  } catch (err) {
    console.error("Ledger entry creation failed", err instanceof Error ? err.message : "unknown");
    return json({ message: "Could not create ledger entry" }, 500);
  }
}

export default async function haloLedgerHandler(request) {
  if (!["GET", "POST"].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405);
  }
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Sign in to access Halo Ledger" }, 401);
    const membership = await ensureMembership(db, user);

    if (request.method === "GET") return handleGet(request, db);
    return handlePost(request, db, membership);
  } catch (error) {
    console.error("Halo Ledger request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Halo Ledger is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/halo-ledger" };
