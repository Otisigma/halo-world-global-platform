import { buildDreamweaverSatellite } from "../../lib/route-registry.js";

// Pipeline stages in order.  Departments can only advance; they cannot regress.
const PIPELINE_STAGES = [
  "uploaded",
  "review",
  "mastering",
  "scheduled",
  "published",
  "archived",
];

const UPLOAD_SURFACES = new Set([
  "dreamweaver_lab",
  "music_upload",
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
    stage: row.stage || "uploaded",
    pipelineStatus: row.pipeline_status || "uploaded",
    sourceUploadSurface: row.source_upload_surface || "",
    updatedAt: new Date(row.updated_at).toISOString(),
    dreamweaverSatellite: buildDreamweaverSatellite(row.id),
  };
}

function buildDepartmentViews(row) {
  return {
    artistRoom: {
      stage: row.artist_room_stage || "uploaded",
      ready: row.artist_room_ready || false,
    },
    radioRoom: {
      stage: row.radio_room_stage || "uploaded",
      ready: row.radio_room_ready || false,
    },
    dreamWeaver: {
      stage: row.dreamweaver_stage || "uploaded",
      ready: row.dreamweaver_ready || false,
    },
    salesPublishing: {
      stage: row.sales_publishing_stage || "uploaded",
      ready: row.sales_publishing_ready || false,
    },
  };
}

export default async function handler(request) {
  const url = new URL(request.url);
  const songId = cleanId(url.searchParams.get("songId"));
  if (!songId) return json({ message: "Invalid song id" }, 400);

  return json({
    songId,
    pipeline: serializePipeline({
      id: songId,
      title: "Untitled",
      artist_name: "Unknown",
      stage: "uploaded",
      pipeline_status: "uploaded",
      source_upload_surface: "music_upload",
      updated_at: new Date().toISOString(),
    }),
    departments: buildDepartmentViews({}),
  });
}
