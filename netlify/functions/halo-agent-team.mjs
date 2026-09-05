import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { isOwner } from "../lib/halo-x.mjs";
import {
  canRunManualCouncil,
  loadAgentDashboard,
  runAgentCouncil,
  sendAgentReportWebhook,
  updateAgentAction
} from "../lib/agent-team.mjs";
import { loadMaintenanceSweeps, runMaintenanceSweep } from "../lib/maintenance-sweep.mjs";

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function bodyFrom(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 12_000) throw new Error("payload_too_large");
  return request.json();
}

async function dashboardResponse(db) {
  const [dashboard, maintenance] = await Promise.all([loadAgentDashboard(db), loadMaintenanceSweeps(db)]);
  return { ...dashboard, maintenance };
}

export default async function haloAgentTeamHandler(request, context) {
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }

  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Sign in to open the HALO Agent Council" }, 401);
    if (!isOwner(user)) return json({ message: "The HALO Agent Council is limited to the owner team" }, 403);

    if (request.method === "GET") return json(await dashboardResponse(db));
    if (!(await verifyRequestOrigin(request))) return json({ message: "Request origin could not be verified" }, 403);

    let body;
    try {
      body = await bodyFrom(request);
    } catch (error) {
      return json({ message: error instanceof Error && error.message === "payload_too_large" ? "Request is too large" : "Invalid request body" }, error instanceof Error && error.message === "payload_too_large" ? 413 : 400);
    }

    if (body?.action === "run") {
      if (!(await canRunManualCouncil(db))) {
        return json({ message: "The council has reached its manual hourly limit" }, 429, { "Retry-After": "3600" });
      }
      const report = await runAgentCouncil(db, { triggerType: "manual" });
      sendAgentReportWebhook(report).catch(error => console.error("HALO agent webhook failed", error instanceof Error ? error.message : "unknown error"));
      return json({ generated: true, dashboard: await dashboardResponse(db) });
    }

    if (body?.action === "run_maintenance" || body?.action === "halo-signal-check") {
      const recentRows = await db.sql`
        SELECT COUNT(*)::int AS total FROM halo_maintenance_sweeps
        WHERE trigger_type = 'manual' AND started_at >= NOW() - INTERVAL '1 hour'
      `;
      if (Number(recentRows[0]?.total || 0) >= 2) {
        return json({ message: "The maintenance team has reached its manual hourly limit" }, 429, { "Retry-After": "3600" });
      }
      const baseUrl = context?.site?.url || globalThis.Netlify?.env?.get("URL") || globalThis.Netlify?.env?.get("DEPLOY_PRIME_URL");
      if (!baseUrl) return json({ message: "The deployed site URL is unavailable" }, 503);
      await runMaintenanceSweep(db, baseUrl, {
        triggerType: "manual",
        commandName: body?.action
      });
      return json({ generated: true, dashboard: await dashboardResponse(db) });
    }

    if (body?.action === "update_action") {
      const updated = await updateAgentAction(db, body.actionId, body);
      if (!updated) return json({ message: "Action could not be updated" }, 400);
      return json({ updated });
    }

    return json({ message: "Unknown council action" }, 400);
  } catch (error) {
    console.error("HALO Agent Council request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The HALO Agent Council is temporarily unavailable" }, 503);
  }
}

export const config = {
  path: "/api/halo-agent-team"
};
