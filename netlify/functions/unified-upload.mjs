import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import { appendLedgerEntry } from "../lib/halo-ledger.mjs";

// Pipeline stages in order.  Departments can only advance; they cannot regress.
const PIPELINE_STAGES = [
  "uploaded",
  "processing",
  "needs_assets",
  "dreamweaver_in_progress",
  "ready_for_radio",
  "ready_for_sale",
  "approved",
  "published",
];

const UPLOAD_SURFACES = new Set([
  "artist_room",
  "radio_room",
  "song_catalog",
  "dreamweaver_lab",
]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function stageIndex(stage) {
  return PIPELINE_STAGES.indexOf(stage);
}

function serializePipeline(row) {
  return {
    songId: row.id,
    title: row.title,
    artistName: row.artist_name,
    pipelineStatus: row.pipeline_status || "uploaded",
    sourceUploadSurface: row.source_upload_surface || "",
    artworkUrl: row.artwork_url || "",
    metadataStatus: row.metadata_status || "needs_review",
    metadataScore: Number(row.metadata_score || 0),
    saleStatus: row.sale_status || "for_sale",
    rightsStatus: row.rights_status || "needs_review",
    genre: row.genre || "",
    updatedAt: new Date(row.updated_at).toISOString(),
    departments: buildDepartmentViews(row),
  };
}

function buildDepartmentViews(row) {
  const stage = row.pipeline_status || "uploaded";
  const idx = stageIndex(stage);
  return {
    artistRoom: {
      visible: true,
      status: stage,
      label: stageLabel(stage),
    },
    radioRoom: {
      visible: idx >= stageIndex("ready_for_radio"),
      status: idx >= stageIndex("ready_for_radio") ? stage : "pending",
      label: idx >= stageIndex("ready_for_radio") ? stageLabel(stage) : "Waiting for approval",
    },
    dreamWeaver: {
      visible: idx >= stageIndex("needs_assets"),
      status: idx >= stageIndex("dreamweaver_in_progress") ? stage : "pending",
      label: idx >= stageIndex("dreamweaver_in_progress") ? stageLabel(stage) : "Awaiting assets",
    },
    salesPublishing: {
      visible: idx >= stageIndex("ready_for_sale"),
      status: idx >= stageIndex("ready_for_sale") ? stage : "pending",
      label: idx >= stageIndex("ready_for_sale") ? stageLabel(stage) : "Not yet approved for sale",
    },
  };
}

function stageLabel(stage) {
  const labels = {
    uploaded: "Uploaded",
    processing: "Processing",
    needs_assets: "Needs Assets",
    dreamweaver_in_progress: "Dream Weaver In Progress",
    ready_for_radio: "Ready for Radio",
    ready_for_sale: "Ready for Sale",
    approved: "Approved",
    published: "Published",
  };
  return labels[stage] || stage;
}

// ----- Actions ---------------------------------------------------------------

/** Create a new master project from any upload surface. */
async function createProject(payload, db, membership) {
  const title = cleanText(payload.title, 200);
  const artistName = cleanText(payload.artistName, 200);
  const surface = UPLOAD_SURFACES.has(payload.surface) ? payload.surface : "song_catalog";
  if (!title || !artistName) return json({ message: "Title and artist name are required" }, 400);

  const existingRows = await db.sql`
    SELECT id FROM halo_song_catalog
    WHERE owner_member_id = ${membership.member_id}
      AND LOWER(title) = LOWER(${title})
      AND LOWER(artist_name) = LOWER(${artistName})
      AND status = 'active'
    LIMIT 1
  `;
  if (existingRows[0]) {
    const row = await getOneSong(db, membership.member_id, existingRows[0].id);
    return json({ message: "Existing master project returned", ...serializePipeline(row), isExisting: true });
  }

  const id = randomUUID();
  const genre = cleanText(payload.genre, 100) || "";
  const albumTitle = cleanText(payload.albumTitle, 200) || "";
  const isrc = cleanText(payload.isrc, 30) || "";
  const upc = cleanText(payload.upc, 30) || "";

  await db.sql`
    INSERT INTO halo_song_catalog (
      id, owner_member_id, artist_name, title, album_title, isrc, upc, genre,
      pipeline_status, source_upload_surface, status, created_at, updated_at
    ) VALUES (
      ${id}, ${membership.member_id}, ${artistName}, ${title}, ${albumTitle},
      ${isrc}, ${upc}, ${genre},
      'uploaded', ${surface}, 'active', NOW(), NOW()
    )
  `;

  // Create a default radio-edit version slot so all departments have a shared
  // version to reference immediately.
  const versionId = randomUUID();
  await db.sql`
    INSERT INTO halo_song_versions (
      id, song_id, version_type, label, destination, status, created_at, updated_at
    ) VALUES (
      ${versionId}, ${id}, 'radio_edit', 'Radio Edit', 'radio', 'active', NOW(), NOW()
    )
  `;

  const row = await getOneSong(db, membership.member_id, id);
  // Fire-and-forget ledger entry — don't block the response if it fails.
  appendLedgerEntry(db, {
    actorId: membership.member_id,
    actorType: "member",
    eventCategory: "upload_event",
    refSongId: id,
    summary: `Master project created: "${title}" by ${artistName}`,
    details: { surface, genre, albumTitle, isrc, upc, versionId },
    pipelineStage: "uploaded",
    outcome: "success",
  }).catch(err => console.error("Ledger create_project entry failed", err instanceof Error ? err.message : err));
  return json({ message: "Master project created", ...serializePipeline(row), versionId, isExisting: false }, 201);
}

/** Advance the pipeline stage for a master project. */
async function advancePipeline(payload, db, membership) {
  const songId = cleanId(payload.songId);
  const toStage = String(payload.toStage || "").trim().toLowerCase();
  if (!songId) return json({ message: "A valid songId is required" }, 400);
  if (stageIndex(toStage) < 0) return json({ message: `"${toStage}" is not a valid pipeline stage` }, 400);

  const rows = await db.sql`
    SELECT id, pipeline_status FROM halo_song_catalog
    WHERE id = ${songId} AND owner_member_id = ${membership.member_id} AND status = 'active'
    LIMIT 1
  `;
  if (!rows[0]) return json({ message: "Master project not found" }, 404);

  const current = rows[0].pipeline_status || "uploaded";
  if (stageIndex(toStage) < stageIndex(current)) {
    return json({ message: `Cannot move backward from "${current}" to "${toStage}"` }, 409);
  }
  if (toStage === current) {
    const row = await getOneSong(db, membership.member_id, songId);
    return json({ message: `Pipeline is already at "${stageLabel(current)}"`, ...serializePipeline(row) });
  }

  await db.sql`
    UPDATE halo_song_catalog
    SET pipeline_status = ${toStage}, updated_at = NOW()
    WHERE id = ${songId}
  `;

  const row = await getOneSong(db, membership.member_id, songId);
  // Fire-and-forget ledger entry for the pipeline stage transition.
  appendLedgerEntry(db, {
    actorId: membership.member_id,
    actorType: "member",
    eventCategory: "upload_event",
    refSongId: songId,
    summary: `Pipeline advanced to "${stageLabel(toStage)}"`,
    details: { fromStage: current, toStage },
    pipelineStage: toStage,
    outcome: "success",
  }).catch(err => console.error("Ledger advance_pipeline entry failed", err instanceof Error ? err.message : err));
  return json({ message: `Pipeline advanced to "${stageLabel(toStage)}"`, ...serializePipeline(row) });
}

/** Get the pipeline status and all department views for a master project. */
async function getPipeline(songId, db, membership) {
  if (!songId) return json({ message: "A valid songId is required" }, 400);
  const row = await getOneSong(db, membership.member_id, songId);
  if (!row) return json({ message: "Master project not found" }, 404);
  return json(serializePipeline(row));
}

/** List all master projects for the current member with their pipeline status. */
async function listPipeline(db, membership) {
  const rows = await db.sql`
    SELECT id, title, artist_name, pipeline_status, source_upload_surface,
      artwork_url, metadata_status, metadata_score, sale_status, rights_status,
      genre, updated_at
    FROM halo_song_catalog
    WHERE owner_member_id = ${membership.member_id} AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 100
  `;
  return json({ songs: rows.map(serializePipeline) });
}

async function getOneSong(db, ownerMemberId, songId) {
  const rows = await db.sql`
    SELECT id, title, artist_name, pipeline_status, source_upload_surface,
      artwork_url, metadata_status, metadata_score, sale_status, rights_status,
      genre, updated_at
    FROM halo_song_catalog
    WHERE id = ${songId} AND owner_member_id = ${ownerMemberId} AND status = 'active'
    LIMIT 1
  `;
  return rows[0] || null;
}

// ----- Handler ---------------------------------------------------------------

export default async function unifiedUploadHandler(request) {
  if (!["GET", "POST"].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405);
  }
  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (!user?.id) return json({ message: "Sign in to use the upload pipeline" }, 401);
    const membership = await ensureMembership(db, user);

    if (request.method === "GET") {
      const url = new URL(request.url);
      const songId = cleanId(url.searchParams.get("songId"));
      if (songId) return getPipeline(songId, db, membership);
      return listPipeline(db, membership);
    }

    try { verifyRequestOrigin(request); } catch {
      return json({ message: "Cross-origin pipeline updates are not accepted" }, 403);
    }

    const payload = await request.json().catch(() => null);
    if (!payload) return json({ message: "Request body must be valid JSON" }, 400);

    if (payload.action === "create_project") return createProject(payload, db, membership);
    if (payload.action === "advance_pipeline") return advancePipeline(payload, db, membership);

    return json({ message: "Choose a supported pipeline action" }, 400);
  } catch (error) {
    console.error("Unified upload pipeline failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The upload pipeline is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/unified-upload" };
