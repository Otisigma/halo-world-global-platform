import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { BindingError, bindingSongId, resolveDreamweaverBinding, validateCustomImages } from "../lib/dreamweaver-assets.mjs";

const json = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", ...headers }
});

export async function handleDreamweaverAssets(request, { database, user = null, verifyOrigin = verifyRequestOrigin }) {
  if (!["GET", "POST"].includes(request.method)) return json({ status: "failed", message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  try {
    let songId;
    let customImages;
    if (request.method === "POST") {
      if (!user?.id) return json({ status: "failed", message: "Sign in to change Dreamweaver artwork" }, 401);
      try { verifyOrigin(request); } catch { return json({ status: "failed", message: "Cross-origin requests are not accepted" }, 403); }
      if (!request.headers.get("content-type")?.startsWith("application/json")) throw new BindingError("Use an application/json body", 415);
      // Stream with a hard bound; Content-Length alone is not trustworthy.
      const reader = request.body?.getReader();
      if (!reader) throw new BindingError("A JSON body is required");
      let text = "";
      let bytes = 0;
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 12_288) { await reader.cancel(); throw new BindingError("Request body is too large", 413); }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      let body;
      try { body = JSON.parse(text); } catch { throw new BindingError("Invalid JSON body"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new BindingError("A binding object is required");
      if (body.mixId !== undefined) throw new BindingError("Song bindings do not accept a mixId");
      songId = bindingSongId(body.songId);
      customImages = validateCustomImages(body.customImages);
    } else {
      songId = bindingSongId(new URL(request.url).searchParams.get("songId"));
    }
    const binding = await resolveDreamweaverBinding(database, { songId, memberId: user?.id || "", customImages });
    return json({ binding });
  } catch (error) {
    if (error instanceof BindingError) return json({ status: "failed", message: error.message }, error.status);
    console.error("Dreamweaver asset binding failed");
    return json({ status: "failed", message: "Dreamweaver assets are temporarily unavailable" }, 503);
  }
}

export default async function dreamweaverAssets(request) {
  try {
    return await handleDreamweaverAssets(request, { database: getDatabase(), user: await getUser() });
  } catch {
    return json({ status: "failed", message: "Dreamweaver assets are temporarily unavailable" }, 503);
  }
}

export const config = { path: "/api/dreamweaver-assets" };
