// A preview may use public static audio only, never private API assets or signed URLs.
export function constellationPreviewUrl(value) {
  if (typeof value !== "string" || value.length > 1200 || /[\u0000-\u001f\\]/.test(value)) return "";
  const direct = value.trim();
  if (!direct || (!direct.startsWith("/") && !direct.startsWith("https://")) || direct.startsWith("//")) return "";
  try {
    const url = new URL(direct, "https://halo.invalid");
    if (!/\.(mp3|m4a|m4b|aac|ogg|oga|wav|flac|webm)$/i.test(url.pathname)) return "";
    if (url.search || url.hash || url.username || url.password) return "";
    if (direct.startsWith("/")) return url.pathname.startsWith("/assets/") ? url.pathname : "";
    if (url.protocol !== "https:" || !url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname)
      || url.hostname.includes(":") || /(^|\.)(localhost|local|internal)$/.test(url.hostname)
      || /(^|\.)(drive\.google\.com|docs\.google\.com)$/.test(url.hostname)
      || /\/(?:api|private)(?:\/|$)/i.test(url.pathname)) return "";
    return url.href;
  } catch { return ""; }
}
