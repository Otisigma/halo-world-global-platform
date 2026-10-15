import { createHash } from "node:crypto";
import { RELEASE_STAGES } from "../../lib/release-conveyor-stages.js";
import { PUBLIC_ROUTE_REGISTRY, buildDreamweaverSatellite } from "../../lib/route-registry.js";
import { normalizeLyricsSource, parseTimestampedLyrics } from "../../lib/dreamweaver-lyrics.js";

export const HALO_SHARED_INTENT = Object.freeze({
  version: 1,
  mission: "Prepare pristine masters, preserve creator rights, and bind immersive Dreamweaver assets.",
  stages: RELEASE_STAGES,
  radioDefaults: Object.freeze({ targetLufs: -16, targetTruePeak: -1 }),
  safeguards: ["preserve_originals", "never_grant_approval", "never_publish", "owner_scoped_audit"],
});

const normalizeIsrc = value => String(value || "").trim().toUpperCase().replaceAll("-", "");
const validIsrc = value => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalizeIsrc(value));
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function masterSourceIdentity(master) {
  if (!master) return "";
  return digest([master.id, master.audio_url, master.audio_blob_prefix, master.audio_storage_key,
    master.audio_byte_size, master.audio_chunk_count, master.audio_filename]);
}

export function safeAssetUrl(value) {
  if (!value || typeof value !== "string" || /[\\\s]/.test(value)) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

// History is trusted only for the exact same owned recording, never a title/artist match.
export function trustedMetadataHistory(song, versions, previous) {
  const masters = versions.filter(version => version.version_type === "sale_master" && version.song_id === song.id);
  const master = masters.length === 1 ? masters[0] : null;
  if (!master?.audio_url) return null;
  const documents = previous?.package?.documents;
  const saved = previous?.watchdog?.metadataHistory;
  if (previous?.status === "ready" && previous.package?.council?.passed
    && documents?.releaseId === song.id && documents.rightsStatus === "cleared"
    && validIsrc(documents.isrc)
    && previous.package?.audio?.sourceIdentity === masterSourceIdentity(master)
    && previous.package?.audio?.sourceVersionId === master.id
    && previous.package?.audio?.sourceAudioUrl === master.audio_url) {
    return { songId: song.id, ownerMemberId: song.owner_member_id, sourceVersionId: master.id,
      sourceAudioUrl: master.audio_url, sourceRevision: previous.inputHash,
      sourceIdentity: masterSourceIdentity(master), isrc: normalizeIsrc(documents.isrc), rightsStatus: "cleared" };
  }
  if (saved?.songId === song.id && saved.ownerMemberId === song.owner_member_id
    && saved.sourceIdentity === masterSourceIdentity(master) && validIsrc(saved.isrc)
    && saved.rightsStatus === "cleared") return saved;
  return null;
}

export function inspectHaloRelease({ song, versions, previous, infrastructure = [], assetChecks = [], now = new Date() }) {
  const findings = [];
  const actions = [];
  const masters = versions.filter(version => version.version_type === "sale_master" && version.song_id === song.id);
  const master = masters.length === 1 ? masters[0] : null;
  const history = trustedMetadataHistory(song, versions, previous);
  if (!song.isrc?.trim() && history) {
    actions.push({ type: "restore_isrc", isrc: history.isrc, sourceRevision: history.sourceRevision });
  }
  if (!validIsrc(song.isrc) && !actions.length) {
    findings.push({ field: "isrc", message: "No trusted same-recording identifier is available; creator input required." });
  }
  if (song.rights_status !== "cleared") {
    findings.push({ field: "rights_status", message: "Rights clearance requires explicit creator confirmation; no clearance was granted." });
  }
  const radioLanes = versions.filter(version => ["radio_edit", "clean"].includes(version.version_type));
  if (master?.audio_url && master.mastering_status === "approved" && Number(master.duration_seconds) > 0
    && radioLanes.length && radioLanes.every(version => version.mastering_status === "not_started" && !version.audio_url)) {
    const radio = radioLanes.find(version => version.version_type === "radio_edit") || radioLanes[0];
    actions.push({ type: "auto_queue_radio", versionId: radio.id, sourceVersionId: master.id,
      sourceAudioUrl: master.audio_url, ...HALO_SHARED_INTENT.radioDefaults,
      approvalRequired: true, originalPreserved: true });
  }
  if (!radioLanes.length) findings.push({ field: "radio_master", message: "Radio version slot missing; restore catalog versions before queueing." });

  const artworkUrl = safeAssetUrl(master?.artwork_url || song.artwork_url);
  const videoUrl = safeAssetUrl(master?.video_url || master?.promo_video_url);
  if (!artworkUrl) findings.push({ field: "artwork", message: "Dreamweaver cover artwork is missing or unsafe." });
  if (!videoUrl) findings.push({ field: "video", message: "Dreamweaver companion video is missing or unsafe; immersive graph remains unlocked." });
  const boundVersions = versions.map(version => ({ versionId: version.id,
    artworkUrl: version.artwork_url ? safeAssetUrl(version.artwork_url) : artworkUrl,
    videoUrl: version.video_url || version.promo_video_url ? safeAssetUrl(version.video_url || version.promo_video_url) : videoUrl }));
  const bindings = [
    { url: artworkUrl, type: "image/" }, { url: videoUrl, type: "video/" },
    ...boundVersions.flatMap(version => [
      { url: version.artworkUrl, type: "image/" }, { url: version.videoUrl, type: "video/" },
    ]),
  ].filter(binding => binding.url);
  const boundAssets = [...new Map(bindings.map(binding => [`${binding.type}:${binding.url}`, binding])).values()];
  const verified = binding => assetChecks.some(check => check.url === binding.url
    && check.type === binding.type && check.status === "passed");
  for (const binding of boundAssets) {
    if (!verified(binding)) {
      findings.push({ field: "dreamweaver_assets", message: `${binding.url}: asset missing or not yet verified; graph remains unlocked.` });
    }
  }
  const graph = { songId: song.id, ...buildDreamweaverSatellite(song.id),
    artworkUrl, videoUrl, lyrics: parseTimestampedLyrics(normalizeLyricsSource(song.lyrics_text)),
    versions: boundVersions,
    locked: Boolean(master?.mastering_status === "approved" && Number(master.duration_seconds) > 0 && artworkUrl && videoUrl
      && boundVersions.every(version => version.artworkUrl && version.videoUrl)
      && boundAssets.every(verified)) };
  graph.revision = digest(graph);
  if (graph.locked && previous?.watchdog?.assetGraph?.revision !== graph.revision) {
    actions.push({ type: "lock_dreamweaver_graph", revision: graph.revision });
  }
  for (const route of infrastructure.filter(route => route.status !== "passed")) {
    findings.push({ field: "infrastructure", message: `${route.path}: ${route.status}` });
  }
  return { schemaVersion: HALO_SHARED_INTENT.version, intent: HALO_SHARED_INTENT,
    checkedAt: now.toISOString(), departments: RELEASE_STAGES.map(name => ({
      name, status: previous?.stages?.find(stage => stage.name === name)?.status || "pending",
    })), actions, findings, infrastructure, assetChecks, assetGraph: graph, metadataHistory: history,
    metadataPrefill: history && song.rights_status === "needs_review"
      ? { ...history, reviewRequired: true, appliedRightsClearance: false } : null };
}

const consoleRoutes = new Set(["/song-catalog/", "/release-house/", "/finish-house/", "/radio/", "/dreamweaver/"]);
export const WATCHDOG_ROUTES = Object.freeze(PUBLIC_ROUTE_REGISTRY.filter(route => consoleRoutes.has(route.route)));

// Only fixed registry routes on the configured deployment are probed, never catalog URLs.
export async function auditHaloInfrastructure(baseUrl, { fetcher = fetch } = {}) {
  let origin;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid deployment");
    origin = url.origin;
  } catch {
    return WATCHDOG_ROUTES.map(route => ({ path: route.route, status: "unavailable" }));
  }

  return Promise.all(WATCHDOG_ROUTES.map(async route => {
    try {
      const options = { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(2000) };
      let response = await fetcher(new URL(route.route, origin), options);
      if (response.status === 405) {
        response = await fetcher(new URL(route.route, origin), { ...options, method: "GET", signal: AbortSignal.timeout(2000) });
        await response.body?.cancel();
      }
      return { path: route.route, status: response.ok ? "passed" : "broken", httpStatus: response.status };
    } catch { return { path: route.route, status: "unavailable" }; }
  }));
}

export async function auditHaloAssets({ song, versions }, baseUrl, { fetcher = fetch } = {}) {
  const master = versions.find(version => version.version_type === "sale_master");
  const candidates = [
    { url: safeAssetUrl(master?.artwork_url || song.artwork_url), type: "image/" },
    { url: safeAssetUrl(master?.video_url || master?.promo_video_url), type: "video/" },
    ...versions.flatMap(version => [
      { url: safeAssetUrl(version.artwork_url), type: "image/" },
      { url: safeAssetUrl(version.video_url || version.promo_video_url), type: "video/" },
    ]),
  ].filter(asset => asset.url);
  const assets = [...new Map(candidates.map(asset => [`${asset.type}:${asset.url}`, asset])).values()];
  return Promise.all(assets.map(async (asset, index) => {
    if (index >= 20) return { ...asset, status: "unverified" };
    try {
      const base = new URL(baseUrl);
      const url = new URL(asset.url, base);
      if (base.protocol !== "https:" || url.origin !== base.origin || url.username || url.password
        || (url.pathname.startsWith("/api/") && !["/api/song-catalog/artwork", "/api/videos"].includes(url.pathname))) {
        return { ...asset, status: "unverified" };
      }
      const options = { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(2000) };
      let response = await fetcher(url, options);
      if (response.status === 405) {
        response = await fetcher(url, { ...options, method: "GET",
          headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(2000) });
      }
      await response.body?.cancel();
      return { ...asset, status: response.ok && response.headers.get("content-type")?.startsWith(asset.type)
        ? "passed" : "broken", httpStatus: response.status };
    } catch { return { ...asset, status: "unavailable" }; }
  }));
}
