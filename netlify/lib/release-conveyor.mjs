import { createHash } from "node:crypto";
import { normalizeLyricsSource, parseTimestampedLyrics } from "../../lib/dreamweaver-lyrics.js";
import { buildDreamweaverSatellite } from "../../lib/route-registry.js";
import { retryReleaseWork } from "./release-conveyor-retry.mjs";

export const RELEASE_STAGES = Object.freeze([
  "intake", "audio_preflight", "metadata_rights", "council",
  "dreamweaver", "documents", "promotion", "distribution_handoff",
]);
export const RELEASE_PIPELINE_VERSION = 2;

export function releaseFingerprint(song, versions, options = { humHz: 0 }) {
  const { updated_at, source_updated_at, ...metadata } = song;
  const audioVersions = versions.map(({ updated_at, ...version }) => version);
  return createHash("sha256").update(JSON.stringify({ pipelineVersion: RELEASE_PIPELINE_VERSION, song: metadata, versions: audioVersions, options })).digest("hex");
}

const issue = (field, message, outcome = "repair") => ({ field, message, outcome });
export function validateRelease(song, versions) {
  const issues = [];
  for (const field of ["title", "artist_name", "genre"]) {
    if (!String(song[field] || "").trim()) issues.push(issue(field, `Add ${field.replaceAll("_", " ")} in Song Catalog.`));
  }
  const isrc = String(song.isrc || "").trim().toUpperCase().replaceAll("-", "");
  if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) {
    issues.push(issue("isrc", "Enter a valid assigned ISRC (CC-XXX-YY-NNNNN); HALO does not issue recording identifiers."));
  }
  if (song.rights_status !== "cleared") {
    issues.push(issue("rights_status", "Confirm ownership, sample permissions, collaborators and splits before release.",
      song.rights_status === "disputed" ? "block" : "escalate"));
  }
  const master = versions.find(version => version.version_type === "sale_master");
  if (!master || master.song_id !== song.id) issues.push(issue("catalog", "Connect the canonical sale master to this catalog song.", "block"));
  if (versions.filter(version => version.version_type === "sale_master").length > 1) {
    issues.push(issue("catalog", "Choose one canonical sale master in Song Catalog before release.", "block"));
  }
  if (master && master.mastering_status !== "approved") {
    issues.push(issue("mastering", "Review and approve sale-master mastering in Song Catalog; conditioning does not grant approval.", "escalate"));
  }
  if (!(master?.artwork_url || song.artwork_url)) issues.push(issue("artwork", "Upload final cover artwork."));
  if (song.sale_status === "for_sale" && !(Number(song.sale_price_cents) > 0)) issues.push(issue("price", "Set a sale price before the storefront handoff."));
  const radio = versions.find(version => ["radio_edit", "clean"].includes(version.version_type)
    && version.song_id === song.id && version.audio_url && version.mastering_status === "approved" && Number(version.duration_seconds) > 0);
  if (!radio) issues.push(issue("radio_master", "Upload a dedicated radio/clean edit, add its duration and approve its mastering.", "escalate"));
  for (const existing of Array.isArray(song.metadata_issues) ? song.metadata_issues : []) {
    if (existing.level === "required" && !issues.some(item => item.field === existing.field)) {
      issues.push(issue(existing.field, existing.message || "Resolve this required Dreamweaver review item."));
    }
  }
  return { isrc, issues };
}

export function councilDecision(issues, repairs = []) {
  const outcome = issues.some(item => item.outcome === "block") ? "block"
    : issues.some(item => item.outcome === "escalate") ? "escalate"
      : issues.length || repairs.length ? "repair" : "pass";
  return { outcome, passed: issues.length === 0, issues, repairs,
    scope: "Single-song release gate; DJ set depth and transition checks remain in DJ preflight." };
}

export function buildReleaseDocuments(song, versions, audio, dreamweaver, isrc) {
  return {
    releaseId: song.id, title: song.title, artistName: song.artist_name,
    albumTitle: song.album_title || "", genre: song.genre, isrc, upc: song.upc || "",
    explicitLyrics: Boolean(song.explicit_lyrics), rightsStatus: song.rights_status,
    artworkUrl: versions.find(version => version.version_type === "sale_master")?.artwork_url || song.artwork_url,
    notes: song.notes || "", saleStatus: song.sale_status, salePriceCents: song.sale_price_cents,
    currency: song.currency || "USD", audio, dreamweaver,
    versions: versions.map(version => ({ id: version.id, type: version.version_type,
      audioUrl: version.audio_url || "", durationSeconds: Number(version.duration_seconds || 0),
      masteringStatus: version.mastering_status })),
    rightsChecklist: ["Ownership, samples, features and splits confirmed in the catalog.",
      "Creator retains rights; this package does not transfer ownership.",
      "Clearance status is a creator declaration, not a legal certification."],
    publicationChecklist: ["Review the conditioned copy against the original.",
      "Use the existing HALO publication controls when ready.",
      "Submit to external distributors separately; this package is not proof of delivery."],
  };
}

export function buildReleasePromotion(song, dreamweaver, versions = []) {
  const title = String(song.title).replace(/[\r\n]/g, " ");
  const artist = String(song.artist_name).replace(/[\r\n]/g, " ");
  return {
    headline: `${artist} — ${title}`,
    shortCopy: `Discover “${title}” by ${artist}. Explore the song and its story on HALO.`,
    pressWriteup: `${artist} presents “${title}”, a ${song.genre} release${song.album_title ? ` from ${song.album_title}` : ""}. Explore the music, lyrics and release details on HALO.`,
    socialCopy: `“${title}” — ${artist}\nExplore the release: ${dreamweaver.experienceUrl}`,
    artworkUrl: versions.find(version => version.version_type === "sale_master")?.artwork_url || song.artwork_url || "", sharePath: dreamweaver.experienceUrl,
    altText: `Cover artwork for ${title} by ${artist}`,
    status: "draft_for_creator_review",
  };
}

function receipt(state) {
  return {
    releaseId: state.releaseId, revision: state.inputHash, status: state.status,
    ready: state.status === "ready", retryable: state.status === "retryable",
    passed: state.stages.filter(stage => ["passed", "repaired"].includes(stage.status)).map(stage => stage.name),
    repaired: state.stages.flatMap(stage => stage.repairs || []),
    blocked: state.stages.flatMap(stage => stage.issues || []),
    nextRetryAt: state.nextRetryAt || null,
    automaticAttempts: state.automaticAttempts || 0,
    nextSteps: state.status === "ready"
      ? ["Download the release kit and review the conditioned copy.", "Use existing publication controls; external distribution is not submitted."]
      : state.stages.flatMap(stage => stage.issues || []).map(item => item.message),
    stages: RELEASE_STAGES.map(name => state.stages.find(stage => stage.name === name) || { name, status: "pending" }),
    council: state.package.council || null,
    handoff: state.package.handoff || null,
  };
}

// Ports isolate durable storage and audio work from the deterministic release stages.
export async function runReleaseConveyor({ song, versions, previous, ports, options = { humHz: 0 }, automatic = false }) {
  const inputHash = releaseFingerprint(song, versions, options);
  const reuse = previous?.inputHash === inputHash;
  const sourceTimes = [song.updated_at, ...versions.map(version => version.updated_at)]
    .map(value => new Date(value || 0).getTime()).filter(Number.isFinite);
  const sourceUpdatedAt = Math.max(0, ...sourceTimes);
  const state = { releaseId: song.id, inputHash, options, status: "processing",
    pipelineVersion: RELEASE_PIPELINE_VERSION,
    sourceUpdatedAt: song.source_updated_at || (sourceUpdatedAt ? new Date(sourceUpdatedAt).toISOString() : null),
    stages: reuse ? [...previous.stages] : [], package: reuse ? { ...previous.package } : {},
    automaticAttempts: automatic && reuse ? Number(previous.automaticAttempts || 0) : 0 };
  const waiting = automatic && (["blocked", "escalated"].includes(previous?.status)
    || (previous?.status === "retryable" && new Date(previous.nextRetryAt).getTime() > Date.now()));
  if (reuse && (previous.status === "ready" || waiting)) {
    await ports.assertCurrent();
    if (previous.sourceUpdatedAt === state.sourceUpdatedAt) return { ...previous, receipt: receipt(previous) };
    const current = { ...previous, sourceUpdatedAt: state.sourceUpdatedAt, receipt: receipt(previous) };
    await ports.finish(current);
    return current;
  }
  let activeStage = "intake";
  async function stage(name, work) {
    activeStage = name;
    if (state.stages.some(item => item.name === name && ["passed", "repaired"].includes(item.status))) return;
    const resumed = state.stages.some(item => item.name === name && item.status === "failed");
    state.stages = state.stages.filter(item => item.name !== name);
    let retries = 0;
    const result = await retryReleaseWork(work, { sleep: ports.sleep, onRetry: () => retries++ });
    const repairs = [...(result.repairs || []), ...(resumed ? [`${name}: resumed successfully after an interrupted or failed run.`] : []),
      ...(retries ? [`${name}: recovered after ${retries} transient retries.`] : [])];
    state.stages.push({ name, status: result.issues?.length ? "blocked" : repairs.length ? "repaired" : "passed", ...result, repairs, attempts: retries + 1 });
    await ports.checkpoint(state);
  }
  try {
    await stage("intake", async () => ({ summary: "Catalog song and canonical versions accepted; release ID preserved." }));
    await stage("audio_preflight", async () => {
      const audio = await ports.prepareAudio(song, versions, inputHash, options);
      state.package.audio = audio;
      return { summary: audio.summary, issues: audio.issues || [], repairs: audio.repairs || [] };
    });
    await stage("metadata_rights", async () => {
      const validation = validateRelease(song, versions);
      state.package.isrc = validation.isrc;
      const repairs = validation.issues.some(item => item.field === "isrc") || song.isrc === validation.isrc
        ? [] : ["ISRC formatting normalized in the release package; identifier unchanged."];
      return { issues: validation.issues, repairs };
    });
    await stage("council", async () => {
      const issues = state.stages.flatMap(item => item.issues || []);
      const repairs = state.stages.flatMap(item => item.repairs || []);
      const council = councilDecision(issues, repairs);
      state.package.council = council;
      return { summary: `Council: ${council.outcome}`, issues: [], outcome: council.outcome,
        status: council.passed ? (repairs.length ? "repaired" : "passed") : "blocked" };
    });
    if (!state.package.council.passed) {
      state.status = state.package.council.outcome === "escalate" ? "escalated" : "blocked";
    } else {
      await stage("dreamweaver", async () => {
        const lyricsText = normalizeLyricsSource(song.lyrics_text);
        const lyrics = parseTimestampedLyrics(lyricsText);
        state.package.dreamweaver = { ...buildDreamweaverSatellite(song.id), songId: song.id,
          lyricsText, lyrics, mode: lyrics.timed ? "sync" : "book" };
        return { summary: "Existing Dreamweaver route, synced lyrics, lyric-book fallback and Oracle insights packaged." };
      });
      await stage("documents", async () => {
        state.package.documents = buildReleaseDocuments(song, versions, state.package.audio,
          state.package.dreamweaver, state.package.isrc);
        return { summary: "Release manifest and rights/publication checklists generated." };
      });
      await stage("promotion", async () => {
        state.package.promotion = buildReleasePromotion(song, state.package.dreamweaver, versions);
        return { summary: "Deterministic press, social, artwork and share copy generated for creator review." };
      });
      await stage("distribution_handoff", async () => {
        await ports.assertCurrent();
        state.package.handoff = await ports.handoff(state);
        return { summary: "Package prepared for existing publication controls; no external delivery claimed." };
      });
      await ports.assertCurrent();
      state.status = "ready";
      state.automaticAttempts = 0;
    }
  } catch (error) {
    state.status = "retryable";
    state.automaticAttempts++;
    state.nextRetryAt = new Date(Date.now() + Math.min(60, 2 ** state.automaticAttempts) * 60_000).toISOString();
    if (state.automaticAttempts >= 5) {
      state.status = "escalated";
      state.nextRetryAt = null;
    }
    state.stages = state.stages.filter(item => item.name !== activeStage);
    state.stages.push({ name: activeStage, status: "failed", issues: [
      issue(activeStage, state.status === "escalated"
        ? "Automatic recovery reached its limit. Check storage/database health, then retry from Song Catalog; your master is preserved."
        : "This department is temporarily unavailable or the song changed. Automatic recovery is scheduled; you can also retry from Song Catalog.", state.status === "escalated" ? "escalate" : "retry"),
    ] });
  }
  state.receipt = receipt(state);
  await ports.finish(state);
  return state;
}
