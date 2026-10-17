// Dreamweaver audio playback helpers. Canonical/direct audio is always the primary source;
// Google Drive links are only normalized into a streamable form and used as a fallback.
const GOOGLE_DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com", "drive.usercontent.google.com"]);
const GOOGLE_DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

function parseHttpsUrl(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 1200) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

export function isGoogleDriveUrl(value) {
  const url = parseHttpsUrl(value);
  return Boolean(url && GOOGLE_DRIVE_HOSTS.has(url.hostname.toLowerCase()));
}

export function googleDriveFileId(value) {
  const url = parseHttpsUrl(value);
  if (!url || !GOOGLE_DRIVE_HOSTS.has(url.hostname.toLowerCase())) return "";
  const pathId = url.pathname.match(/^\/file\/d\/([^/]+)(?:\/(?:view|preview|edit))?\/?$/)?.[1] || "";
  const queryId = ["/uc", "/open", "/download"].includes(url.pathname) ? url.searchParams.get("id") || "" : "";
  const id = pathId || queryId;
  return GOOGLE_DRIVE_ID_PATTERN.test(id) ? id : "";
}

/** Converts Drive share/open/uc links into the direct-download form the audio element can stream. */
export function normalizeGoogleDriveAudioUrl(value) {
  const id = googleDriveFileId(value);
  if (!id) return "";
  const url = new URL("https://drive.google.com/uc");
  url.searchParams.set("export", "download");
  url.searchParams.set("id", id);
  const resourceKey = parseHttpsUrl(value)?.searchParams.get("resourcekey") || "";
  if (/^[A-Za-z0-9_-]{1,200}$/.test(resourceKey)) url.searchParams.set("resourcekey", resourceKey);
  return url.href;
}

/** Returns normalized, de-duplicated Google Drive fallback URLs that differ from the primary source. */
export function googleDriveFallbackSources(candidates = [], primary = "") {
  const primaryDrive = normalizeGoogleDriveAudioUrl(primary);
  const seen = new Set([String(primary || ""), primaryDrive].filter(Boolean));
  const sources = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const normalized = normalizeGoogleDriveAudioUrl(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    sources.push(normalized);
  }
  return sources;
}

/**
 * Starts the given audio element muted so browser autoplay policies allow it. Never unmutes:
 * restoring sound requires unlockDreamweaverAudio() from an explicit user gesture.
 */
export async function startDreamweaverMutedAutoplay(audio) {
  if (!audio || typeof audio.play !== "function") return { started: false, muted: false, blocked: false, reason: "missing-audio" };
  audio.muted = true;
  try {
    await audio.play();
    return { started: true, muted: true, blocked: false };
  } catch (error) {
    if (error?.name === "AbortError") return { started: false, muted: true, blocked: false, reason: "aborted" };
    return { started: false, muted: true, blocked: true, reason: error?.name === "NotAllowedError" ? "autoplay-blocked" : "play-rejected", error };
  }
}

/** Must only be called from a user gesture handler (click/keydown): unmutes and plays. */
export async function unlockDreamweaverAudio(audio) {
  if (!audio || typeof audio.play !== "function") return { started: false, muted: false };
  audio.muted = false;
  if (audio.paused) await audio.play();
  return { started: !audio.paused, muted: Boolean(audio.muted) };
}
