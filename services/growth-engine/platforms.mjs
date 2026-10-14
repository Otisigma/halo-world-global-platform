export const PLATFORMS = Object.freeze({
  youtube_shorts: Object.freeze({ clipSeconds: 20, width: 1080, height: 1920, titleLimit: 100, descriptionLimit: 5000, hashtags: ["Shorts", "NewMusic"] }),
  tiktok: Object.freeze({ clipSeconds: 15, width: 1080, height: 1920, titleLimit: 100, descriptionLimit: 2200, hashtags: ["NewMusic"] }),
  instagram_reels: Object.freeze({ clipSeconds: 20, width: 1080, height: 1920, titleLimit: 100, descriptionLimit: 2200, hashtags: ["Reels", "NewMusic"] }),
});

export function platformConfig(target) {
  if (!Object.hasOwn(PLATFORMS, target)) throw new Error("Unsupported growth platform");
  return PLATFORMS[target];
}

const text = value => String(value || "").replace(/[\u0000-\u001f<>]/g, "").trim();

export function metadataDraft(release, target) {
  const config = platformConfig(target);
  const title = `${text(release.artistName)} - ${text(release.title)} (Teaser)`.slice(0, config.titleLimit);
  const genre = text(release.genre);
  const tags = [...new Set([genre, text(release.artistName), ...config.hashtags].filter(Boolean))];
  return {
    title,
    description: `${title}\n${genre ? `${genre} · ` : ""}Discover the full release on HALO.\n${config.hashtags.map(tag => `#${tag}`).join(" ")}`.slice(0, config.descriptionLimit),
    tags, categoryId: target === "youtube_shorts" ? "10" : null,
    pinnedComment: "Which moment should we share next?",
    privacyStatus: "private", requiresReview: true,
  };
}

// Paths are worker-local identifiers, never user-supplied URLs or shell fragments.
export function renderPlan(hook, target, variantId, visualKind = "video") {
  const config = platformConfig(target);
  if (!/^[a-zA-Z0-9-]+$/.test(variantId) || !["video", "artwork"].includes(visualKind) ||
      !Number.isFinite(hook.start) || !Number.isFinite(hook.end) || hook.start < 0 || hook.end <= hook.start) {
    throw new Error("Invalid render plan");
  }
  const duration = Math.min(hook.end - hook.start, config.clipSeconds);
  return {
    status: "planned", target, start: hook.start, end: hook.start + duration,
    width: config.width, height: config.height, captions: "requires_timed_transcript",
    command: "ffmpeg",
    args: ["-nostdin", "-n",
      ...(visualKind === "artwork" ? ["-loop", "1"] : ["-ss", String(hook.start)]),
      "-i", visualKind === "artwork" ? "artwork-input" : "video-input",
      "-ss", String(hook.start), "-i", "audio-input", "-t", String(duration),
      "-filter_complex", `[0:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=increase,crop=${config.width}:${config.height},setsar=1[v]`,
      "-map", "[v]", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-movflags", "+faststart", `${variantId}.mp4`],
  };
}
