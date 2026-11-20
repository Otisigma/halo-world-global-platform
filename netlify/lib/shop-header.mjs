// Rules for an artist's Artist Shop hero header image.
// Sources: the active theme backdrop (default), an uploaded image, an image URL, or one of
// the artist's own release covers. Focal point and scrim keep the hero copy readable.

export const HEADER_SOURCES = ["theme", "upload", "url", "album_cover"];
export const HEADER_FOCALS = ["top", "center", "bottom", "left", "right"];
export const SCRIM_MIN = 0.1;
export const SCRIM_MAX = 0.92;
export const DEFAULT_SCRIM = 0.62;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const UPLOAD_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function clampScrim(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_SCRIM;
  return Math.round(Math.min(SCRIM_MAX, Math.max(SCRIM_MIN, num)) * 100) / 100;
}

export function normaliseFocal(value) {
  return HEADER_FOCALS.includes(value) ? value : "center";
}

// Same-site paths or https URLs only; never data:, javascript: or http:.
export function safeImageUrl(value) {
  const raw = String(value ?? "").trim().slice(0, 1000);
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function serialiseHeader(row) {
  const sourceType = HEADER_SOURCES.includes(row?.source_type) ? row.source_type : "theme";
  const imageUrl = sourceType === "theme" ? "" : safeImageUrl(row?.image_url);
  const usable = sourceType !== "theme" && Boolean(imageUrl);
  return {
    sourceType: usable ? sourceType : "theme",
    imageUrl: usable ? imageUrl : "",
    songId: usable && sourceType === "album_cover" ? String(row?.song_id || "") : "",
    label: usable ? String(row?.label || "") : "Theme backdrop",
    focal: normaliseFocal(row?.focal),
    scrim: clampScrim(row?.scrim ?? DEFAULT_SCRIM)
  };
}
