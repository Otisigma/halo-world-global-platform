import { randomUUID } from "node:crypto";
import { RELEASE_STAGES } from "../../lib/release-conveyor-stages.js";
import { PUBLIC_ROUTE_REGISTRY } from "../../lib/route-registry.js";

export const HALO_MASTER_INTENT = Object.freeze({
  version: 1,
  directive: "Move catalog releases safely from intake through audio, metadata rights, council, Dreamweaver, and distribution.",
  safeguards: Object.freeze([
    "Preserve the canonical sale master and never publish or externally distribute automatically.",
    "Never infer rights clearance or copy recording identifiers from catalog history.",
    "Record every automated repair and infrastructure finding for review.",
  ]),
});

export const HALO_MASTER_DEPARTMENTS = Object.freeze([
  "intake", "audio_preflight", "metadata_rights", "council", "dreamweaver", "distribution", "radio",
]);

export const RADIO_BROADCAST_DEFAULTS = Object.freeze({ targetLufs: -16, targetTruePeakDbtp: -1 });

const INFRASTRUCTURE_ROUTES = Object.freeze(
  ["HALO", "Song Catalog", "Release House", "Finish House", "Radio", "Dreamweaver", "Upload Pipeline"]
    .map(name => PUBLIC_ROUTE_REGISTRY.find(route => route.name === name))
    .filter(Boolean)
    .map(({ name, route }) => ({ name, route })),
);

function safeAssetUrl(value) {
  const candidate = String(value || "").trim();
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

export function buildDreamweaverAssetGraph(song, versions = []) {
  const assets = [];
  const cover = safeAssetUrl(song.artwork_url);
  if (cover) assets.push({ kind: "artwork", url: cover, source: "catalog" });
  for (const version of versions) {
    const artwork = safeAssetUrl(version.artwork_url);
    const video = safeAssetUrl(version.video_url || version.promo_video_url);
    if (artwork) assets.push({ kind: "artwork", url: artwork, versionId: version.id });
    if (video) assets.push({ kind: "video", url: video, versionId: version.id });
  }
  if (!assets.length) return null;
  return {
    locked: true,
    songId: song.id,
    assets,
    versionIds: versions.map(version => version.id),
    lockedAt: new Date().toISOString(),
  };
}

export function buildDepartmentDiagnostics(song, versions, conveyorState, graph) {
  const master = versions.find(version => version.version_type === "sale_master");
  const radio = versions.find(version => ["radio_edit", "clean"].includes(version.version_type));
  const stages = conveyorState?.stages || [];
  const stageStatus = name => stages.find(stage => stage.name === name)?.status || "pending";
  const council = conveyorState?.package?.council;
  const rightsReady = song.rights_status === "cleared" && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(String(song.isrc || "").replaceAll("-", ""));
  return {
    intake: song.pipeline_status || "uploaded",
    audio_preflight: master?.mastering_status || "not_started",
    metadata_rights: rightsReady ? "passed" : "needs_review",
    council: council?.outcome || stageStatus("council"),
    dreamweaver: graph?.locked ? "locked" : stageStatus("dreamweaver"),
    distribution: ["approved", "published"].includes(song.pipeline_status) ? song.pipeline_status : stageStatus("distribution_handoff"),
    radio: radio?.mastering_status || "not_started",
  };
}

export async function auditInfrastructureRoutes({
  routes = INFRASTRUCTURE_ROUTES,
  baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.SITE_URL || "",
  fetcher = fetch,
} = {}) {
  let origin;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("invalid origin");
    origin = parsed.origin;
  } catch {
    return routes.map(({ name, route }) => ({ name, route, status: "not_configured" }));
  }
  return Promise.all(routes.map(async ({ name, route }) => {
    try {
      const response = await fetcher(new URL(route, origin), {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(3000),
      });
      return { name, route, status: response.ok ? "ok" : "broken", httpStatus: response.status };
    } catch {
      return { name, route, status: "broken" };
    }
  }));
}

async function recordEvent(db, scopeId, ownerMemberId, action, details) {
  await db.sql`
    INSERT INTO halo_master_orchestrator_events (id, scope_id, owner_member_id, action, details)
    VALUES (${randomUUID()}, ${scopeId}, ${ownerMemberId || null}, ${action}, ${JSON.stringify(details)}::jsonb)
  `;
}

export async function queueRadioLane(db, song) {
  const saleMaster = await db.sql`
    SELECT id FROM halo_song_versions
    WHERE song_id = ${song.id} AND version_type = 'sale_master' AND status = 'active'
      AND mastering_status = 'approved' AND COALESCE(audio_url, '') <> ''
    ORDER BY updated_at DESC LIMIT 1
  `;
  if (!saleMaster.length) return null;
  const queued = await db.sql`
    UPDATE halo_song_versions
    SET target_lufs = ${RADIO_BROADCAST_DEFAULTS.targetLufs},
      true_peak_dbtp_tenths = ${RADIO_BROADCAST_DEFAULTS.targetTruePeakDbtp * 10},
      mastering_status = 'queued', updated_at = NOW()
    WHERE id = (
      SELECT id FROM halo_song_versions
      WHERE song_id = ${song.id} AND version_type IN ('radio_edit', 'clean')
        AND status = 'active' AND mastering_status = 'not_started'
        AND COALESCE(audio_url, '') = ''
      ORDER BY CASE version_type WHEN 'radio_edit' THEN 0 ELSE 1 END, created_at
      LIMIT 1
    )
      AND EXISTS (
        SELECT 1 FROM halo_song_versions
        WHERE song_id = ${song.id} AND version_type = 'sale_master'
          AND status = 'active' AND mastering_status = 'approved' AND COALESCE(audio_url, '') <> ''
      )
    RETURNING id, version_type
  `;
  if (queued[0]) return { versionId: queued[0].id, versionType: queued[0].version_type, created: false };
  const inserted = await db.sql`
    INSERT INTO halo_song_versions (
      id, song_id, version_type, label, destination, target_lufs, true_peak_dbtp_tenths,
      mastering_status, status, created_at, updated_at
    )
    SELECT ${randomUUID()}, ${song.id}, 'radio_edit', 'Radio edit', 'radio',
      ${RADIO_BROADCAST_DEFAULTS.targetLufs}, ${RADIO_BROADCAST_DEFAULTS.targetTruePeakDbtp * 10},
      'queued', 'active', NOW(), NOW()
    WHERE EXISTS (
      SELECT 1 FROM halo_song_versions
      WHERE song_id = ${song.id} AND version_type = 'sale_master'
        AND status = 'active' AND mastering_status = 'approved' AND COALESCE(audio_url, '') <> ''
    )
      AND NOT EXISTS (
        SELECT 1 FROM halo_song_versions
        WHERE song_id = ${song.id} AND version_type IN ('radio_edit', 'clean') AND status = 'active'
      )
    RETURNING id, version_type
  `;
  return inserted[0] ? { versionId: inserted[0].id, versionType: inserted[0].version_type, created: true } : null;
}

export async function prefillMetadataFromHistory(db, song) {
  const history = await db.sql`
    SELECT genre, album_title
    FROM halo_song_catalog
    WHERE owner_member_id = ${song.owner_member_id} AND id <> ${song.id}
      AND status = 'active' AND metadata_status IN ('ready', 'reviewed')
      AND rights_status = 'cleared'
      AND LOWER(TRIM(artist_name)) = LOWER(TRIM(${song.artist_name}))
      AND LOWER(TRIM(title)) = LOWER(TRIM(${song.title}))
    ORDER BY reviewed_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;
  if (!history[0]) return null;
  const template = history[0];
  const updated = await db.sql`
    UPDATE halo_song_catalog
    SET genre = COALESCE(NULLIF(genre, ''), NULLIF(${template.genre || ""}, '')),
      album_title = COALESCE(NULLIF(album_title, ''), NULLIF(${template.album_title || ""}, '')),
      updated_at = NOW()
    WHERE id = ${song.id} AND owner_member_id = ${song.owner_member_id} AND status = 'active'
      AND (
        (COALESCE(genre, '') = '' AND COALESCE(${template.genre || ""}, '') <> '')
        OR (COALESCE(album_title, '') = '' AND COALESCE(${template.album_title || ""}, '') <> '')
      )
    RETURNING id
  `;
  if (!updated.length) return null;
  return {
    source: "same_owner_exact_artist_title_reviewed_catalog_history",
    fields: ["genre", "album_title"],
    rightsStatusChanged: false,
    isrcCopied: false,
  };
}

async function loadVersions(db, songId) {
  return db.sql`
    SELECT id, version_type, audio_url, mastering_status, target_lufs, true_peak_dbtp_tenths,
      artwork_url, video_url, promo_video_url
    FROM halo_song_versions WHERE song_id = ${songId} AND status = 'active'
    ORDER BY id
  `;
}

async function saveState(db, scopeId, ownerMemberId, state) {
  await db.sql`
    INSERT INTO halo_master_orchestrator_state (scope_id, owner_member_id, intent, state, updated_at)
    VALUES (${scopeId}, ${ownerMemberId || null}, ${JSON.stringify(HALO_MASTER_INTENT)}::jsonb,
      ${JSON.stringify(state)}::jsonb, NOW())
    ON CONFLICT (scope_id) DO UPDATE SET owner_member_id = EXCLUDED.owner_member_id,
      intent = EXCLUDED.intent, state = EXCLUDED.state, updated_at = NOW()
  `;
}

export async function loadSharedOrchestratorState(db, scopeId) {
  const rows = await db.sql`
    SELECT scope_id, owner_member_id, intent, state, updated_at
    FROM halo_master_orchestrator_state WHERE scope_id = ${scopeId}
  `;
  return rows[0] || null;
}

export async function runHaloMasterPulse(db, options = {}) {
  const routes = await auditInfrastructureRoutes(options);
  const brokenRoutes = routes.filter(route => route.status === "broken");
  const globalState = { lastPulseAt: new Date().toISOString(), departments: HALO_MASTER_DEPARTMENTS,
    routes, brokenRoutes, status: brokenRoutes.length ? "degraded" : routes.some(route => route.status === "not_configured") ? "not_configured" : "healthy" };
  await saveState(db, "global", null, globalState);
  await recordEvent(db, "global", null, "infrastructure_audit", globalState);
  const candidates = await db.sql`
    SELECT song.id, song.owner_member_id, song.title, song.artist_name, song.isrc, song.rights_status,
      song.album_title, song.genre, song.explicit_lyrics, song.metadata_status, song.pipeline_status,
      song.artwork_url, song.updated_at
    FROM halo_song_catalog song
    LEFT JOIN halo_master_orchestrator_state state ON state.scope_id = song.id
    WHERE song.status = 'active'
    ORDER BY state.updated_at ASC NULLS FIRST, song.updated_at, song.id
    LIMIT 50
  `;
  const results = [];
  for (const song of candidates) {
    try {
      const actions = [];
      const queuedRadio = await queueRadioLane(db, song);
      if (queuedRadio) {
        const details = { ...queuedRadio, ...RADIO_BROADCAST_DEFAULTS, sourceMasterPreserved: true };
        actions.push({ action: "radio_lane_queued", details });
        await recordEvent(db, song.id, song.owner_member_id, "radio_lane_queued", details);
      }
      const metadataRepair = await prefillMetadataFromHistory(db, song);
      if (metadataRepair) {
        actions.push({ action: "metadata_prefilled_from_history", details: metadataRepair });
        await recordEvent(db, song.id, song.owner_member_id, "metadata_prefilled_from_history", metadataRepair);
      }
      const versions = await loadVersions(db, song.id);
      const prior = await loadSharedOrchestratorState(db, song.id);
      const existingGraph = prior?.state?.dreamweaverAssetGraph;
      const graph = existingGraph?.locked ? existingGraph : buildDreamweaverAssetGraph(song, versions);
      if (graph && !existingGraph?.locked) {
        actions.push({ action: "dreamweaver_asset_graph_locked", details: graph });
        await recordEvent(db, song.id, song.owner_member_id, "dreamweaver_asset_graph_locked", graph);
      }
      const conveyor = await db.sql`
        SELECT state FROM halo_release_conveyor
        WHERE song_id = ${song.id} AND owner_member_id = ${song.owner_member_id}
        LIMIT 1
      `;
      const latestSong = metadataRepair ? (await db.sql`
        SELECT genre, album_title FROM halo_song_catalog
        WHERE id = ${song.id} AND owner_member_id = ${song.owner_member_id}
      `)[0] : song;
      const conveyorState = conveyor[0]?.state || null;
      const diagnostics = buildDepartmentDiagnostics({ ...song, ...latestSong }, versions,
        conveyorState, graph);
      const state = {
        lastPulseAt: new Date().toISOString(),
        departments: diagnostics,
        releaseConveyorStatus: conveyorState?.status || "not_started",
        conveyorStages: RELEASE_STAGES.map(name => conveyorState?.stages?.find(stage => stage.name === name)
          || { name, status: "pending" }),
        dreamweaverAssetGraph: graph || { locked: false, assets: [] },
        actions,
        findings: diagnostics.metadata_rights === "needs_review"
          ? ["Rights clearance and/or a valid ISRC still require explicit creator review; history was not used to certify them."]
          : [],
        status: diagnostics.metadata_rights === "needs_review" ? "needs_review" : "observing",
      };
      await saveState(db, song.id, song.owner_member_id, state);
      results.push({ releaseId: song.id, actions: actions.length, status: state.status });
    } catch {
      const details = { message: "The release could not be inspected; no unverified repair was applied." };
      await recordEvent(db, song.id, song.owner_member_id, "inspection_failed", details).catch(() => {});
      results.push({ releaseId: song.id, actions: 0, status: "retryable" });
    }
  }
  return { scanned: candidates.length, routes, results };
}
