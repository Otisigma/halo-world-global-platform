// Inspect only same-origin media routes; never expose storage redirects or audio bytes.
export async function inspectAudioStream(value, {
  origin = globalThis.location?.origin, fetcher = globalThis.fetch, timeoutMs = 8000,
} = {}) {
  if (typeof value !== "string" || !value.trim()) return "No remote audio source is bound.";
  let url;
  try { url = new URL(value, origin); } catch { return "No valid remote audio source is bound."; }
  if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) {
    return "The selected stream is external. Browser media delivery failed; inspect its response in Network.";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const route = url.pathname;
  try {
    const response = await fetcher(url.href, {
      method: "GET", headers: { Range: "bytes=0-63", Accept: "audio/*, application/json" },
      credentials: "same-origin", signal: controller.signal, redirect: "follow", cache: "no-store",
    });
    const contentType = response.headers.get("content-type") || "missing Content-Type";
    let message = "";
    const reader = response.body?.getReader();
    if (reader) {
      try {
        const { value: bytes } = await reader.read();
        if (contentType.includes("application/json") && bytes) {
          try {
            const body = JSON.parse(new TextDecoder().decode(bytes.subarray(0, 2048)));
            if (typeof body.message === "string") message = body.message.replace(/\s+/g, " ").slice(0, 200);
          } catch { message = "The audio endpoint returned an unreadable error response."; }
        }
      } finally { await reader.cancel(); reader.releaseLock(); }
    }
    const reason = response.status === 401 || response.status === 403 ? "Access was refused."
      : response.status === 404 ? "The published audio route or stored file was not found."
      : response.status >= 500 ? "The audio service or storage failed."
      : !/^audio\//i.test(contentType) ? "The route returned a document, not audio."
      : response.ok ? "The server returned audio; the browser may be failing to decode it or continue the download." : "Audio delivery failed.";
    return `${route}: HTTP ${response.status} · ${contentType}. ${reason}${message ? ` ${message}` : ""}`;
  } catch (error) {
    return `${route}: ${controller.signal.aborted ? "audio request timed out." : "network/CORS request failed."}`;
  } finally { clearTimeout(timer); }
}
