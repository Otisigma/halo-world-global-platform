/**
 * HALO Data-Driven Creative & Visual Engine (halo-creative-engine.js)
 * Analyzes fan engagement data to auto-generate optimized cover art prompts and assets.
 */

export {
  DEFAULT_DESIGN_CUES,
  DEFAULT_METRICS_PATH,
  DEFAULT_MANIFEST_PATH,
  TAG_DESIGN_MAP,
  analyzeFanPreferences,
  generateOptimizedVisualManifest,
  recordEngagementMetric,
  loadVisualManifests,
  getVisualManifestForRelease,
  default
} from "./lib/halo-creative-engine.js";
