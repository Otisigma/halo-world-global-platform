// Rules for an artist's editable Artist Shop video gallery.
//
// Nothing from other artists or the global HALO feed is ever injected:
//   - 'dreamweaver_only' (the default) auto-attaches this artist's own Dreamweaver song videos.
//   - 'empty' attaches nothing automatically.
// In both modes the artist can add their own videos manually, pin one, reorder, hide or remove.

export const GALLERY_MODES = ["empty", "dreamweaver_only"];
export const DEFAULT_MODE = "dreamweaver_only";
export const PUBLISH_SCOPES = ["shop_only", "halo_feed"];
export const VIDEO_ORIGINS = ["manual", "dreamweaver"];

export function normaliseSettings(row = {}) {
  return {
    mode: GALLERY_MODES.includes(row.mode) ? row.mode : DEFAULT_MODE,
    pinnedVideoId: row.pinned_video_id ? String(row.pinned_video_id) : "",
    emptyState: {
      title: String(row.empty_title || ""),
      note: String(row.empty_note || ""),
      coverUrl: String(row.empty_cover_url || ""),
      releaseAt: row.empty_release_at ? new Date(row.empty_release_at).toISOString() : ""
    }
  };
}

// True when a video belongs in the shop automatically under the current mode.
export function isAutoAttached(video, { mode, artistSlug }) {
  return mode === "dreamweaver_only" && video.origin === "dreamweaver" && video.artistSlug === artistSlug;
}

// videos: the shop owner's own published videos (already filtered by owner in SQL).
// items:  rows from halo_shop_video_gallery_items for this shop.
// Returns ordered entries; `includeHidden` is for the artist's own editor view.
export function resolveGallery({ artistSlug, settings, videos, items, includeHidden = false }) {
  const itemById = new Map(items.map(item => [String(item.video_id), item]));
  const entries = [];
  for (const video of videos) {
    const item = itemById.get(video.id);
    const auto = isAutoAttached(video, { mode: settings.mode, artistSlug });
    const manual = Boolean(item?.added_manually);
    if (!auto && !manual) continue;
    // A manual addition may only come from this artist room or the owner's unattached videos.
    if (manual && !auto && video.artistSlug && video.artistSlug !== artistSlug) continue;
    const hidden = Boolean(item?.hidden);
    if (hidden && !includeHidden) continue;
    entries.push({
      ...video,
      placement: auto ? "dreamweaver_auto" : "manual",
      hidden,
      pinned: settings.pinnedVideoId === video.id,
      position: item && Number.isFinite(Number(item.position)) && item.position !== null ? Number(item.position) : null
    });
  }
  return entries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.position !== null && b.position !== null && a.position !== b.position) return a.position - b.position;
    if ((a.position === null) !== (b.position === null)) return a.position === null ? 1 : -1;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

// Builds a YouTube-ready draft. The artist copies it; nothing is posted automatically.
export function youtubePackage({ video = {}, song = null, version = null, artistName = "", shopUrl = "" }) {
  const artist = artistName || video.artistName || "HALO artist";
  const songTitle = song?.title || video.title || "Untitled";
  const versionLabel = version?.label && !/^(original|sale master|master)$/i.test(version.label) ? ` (${version.label})` : "";
  const kind = video.origin === "dreamweaver" ? "Dreamweaver Visual" : "Official Visual";
  const title = `${artist} — ${songTitle}${versionLabel} | ${kind}`.slice(0, 100);
  const lines = [
    `${songTitle}${versionLabel} by ${artist}.`,
    video.description ? `\n${video.description}` : "",
    "\nCredits",
    `Artist: ${song?.artistName || artist}`,
    `Song: ${songTitle}`,
    version?.label ? `Version: ${version.label}` : "",
    song?.albumTitle ? `Release: ${song.albumTitle}` : "",
    song?.isrc ? `ISRC: ${song.isrc}` : "",
    video.origin === "dreamweaver" ? "Visual: made with HALO Dreamweaver" : "",
    shopUrl ? `\nListen and buy direct from the artist: ${shopUrl}` : ""
  ].filter(Boolean);
  const tags = [artist, songTitle, version?.label, "HALO", video.origin === "dreamweaver" ? "Dreamweaver" : ""].filter(Boolean);
  return { title, description: lines.join("\n").trim(), tags: [...new Set(tags)] };
}
