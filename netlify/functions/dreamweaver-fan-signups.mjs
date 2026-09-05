import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { verifyRequestOrigin } from "@netlify/identity";

const MAX_BODY_BYTES = 8_000;
const PLATFORMS = new Set(["spotify", "apple_music", "youtube"]);

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders }
  });
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : "";
}

export default async function dreamweaverFanSignups(request) {
  if (request.method !== "POST") {
    return json({ message: "Method not allowed" }, 405, { Allow: "POST" });
  }

  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin unlocks are not accepted" }, 403);
  }

  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return json({ message: "That unlock request is too large" }, 413);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Unlock details must be valid JSON" }, 400);
  }

  if (cleanText(payload?.company, 120)) return json({ accepted: true }, 202);

  const email = cleanEmail(payload?.email);
  const firstName = cleanText(payload?.firstName, 80);
  const favoritePlatform = PLATFORMS.has(payload?.favoritePlatform) ? payload.favoritePlatform : "spotify";

  if (!email) return json({ message: "Add a valid email address" }, 400);
  if (payload?.consent !== true) return json({ message: "Accept the unlock terms to continue" }, 400);

  try {
    const db = getDatabase();
    await db.sql`
      INSERT INTO halo_dreamweaver_fan_signups (
        id, email, first_name, favorite_platform, source, unlock_reward, consent_at
      ) VALUES (
        ${randomUUID()}, ${email}, ${firstName}, ${favoritePlatform},
        'dreamweaver_satellite', 'full_track_doorway', NOW()
      )
      ON CONFLICT (email) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        favorite_platform = EXCLUDED.favorite_platform,
        source = EXCLUDED.source,
        unlock_reward = EXCLUDED.unlock_reward,
        consent_at = NOW(),
        updated_at = NOW()
    `;
    return json({
      accepted: true,
      message: "Dreamweaver is unlocked. Your full doorway and platform links are ready."
    }, 201);
  } catch (error) {
    console.error("Dreamweaver fan signup failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Dreamweaver could not save the unlock right now" }, 500);
  }
}

export const config = {
  path: "/api/dreamweaver-fan-signups"
};
