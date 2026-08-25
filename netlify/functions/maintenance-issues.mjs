import { getDatabase } from "@netlify/database";
import { maintenanceAuthorized, mapIssueRow } from "../lib/maintenance.mjs";

const updateStatuses = new Set(["acknowledged", "in_progress", "healed", "failed", "ignored"]);

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanText(value, maximum) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

export default async function maintenanceIssuesHandler(request, context) {
  if (!process.env.MAINTENANCE_AGENT_TOKEN) {
    return jsonResponse({ message: "Maintenance access is not configured" }, 503);
  }
  if (!maintenanceAuthorized(request)) {
    return jsonResponse({ message: "Unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const db = getDatabase();
  const issueId = Number(context.params?.id || 0);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") || 50);
    const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
    const status = cleanText(url.searchParams.get("status"), 24);
    const rows = status
      ? await db.sql`
          SELECT * FROM maintenance_issues
          WHERE status = ${status}
          ORDER BY updated_at DESC
          LIMIT ${limit}
        `
      : await db.sql`
          SELECT * FROM maintenance_issues
          ORDER BY updated_at DESC
          LIMIT ${limit}
        `;
    return jsonResponse({ issues: rows.map(mapIssueRow) });
  }

  if (request.method === "PATCH" && issueId > 0) {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ message: "Update must be valid JSON" }, 400);
    }

    const status = cleanText(payload.status, 24);
    if (!updateStatuses.has(status)) return jsonResponse({ message: "Unsupported maintenance status" }, 422);
    const resolutionSummary = cleanText(payload.resolutionSummary, 2000) || null;
    const maintenanceReference = cleanText(payload.reference, 180) || null;
    const [row] = await db.sql`
      UPDATE maintenance_issues
      SET status = ${status},
          resolution_summary = COALESCE(${resolutionSummary}, resolution_summary),
          maintenance_reference = COALESCE(${maintenanceReference}, maintenance_reference),
          healed_at = CASE WHEN ${status} = 'healed' THEN NOW() ELSE healed_at END,
          updated_at = NOW()
      WHERE id = ${issueId}
      RETURNING *
    `;
    if (!row) return jsonResponse({ message: "Issue not found" }, 404);
    return jsonResponse({ issue: mapIssueRow(row) });
  }

  return jsonResponse({ message: "Method not allowed" }, 405, { Allow: "GET, PATCH" });
}

export const config = {
  path: ["/api/maintenance/issues", "/api/maintenance/issues/:id"]
};

