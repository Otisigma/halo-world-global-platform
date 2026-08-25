import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership, isOwner } from "../lib/halo-x.mjs";
import {
  loadArtistAgentDashboard,
  loadArtistPlan,
  reserveArtistRun,
  runArtistAgentTeam,
  setArtistPlan,
  updateArtistAction,
  updateArtistDraft
} from "../lib/artist-agents.mjs";

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanSlug(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-|-$/g, "").slice(0, 80)
    : "";
}

async function bodyFrom(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 12_000) throw new Error("payload_too_large");
  return request.json();
}

// A team belongs to the room it was hired for. Only the artist who owns that room, or the platform
// owner, can read its evidence or act on its proposals.
async function authorize(db, user, slug) {
  if (!user?.id) return { status: 401, message: "Sign in to open this artist's agent team" };
  const rows = await db.sql`SELECT slug, owner_member_id FROM halo_artist_pages WHERE slug = ${slug} LIMIT 1`;
  if (!rows.length) return { status: 404, message: "Artist room not found" };
  const membership = await ensureMembership(db, user);
  const platformOwner = isOwner(user);
  if (!platformOwner && rows[0].owner_member_id !== membership.member_id) {
    return { status: 403, message: "This agent team belongs to another artist room" };
  }
  return { memberId: membership.member_id, platformOwner };
}

export default async function artistAgentsHandler(request) {
  if (!["GET", "POST"].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }

  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    const url = new URL(request.url);

    if (request.method === "GET") {
      const slug = cleanSlug(url.searchParams.get("slug"));
      if (!slug) return json({ message: "Add an artist room handle" }, 400);
      const access = await authorize(db, user, slug);
      if (access.status) return json({ message: access.message }, access.status);
      return json({
        ...await loadArtistAgentDashboard(db, slug),
        viewer: { platformOwner: access.platformOwner }
      });
    }

    if (!(await verifyRequestOrigin(request))) {
      return json({ message: "Request origin could not be verified" }, 403);
    }

    let body;
    try {
      body = await bodyFrom(request);
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === "payload_too_large";
      return json({ message: tooLarge ? "Request is too large" : "Invalid request body" }, tooLarge ? 413 : 400);
    }

    const slug = cleanSlug(body?.slug);
    if (!slug) return json({ message: "Add an artist room handle" }, 400);
    const access = await authorize(db, user, slug);
    if (access.status) return json({ message: access.message }, access.status);

    if (body.action === "run") {
      const plan = await loadArtistPlan(db, slug);
      if (!plan) return json({ message: "This artist room does not have an agent team plan yet" }, 402);
      const reserved = await reserveArtistRun(db, slug);
      if (!reserved) {
        return json({ message: "This plan has used its runs for the current period" }, 429, { "Retry-After": "3600" });
      }
      const report = await runArtistAgentTeam(db, slug, { triggerType: "manual", plan: reserved });
      if (!report) return json({ message: "The artist signals could not be read" }, 503);
      return json({ generated: true, dashboard: await loadArtistAgentDashboard(db, slug) });
    }

    if (body.action === "update_action") {
      const updated = await updateArtistAction(db, slug, body.actionId, body);
      if (!updated) return json({ message: "That proposal could not be updated" }, 400);
      return json({ updated });
    }

    if (body.action === "update_draft") {
      const updated = await updateArtistDraft(db, slug, body.draftId, body, access.memberId);
      if (!updated) return json({ message: "That draft could not be updated" }, 400);
      return json({ updated });
    }

    if (body.action === "set_plan") {
      if (!access.platformOwner) return json({ message: "Plan changes are made by the HALO team" }, 403);
      const plan = await setArtistPlan(db, slug, body, access.memberId);
      if (!plan) return json({ message: "Choose a valid plan tier" }, 400);
      return json({ plan });
    }

    return json({ message: "Unknown agent team action" }, 400);
  } catch (error) {
    console.error("HALO artist agent request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The artist agent team is temporarily unavailable" }, 503);
  }
}

export const config = {
  path: "/api/artist-agents"
};
