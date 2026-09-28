import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import { reconcilePublishedSong } from "../lib/song-publication.mjs";

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
const STAGE_ORDER = ["uploaded", "processing", "needs_assets", "dreamweaver_in_progress", "ready_for_radio", "ready_for_sale", "approved", "published"];
const WORKFLOW_POLICY = Object.freeze({
  id: "operator-never-the-bottleneck",
  autoAdvanceByDefault: true,
  exceptionOnlyIntervention: true,
  blockedWhen: "missing, unsafe, or ambiguous inputs",
  riskyStageRequiresOperator: "published",
  copy: "HALO auto-advances routine release steps by default and only interrupts the operator when inputs are missing, unsafe, or ambiguous.",
});

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
  const idx = STAGE_ORDER.indexOf(stage);
  return idx === -1 ? STAGE_ORDER.length : idx;
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
      s.sale_price_cents,
      s.updated_at,
      s.created_at,
      COALESCE(version_health.has_sale_master_audio, FALSE) AS has_sale_master_audio,
      COALESCE(version_health.has_radio_audio, FALSE) AS has_radio_audio,
      COALESCE(version_health.has_approved_radio_master, FALSE) AS has_approved_radio_master,
      rt.id AS radio_track_id,
      rt.status AS radio_track_status,
      rt.room AS radio_room
    FROM halo_song_catalog s
    LEFT JOIN LATERAL (
      SELECT
        BOOL_OR(version_type = 'sale_master' AND COALESCE(audio_url, '') <> '') AS has_sale_master_audio,
        BOOL_OR(version_type IN ('radio_edit', 'clean') AND COALESCE(audio_url, '') <> '') AS has_radio_audio,
        BOOL_OR(version_type IN ('radio_edit', 'clean') AND mastering_status = 'approved') AS has_approved_radio_master
      FROM halo_song_versions
      WHERE song_id = s.id
        AND status = 'active'
    ) version_health ON TRUE
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
      salePriceCents: Number(row.sale_price_cents || 0),
      updatedAt: new Date(row.updated_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      hasSaleMasterAudio: row.has_sale_master_audio === true,
      hasRadioAudio: row.has_radio_audio === true,
      hasApprovedRadioMaster: row.has_approved_radio_master === true,
      radioTracks: row.radio_track_id
        ? [{ id: row.radio_track_id, status: row.radio_track_status || "", room: row.radio_room || "" }]
        : [],
    };
    itemMap.set(row.id, item);
  }

  const items = [...itemMap.values()];
  await applyAutoAdvancePolicy(db, ownerMemberId, items);

  items.sort((a, b) => stageSortOrder(a.pipelineStatus) - stageSortOrder(b.pipelineStatus) || new Date(b.updatedAt) - new Date(a.updatedAt));
  return items.map(item => ({
    id: item.id,
    artistName: item.artistName,
    title: item.title,
    albumTitle: item.albumTitle,
    genre: item.genre,
    artworkUrl: item.artworkUrl,
    pipelineStatus: item.pipelineStatus,
    pipelineUpdatedAt: item.pipelineUpdatedAt,
    metadataStatus: item.metadataStatus,
    metadataScore: item.metadataScore,
    rightsStatus: item.rightsStatus,
    saleStatus: item.saleStatus,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    radioTracks: item.radioTracks,
    workflowMode: item.workflowMode,
    operatorGate: item.operatorGate,
    autoAdvancedFrom: item.autoAdvancedFrom || "",
  }));
}

function resolveWorkflowDecision(item) {
  const blockers = [];
  if (!item.artworkUrl) blockers.push("cover artwork is missing");
  if (!item.hasSaleMasterAudio) blockers.push("sale master audio is missing");
  if (!item.hasRadioAudio) blockers.push("radio edit audio is missing");
  if (item.rightsStatus !== "cleared") blockers.push("rights are not cleared");
  if (item.metadataStatus === "needs_attention") blockers.push("Dream Weaver found blocking metadata issues");
  if (item.saleStatus === "for_sale" && item.salePriceCents < 1) blockers.push("sale pricing is missing");

  if (blockers.length) {
    return {
      recommendedStage: "needs_assets",
      requiresOperator: true,
      summary: `Blocked: ${blockers[0]}. HALO continues automatically once this is resolved.`,
      blockers,
    };
  }

  if (item.metadataStatus === "ready") {
    return {
      recommendedStage: "approved",
      requiresOperator: false,
      summary: "No blocker detected. HALO auto-advances this package through routine review stages.",
      blockers: [],
    };
  }

  if (!item.hasApprovedRadioMaster) {
    return {
      recommendedStage: "dreamweaver_in_progress",
      requiresOperator: false,
      summary: "No blocker detected. HALO keeps this package moving while radio mastering finalizes.",
      blockers: [],
    };
  }

  return {
    recommendedStage: item.saleStatus === "not_for_sale" ? "ready_for_radio" : "ready_for_sale",
    requiresOperator: false,
    summary: "No blocker detected. HALO continues this package automatically unless new exceptions appear.",
    blockers: [],
  };
}

async function applyAutoAdvancePolicy(db, ownerMemberId, items) {
  for (const item of items) {
    const decision = resolveWorkflowDecision(item);
    const currentStageIndex = stageSortOrder(item.pipelineStatus);
    const recommendedStageIndex = stageSortOrder(decision.recommendedStage);

    item.operatorGate = {
      requiresOperator: decision.requiresOperator,
      summary: decision.summary,
      blockers: decision.blockers,
    };
    item.workflowMode = decision.requiresOperator ? "exception_only" : "auto_advance";

    if (decision.requiresOperator || decision.recommendedStage === "published" || recommendedStageIndex <= currentStageIndex) {
      continue;
    }

    await db.sql`
      UPDATE halo_song_catalog
      SET pipeline_status = ${decision.recommendedStage},
          pipeline_updated_at = NOW(),
          updated_at = NOW()
      WHERE id = ${item.id}
        AND owner_member_id = ${ownerMemberId}
        AND status = 'active'
        AND pipeline_status = ${item.pipelineStatus}
    `;
    item.autoAdvancedFrom = item.pipelineStatus;
    item.pipelineStatus = decision.recommendedStage;
    item.pipelineUpdatedAt = new Date().toISOString();
  }
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
  if (stage === "published") {
    await reconcilePublishedSong(db, {
      songId,
      ownerMemberId,
      actorId: payload.actorId || "system",
      actorType: "member",
    });
  }
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
    const user = await getUser(request).catch(() => null);
    if (!user?.id) {
      return request.method === "GET"
        ? json({ authenticated: false, items: [], stageOrder: [...PIPELINE_STAGES] })
        : json({ message: "Sign in to access the upload pipeline" }, 401);
    }
    const db = await getDatabase();
    const membership = await ensureMembership(db, user);

    if (request.method === "GET") {
      const url = new URL(request.url);
      const department = url.searchParams.get("department") || "all";
      const items = await loadPipeline(db, membership.member_id, department);
      return json({ authenticated: true, items, stageOrder: [...PIPELINE_STAGES], workflow: WORKFLOW_POLICY });
    }

    try { verifyRequestOrigin(request); } catch { return json({ message: "Cross-origin pipeline actions are not accepted" }, 403); }
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ message: "This pipeline update is too large" }, 413);
    const payload = await request.json().catch(() => null);
    if (!payload) return json({ message: "Request body must be valid JSON" }, 400);

    if (payload.action === "set_stage") return setStage(db, membership.member_id, { ...payload, actorId: membership.actor_id });
    if (payload.action === "link_radio_track") return linkRadioTrack(db, membership.member_id, payload);

    return json({ message: "Choose a supported pipeline action" }, 400);
  } catch (error) {
    console.error("Upload pipeline request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The upload pipeline is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/upload-pipeline" };
