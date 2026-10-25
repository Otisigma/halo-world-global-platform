import { createHash, randomUUID } from "node:crypto";
import { PUBLIC_ROUTE_REGISTRY } from "../../lib/route-registry.js";
import { RELEASE_AGENT_INTENT } from "../../lib/release-conveyor-stages.js";
import { releaseFingerprint } from "./release-conveyor.mjs";
import { canPrepareRadio, proposedRadioRoom } from "./radio-preparation.mjs";

const normalizeIsrc = value => String(value || "").trim().toUpperCase().replaceAll("-", "");
const validIsrc = value => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalizeIsrc(value));
const masterOf = versions => versions.find(version => version.version_type === "sale_master");
const sourceKey = master => master?.audio_storage_key || master?.audio_blob_prefix || master?.audio_url;
const problem = (field, message) => ({ field, message, outcome: "escalate" });

export const WATCHDOG_ROUTES = Object.freeze(PUBLIC_ROUTE_REGISTRY
  .filter(entry => ["/song-catalog/", "/upload-pipeline/", "/finish-house/", "/release-house/", "/dreamweaver/", "/radio/", "/toolost/"].includes(entry.route))
  .map(entry => entry.route));

function safeAsset(value) {
  if (typeof value !== "string" || !value || /[\s\\]/.test(value)) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : "";
  } catch { return ""; }
}

export function metadataTemplate(song, versions) {
  const master = masterOf(versions);
  if (versions.filter(version => version.version_type === "sale_master").length !== 1
    || master?.song_id !== song.id || !master.audio_url || !validIsrc(song.isrc) || song.rights_status !== "cleared") return null;
  return { songId: song.id, ownerMemberId: song.owner_member_id, masterVersionId: master.id,
    sourceAudioUrl: master.audio_url, sourceKey: sourceKey(master), byteSize: Number(master.audio_byte_size || 0),
    title: song.title, artistName: song.artist_name,
    isrc: normalizeIsrc(song.isrc), rightsStatus: song.rights_status };
}

export function planReleaseRepairs(song, versions, template) {
  const actions = [];
  const master = masterOf(versions);
  const radio = versions.find(version => version.version_type === "radio_edit")
    || versions.find(version => version.version_type === "clean");
  if (canPrepareRadio(song, versions)
    && !versions.some(version => ["radio_edit", "clean"].includes(version.version_type)
      && (version.audio_url || version.mastering_status !== "not_started"))
    && (!radio || radio.mastering_status === "not_started")) {
    actions.push({ type: "auto_queue_radio", versionId: radio?.id || randomUUID(),
      targetLufs: -16, targetTruePeak: -1, sourceVersionId: master.id,
      sourceAudioUrl: master.audio_url, proposedRoom: proposedRadioRoom(song.genre),
      approvalRequired: true });
  }
  const trusted = master?.song_id === song.id && template && template.songId === song.id && template.ownerMemberId === song.owner_member_id
    && template.masterVersionId === master?.id && template.sourceAudioUrl === master?.audio_url
    && template.sourceKey === sourceKey(master) && template.byteSize === Number(master?.audio_byte_size || 0)
    && template.title === song.title && template.artistName === song.artist_name
    && template.rightsStatus === "cleared" && validIsrc(template.isrc)
    && (!String(song.isrc || "").trim() || normalizeIsrc(song.isrc) === normalizeIsrc(template.isrc));
  if (trusted && !String(song.isrc || "").trim()) {
    actions.push({ type: "apply_metadata_template", isrc: normalizeIsrc(template.isrc), source: template });
  }
  return { actions, rightsSuggestion: trusted && ["", "needs_review"].includes(song.rights_status)
    ? { source: template, requiresCreatorConfirmation: true } : null };
}

// Only a configured deployment origin is probed. Catalog URLs cannot select a host or follow redirects.
export function createInfrastructureChecker(origin, fetcher = fetch, { deadline = Infinity } = {}) {
  let base;
  try {
    base = new URL(origin);
    if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/") return null;
  } catch { return null; }
  const cache = new Map();
  let active = 0;
  const waiting = [];
  async function probe(path) {
    if (!safeAsset(path)) return { url: path, status: "invalid" };
    const url = new URL(path, base);
    if (url.origin !== base.origin) return { url: path, status: "unverified_external" };
    const mediaEndpoint = ["/api/song-catalog/artwork", "/api/radio/artwork"].includes(url.pathname)
      || (url.pathname === "/api/videos" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url.searchParams.get("media") || ""));
    if (url.pathname.startsWith("/api/") && !mediaEndpoint) {
      return { url: path, status: "unverified_endpoint" };
    }
    if (!WATCHDOG_ROUTES.includes(url.pathname) && !mediaEndpoint
      && !/\.(?:png|jpe?g|webp|gif|avif|svg|mp4|webm|mov)$/i.test(url.pathname)) {
      return { url: path, status: "unverified_endpoint" };
    }
    if (active >= 4) await new Promise(resolve => waiting.push(resolve));
    active++;
    try {
      if (Date.now() >= deadline - 1500) return { url: path, status: "deferred" };
      const response = await fetcher(url.href, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(1500) });
      return { url: path, status: response.ok ? "passed" : [401, 403].includes(response.status)
        ? "restricted" : "broken", httpStatus: response.status };
    } catch { return { url: path, status: "unavailable" }; }
    finally { active--; waiting.shift()?.(); }
  }
  return path => {
    if (!cache.has(path)) cache.set(path, cache.size < 64 ? probe(path)
      : Promise.resolve({ url: path, status: "deferred" }));
    return cache.get(path);
  };
}

export async function inspectReleaseAssets(song, versions, check) {
  const master = masterOf(versions);
  const artwork = safeAsset(master?.artwork_url || song.artwork_url);
  const video = safeAsset(master?.video_url || master?.promo_video_url);
  const nodes = versions.map(version => ({ versionId: version.id, type: version.version_type,
    audioUrl: safeAsset(version.audio_url), artworkUrl: safeAsset(version.artwork_url) || artwork,
    videoUrl: safeAsset(version.video_url || version.promo_video_url) || video }));
  const urls = [...new Set(nodes.flatMap(node => [node.artworkUrl, node.videoUrl]).filter(Boolean))];
  const assets = check ? await Promise.all(urls.map(check)) : urls.map(url => ({ url, status: "not_checked" }));
  const issues = [];
  for (const value of versions.flatMap(version => [version.audio_url, version.artwork_url, version.video_url, version.promo_video_url])) {
    if (value && !safeAsset(value)) issues.push(problem("asset", "A catalog version contains an invalid asset URL; review its source."));
  }
  if (!master?.audio_url) issues.push(problem("sale_master_audio", "Upload the canonical sale master; no backup source can be inferred."));
  if (!artwork) issues.push(problem("artwork", "Dreamweaver needs valid cover artwork."));
  if (!video) issues.push(problem("video", "Dreamweaver immersive graph needs a video or promo loop."));
  for (const asset of assets) {
    if (["invalid", "broken", "unavailable"].includes(asset.status)) {
      issues.push(problem("asset", `Asset ${asset.url}: ${asset.status}.`));
    }
  }
  if (assets.some(asset => !["passed", "broken", "invalid", "unavailable"].includes(asset.status))) {
    issues.push(problem("asset_verification", "Dreamweaver asset availability is not verified; the graph remains unlocked."));
  }
  const locked = Boolean(!issues.length && artwork && video && safeAsset(master?.audio_url) && master.mastering_status === "approved" && assets.length
    && assets.every(asset => asset.status === "passed"));
  const graph = { locked, nodes, assets, lyricsText: song.lyrics_text || "",
    revision: createHash("sha256").update(JSON.stringify({ nodes, lyrics: song.lyrics_text || "",
      sourceKey: sourceKey(master), masteringStatus: master?.mastering_status })).digest("hex") };
  return { graph, issues };
}

export async function healCatalogRelease(db, ownerMemberId, songId, token, submission, options) {
  const { song, versions } = submission;
  let template = null;
  if (!String(song.isrc || "").trim() || song.rights_status === "needs_review") {
    const history = await db.sql`
      SELECT details->'template' AS template FROM halo_release_conveyor_events
      WHERE song_id = ${songId} AND owner_member_id = ${ownerMemberId}
        AND stage = 'metadata_rights' AND details->>'status' IN ('passed', 'repaired')
        AND details->'template' IS NOT NULL
      ORDER BY created_at DESC LIMIT 1
    `;
    template = history[0]?.template;
  }
  const plan = planReleaseRepairs(song, versions, template);
  const repairs = [];
  for (const action of plan.actions) {
    const details = JSON.stringify({ ...action, actor: "release_watchdog", originalPreserved: true });
    const inputHash = releaseFingerprint(song, versions, options);
    // Lock the owner/song and lease, then mutate and append its audit event atomically.
    const rows = action.type === "apply_metadata_template" ? await db.sql`
      WITH guarded AS (
        SELECT song.id FROM halo_song_catalog song JOIN halo_release_conveyor conveyor ON conveyor.song_id = song.id
        JOIN halo_song_versions master ON master.song_id = song.id
        WHERE song.id = ${songId} AND song.owner_member_id = ${ownerMemberId} AND song.status = 'active'
          AND song.updated_at = ${song.updated_at} AND song.isrc = ''
          AND conveyor.owner_member_id = ${ownerMemberId} AND conveyor.lease_token = ${token} AND conveyor.locked_until > NOW()
          AND master.id = ${action.source.masterVersionId} AND master.version_type = 'sale_master'
          AND master.status = 'active' AND master.audio_url = ${action.source.sourceAudioUrl}
          AND COALESCE(NULLIF(master.audio_storage_key, ''), NULLIF(master.audio_blob_prefix, ''), master.audio_url) = ${action.source.sourceKey}
          AND master.audio_byte_size = ${action.source.byteSize}
        FOR UPDATE OF song, conveyor, master
      ), repaired AS (
        UPDATE halo_song_catalog SET isrc = ${action.isrc}, updated_at = NOW()
        WHERE id IN (SELECT id FROM guarded) RETURNING id
      )
      INSERT INTO halo_release_conveyor_events (id, song_id, owner_member_id, input_hash, stage, details)
      SELECT ${randomUUID()}, id, ${ownerMemberId}, ${inputHash}, 'watchdog_repair', ${details}::jsonb FROM repaired RETURNING id
    ` : await db.sql`
      WITH guarded AS (
        SELECT song.id FROM halo_song_catalog song JOIN halo_release_conveyor conveyor ON conveyor.song_id = song.id
        JOIN halo_song_versions master ON master.song_id = song.id
        WHERE song.id = ${songId} AND song.owner_member_id = ${ownerMemberId} AND song.status = 'active'
          AND song.updated_at = ${song.updated_at}
          AND song.broadcast_requested = TRUE AND song.rights_status = 'cleared'
          AND conveyor.owner_member_id = ${ownerMemberId} AND conveyor.lease_token = ${token} AND conveyor.locked_until > NOW()
          AND master.id = ${action.sourceVersionId} AND master.version_type = 'sale_master' AND master.status = 'active'
          AND master.audio_url = ${action.sourceAudioUrl} AND master.mastering_status = 'approved' AND master.duration_seconds > 0
          AND COALESCE(master.audio_blob_prefix, '') = ${masterOf(versions).audio_blob_prefix || ""}
          AND COALESCE(master.audio_storage_key, '') = ${masterOf(versions).audio_storage_key || ""}
          AND master.audio_content_type = ${masterOf(versions).audio_content_type}
          AND master.audio_byte_size = ${Number(masterOf(versions).audio_byte_size)}
          AND COALESCE(master.audio_chunk_count, 0) = ${Number(masterOf(versions).audio_chunk_count || 0)}
          AND NOT EXISTS (SELECT 1 FROM halo_song_versions WHERE song_id = song.id AND status = 'active'
            AND version_type IN ('radio_edit', 'clean') AND (audio_url <> '' OR mastering_status <> 'not_started'))
        FOR UPDATE OF song, conveyor, master
      ), repaired AS (
        UPDATE halo_song_versions SET mastering_status = 'queued', target_lufs = -16, true_peak_dbtp_tenths = -10,
          notes = CONCAT(notes, E'\nWatchdog: prepare a separate broadcast copy from ', ${action.sourceVersionId},
            ${`; proposed room: ${action.proposedRoom || "unassigned — operator genre mapping required"}; -16 LUFS / -1 dBTP targets. Clean edit, mastering and operator approval still required.`}), updated_at = NOW()
        WHERE song_id IN (SELECT id FROM guarded) AND id = ${action.versionId} AND status = 'active'
          AND version_type IN ('radio_edit', 'clean') AND mastering_status = 'not_started' AND audio_url = ''
        RETURNING song_id
      ), created AS (
        INSERT INTO halo_song_versions (id, song_id, version_type, label, destination, mastering_status,
          target_lufs, true_peak_dbtp_tenths, notes)
        SELECT ${action.versionId}, id, 'radio_edit', 'Radio edit', 'radio', 'queued', -16, -10,
          ${`Watchdog source: ${action.sourceVersionId}. Proposed room: ${action.proposedRoom || "unassigned — operator genre mapping required"}. Prepare a separate broadcast copy; clean edit, mastering and operator approval required.`}
        FROM guarded WHERE NOT EXISTS (SELECT 1 FROM halo_song_versions WHERE song_id = guarded.id
          AND status = 'active' AND version_type IN ('radio_edit', 'clean'))
        ON CONFLICT (id) DO NOTHING RETURNING song_id
      )
      INSERT INTO halo_release_conveyor_events (id, song_id, owner_member_id, input_hash, stage, details)
      SELECT ${randomUUID()}, song_id, ${ownerMemberId}, ${inputHash}, 'watchdog_repair', ${details}::jsonb
      FROM (SELECT song_id FROM repaired UNION SELECT song_id FROM created) changed RETURNING id
    `;
    if (rows.length) repairs.push(action.type);
  }
  return { repairs, rightsSuggestion: plan.rightsSuggestion };
}

export async function releaseWatchdogDiagnostics(submission, healing, check, routes = []) {
  const { graph, issues } = await inspectReleaseAssets(submission.song, submission.versions, check);
  const proposedRoom = proposedRadioRoom(submission.song.genre);
  if (submission.song.broadcast_requested === true && !proposedRoom) {
    issues.push(problem("radio_room", "Broadcast requested, but this genre has no supported radio room mapping; operator assignment is required."));
  }
  for (const route of routes) {
    if (route.status !== "passed") issues.push(problem("route", `Department route ${route.url}: ${route.status}.`));
  }
  if (healing.rightsSuggestion) issues.push(problem("rights_status", "Trusted historical rights template available; creator confirmation is required."));
  return { schemaVersion: 1, intent: RELEASE_AGENT_INTENT, checkedAt: new Date().toISOString(),
    repairs: healing.repairs, rightsSuggestion: healing.rightsSuggestion,
    radioPreparation: { requested: submission.song.broadcast_requested === true, proposedRoom, approvalRequired: true },
    graph, routes, issues };
}
