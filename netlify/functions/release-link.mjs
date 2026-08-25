import { getDatabase } from "@netlify/database";
import { verifyRequestOrigin } from "@netlify/identity";
import { createHash, timingSafeEqual } from "node:crypto";

const audiences = new Set(["fan", "dj", "radio", "press", "preview"]);
const destinations = {
  fan: ["official_url", "official"],
  dj: ["dj_url", "dj"],
  radio: ["radio_url", "radio"],
  press: ["press_url", "press"],
  preview: ["preview_url", "preview"]
};

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanSlug(value) {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug.slice(0, 96) : "";
}

function cleanAudience(value) {
  const audience = typeof value === "string" ? value.trim().toLowerCase() : "";
  return audiences.has(audience) ? audience : "fan";
}

function absoluteDestination(value, requestUrl) {
  try {
    const parsed = new URL(value, requestUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function accessCodeMatches(code, expectedHash) {
  if (!expectedHash) return true;
  const receivedHash = createHash("sha256").update(String(code || "")).digest();
  const storedHash = Buffer.from(expectedHash, "hex");
  return storedHash.length === receivedHash.length && timingSafeEqual(storedHash, receivedHash);
}

export default async function releaseLinkHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);

  try {
    const db = getDatabase();
    if (request.method === "POST") {
      try {
        verifyRequestOrigin(request);
      } catch {
        return json({ message: "Cross-origin campaign events are not accepted" }, 403);
      }

      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ message: "Request body must be valid JSON" }, 400);
      }
      const releaseId = cleanSlug(payload.releaseId);
      const audience = cleanAudience(payload.audience);
      if (!releaseId) return json({ message: "Choose a valid release campaign" }, 400);
      const rows = await db.sql`SELECT id FROM halo_release_campaigns WHERE id = ${releaseId} AND status = 'published' LIMIT 1`;
      if (!rows.length) return json({ message: "Release campaign not found" }, 404);
      await db.sql`
        INSERT INTO halo_release_campaign_events (release_id, audience, event_type, target)
        VALUES (${releaseId}, ${audience}, 'kit_open', '')
      `;
      return json({ recorded: true }, 201);
    }

    const url = new URL(request.url);
    const releaseId = cleanSlug(url.searchParams.get("slug"));
    const audience = cleanAudience(url.searchParams.get("audience"));
    if (!releaseId) return json({ message: "Choose a valid release campaign" }, 400);
    const rows = await db.sql`
      SELECT official_url, dj_url, radio_url, press_url, preview_url, preview_expires_at, preview_access_code_hash
      FROM halo_release_campaigns
      WHERE id = ${releaseId} AND status = 'published'
      LIMIT 1
    `;
    if (!rows.length) return json({ message: "Release campaign not found" }, 404);

    const row = rows[0];
    if (audience === "preview" && row.preview_expires_at && new Date(row.preview_expires_at) <= new Date()) {
      return json({ message: "This private preview has expired" }, 410);
    }
    if (audience === "preview" && !accessCodeMatches(url.searchParams.get("code"), row.preview_access_code_hash)) {
      return json({ message: "Enter the private preview access code" }, 401);
    }
    const [column, target] = destinations[audience];
    const destination = absoluteDestination(row[column] || row.official_url, request.url);
    if (!destination) return json({ message: "This campaign destination is not available" }, 404);

    await db.sql`
      INSERT INTO halo_release_campaign_events (release_id, audience, event_type, target)
      VALUES (${releaseId}, ${audience}, 'outbound_click', ${target})
    `;
    return new Response(null, {
      status: 302,
      headers: {
        Location: destination,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer"
      }
    });
  } catch (error) {
    console.error("HALO release link failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "This campaign link is temporarily unavailable" }, 500);
  }
}

export const config = { path: "/api/release-link" };
