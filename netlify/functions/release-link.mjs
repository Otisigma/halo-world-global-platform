import { getDatabase } from "@netlify/database";
import { verifyRequestOrigin } from "@netlify/identity";
import { createHash, timingSafeEqual } from "node:crypto";
import { buildDreamweaverSongPage, resolveDreamweaverPageFlow } from "../lib/dreamweaver-page-manager.mjs";

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

function cleanId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
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

function legacyAudioVersionIdFromDestination(destination, requestUrl) {
  try {
    const parsed = new URL(destination, requestUrl);
    if (parsed.origin !== new URL(requestUrl).origin) return "";
    if (parsed.pathname !== "/api/song-catalog/audio") return "";
    return cleanId(parsed.searchParams.get("versionId"));
  } catch {
    return "";
  }
}

async function remapLegacyAudioDestination(db, versionId, {
  releaseSlug = "",
  audience = "fan",
  officialUrl = "",
  streamUrl = "",
} = {}) {
  try {
    if (!versionId) return "";
    const result = await db.sql`
      SELECT version.song_id
      FROM halo_song_versions version
      WHERE version.id = ${versionId}
      LIMIT 1
    `;
    const rows = Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];
    const songId = cleanId(rows[0]?.song_id);
    const mixId = cleanSlug(releaseSlug);
    const generatedPage = buildDreamweaverSongPage(songId, {
      mixId,
      audience,
      includeAudienceParam: true,
    });
    const flow = resolveDreamweaverPageFlow(songId, {
      mixId,
      officialUrl,
      streamUrl,
    });
    if (flow.routeMode === "dreamweaver_page") {
      return generatedPage?.experienceUrl || flow.page?.experienceUrl || flow.destinationUrl || "";
    }
    return flow.destinationUrl || "";
  } catch {
    return "";
  }
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
    const releaseSlug = cleanSlug(url.searchParams.get("slug"));
    const audience = cleanAudience(url.searchParams.get("audience"));
    if (!releaseSlug) return json({ message: "Choose a valid release campaign" }, 400);
    const rows = await db.sql`
      SELECT
        release.official_url,
        release.stream_url,
        release.dj_url,
        release.radio_url,
        release.press_url,
        release.preview_url,
        release.preview_expires_at,
        release.preview_access_code_hash,
        catalog.song_id AS catalog_song_id
      FROM halo_release_campaigns release
      LEFT JOIN LATERAL (
        SELECT song.id AS song_id
        FROM halo_song_catalog song
        WHERE song.source_release_id = release.id
          AND song.status = 'active'
        ORDER BY song.updated_at DESC
        LIMIT 1
      ) catalog ON TRUE
      WHERE release.id = ${releaseSlug} AND release.status = 'published'
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
    const flow = audience === "fan" && row.catalog_song_id
      ? resolveDreamweaverPageFlow(row.catalog_song_id, {
          mixId: releaseSlug,
          officialUrl: row.official_url || "",
          streamUrl: row.stream_url || "",
        })
      : null;
    const [column, target] = destinations[audience];
    const preferredDestination = audience === "fan" && flow
      ? flow.destinationUrl || row[column] || row.official_url
      : row[column] || row.official_url;
    const destination = absoluteDestination(preferredDestination, request.url);
    if (!destination) return json({ message: "This campaign destination is not available" }, 404);
    const legacyAudioVersionId = legacyAudioVersionIdFromDestination(destination, request.url);
    const remappedDestination = legacyAudioVersionId
      ? await remapLegacyAudioDestination(db, legacyAudioVersionId, {
          releaseSlug,
          audience,
          officialUrl: row.official_url || "",
          streamUrl: row.stream_url || "",
        })
      : "";
    const finalDestination = absoluteDestination(remappedDestination || destination, request.url);
    if (!finalDestination) return json({ message: "This campaign destination is not available" }, 404);

    await db.sql`
      INSERT INTO halo_release_campaign_events (release_id, audience, event_type, target)
      VALUES (${releaseSlug}, ${audience}, 'outbound_click', ${target})
    `;
    return new Response(null, {
      status: 302,
      headers: {
        Location: finalDestination,
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
