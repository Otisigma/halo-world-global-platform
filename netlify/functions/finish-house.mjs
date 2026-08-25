import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const MAX_BODY_BYTES = 80_000;
const INTENDED_USES = new Set(["streaming", "radio", "club", "film_tv", "games", "general"]);
const MASTERING_STATUSES = new Set(["brief", "requested", "in_progress", "review", "approved"]);
const DELIVERABLES = new Set(["streaming_master", "high_resolution_master", "instrumental", "clean", "performance", "acapella"]);
const LICENSING_STATUSES = new Set(["preparing", "rights_review", "ready", "submitted", "placed", "declined"]);
const DESTINATIONS = new Set(["halo_house", "disco", "sync_library", "music_supervisor", "brand_agency", "games"]);
const CHECKLIST_KEYS = new Set(["masterOwned", "publishingControlled", "splitsConfirmed", "samplesCleared", "metadataComplete", "stemsAvailable", "instrumentalReady", "cleanVersionReady"]);

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function cleanEnum(value, choices, fallback) {
  const cleaned = String(value || "").trim();
  return choices.has(cleaned) ? cleaned : fallback;
}

function cleanDeliverables(value) {
  if (!Array.isArray(value)) return ["streaming_master"];
  const cleaned = [...new Set(value.map(item => String(item || "").trim()).filter(item => DELIVERABLES.has(item)))];
  return cleaned.length ? cleaned : ["streaming_master"];
}

function cleanChecklist(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries([...CHECKLIST_KEYS].map(key => [key, value[key] === true]));
}

function cleanBrief(value) {
  const brief = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    mixUrl: cleanText(brief.mixUrl, 500),
    referenceTracks: cleanText(brief.referenceTracks, 1200),
    sonicDirection: cleanText(brief.sonicDirection, 1600),
    mixNotes: cleanText(brief.mixNotes, 2400),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(brief.deadline || "")) ? String(brief.deadline) : ""
  };
}

function serialize(row) {
  return {
    id: row.id,
    releaseProjectId: row.release_project_id || "",
    artistName: row.artist_name,
    trackTitle: row.track_title,
    intendedUse: row.intended_use,
    masteringStatus: row.mastering_status,
    masteringBrief: row.mastering_brief || {},
    requestedDeliverables: row.requested_deliverables || [],
    licensingChecklist: row.licensing_checklist || {},
    licensingStatus: row.licensing_status,
    licensingDestination: row.licensing_destination,
    submissionNotes: row.submission_notes,
    status: row.status,
    releaseProjectName: row.release_project_name || "",
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

async function loadWorkspace(db, memberId) {
  const [projectRows, releaseRows] = await Promise.all([
    db.sql`
      SELECT finish.*, release.project_name AS release_project_name
      FROM halo_finish_house_projects finish
      LEFT JOIN halo_release_house_projects release ON release.id = finish.release_project_id
      WHERE finish.owner_member_id = ${memberId} AND finish.status = 'active'
      ORDER BY finish.updated_at DESC
    `,
    db.sql`
      SELECT id, project_name, artist_name, track_title, completed_rooms, updated_at
      FROM halo_release_house_projects
      WHERE owner_member_id = ${memberId} AND status <> 'archived'
      ORDER BY updated_at DESC
    `
  ]);
  return {
    projects: projectRows.map(serialize),
    releaseProjects: releaseRows.map(row => ({
      id: row.id,
      projectName: row.project_name,
      artistName: row.artist_name,
      trackTitle: row.track_title,
      mixRoomComplete: (row.completed_rooms || []).map(Number).includes(5)
    }))
  };
}

async function createProject(db, membership, payload) {
  const releaseProjectId = cleanId(payload.releaseProjectId);
  let artistName = cleanText(payload.artistName, 120);
  let trackTitle = cleanText(payload.trackTitle, 160);
  if (releaseProjectId) {
    const releaseRows = await db.sql`
      SELECT artist_name, track_title FROM halo_release_house_projects
      WHERE id = ${releaseProjectId} AND owner_member_id = ${membership.member_id} AND status <> 'archived'
      LIMIT 1
    `;
    if (!releaseRows.length) return json({ message: "That release project was not found" }, 404);
    artistName = artistName || releaseRows[0].artist_name;
    trackTitle = trackTitle || releaseRows[0].track_title;
    const existingRows = await db.sql`
      SELECT finish.*, release.project_name AS release_project_name
      FROM halo_finish_house_projects finish
      LEFT JOIN halo_release_house_projects release ON release.id = finish.release_project_id
      WHERE finish.owner_member_id = ${membership.member_id}
        AND finish.release_project_id = ${releaseProjectId}
        AND finish.status = 'active'
      LIMIT 1
    `;
    if (existingRows.length) return json({ project: serialize(existingRows[0]), message: "Finish House reopened" });
  }
  if (!artistName && !trackTitle) return json({ message: "Add an artist or track name to start" }, 400);

  const rows = await db.sql`
    INSERT INTO halo_finish_house_projects (
      id, owner_member_id, release_project_id, artist_name, track_title, intended_use
    ) VALUES (
      ${randomUUID()}, ${membership.member_id}, ${releaseProjectId || null},
      ${artistName}, ${trackTitle}, ${cleanEnum(payload.intendedUse, INTENDED_USES, "streaming")}
    )
    RETURNING *
  `;
  return json({ project: serialize(rows[0]), message: "Finish House opened" }, 201);
}

async function saveProject(db, membership, payload) {
  const id = cleanId(payload.projectId);
  if (!id) return json({ message: "Choose a valid finish project" }, 400);
  const masteringStatus = cleanEnum(payload.masteringStatus, MASTERING_STATUSES, "brief");
  const masteringBrief = cleanBrief(payload.masteringBrief);
  const requestedDeliverables = cleanDeliverables(payload.requestedDeliverables);
  const licensingChecklist = cleanChecklist(payload.licensingChecklist);
  const licensingStatus = cleanEnum(payload.licensingStatus, LICENSING_STATUSES, "preparing");
  if (masteringStatus !== "brief" && !masteringBrief.mixUrl) {
    return json({ message: "Add the approved mix link before moving the mastering request forward" }, 400);
  }
  if (["ready", "submitted", "placed"].includes(licensingStatus)) {
    const clearanceComplete = [...CHECKLIST_KEYS].every(key => licensingChecklist[key] === true);
    if (masteringStatus !== "approved" || !clearanceComplete || !requestedDeliverables.includes("instrumental")) {
      return json({ message: "Approve the master, confirm every clearance item, and add an instrumental before marking this package ready" }, 400);
    }
  }
  const rows = await db.sql`
    UPDATE halo_finish_house_projects SET
      artist_name = ${cleanText(payload.artistName, 120)},
      track_title = ${cleanText(payload.trackTitle, 160)},
      intended_use = ${cleanEnum(payload.intendedUse, INTENDED_USES, "streaming")},
      mastering_status = ${masteringStatus},
      mastering_brief = ${JSON.stringify(masteringBrief)}::jsonb,
      requested_deliverables = ${requestedDeliverables}::text[],
      licensing_checklist = ${JSON.stringify(licensingChecklist)}::jsonb,
      licensing_status = ${licensingStatus},
      licensing_destination = ${cleanEnum(payload.licensingDestination, DESTINATIONS, "halo_house")},
      submission_notes = ${cleanText(payload.submissionNotes, 4000)},
      updated_at = NOW()
    WHERE id = ${id} AND owner_member_id = ${membership.member_id} AND status = 'active'
    RETURNING *
  `;
  if (!rows.length) return json({ message: "That finish project was not found" }, 404);
  return json({ project: serialize(rows[0]), message: "Finish House saved" });
}

async function archiveProject(db, membership, payload) {
  const id = cleanId(payload.projectId);
  if (!id) return json({ message: "Choose a valid finish project" }, 400);
  const rows = await db.sql`
    UPDATE halo_finish_house_projects SET status = 'archived', updated_at = NOW()
    WHERE id = ${id} AND owner_member_id = ${membership.member_id}
    RETURNING id
  `;
  if (!rows.length) return json({ message: "That finish project was not found" }, 404);
  return json({ archived: true, projectId: id });
}

export default async function finishHouseHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return request.method === "GET"
      ? json({ authenticated: false, projects: [], releaseProjects: [] })
      : json({ message: "Join or sign in to use Finish House" }, 401);
    const membership = await ensureMembership(db, user);
    if (request.method === "GET") {
      return json({ authenticated: true, viewer: { name: membership.display_name }, ...(await loadWorkspace(db, membership.member_id)) });
    }
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin Finish House actions are not accepted" }, 403);
    }
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ message: "This finish brief is too large to save" }, 413);
    const payload = await request.json().catch(() => null);
    if (!payload) return json({ message: "Request body must be valid JSON" }, 400);
    if (payload.action === "create") return createProject(db, membership, payload);
    if (payload.action === "save") return saveProject(db, membership, payload);
    if (payload.action === "archive") return archiveProject(db, membership, payload);
    return json({ message: "Choose a supported Finish House action" }, 400);
  } catch (error) {
    console.error("Finish House request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Finish House is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/finish-house" };
