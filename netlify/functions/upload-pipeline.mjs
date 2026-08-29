import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const MAX_BODY_BYTES = 40_000;
const PIPELINE_STAGES = new Set([
  "uploaded",
  "processing",
  "needs_assets",
  "dreamweaver_in_progress",
  "ready_for_radio",
  "ready_for_sale",
  "approved",
  "published",
]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function cleanEnum(value, choices, fallback) {
  const cleaned = String(value || "").trim();
  return choices.has(cleaned) ? cleaned : fallback;
}

function stageSortOrder(stage) {
  const order = ["uploaded", "processing", "needs_assets", "dreamweaver_in_progress", "ready_for_radio", "ready_for_sale", "approved", "published"];
  const idx = order.indexOf(stage);
  return idx === -1 ? order.length : idx;
}

async function loadPipeline(db, ownerMemberId, department) {
  // Load all active songs with their pipeline stages and linked radio tracks.
  const stageSql = department === "radio"
    ? `AND s.pipeline_status IN ('ready_for_radio', 'approved', 'published')`
    : department === "sales"
      ? `AND s.pipeline_status IN ('ready_for_sale', 'approved', 'published')`
      : department === "dreamweaver"
        ? `AND s.pipeline_status IN ('needs_assets', 'dreamweaver_in_progress', 'ready_for_radio')`
        : "";

  const rows = await db.sql`
    SELECT
      s.id,
      s.artist_name,
      s.title,
      s.album_title,
      s.genre,
      s.artwork_url,
      s.pipeline_status,
      s.pipeline_updated_at,
      s.metadata_status,
      s.metadata_score,
      s.rights_status,
      s.sale_status,
      s.updated_at,
      s.created_at,
      rt.id AS radio_track_id,
      rt.status AS radio_track_status,
      rt.room AS radio_room
    FROM halo_song_catalog s
    LEFT JOIN halo_radio_tracks rt ON rt.master_song_id = s.id AND rt.status NOT IN ('rejected')
    WHERE s.owner_member_id = ${ownerMemberId}
      AND s.status = 'active'
      ${db.sql.raw(stageSql)}
    ORDER BY s.updated_at DESC
    LIMIT 200
  `;

  const itemMap = new Map();
  for (const row of rows) {
    if (itemMap.has(row.id)) {
      const existing = itemMap.get(row.id);
      if (row.radio_track_id) {
        existing.radioTracks.push({
          id: row.radio_track_id,
          status: row.radio_track_status || "",
          room: row.radio_room || "",
        });
      }
      continue;
    }
    const item = {
      id: row.id,
      artistName: row.artist_name,
      title: row.title,
      albumTitle: row.album_title || "",
      genre: row.genre || "",
      artworkUrl: row.artwork_url || "",
      pipelineStatus: row.pipeline_status || "uploaded",
      pipelineUpdatedAt: row.pipeline_updated_at ? new Date(row.pipeline_updated_at).toISOString() : "",
      metadataStatus: row.metadata_status || "needs_review",
      metadataScore: Number(row.metadata_score || 0),
      rightsStatus: row.rights_status || "needs_review",
      saleStatus: row.sale_status || "for_sale",
      updatedAt: new Date(row.updated_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      radioTracks: row.radio_track_id
        ? [{ id: row.radio_track_id, status: row.radio_track_status || "", room: row.radio_room || "" }]
        : [],
    };
    itemMap.set(row.id, item);
  }

  const items = [...itemMap.values()];

  items.sort((a, b) => stageSortOrder(a.pipelineStatus) - stageSortOrder(b.pipelineStatus) || new Date(b.updatedAt) - new Date(a.updatedAt));
  return items;
}

async function setStage(db, ownerMemberId, payload) {
  const songId = cleanId(payload.songId);
  const stage = cleanEnum(payload.stage, PIPELINE_STAGES, "");
  if (!songId || !stage) return json({ message: "Choose a valid song and a recognised pipeline stage" }, 400);
  const rows = await db.sql`
    UPDATE halo_song_catalog
    SET pipeline_status = ${stage},
        pipeline_updated_at = NOW(),
        updated_at = NOW()
    WHERE id = ${songId}
      AND owner_member_id = ${ownerMemberId}
      AND status = 'active'
    RETURNING id
  `;
  if (!rows.length) return json({ message: "That song was not found" }, 404);
  return json({ message: `Song moved to ${stage.replace(/_/g, " ")}`, songId, stage });
}

async function linkRadioTrack(db, ownerMemberId, payload) {
  const songId = cleanId(payload.songId);
  const radioTrackId = cleanId(payload.radioTrackId);
  if (!songId || !radioTrackId) return json({ message: "Provide a valid song and radio track" }, 400);

  // Verify the song belongs to this owner.
  const songs = await db.sql`SELECT id FROM halo_song_catalog WHERE id = ${songId} AND owner_member_id = ${ownerMemberId} AND status = 'active' LIMIT 1`;
  if (!songs.length) return json({ message: "That song was not found" }, 404);

  // Verify the radio track belongs to this member.
  const tracks = await db.sql`SELECT id FROM halo_radio_tracks WHERE id = ${radioTrackId} AND member_id = ${ownerMemberId} LIMIT 1`;
  if (!tracks.length) return json({ message: "That radio track was not found" }, 404);

  await db.sql`UPDATE halo_radio_tracks SET master_song_id = ${songId}, updated_at = NOW() WHERE id = ${radioTrackId}`;
  return json({ message: "Radio track linked to the master song", songId, radioTrackId });
}

export default async function handler(request) {
  try {
    const user = getUser(request);
    if (!user?.sub) return json({ message: "Sign in to access the upload pipeline" }, 401);
    const db = await getDatabase();
    const membership = await ensureMembership(db, user);

    if (request.method === "GET") {
      const url = new URL(request.url);
      const department = url.searchParams.get("department") || "all";
      const items = await loadPipeline(db, membership.member_id, department);
      return json({ authenticated: true, items, stageOrder: [...PIPELINE_STAGES] });
    }

    try { verifyRequestOrigin(request); } catch { return json({ message: "Cross-origin pipeline actions are not accepted" }, 403); }
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ message: "This pipeline update is too large" }, 413);
    const payload = await request.json().catch(() => null);
    if (!payload) return json({ message: "Request body must be valid JSON" }, 400);

    if (payload.action === "set_stage") return setStage(db, membership.member_id, payload);
    if (payload.action === "link_radio_track") return linkRadioTrack(db, membership.member_id, payload);

    return json({ message: "Choose a supported pipeline action" }, 400);
  } catch (error) {
    console.error("Upload pipeline request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The upload pipeline is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/upload-pipeline" };
