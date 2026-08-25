import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership, isOwner } from "../lib/halo-x.mjs";
import {
  approvePersonaSet,
  evaluatePersonas,
  loadPersonaDashboard,
  markPersonaSetAired,
  planPersonaSet,
  updatePersonaSetStatus
} from "../lib/radio-personas.mjs";

const MAX_BODY_BYTES = 8_000;
const HOURLY_PLAN_LIMIT = 12;
const PERSONA_STATUSES = new Set(["resident", "guest", "rested", "retired"]);
const SET_STATUSES = new Set(["skipped", "archived"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanId(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 96)
    : "";
}

function cleanSetId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim()) ? value.trim() : "";
}

export default async function radioPersonasHandler(request) {
  if (!["GET", "POST"].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }

  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    const canManage = isOwner(user);

    if (request.method === "GET") {
      return json(await loadPersonaDashboard(db, { canManage }));
    }

    // Every mutation below changes what a resident is allowed to do or what reaches the station,
    // so all of them are station-desk actions on a verified same-origin request.
    if (!canManage) return json({ message: "Station desk access is required" }, 403);
    if (!(await verifyRequestOrigin(request))) {
      return json({ message: "Request origin could not be verified" }, 403);
    }
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) {
      return json({ message: "Request is too large" }, 413);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ message: "Invalid request body" }, 400);
    }

    const membership = await ensureMembership(db, user);

    if (body.action === "plan_set") {
      const personaId = cleanId(body.personaId);
      const plannedFor = new Date(body.plannedFor);
      if (!personaId || Number.isNaN(plannedFor.getTime())) {
        return json({ message: "Choose a resident and a start time" }, 400);
      }

      // Planning can reach the model, so it is metered against the shared AI usage budget.
      const accepted = await db.sql`
        INSERT INTO halo_ai_usage_events (member_id, feature)
        SELECT ${membership.member_id}, 'radio_persona'
        WHERE (
          SELECT COUNT(*)
          FROM halo_ai_usage_events
          WHERE member_id = ${membership.member_id}
            AND feature = 'radio_persona'
            AND created_at >= NOW() - INTERVAL '1 hour'
        ) < ${HOURLY_PLAN_LIMIT}
        RETURNING id
      `;
      if (!accepted.length) {
        return json({ message: "Set planning has reached its hourly limit" }, 429, { "Retry-After": "3600" });
      }

      const planned = await planPersonaSet(db, {
        personaId,
        plannedFor: plannedFor.toISOString(),
        durationMinutes: Math.min(480, Math.max(15, Number(body.durationMinutes) || 60)),
        showId: cleanId(body.showId) || null,
        room: cleanId(body.room)
      });
      if (!planned) return json({ message: "That resident could not be found" }, 404);
      if (!planned.stored) {
        const message = planned.reason === "already_approved"
          ? "That hour already has an approved set. Skip it before planning again."
          : "No rotation-approved tracks are available for that room yet.";
        return json({ message, reason: planned.reason }, 409);
      }
      return json({ set: planned.stored, dashboard: await loadPersonaDashboard(db, { canManage: true }) }, 201);
    }

    if (body.action === "approve_set") {
      const setId = cleanSetId(body.setId);
      if (!setId) return json({ message: "Choose a planned set" }, 400);
      const approved = await approvePersonaSet(db, setId, membership.member_id);
      if (!approved) return json({ message: "That set is no longer awaiting approval" }, 409);
      return json({ set: approved, dashboard: await loadPersonaDashboard(db, { canManage: true }) });
    }

    if (body.action === "mark_aired") {
      const setId = cleanSetId(body.setId);
      if (!setId) return json({ message: "Choose an approved set" }, 400);
      const aired = await markPersonaSetAired(db, setId, membership.member_id);
      if (!aired) return json({ message: "Only an approved set can be marked as aired" }, 409);
      return json({ set: aired, dashboard: await loadPersonaDashboard(db, { canManage: true }) });
    }

    if (body.action === "update_set") {
      const setId = cleanSetId(body.setId);
      const status = String(body.status || "");
      if (!setId || !SET_STATUSES.has(status)) return json({ message: "Choose a set and a valid status" }, 400);
      const updated = await updatePersonaSetStatus(db, setId, status);
      if (!updated) return json({ message: "That set could not be updated" }, 409);
      return json({ set: updated, dashboard: await loadPersonaDashboard(db, { canManage: true }) });
    }

    if (body.action === "set_persona_status") {
      const personaId = cleanId(body.personaId);
      const status = String(body.status || "");
      if (!personaId || !PERSONA_STATUSES.has(status)) {
        return json({ message: "Choose a resident and a valid status" }, 400);
      }
      const rows = await db.sql`
        UPDATE halo_radio_personas SET status = ${status}, updated_at = NOW()
        WHERE id = ${personaId}
        RETURNING id
      `;
      if (!rows.length) return json({ message: "That resident could not be found" }, 404);
      return json({ dashboard: await loadPersonaDashboard(db, { canManage: true }) });
    }

    if (body.action === "evaluate") {
      const windowDays = Math.min(180, Math.max(7, Number(body.windowDays) || 30));
      const evaluation = await evaluatePersonas(db, { windowDays });
      return json({ evaluation, dashboard: await loadPersonaDashboard(db, { canManage: true }) });
    }

    return json({ message: "Unknown resident action" }, 400);
  } catch (error) {
    console.error("HALO radio persona request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The resident roster is temporarily unavailable" }, 503);
  }
}

export const config = {
  path: "/api/radio/personas"
};
