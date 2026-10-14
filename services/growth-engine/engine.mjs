import { randomUUID } from "node:crypto";
import { energyFrames, selectHooks } from "./analysis.mjs";
import { metadataDraft, platformConfig, renderPlan } from "./platforms.mjs";

export class GrowthBlocked extends Error {}
export class GrowthInputError extends Error {}

export function campaignInput(song, input) {
  const targets = input.targets ?? ["youtube_shorts"];
  if (!Array.isArray(targets) || !targets.length || targets.length > 3) throw new GrowthInputError("Choose one to three platforms");
  try { targets.forEach(platformConfig); } catch { throw new GrowthInputError("Unsupported growth platform"); }
  if (song.rights_status !== "cleared" || input.rights?.master !== true ||
      input.rights?.visual !== true || input.rights?.promotion !== true) throw new GrowthInputError("Confirm cleared master, visual, and promotional rights");
  if (!song.master_version_id || !(song.audio_url || song.audio_storage_key || song.drive_file_id ||
      (song.audio_blob_prefix && song.audio_chunk_count > 0)) || !Number.isFinite(Number(song.duration_seconds)) ||
      Number(song.duration_seconds) <= 0 || Number(song.duration_seconds) > 7200) throw new GrowthInputError("A completed sale master with duration is required");
  if (!song.video_url && !song.artwork_url) throw new GrowthInputError("A catalog video or artwork is required");
  if (typeof input.requestKey !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.requestKey)) throw new GrowthInputError("A stable requestKey is required");
  let scheduledAt = null;
  if (input.scheduledAt != null) {
    if (typeof input.scheduledAt !== "string" || !Number.isFinite(Date.parse(input.scheduledAt))) throw new GrowthInputError("Invalid schedule");
    scheduledAt = new Date(input.scheduledAt).toISOString();
  }
  return {
    id: randomUUID(), songId: song.id, ownerMemberId: song.owner_member_id, requestKey: input.requestKey,
    snapshot: {
      title: song.title, artistName: song.artist_name, genre: song.genre,
      masterVersionId: song.master_version_id, durationSeconds: Number(song.duration_seconds),
      visualKind: song.video_url ? "video" : "artwork",
      sourceFingerprint: song.source_fingerprint,
    },
    settings: { targets: [...new Set(targets)], scheduledAt, publishApproved: input.publishApproved === true, adsEnabled: false },
    rights: { master: true, visual: true, promotion: true },
  };
}

function nextJob(kind, key, payload = {}) {
  return { id: randomUUID(), kind, key, payload };
}

// Adapters run only in trusted workers; the public API cannot supply results or executable code.
export async function executeJob(job, campaign, adapters = {}) {
  const { snapshot, settings } = campaign;
  if (job.kind === "ingest") {
    return { result: { masterVersionId: snapshot.masterVersionId }, next: [nextJob("analysis", "analysis")] };
  }
  if (job.kind === "analysis") {
    if (!adapters.decodeAudio) throw new GrowthBlocked("Install a trusted audio decoder adapter");
    const pcm = await adapters.decodeAudio(campaign);
    const frames = energyFrames(pcm.samples, pcm.sampleRate);
    const hooks = selectHooks(frames, { durationSeconds: snapshot.durationSeconds });
    const next = settings.targets.flatMap(target => hooks.map(hook =>
      nextJob("render", `render:${target}:${hook.rank}`, { target, hook })));
    return { result: { hooks, model: "rms-window-v1" }, next };
  }
  if (job.kind === "render") {
    const plan = renderPlan(job.payload.hook, job.payload.target, job.id, snapshot.visualKind);
    if (!adapters.render) return {
      result: { plan, status: "planned" },
      next: [nextJob("metadata", `metadata:${job.key}`, { ...job.payload, render: { status: "planned", plan } })],
    };
    const rendered = await adapters.render(plan, campaign, { idempotencyKey: job.id });
    if (rendered?.status !== "ready" || typeof rendered.artifactId !== "string" || !rendered.artifactId ||
        !Array.isArray(rendered.logs)) throw new Error("Renderer must return a ready artifact and render logs");
    return { result: rendered, next: [nextJob("metadata", `metadata:${job.key}`, { ...job.payload, render: rendered })] };
  }
  if (job.kind === "metadata") {
    const metadata = metadataDraft(snapshot, job.payload.target);
    return { result: metadata, next: [nextJob("publish", `publish:${job.key}`, { ...job.payload, metadata })] };
  }
  if (job.kind === "publish") {
    if (!settings.publishApproved) throw new GrowthBlocked("Owner publication approval required");
    if (job.payload.render?.status !== "ready") throw new GrowthBlocked("A real rendered artifact is required; render plans cannot be published");
    const publisher = adapters.publishers?.[job.payload.target];
    if (!publisher?.publish) throw new GrowthBlocked("Platform publishing adapter is not configured");
    const result = await publisher.publish({
      artifactId: job.payload.render.artifactId, metadata: job.payload.metadata,
      scheduledAt: settings.scheduledAt, idempotencyKey: job.id,
    });
    if (!result?.publishId || !["published", "scheduled"].includes(result.status)) throw new Error("Publisher must return a confirmed platform ID and status");
    return { result, next: [nextJob("analytics", `analytics:${job.key}`, { target: job.payload.target, publishId: result.publishId })] };
  }
  if (job.kind === "analytics") {
    const collector = adapters.publishers?.[job.payload.target]?.analytics;
    if (!collector) throw new GrowthBlocked("Platform analytics adapter is not configured");
    const result = await collector(job.payload.publishId);
    if (!result || !Number.isFinite(result.views) || result.views < 0) throw new Error("Analytics must include non-negative views");
    return { result: { ...result, collectedAt: new Date().toISOString() }, next: [] };
  }
  throw new Error("Unknown growth job kind");
}

export const GROWTH_AGENT_ROLES = Object.freeze({
  ingest: "ingest", hook_analyzer: "analysis", teaser_renderer: "render",
  metadata_editor: "metadata", publisher: "publish", performance_collector: "analytics",
});

export async function runGrowthAgent(store, { role, ...options }) {
  if (!Object.hasOwn(GROWTH_AGENT_ROLES, role)) throw new Error("Unknown growth agent role");
  return runNextJob(store, { ...options, kind: GROWTH_AGENT_ROLES[role] });
}

export async function runNextJob(store, { ownerMemberId, campaignId, adapters = {}, kind = null }) {
  const job = await store.claim(ownerMemberId, campaignId, kind);
  if (!job) return { status: "idle" };
  try {
    // Revalidate the live catalog on every attempt, including publish and analytics.
    const campaign = await store.loadAuthorizedCampaign(ownerMemberId, campaignId);
    if (!campaign) throw new GrowthBlocked("Catalog ownership, rights, or master changed; review the campaign");
    const output = await executeJob(job, campaign, adapters);
    const committed = await store.complete(job, output);
    return { status: committed ? "succeeded" : "lease_lost", jobId: job.id };
  } catch (error) {
    const status = error instanceof GrowthBlocked ? "blocked" : "failed";
    // Never persist raw adapter exceptions: OAuth tokens and signed URLs may appear in them.
    const message = status === "blocked" ? error.message : "Growth adapter failed; inspect restricted worker diagnostics";
    const committed = await store.fail(job, status, message);
    return { status: committed ? status : "lease_lost", jobId: job.id };
  }
}
