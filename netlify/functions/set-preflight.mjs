import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { analyzeSetPreflight } from "../lib/dj-preflight.mjs";

const MAX_BODY_BYTES = 96_000;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export default async function setPreflightHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (request.method === "GET") {
      if (!user?.id) return json({ authenticated: false, preflights: [] });
      const membership = await ensureMembership(db, user);
      const rows = await db.sql`
        SELECT id, title, mode, status, quality_score, track_count, report, created_at, updated_at
        FROM halo_dj_set_preflights
        WHERE member_id = ${membership.member_id}
        ORDER BY updated_at DESC
        LIMIT 12
      `;
      return json({ authenticated: true, preflights: rows.map(row => ({
        id: row.id,
        title: row.title,
        mode: row.mode,
        status: row.status,
        qualityScore: Number(row.quality_score),
        trackCount: Number(row.track_count),
        report: row.report,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      })) });
    }

    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Request origin could not be verified" }, 403);
    }
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ message: "Set preflight request is too large" }, 413);
    const body = await request.json().catch(() => null);
    if (!body) return json({ message: "Request body must be valid JSON" }, 400);

    let report;
    try {
      report = analyzeSetPreflight(body);
    } catch (error) {
      return json({ message: error instanceof Error ? error.message : "The set could not be analyzed" }, 400);
    }

    if (!user?.id) return json({ authenticated: false, persisted: false, report });
    const membership = await ensureMembership(db, user);
    const id = randomUUID();
    const rows = await db.sql`
      INSERT INTO halo_dj_set_preflights (
        id, member_id, persona_id, title, mode, seed, status, quality_score, track_count, report
      ) VALUES (
        ${id}, ${membership.member_id}, ${report.personaId}, ${report.title}, ${report.mode}, ${report.seed},
        ${report.status}, ${report.qualityScore}, ${report.orderedTracks.length}, ${JSON.stringify(report)}::jsonb
      )
      RETURNING id, created_at
    `;
    return json({ authenticated: true, persisted: true, preflightId: rows[0].id, createdAt: new Date(rows[0].created_at).toISOString(), report }, 201);
  } catch (error) {
    console.error("HALO set preflight failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Set preflight is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/set-preflight" };
