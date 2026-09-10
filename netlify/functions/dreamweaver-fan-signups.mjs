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

async function syncRelationshipSignup(db, signup) {
  const membershipRows = await db.sql`
    SELECT member_id
    FROM halo_memberships
    WHERE email = ${signup.email}
    LIMIT 1
  `;
  const linkedMemberId = membershipRows[0]?.member_id || null;
  const relationshipRows = await db.sql`
    INSERT INTO halo_relationship_signups (
      email,
      source_signup_id,
      linked_member_id,
      first_name,
      favorite_platform,
      source,
      unlock_reward,
      status,
      signup_count,
      consent_at,
      first_signup_at,
      last_signup_at
    ) VALUES (
      ${signup.email},
      ${signup.id},
      ${linkedMemberId},
      ${signup.first_name},
      ${signup.favorite_platform},
      ${signup.source},
      ${signup.unlock_reward},
      ${linkedMemberId ? "linked_member" : "received"},
      1,
      ${signup.consent_at},
      NOW(),
      NOW()
    )
    ON CONFLICT (email) DO UPDATE SET
      source_signup_id = EXCLUDED.source_signup_id,
      linked_member_id = COALESCE(EXCLUDED.linked_member_id, halo_relationship_signups.linked_member_id),
      first_name = EXCLUDED.first_name,
      favorite_platform = EXCLUDED.favorite_platform,
      source = EXCLUDED.source,
      unlock_reward = EXCLUDED.unlock_reward,
      consent_at = LEAST(halo_relationship_signups.consent_at, EXCLUDED.consent_at),
      signup_count = CASE
        WHEN halo_relationship_signups.source_signup_id IS DISTINCT FROM EXCLUDED.source_signup_id THEN halo_relationship_signups.signup_count + 1
        ELSE halo_relationship_signups.signup_count
      END,
      last_signup_at = NOW(),
      updated_at = NOW(),
      status = CASE
        WHEN COALESCE(EXCLUDED.linked_member_id, halo_relationship_signups.linked_member_id) IS NOT NULL THEN 'linked_member'
        ELSE 'repeat_signup'
      END
    RETURNING linked_member_id
  `;
  const relationshipSignup = relationshipRows[0];
  if (!relationshipSignup?.linked_member_id) return;
  await db.sql`
    INSERT INTO halo_relationship_profiles (member_id)
    VALUES (${relationshipSignup.linked_member_id})
    ON CONFLICT (member_id) DO NOTHING
  `;
  await db.sql`
    UPDATE halo_relationship_profiles
    SET
      tags = CASE
        WHEN 'dreamweaver' = ANY(tags) THEN tags
        ELSE array_append(tags, 'dreamweaver')
      END,
      relationship_summary = CASE
        WHEN relationship_summary = '' THEN 'Dreamweaver fan signup captured from the public unlock flow.'
        ELSE relationship_summary
      END,
      updated_at = NOW()
    WHERE member_id = ${relationshipSignup.linked_member_id}
  `;
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
    const rows = await db.sql`
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
        consent_at = NOW()
      RETURNING id, email, first_name, favorite_platform, source, unlock_reward, consent_at, xmax = 0 AS inserted
    `;
    await syncRelationshipSignup(db, rows[0]);
    return json({
      accepted: true,
      message: "Dreamweaver is unlocked. Your full doorway and platform links are ready."
    }, rows[0]?.inserted ? 201 : 200);
  } catch (error) {
    console.error("Dreamweaver fan signup failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Dreamweaver could not save the unlock right now" }, 500);
  }
}

export const config = {
  path: "/api/dreamweaver-fan-signups"
};
