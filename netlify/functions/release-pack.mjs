import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { createHash } from "node:crypto";
import { ensureMembership, isOwner } from "../lib/halo-x.mjs";
import { resolveReleaseArtworkFields } from "../lib/release-artwork.mjs";

const allowedStatuses = new Set(["interested", "downloaded", "played", "declined"]);
const allowedSelectorTypes = new Set(["dj", "radio"]);
const allowedCampaignStatuses = new Set(["draft", "published"]);
const allowedRatings = new Set(["unspecified", "clean", "explicit"]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function cleanLongText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\r\n/g, "\n").slice(0, maxLength) : "";
}

function cleanList(value, maxItems = 12, maxLength = 80) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return source.map(item => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function cleanUrl(value, maxLength = 1000) {
  const raw = cleanText(value, maxLength);
  if (!raw) return "";
  try {
    const parsed = new URL(raw, "https://halo.world");
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    if (raw.startsWith('/')) return `${parsed.pathname}${parsed.search}${parsed.hash}`.slice(0, maxLength);
    return parsed.toString().slice(0, maxLength);
  } catch {
    return "";
  }
}

function cleanDate(value) {
  const raw = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function cleanTimestamp(value) {
  const raw = cleanText(value, 64);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function slugify(value) {
  return cleanText(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 96);
}

function dateOnly(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function serializeRelease(row, includePrivateLinks = false) {
  const artwork = resolveReleaseArtworkFields({
    artworkUrl: row.artwork_url,
    importedArtworkUrl: row.imported_artwork_url || row.artwork_url,
    artworkOverrideUrl: row.artwork_override_url
  });
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    releaseDate: dateOnly(row.release_date),
    duration: row.duration || "",
    genres: row.genres || [],
    artwork: artwork.artwork,
    importedArtwork: artwork.importedArtwork,
    artworkOverride: artwork.artworkOverride,
    artworkSource: artwork.artworkSource,
    officialUrl: row.official_url || "",
    djUrl: includePrivateLinks ? row.dj_url || "" : "",
    radioUrl: includePrivateLinks ? row.radio_url || "" : "",
    pressUrl: includePrivateLinks ? row.press_url || "" : "",
    previewUrl: includePrivateLinks ? row.preview_url || "" : "",
    previewExpiresAt: row.preview_expires_at ? new Date(row.preview_expires_at).toISOString() : null,
    previewProtected: Boolean(row.preview_access_code_hash),
    bpm: row.bpm === null ? null : Number(row.bpm),
    musicalKey: row.musical_key || "",
    isrc: row.isrc || "",
    contentRating: row.content_rating || "unspecified",
    pitch: row.pitch || "",
    pressDescription: row.press_description || "",
    credits: row.credits || "",
    contactName: row.contact_name || "",
    contactEmail: row.contact_email || "",
    availableVersions: row.available_versions || [],
    delivery: row.available_versions || [],
    status: row.status,
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

async function findRelease(db, slug, { platformOwner = false, memberId = "" } = {}) {
  if (slug) {
    const rows = platformOwner
      ? await db.sql`SELECT * FROM halo_release_campaigns WHERE id = ${slug} LIMIT 1`
      : memberId
        ? await db.sql`
            SELECT * FROM halo_release_campaigns
            WHERE id = ${slug} AND (status = 'published' OR owner_member_id = ${memberId})
            LIMIT 1
          `
        : await db.sql`SELECT * FROM halo_release_campaigns WHERE id = ${slug} AND status = 'published' LIMIT 1`;
    return rows[0] || null;
  }
  if (platformOwner) {
    const rows = await db.sql`
      SELECT * FROM halo_release_campaigns
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (rows[0]) return rows[0];
  } else if (memberId) {
    const rows = await db.sql`
      SELECT * FROM halo_release_campaigns
      WHERE owner_member_id = ${memberId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (rows[0]) return rows[0];
  }
  const rows = await db.sql`
    SELECT * FROM halo_release_campaigns
    WHERE status = 'published'
    ORDER BY release_date DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function packState(db, user, requestedSlug = "") {
  const platformOwner = isOwner(user);
  const membership = user?.id ? await ensureMembership(db, user) : null;
  const memberId = membership?.member_id || "";
  const releaseRow = await findRelease(db, slugify(requestedSlug), { platformOwner, memberId });
  if (!releaseRow) return null;
  const canEdit = platformOwner || Boolean(memberId && releaseRow.owner_member_id === memberId);

  const [summaryRows, eventRows] = await Promise.all([
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'interested')::int AS interested,
        COUNT(*) FILTER (WHERE status = 'downloaded')::int AS downloaded,
        COUNT(*) FILTER (WHERE status = 'played')::int AS played,
        COUNT(*) FILTER (WHERE status = 'declined')::int AS declined,
        COUNT(*) FILTER (WHERE selector_type = 'dj')::int AS djs,
        COUNT(*) FILTER (WHERE selector_type = 'radio')::int AS radio
      FROM halo_release_selector_responses
      WHERE release_id = ${releaseRow.id}
    `,
    db.sql`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'kit_open')::int AS kit_opens,
        COUNT(*) FILTER (WHERE event_type = 'outbound_click')::int AS outbound_clicks
      FROM halo_release_campaign_events
      WHERE release_id = ${releaseRow.id}
    `
  ]);

  let response = null;
  if (membership) {
    const responseRows = await db.sql`
      SELECT selector_type, outlet_name, status, notes, updated_at
      FROM halo_release_selector_responses
      WHERE release_id = ${releaseRow.id} AND member_id = ${membership.member_id}
    `;
    response = responseRows[0] || null;
  }

  const summary = summaryRows[0] || {};
  const events = eventRows[0] || {};
  let campaigns = [];
  if (membership) {
    const campaignRows = platformOwner
      ? await db.sql`
          SELECT id, title, artist, release_date, status, updated_at
          FROM halo_release_campaigns
          ORDER BY updated_at DESC
          LIMIT 50
        `
      : await db.sql`
          SELECT id, title, artist, release_date, status, updated_at
          FROM halo_release_campaigns
          WHERE owner_member_id = ${memberId}
          ORDER BY updated_at DESC
          LIMIT 20
        `;
    campaigns = campaignRows.map(row => ({
      id: row.id,
      title: row.title,
      artist: row.artist,
      releaseDate: row.release_date ? String(row.release_date).slice(0, 10) : "",
      status: row.status,
      updatedAt: new Date(row.updated_at).toISOString()
    }));
  }

  return {
    release: serializeRelease(releaseRow, canEdit),
    response,
    canCreate: Boolean(membership),
    canEdit,
    campaigns,
    summary: {
      interested: Number(summary.interested || 0),
      downloaded: Number(summary.downloaded || 0),
      played: Number(summary.played || 0),
      declined: Number(summary.declined || 0),
      djs: Number(summary.djs || 0),
      radio: Number(summary.radio || 0),
      kitOpens: Number(events.kit_opens || 0),
      outboundClicks: Number(events.outbound_clicks || 0)
    }
  };
}

async function saveCampaign(request, db, user) {
  if (!user?.id) return json({ message: "Sign in to manage release campaigns" }, 401);
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin campaign updates are not accepted" }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }

  const title = cleanText(payload.title, 160);
  const artist = cleanText(payload.artist, 120);
  const id = slugify(payload.id || title);
  if (id.length < 2 || !title || !artist) return json({ message: "Add a release title and artist" }, 400);
  const membership = await ensureMembership(db, user);
  const platformOwner = isOwner(user);
  const existingRows = await db.sql`
    SELECT owner_member_id FROM halo_release_campaigns WHERE id = ${id} LIMIT 1
  `;
  const existing = existingRows[0];
  if (existing && !platformOwner && existing.owner_member_id !== membership.member_id) {
    return json({ message: "That release campaign handle already belongs to another artist" }, 409);
  }

  const urls = {
    officialUrl: cleanUrl(payload.officialUrl),
    djUrl: cleanUrl(payload.djUrl),
    radioUrl: cleanUrl(payload.radioUrl),
    pressUrl: cleanUrl(payload.pressUrl),
    previewUrl: cleanUrl(payload.previewUrl)
  };
  const importedArtworkInput = payload.importedArtwork ?? payload.artwork ?? "";
  const artworkOverrideInput = payload.artworkOverride ?? "";
  const importedArtwork = cleanUrl(importedArtworkInput);
  const artworkOverride = cleanUrl(artworkOverrideInput);
  const suppliedUrls = [
    [importedArtworkInput, importedArtwork],
    [artworkOverrideInput, artworkOverride],
    [payload.officialUrl, urls.officialUrl],
    [payload.djUrl, urls.djUrl],
    [payload.radioUrl, urls.radioUrl],
    [payload.pressUrl, urls.pressUrl],
    [payload.previewUrl, urls.previewUrl]
  ];
  if (suppliedUrls.some(([raw, cleaned]) => cleanText(raw, 1000) && !cleaned)) {
    return json({ message: "Use valid HTTP, HTTPS, or site-relative links" }, 400);
  }
  const artwork = resolveReleaseArtworkFields({
    artworkUrl: cleanUrl(payload.artwork),
    importedArtworkUrl: importedArtwork,
    artworkOverrideUrl: artworkOverride,
    fallbackArtwork: ""
  });

  const status = allowedCampaignStatuses.has(payload.status) ? payload.status : "draft";
  const contentRating = allowedRatings.has(payload.contentRating) ? payload.contentRating : "unspecified";
  const bpmValue = Number(payload.bpm);
  const bpm = Number.isInteger(bpmValue) && bpmValue >= 20 && bpmValue <= 300 ? bpmValue : null;
  const previewAccessCode = cleanText(payload.previewAccessCode, 80);
  const previewAccessCodeHash = previewAccessCode ? createHash("sha256").update(previewAccessCode).digest("hex") : "";
  const clearPreviewAccessCode = payload.clearPreviewAccessCode === true;
  const savedRows = await db.sql`
    INSERT INTO halo_release_campaigns (
      id, owner_member_id, title, artist, release_date, duration, genres, artwork_url,
      imported_artwork_url, artwork_override_url,
      official_url, dj_url, radio_url, press_url, preview_url, preview_expires_at,
      preview_access_code_hash,
      bpm, musical_key, isrc, content_rating, pitch, press_description, credits,
      contact_name, contact_email, available_versions, status
    ) VALUES (
      ${id}, ${membership.member_id}, ${title}, ${artist}, ${cleanDate(payload.releaseDate)},
      ${cleanText(payload.duration, 24)}, ${cleanList(payload.genres, 10, 48)}, ${artwork.artwork},
      ${artwork.importedArtwork}, ${artwork.artworkOverride},
      ${urls.officialUrl}, ${urls.djUrl}, ${urls.radioUrl}, ${urls.pressUrl}, ${urls.previewUrl},
      ${cleanTimestamp(payload.previewExpiresAt)}, ${previewAccessCodeHash}, ${bpm}, ${cleanText(payload.musicalKey, 32)},
      ${cleanText(payload.isrc, 32).toUpperCase()}, ${contentRating}, ${cleanLongText(payload.pitch, 500)},
      ${cleanLongText(payload.pressDescription, 4000)}, ${cleanLongText(payload.credits, 2000)},
      ${cleanText(payload.contactName, 120)}, ${cleanText(payload.contactEmail, 320).toLowerCase()},
      ${cleanList(payload.availableVersions, 16, 100)}, ${status}
    )
    ON CONFLICT (id) DO UPDATE SET
      owner_member_id = COALESCE(halo_release_campaigns.owner_member_id, EXCLUDED.owner_member_id),
      title = EXCLUDED.title,
      artist = EXCLUDED.artist,
      release_date = EXCLUDED.release_date,
      duration = EXCLUDED.duration,
      genres = EXCLUDED.genres,
      artwork_url = EXCLUDED.artwork_url,
      imported_artwork_url = EXCLUDED.imported_artwork_url,
      artwork_override_url = EXCLUDED.artwork_override_url,
      official_url = EXCLUDED.official_url,
      dj_url = EXCLUDED.dj_url,
      radio_url = EXCLUDED.radio_url,
      press_url = EXCLUDED.press_url,
      preview_url = EXCLUDED.preview_url,
      preview_expires_at = EXCLUDED.preview_expires_at,
      preview_access_code_hash = CASE
        WHEN ${clearPreviewAccessCode} THEN ''
        WHEN ${previewAccessCodeHash} <> '' THEN ${previewAccessCodeHash}
        ELSE halo_release_campaigns.preview_access_code_hash
      END,
      bpm = EXCLUDED.bpm,
      musical_key = EXCLUDED.musical_key,
      isrc = EXCLUDED.isrc,
      content_rating = EXCLUDED.content_rating,
      pitch = EXCLUDED.pitch,
      press_description = EXCLUDED.press_description,
      credits = EXCLUDED.credits,
      contact_name = EXCLUDED.contact_name,
      contact_email = EXCLUDED.contact_email,
      available_versions = EXCLUDED.available_versions,
      status = EXCLUDED.status,
      updated_at = NOW()
    WHERE ${platformOwner}
      OR halo_release_campaigns.owner_member_id = ${membership.member_id}
    RETURNING id
  `;
  if (!savedRows.length) return json({ message: "That release campaign could not be updated by this artist" }, 409);

  const state = await packState(db, user, id);
  return json({ ...state, message: status === "published" ? "Release campaign published" : "Release campaign saved as draft" });
}

async function saveSelectorResponse(request, db, user) {
  if (!user?.id) return json({ message: "Join HALO to request and report on release packs" }, 401);
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin release-pack updates are not accepted" }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON" }, 400);
  }

  const selectorType = cleanText(payload.selectorType, 16).toLowerCase();
  const status = cleanText(payload.status, 16).toLowerCase();
  const outletName = cleanText(payload.outletName, 100);
  const notes = cleanText(payload.notes, 320);
  const releaseId = slugify(payload.releaseId);
  if (!allowedSelectorTypes.has(selectorType)) return json({ message: "Choose the DJ or radio lane" }, 400);
  if (!allowedStatuses.has(status)) return json({ message: "Choose a valid release-pack response" }, 400);

  const releaseRows = releaseId
    ? await db.sql`SELECT id FROM halo_release_campaigns WHERE id = ${releaseId} AND status = 'published' LIMIT 1`
    : await db.sql`SELECT id FROM halo_release_campaigns WHERE status = 'published' ORDER BY release_date DESC NULLS LAST, updated_at DESC LIMIT 1`;
  if (!releaseRows.length) return json({ message: "This release campaign is not available" }, 404);

  const membership = await ensureMembership(db, user);
  await db.sql`
    INSERT INTO halo_release_selector_responses (release_id, member_id, actor_id, selector_type, outlet_name, status, notes)
    VALUES (${releaseRows[0].id}, ${membership.member_id}, ${membership.actor_id}, ${selectorType}, ${outletName}, ${status}, ${notes})
    ON CONFLICT (release_id, member_id) DO UPDATE SET
      selector_type = EXCLUDED.selector_type,
      outlet_name = EXCLUDED.outlet_name,
      status = EXCLUDED.status,
      notes = EXCLUDED.notes,
      updated_at = NOW()
  `;

  return json({ ...(await packState(db, user, releaseRows[0].id)), message: status === "interested" ? "Release pack requested" : `Release marked ${status}` });
}

export default async function releasePackHandler(request) {
  if (!["GET", "POST", "PUT"].includes(request.method)) return json({ message: "Method not allowed" }, 405);

  try {
    const [db, user] = await Promise.all([getDatabase(), getUser()]);
    if (request.method === "PUT") return saveCampaign(request, db, user);
    if (request.method === "POST") return saveSelectorResponse(request, db, user);
    const slug = new URL(request.url).searchParams.get("slug") || "";
    const state = await packState(db, user, slug);
    return state ? json(state) : json({ message: "Release campaign not found" }, 404);
  } catch (error) {
    console.error("HALO release pack request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The release campaign room could not be updated right now" }, 500);
  }
}

export const config = { path: "/api/release-pack" };
