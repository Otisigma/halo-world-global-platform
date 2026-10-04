import { getCreatorPassEntitlements } from "./creator-pass.js";

export const THEMES = Object.freeze({
  GOLD: Object.freeze({ name: "Gold", accent: "#d6ad69", requiredStems: 0, requiredSplits: 0 }),
  BRONZE: Object.freeze({ name: "Bronze", accent: "#cd9c73", requiredStems: 1, requiredSplits: 0 }),
  COPPER: Object.freeze({ name: "Copper", accent: "#e5a18a", requiredStems: 5, requiredSplits: 0 }),
  PLATINUM: Object.freeze({ name: "Platinum", accent: "#d9e3ef", requiredStems: 5, requiredSplits: 1 })
});

export const CURATED_LOOPS = Object.freeze([
  Object.freeze({ id: "obsidian-gold-dust", name: "Obsidian Gold Dust", url: "/music-home/loops/obsidian-gold-dust.mp4", requiredStems: 0, requiredSplits: 0 }),
  Object.freeze({ id: "deep-house-smoke", name: "Late-Night Studio Smoke", url: "/music-home/loops/deep-house-smoke.mp4", requiredStems: 1, requiredSplits: 0 }),
  Object.freeze({ id: "vinyl-caustics", name: "Vinyl & Water Light", url: "/music-home/loops/vinyl-caustics.mp4", requiredStems: 5, requiredSplits: 1 })
]);
export const MODULE_TYPES = Object.freeze(["PEARL_HALL", "SOVEREIGN_VAULT", "SIGNAL_FEED", "COLLAB_BRIEFS"]);
export const MAX_CUSTOM_VIDEO_BYTES = 4 * 1024 * 1024;

export function getMusicHomeUnlocks(milestones = {}) {
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const stems = count(milestones.stemUploads), splits = count(milestones.completedSplits);
  const earned = item => stems >= item.requiredStems && splits >= item.requiredSplits;
  return {
    themes: Object.keys(THEMES).filter(key => earned(THEMES[key])),
    backgrounds: CURATED_LOOPS.filter(earned).map(loop => loop.id),
    badges: [
      ...(stems >= 1 ? ["FIRST_STEM"] : []),
      ...(stems >= 5 ? ["STEM_COLLECTOR"] : []),
      ...(splits >= 1 ? ["SPLITS_COMPLETED"] : [])
    ]
  };
}

export function defaultMusicHomeConfig(creatorId) {
  return {
    schemaVersion: 1, creatorId, theme: "GOLD", backgroundMode: "SOLID_OBSIDIAN",
    selectedBackgroundUrl: "", unlockedBadges: [],
    layoutModules: MODULE_TYPES.map((type, order) => ({ id: type, type, order, isVisible: true })),
    isSovereignModeActive: false
  };
}

export function normalizeMusicHomeConfig(input, context, { strict = false } = {}) {
  const { creatorId, pass, milestones, customBackgroundUrl = "" } = context;
  const defaults = defaultMusicHomeConfig(creatorId);
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const unlocks = getMusicHomeUnlocks(milestones);
  const premium = getCreatorPassEntitlements(pass).customArtistRoom;
  const reject = message => { if (strict) throw new Error(message); };
  if (strict && (source.schemaVersion !== 1 || source.creatorId !== creatorId)) reject("Invalid Music Home owner or schema version.");
  let theme = source.theme ?? defaults.theme;
  if (strict && typeof source.theme !== "string") reject("Invalid theme.");
  if (!unlocks.themes.includes(theme)) { reject("This theme has not been earned."); theme = defaults.theme; }
  let backgroundMode = source.backgroundMode ?? defaults.backgroundMode;
  if (strict && (typeof source.backgroundMode !== "string" || typeof source.selectedBackgroundUrl !== "string")) reject("Invalid background setting.");
  let selectedBackgroundUrl = "";
  if (backgroundMode === "CURATED_LOOP") {
    const loop = CURATED_LOOPS.find(item => item.url === source.selectedBackgroundUrl && unlocks.backgrounds.includes(item.id));
    if (!loop) { reject("This curated loop has not been earned."); backgroundMode = "SOLID_OBSIDIAN"; }
    else selectedBackgroundUrl = loop.url;
  } else if (backgroundMode === "CUSTOM_UPLOAD") {
    const expected = `/api/music-home?creator=${encodeURIComponent(creatorId)}&asset=background`;
    if (!premium || customBackgroundUrl !== expected || source.selectedBackgroundUrl !== expected) {
      reject("An active Premium Creator Pass and an owned MP4 upload are required.");
      backgroundMode = "SOLID_OBSIDIAN";
    } else selectedBackgroundUrl = expected;
  } else if (backgroundMode !== "SOLID_OBSIDIAN") {
    reject("Invalid background mode."); backgroundMode = "SOLID_OBSIDIAN";
  }
  if (strict && !Array.isArray(source.layoutModules)) reject("Invalid module layout.");
  const modules = Array.isArray(source.layoutModules) ? source.layoutModules : defaults.layoutModules;
  const validModules = modules.length === MODULE_TYPES.length &&
    new Set(modules.map(item => item?.type)).size === MODULE_TYPES.length &&
    new Set(modules.map(item => item?.order)).size === MODULE_TYPES.length &&
    modules.every(item => item && MODULE_TYPES.includes(item.type) && item.id === item.type &&
      Number.isInteger(item.order) && item.order >= 0 && item.order < MODULE_TYPES.length &&
      typeof item.isVisible === "boolean");
  if (!validModules) reject("Each layout module must have a unique position and a visibility setting.");
  if (source.isSovereignModeActive === true && !premium) reject("Sovereign Mode requires an active Premium Creator Pass.");
  if (strict && typeof source.isSovereignModeActive !== "boolean") reject("Invalid Sovereign Mode setting.");
  return {
    ...defaults, theme, backgroundMode, selectedBackgroundUrl, unlockedBadges: unlocks.badges,
    layoutModules: (validModules ? modules : defaults.layoutModules)
      .map(({ type, order, isVisible }) => ({ id: type, type, order, isVisible })).sort((a, b) => a.order - b.order),
    isSovereignModeActive: premium && source.isSovereignModeActive === true
  };
}

export function validateCustomVideo(bytes, mime) {
  if (mime !== "video/mp4" || !(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > MAX_CUSTOM_VIDEO_BYTES) {
    throw new Error("Upload an MP4 video no larger than 4 MiB.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  let offset = 0, fileType = false, movie = false, media = false;
  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset), type = text(offset + 4, offset + 8);
    if (size < 8 || offset + size > bytes.length) throw new Error("Invalid MP4 container.");
    if (type === "ftyp") {
      if (offset !== 0 || size < 16 || !/^(isom|iso[2-9]|mp4[12]|avc1|M4V )$/.test(text(offset + 8, offset + 12))) {
        throw new Error("Unsupported MP4 container.");
      }
      fileType = true;
    }
    if (type === "moov") movie = true;
    if (type === "mdat") media = size > 8;
    offset += size;
  }
  if (offset !== bytes.length || !fileType || !movie || !media) throw new Error("Invalid MP4 container.");
  return true;
}
