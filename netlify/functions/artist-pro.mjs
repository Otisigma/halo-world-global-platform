import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { isOwner } from "../lib/halo-x.mjs";

const MAX_BODY_BYTES = 12_000;
const stages = new Set(["idea", "recording", "finishing", "scheduled", "released"]);
const goals = new Set(["finish_release", "build_campaign", "reach_djs_radio", "grow_fans", "organise_team"]);

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

function cleanCountry(value) {
  const country = cleanText(value, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : "";
}

function cleanDate(value) {
  const date = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function cleanUrl(value) {
  const candidate = cleanText(value, 500);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function serializeLead(row) {
  return {
    id: row.id,
    email: row.email,
    artistName: row.artist_name,
    countryCode: row.country_code,
    releaseStage: row.release_stage,
    releaseTitle: row.release_title,
    targetReleaseDate: row.target_release_date ? String(row.target_release_date).slice(0, 10) : "",
    primaryGoal: row.primary_goal,
    artistUrl: row.artist_url,
    message: row.message,
    requestedPlan: row.requested_plan,
    status: row.status,
    reviewNotes: row.review_notes,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

async function listLeads(db, user) {
  if (!isOwner(user)) return json({ message: "Owner access is required" }, 403);
  const rows = await db.sql`
    SELECT id, email, artist_name, country_code, release_stage, release_title,
      target_release_date, primary_goal, artist_url, message, requested_plan,
      status, review_notes, created_at, updated_at
    FROM halo_artist_pro_leads
    ORDER BY
      CASE status WHEN 'new' THEN 0 WHEN 'qualified' THEN 1 WHEN 'contacted' THEN 2 ELSE 3 END,
      created_at DESC
    LIMIT 200
  `;
  return json({ leads: rows.map(serializeLead) });
}

async function submitLead(request, db) {
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin applications are not accepted" }, 403);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ message: "That application is too large" }, 413);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Application details must be valid JSON" }, 400);
  }

  if (cleanText(payload.company, 120)) return json({ accepted: true }, 202);

  const email = cleanEmail(payload.email);
  const artistName = cleanText(payload.artistName, 120);
  const releaseStage = stages.has(payload.releaseStage) ? payload.releaseStage : "";
  const primaryGoal = goals.has(payload.primaryGoal) ? payload.primaryGoal : "";
  const artistUrl = cleanUrl(payload.artistUrl);
  const suppliedArtistUrl = cleanText(payload.artistUrl, 500);

  if (!artistName) return json({ message: "Add the artist or project name" }, 400);
  if (!email) return json({ message: "Add a valid email address" }, 400);
  if (!releaseStage) return json({ message: "Choose the current release stage" }, 400);
  if (!primaryGoal) return json({ message: "Choose the result that matters most" }, 400);
  if (suppliedArtistUrl && !artistUrl) return json({ message: "Use a valid artist link beginning with http or https" }, 400);
  if (payload.consent !== true) return json({ message: "Accept the founding offer terms and contact permission to apply" }, 400);

  const recentRows = await db.sql`
    SELECT updated_at
    FROM halo_artist_pro_leads
    WHERE email = ${email} AND updated_at >= NOW() - INTERVAL '10 minutes'
    LIMIT 1
  `;
  if (recentRows.length) {
    return json({ message: "Your application is already in the queue" }, 429, { "Retry-After": "600" });
  }

  const id = randomUUID();
  const rows = await db.sql`
    INSERT INTO halo_artist_pro_leads (
      id, email, artist_name, country_code, release_stage, release_title,
      target_release_date, primary_goal, artist_url, message, requested_plan,
      source, consent_at
    ) VALUES (
      ${id}, ${email}, ${artistName}, ${cleanCountry(payload.countryCode)}, ${releaseStage},
      ${cleanText(payload.releaseTitle, 160)}, ${cleanDate(payload.targetReleaseDate)},
      ${primaryGoal}, ${artistUrl}, ${cleanText(payload.message, 1500)}, 'artist_pro',
      'artist_pro_page', NOW()
    )
    ON CONFLICT (email) DO UPDATE SET
      artist_name = EXCLUDED.artist_name,
      country_code = EXCLUDED.country_code,
      release_stage = EXCLUDED.release_stage,
      release_title = EXCLUDED.release_title,
      target_release_date = EXCLUDED.target_release_date,
      primary_goal = EXCLUDED.primary_goal,
      artist_url = EXCLUDED.artist_url,
      message = EXCLUDED.message,
      requested_plan = EXCLUDED.requested_plan,
      source = EXCLUDED.source,
      consent_at = NOW(),
      status = CASE
        WHEN halo_artist_pro_leads.status IN ('accepted', 'qualified', 'contacted') THEN halo_artist_pro_leads.status
        ELSE 'new'
      END,
      updated_at = NOW()
    RETURNING id
  `;

  return json({
    accepted: true,
    applicationId: rows[0].id,
    message: "Your release is on the board. HALO will review the fit and confirm the £49 monthly scope before any payment is requested."
  }, 201);
}

export default async function artistProHandler(request) {
  if (!["GET", "POST"].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }

  try {
    const db = getDatabase();
    if (request.method === "POST") return await submitLead(request, db);
    return await listLeads(db, await getUser());
  } catch (error) {
    console.error("Artist Pro request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The Artist Pro desk is temporarily unavailable" }, 500);
  }
}

export const config = {
  path: "/api/artist-pro"
};
