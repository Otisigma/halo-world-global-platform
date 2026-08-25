import { getDatabase } from "@netlify/database";
import { authorizeStatsAdmin, jsonResponse } from "../lib/stats.mjs";
import { runRadioOperator, serializeBriefingRow } from "../lib/radio-operator.mjs";

export default async function radioOperatorHandler(request) {
  if (!["GET", "POST"].includes(request.method)) {
    return jsonResponse({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }

  if (!process.env.STATS_ADMIN_TOKEN) {
    return jsonResponse({ message: "Operator briefings are not configured" }, 503);
  }
  if (!authorizeStatsAdmin(request)) {
    return jsonResponse({ message: "Unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  try {
    const db = await getDatabase();

    if (request.method === "POST") {
      const briefing = await runRadioOperator(db, { triggerType: "manual" });
      return jsonResponse({ briefing }, 201);
    }

    const limit = Math.min(30, Math.max(1, Number(new URL(request.url).searchParams.get("limit") || 7)));
    const rows = await db.sql`
      SELECT *
      FROM halo_radio_operator_briefings
      ORDER BY briefing_date DESC
      LIMIT ${limit}
    `;

    return jsonResponse({
      latest: serializeBriefingRow(rows[0]),
      history: rows.map(serializeBriefingRow)
    });
  } catch (error) {
    console.error("HALO radio operator request failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ message: "The operator briefing could not be read" }, 500);
  }
}

export const config = {
  path: "/api/radio/operator"
};
