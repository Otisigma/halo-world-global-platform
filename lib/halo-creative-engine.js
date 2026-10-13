import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export const DEFAULT_METRICS_PATH = path.join(projectRoot, "data", "fan_engagement_metrics.json");
export const DEFAULT_MANIFEST_PATH = path.join(projectRoot, "data", "visual_manifests.json");

export const DEFAULT_DESIGN_CUES = Object.freeze({
  dominant_mood: "atmospheric deep house",
  top_tag: "Resonance",
  color_palette: "dark amber and obsidian"
});

export const TAG_DESIGN_MAP = Object.freeze({
  Resonance: {
    dominant_mood: "atmospheric deep house",
    top_tag: "Resonance",
    color_palette: "dark amber and obsidian"
  },
  Tension: {
    dominant_mood: "underground club pulse",
    top_tag: "Tension",
    color_palette: "deep bronze and matte black"
  },
  Release: {
    dominant_mood: "euphoric peak-time terrace",
    top_tag: "Release",
    color_palette: "electric violet and luminous gold"
  },
  Clarity: {
    dominant_mood: "minimalist hypnotic groove",
    top_tag: "Clarity",
    color_palette: "cool cyan and platinum"
  },
  Shift: {
    dominant_mood: "progressive melodic ascent",
    top_tag: "Shift",
    color_palette: "deep ultraviolet and radiant amber"
  },
  Focus: {
    dominant_mood: "deep nocturnal techno",
    top_tag: "Focus",
    color_palette: "matte carbon and neon emerald"
  },
  Unfiltered: {
    dominant_mood: "raw analog warehouse sound",
    top_tag: "Unfiltered",
    color_palette: "industrial rust and warm tungsten"
  }
});

function cleanText(value, fallback = "") {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : fallback;
}

/**
 * Analyzes fan engagement data and extracts winning design cues.
 * Supports metrics from disk or passed in-memory, aggregating listening
 * retention and Signal chat tags for specific tracks/versions or globally.
 */
export function analyzeFanPreferences(options = {}) {
  const query = typeof options === "string" ? { trackId: options } : options;
  const metricsPath = query.metricsPath || DEFAULT_METRICS_PATH;
  let metrics = query.metricsData || null;

  if (!metrics) {
    if (!fs.existsSync(metricsPath)) {
      return { ...DEFAULT_DESIGN_CUES };
    }
    try {
      metrics = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
    } catch {
      return { ...DEFAULT_DESIGN_CUES };
    }
  }

  if (!metrics || typeof metrics !== "object") {
    return { ...DEFAULT_DESIGN_CUES };
  }

  const tracks = Array.isArray(metrics.tracks) ? metrics.tracks : [];
  const targetTrackId = cleanText(query.trackId || query.releaseId).toLowerCase();
  const targetTitle = cleanText(query.trackTitle || query.title).toLowerCase();
  const targetVersionId = cleanText(query.versionId).toLowerCase();

  // If specific track is requested, search for matching track records
  let matchedTrack = null;
  if (targetTrackId || targetTitle || targetVersionId) {
    matchedTrack = tracks.find(track => {
      const matchTrackId = targetTrackId && cleanText(track.track_id).toLowerCase() === targetTrackId;
      const matchTitle = targetTitle && cleanText(track.track_title).toLowerCase() === targetTitle;
      const matchVersion = targetVersionId && cleanText(track.version_id).toLowerCase() === targetVersionId;
      return matchTrackId || matchTitle || matchVersion;
    });
  }

  // If matched track has its own winning design cues defined, return them
  if (matchedTrack?.design_cues && typeof matchedTrack.design_cues === "object") {
    return {
      dominant_mood: cleanText(matchedTrack.design_cues.dominant_mood, DEFAULT_DESIGN_CUES.dominant_mood),
      top_tag: cleanText(matchedTrack.design_cues.top_tag, DEFAULT_DESIGN_CUES.top_tag),
      color_palette: cleanText(matchedTrack.design_cues.color_palette, DEFAULT_DESIGN_CUES.color_palette)
    };
  }

  // If metrics has predefined winning_design_cues and no explicit track override was matched
  if (metrics.winning_design_cues && typeof metrics.winning_design_cues === "object" && !matchedTrack) {
    return {
      dominant_mood: cleanText(metrics.winning_design_cues.dominant_mood, "underground club pulse"),
      top_tag: cleanText(metrics.winning_design_cues.top_tag, "Tension"),
      color_palette: cleanText(metrics.winning_design_cues.color_palette, "deep bronze and matte black")
    };
  }

  // Aggregate tags and retention
  const tagCounts = new Map();
  const countTag = tag => {
    if (typeof tag === "string" && tag.trim()) {
      const cleaned = cleanText(tag);
      tagCounts.set(cleaned, (tagCounts.get(cleaned) || 0) + 1);
    }
  };

  const tracksToScan = matchedTrack ? [matchedTrack] : tracks;
  for (const track of tracksToScan) {
    if (Array.isArray(track.signal_tags)) {
      track.signal_tags.forEach(countTag);
    }
  }

  if (Array.isArray(metrics.signal_tags)) {
    metrics.signal_tags.forEach(countTag);
  }

  if (Array.isArray(metrics.events)) {
    for (const event of metrics.events) {
      if (event.tag) countTag(event.tag);
      if (event.signal_tag) countTag(event.signal_tag);
      if (event.word) countTag(event.word);
    }
  }

  let topTag = null;
  let maxCount = -1;
  for (const [tag, count] of tagCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      topTag = tag;
    }
  }

  // If top tag maps to predefined cues, use them
  if (topTag && TAG_DESIGN_MAP[topTag]) {
    return { ...TAG_DESIGN_MAP[topTag] };
  }

  if (topTag) {
    return {
      dominant_mood: matchedTrack?.dominant_mood || "underground club pulse",
      top_tag: topTag,
      color_palette: matchedTrack?.color_palette || "deep bronze and matte black"
    };
  }

  if (metrics.winning_design_cues && typeof metrics.winning_design_cues === "object") {
    return {
      dominant_mood: cleanText(metrics.winning_design_cues.dominant_mood, "underground club pulse"),
      top_tag: cleanText(metrics.winning_design_cues.top_tag, "Tension"),
      color_palette: cleanText(metrics.winning_design_cues.color_palette, "deep bronze and matte black")
    };
  }

  return { ...DEFAULT_DESIGN_CUES };
}

/**
 * Generates an optimized visual manifest and cinematic cover-art prompt for a release.
 * Persists to project pipeline in data/visual_manifests.json.
 */
export function generateOptimizedVisualManifest({
  trackTitle = "Untitled Track",
  artistName = "Owen Anthony",
  versionType = "canonical_release",
  versionId = null,
  trackId = null,
  designCues = null,
  manifestPath = DEFAULT_MANIFEST_PATH,
  metricsPath = DEFAULT_METRICS_PATH,
  metricsData = null,
  persist = true,
  createdAt = null
} = {}) {
  const cleanTitle = cleanText(trackTitle, "Untitled Track");
  const cleanArtist = cleanText(artistName, "Owen Anthony");

  const preferences = designCues || analyzeFanPreferences({
    trackId,
    trackTitle: cleanTitle,
    versionId,
    metricsPath,
    metricsData
  });

  const visualPrompt = `Cinematic single cover art for '${cleanTitle}' by ${cleanArtist}. Vibe: ${preferences.dominant_mood}, evoking a sense of ${preferences.top_tag}. Color palette dominated by ${preferences.color_palette}. High-end luxury vinyl aesthetic, clean typography layout, minimalist underground electronic music design, 8k resolution.`;

  const assetPackage = {
    release_title: cleanTitle,
    artist: cleanArtist,
    version_type: versionType,
    version_id: versionId,
    track_id: trackId,
    design_cues_used: preferences,
    generated_prompt: visualPrompt,
    status: "READY_FOR_GENERATION",
    created_at: createdAt || new Date().toISOString()
  };

  if (persist) {
    try {
      let manifests = [];
      if (fs.existsSync(manifestPath)) {
        try {
          const raw = fs.readFileSync(manifestPath, "utf8");
          manifests = JSON.parse(raw);
          if (!Array.isArray(manifests)) manifests = [];
        } catch {
          manifests = [];
        }
      }
      manifests.unshift(assetPackage);
      const dir = path.dirname(manifestPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(manifestPath, JSON.stringify(manifests, null, 2));
    } catch (err) {
      // If filesystem write fails in restricted/read-only environments, continue gracefully
      console.warn(`[HALO Creative Engine] Could not persist manifest to ${manifestPath}: ${err.message}`);
    }
  }

  return {
    success: true,
    message: "Visual manifest generated successfully based on community engagement data.",
    assetPackage
  };
}

/**
 * Captures/records engagement analytics such as listening duration, replay counts,
 * and Signal chat word tags tied to a specific track/version.
 */
export function recordEngagementMetric({
  trackId = "default-track",
  versionId = null,
  trackTitle = "",
  artistName = "",
  durationSeconds = 0,
  listenDurationMs = null,
  replayCount = 0,
  replays = 0,
  signalTags = [],
  signalTag = null,
  metricsPath = DEFAULT_METRICS_PATH
} = {}) {
  const finalDurationSeconds = Number(durationSeconds) || (listenDurationMs ? Math.round(Number(listenDurationMs) / 1000) : 0);
  const finalReplayCount = Number(replayCount) || Number(replays) || 0;
  let metrics = { tracks: [], winning_design_cues: null };

  if (fs.existsSync(metricsPath)) {
    try {
      metrics = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
      if (!metrics || typeof metrics !== "object") metrics = { tracks: [] };
      if (!Array.isArray(metrics.tracks)) metrics.tracks = [];
    } catch {
      metrics = { tracks: [] };
    }
  }

  const tagsToAdd = [
    ...(Array.isArray(signalTags) ? signalTags : []),
    ...(typeof signalTag === "string" && signalTag.trim() ? [signalTag.trim()] : [])
  ];

  let track = metrics.tracks.find(t =>
    (trackId && t.track_id === trackId) ||
    (trackTitle && cleanText(t.track_title).toLowerCase() === cleanText(trackTitle).toLowerCase())
  );

  if (!track) {
    track = {
      track_id: trackId,
      version_id: versionId,
      track_title: trackTitle,
      artist_name: artistName,
      listen_duration_seconds: finalDurationSeconds,
      replay_count: finalReplayCount,
      signal_tags: tagsToAdd
    };
    metrics.tracks.push(track);
  } else {
    if (versionId) track.version_id = versionId;
    if (trackTitle && !track.track_title) track.track_title = trackTitle;
    if (artistName && !track.artist_name) track.artist_name = artistName;
    track.listen_duration_seconds = (track.listen_duration_seconds || 0) + finalDurationSeconds;
    track.replay_count = (track.replay_count || 0) + finalReplayCount;
    if (!Array.isArray(track.signal_tags)) track.signal_tags = [];
    track.signal_tags.push(...tagsToAdd);
  }

  // Update winning design cues
  const updatedCues = analyzeFanPreferences({ metricsData: metrics });
  metrics.winning_design_cues = updatedCues;

  const dir = path.dirname(metricsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));

  return {
    success: true,
    track,
    recorded: {
      trackId: track.track_id,
      trackTitle: track.track_title,
      tag: signalTag || null,
      signalTags: tagsToAdd,
      listenDurationMs,
      durationSeconds: finalDurationSeconds,
      replayCount: finalReplayCount
    },
    winning_design_cues: updatedCues
  };
}

/**
 * Loads persisted visual manifests from data/visual_manifests.json.
 */
export function loadVisualManifests(options = {}) {
  const manifestPath = typeof options === "string" ? options : (options?.manifestPath || DEFAULT_MANIFEST_PATH);
  if (!fs.existsSync(manifestPath)) return [];
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const manifests = JSON.parse(raw);
    return Array.isArray(manifests) ? manifests : [];
  } catch {
    return [];
  }
}

/**
 * Retrieves a visual manifest by track title or id.
 */
export function getVisualManifestForRelease(identifier, options = {}) {
  const manifestPath = typeof options === "string" ? options : (options?.manifestPath || DEFAULT_MANIFEST_PATH);
  const manifests = loadVisualManifests(manifestPath);
  const cleanId = cleanText(identifier).toLowerCase();
  if (!cleanId) return null;

  return manifests.find(m =>
    cleanText(m.release_title).toLowerCase() === cleanId ||
    cleanText(m.track_id).toLowerCase() === cleanId ||
    cleanText(m.version_id).toLowerCase() === cleanId
  ) || null;
}

export default {
  DEFAULT_DESIGN_CUES,
  DEFAULT_METRICS_PATH,
  DEFAULT_MANIFEST_PATH,
  TAG_DESIGN_MAP,
  analyzeFanPreferences,
  generateOptimizedVisualManifest,
  recordEngagementMetric,
  loadVisualManifests,
  getVisualManifestForRelease
};
