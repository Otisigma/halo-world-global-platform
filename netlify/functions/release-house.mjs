import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const ROOM_COUNT = 13;
const MAX_BODY_BYTES = 120_000;
const ROOM_KEYS = new Set([
  "idea", "writing", "recording", "production", "mix", "rights", "identity",
  "metadata", "distributor", "upload", "campaign", "releaseDay", "afterRelease"
]);

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cleanProjectId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function cleanDate(value) {
  const date = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function cleanRoom(value) {
  return Math.max(1, Math.min(ROOM_COUNT, Number.parseInt(value, 10) || 1));
}

function cleanCompletedRooms(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => Number.parseInt(item, 10)).filter(room => room >= 1 && room <= ROOM_COUNT))]
    .sort((left, right) => left - right);
}

function cleanRoomValue(value, depth = 0) {
  if (depth > 3) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value.trim().slice(0, 6000);
  if (Array.isArray(value)) return value.slice(0, 40).map(item => cleanRoomValue(item, depth + 1)).filter(item => item !== null);
  if (!value || typeof value !== "object") return null;

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 60)
      .map(([key, item]) => [cleanText(key, 80), cleanRoomValue(item, depth + 1)])
      .filter(([key, item]) => key && item !== null)
  );
}

function cleanRoomData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => ROOM_KEYS.has(key))
      .map(([key, item]) => [key, cleanRoomValue(item)])
      .filter(([, item]) => item && typeof item === "object" && !Array.isArray(item))
  );
}

function serializeProject(row) {
  return {
    id: row.id,
    projectName: row.project_name,
    artistName: row.artist_name,
    trackTitle: row.track_title,
    targetReleaseDate: row.target_release_date ? String(row.target_release_date).slice(0, 10) : "",
    currentRoom: Number(row.current_room),
    completedRooms: (row.completed_rooms || []).map(Number),
    roomData: row.room_data || {},
    status: row.status,
    connections: {
      artistPage: row.artist_page_slug ? {
        slug: row.artist_page_slug,
        status: row.artist_page_status,
        releaseId: row.artist_page_release_id || ""
      } : null,
      catalogRelease: row.catalog_release_id ? {
        id: row.catalog_release_id,
        status: row.catalog_release_status
      } : null,
      radioTrack: row.radio_track_id ? {
        id: row.radio_track_id,
        status: row.radio_track_status
      } : null,
      fanCampaign: row.fan_campaign_slug ? {
        slug: row.fan_campaign_slug,
        status: row.fan_campaign_status
      } : null
    },
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

async function loadProjects(db, memberId) {
  const rows = await db.sql`
    SELECT
      project.id, project.project_name, project.artist_name, project.track_title,
      project.target_release_date, project.current_room, project.completed_rooms,
      project.room_data, project.status, project.created_at, project.updated_at,
      artist_page.slug AS artist_page_slug,
      artist_page.status AS artist_page_status,
      artist_page.current_release_id AS artist_page_release_id,
      catalog_release.id AS catalog_release_id,
      catalog_release.status AS catalog_release_status,
      radio_track.id AS radio_track_id,
      radio_track.status AS radio_track_status,
      fan_campaign.slug AS fan_campaign_slug,
      fan_campaign.status AS fan_campaign_status
    FROM halo_release_house_projects project
    LEFT JOIN LATERAL (
      SELECT page.slug, page.status, page.current_release_id
      FROM halo_artist_pages page
      WHERE page.owner_member_id = project.owner_member_id
        AND project.artist_name <> ''
        AND LOWER(page.artist_name) = LOWER(project.artist_name)
      ORDER BY
        CASE WHEN project.track_title <> '' AND LOWER(page.release_title) = LOWER(project.track_title) THEN 0 ELSE 1 END,
        page.updated_at DESC
      LIMIT 1
    ) artist_page ON TRUE
    LEFT JOIN LATERAL (
      SELECT release.id, release.status
      FROM halo_release_campaigns release
      WHERE release.owner_member_id = project.owner_member_id
        AND project.artist_name <> ''
        AND project.track_title <> ''
        AND LOWER(release.artist) = LOWER(project.artist_name)
        AND LOWER(release.title) = LOWER(project.track_title)
      ORDER BY release.updated_at DESC
      LIMIT 1
    ) catalog_release ON TRUE
    LEFT JOIN LATERAL (
      SELECT track.id, track.status
      FROM halo_radio_tracks track
      WHERE track.member_id = project.owner_member_id
        AND project.artist_name <> ''
        AND project.track_title <> ''
        AND LOWER(track.artist_name) = LOWER(project.artist_name)
        AND LOWER(track.title) = LOWER(project.track_title)
      ORDER BY track.updated_at DESC
      LIMIT 1
    ) radio_track ON TRUE
    LEFT JOIN LATERAL (
      SELECT campaign.slug, campaign.status
      FROM halo_fan_vote_campaigns campaign
      JOIN halo_fan_vote_campaign_tracks track ON track.campaign_id = campaign.id
      WHERE campaign.owner_member_id = project.owner_member_id
        AND project.artist_name <> ''
        AND project.track_title <> ''
        AND LOWER(track.artist_name) = LOWER(project.artist_name)
        AND LOWER(track.title) = LOWER(project.track_title)
      ORDER BY campaign.updated_at DESC
      LIMIT 1
    ) fan_campaign ON TRUE
    WHERE project.owner_member_id = ${memberId}
      AND project.status <> 'archived'
    ORDER BY project.updated_at DESC
    LIMIT 20
  `;
  return rows.map(serializeProject);
}

async function createProject(db, membership, payload) {
  const projectName = cleanText(payload.projectName, 120);
  if (!projectName) return json({ message: "Give this release journey a project name" }, 400);

  const id = randomUUID();
  const artistName = cleanText(payload.artistName, 120);
  const trackTitle = cleanText(payload.trackTitle, 160);
  const targetReleaseDate = cleanDate(payload.targetReleaseDate);
  const roomData = cleanRoomData(payload.roomData);
  const completedRooms = cleanCompletedRooms(payload.completedRooms);
  const rows = await db.sql`
    INSERT INTO halo_release_house_projects (
      id, owner_member_id, project_name, artist_name, track_title, target_release_date,
      current_room, completed_rooms, room_data
    ) VALUES (
      ${id}, ${membership.member_id}, ${projectName}, ${artistName}, ${trackTitle}, ${targetReleaseDate},
      ${cleanRoom(payload.currentRoom)}, ${completedRooms}::smallint[], ${JSON.stringify(roomData)}::jsonb
    )
    RETURNING id, project_name, artist_name, track_title, target_release_date, current_room,
      completed_rooms, room_data, status, created_at, updated_at
  `;
  return json({ project: serializeProject(rows[0]), message: "Your release house is ready" }, 201);
}

async function saveProject(db, membership, payload) {
  const id = cleanProjectId(payload.projectId);
  if (!id) return json({ message: "Choose a valid release project" }, 400);

  const projectName = cleanText(payload.projectName, 120);
  if (!projectName) return json({ message: "The project name cannot be empty" }, 400);

  const rows = await db.sql`
    UPDATE halo_release_house_projects SET
      project_name = ${projectName},
      artist_name = ${cleanText(payload.artistName, 120)},
      track_title = ${cleanText(payload.trackTitle, 160)},
      target_release_date = ${cleanDate(payload.targetReleaseDate)},
      current_room = ${cleanRoom(payload.currentRoom)},
      completed_rooms = ${cleanCompletedRooms(payload.completedRooms)}::smallint[],
      room_data = ${JSON.stringify(cleanRoomData(payload.roomData))}::jsonb,
      status = ${payload.status === "released" ? "released" : "active"},
      updated_at = NOW()
    WHERE id = ${id} AND owner_member_id = ${membership.member_id}
    RETURNING id, project_name, artist_name, track_title, target_release_date, current_room,
      completed_rooms, room_data, status, created_at, updated_at
  `;
  if (!rows.length) return json({ message: "That release project was not found" }, 404);
  return json({ project: serializeProject(rows[0]), message: "Progress saved" });
}

async function archiveProject(db, membership, payload) {
  const id = cleanProjectId(payload.projectId);
  if (!id) return json({ message: "Choose a valid release project" }, 400);
  const rows = await db.sql`
    UPDATE halo_release_house_projects
    SET status = 'archived', updated_at = NOW()
    WHERE id = ${id} AND owner_member_id = ${membership.member_id}
    RETURNING id
  `;
  if (!rows.length) return json({ message: "That release project was not found" }, 404);
  return json({ archived: true, projectId: id });
}

export default async function releaseHouseHandler(request) {
  if (!["GET", "POST"].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }

  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) {
      return request.method === "GET"
        ? json({ authenticated: false, projects: [] })
        : json({ message: "Join or sign in to save a release project" }, 401);
    }
    const membership = await ensureMembership(db, user);

    if (request.method === "GET") {
      return json({ authenticated: true, viewer: { name: membership.display_name }, projects: await loadProjects(db, membership.member_id) });
    }

    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin release house actions are not accepted" }, 403);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ message: "This release project is too large to save" }, 413);
    const payload = await request.json().catch(() => null);
    if (!payload) return json({ message: "Request body must be valid JSON" }, 400);
    if (payload.action === "create") return createProject(db, membership, payload);
    if (payload.action === "save") return saveProject(db, membership, payload);
    if (payload.action === "archive") return archiveProject(db, membership, payload);
    return json({ message: "Choose a supported release house action" }, 400);
  } catch (error) {
    console.error("Release house request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The release house is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/release-house" };
