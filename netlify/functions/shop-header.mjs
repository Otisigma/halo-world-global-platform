import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import {
  HEADER_FOCALS, MAX_UPLOAD_BYTES, UPLOAD_TYPES, clampScrim, normaliseFocal, safeImageUrl, serialiseHeader
} from "../lib/shop-header.mjs";

// Artist Shop hero header image, saved per artist page so each artist room / persona
// keeps its own header. Anyone can read a published shop's header; only the page owner edits it.
const API = "/api/shop-header";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/;
const store = () => getStore({ name: "halo-shop-headers", consistency: "strong" });

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function loadPage(db, slug) {
  const rows = await db.sql`
    SELECT slug, artist_name, owner_member_id, status FROM halo_artist_pages WHERE slug = ${slug} LIMIT 1
  `;
  return rows[0] || null;
}

async function loadHeaderRow(db, slug) {
  const rows = await db.sql`SELECT * FROM halo_shop_headers WHERE artist_slug = ${slug} LIMIT 1`;
  return rows[0] || null;
}

// This artist's own releases that have cover art (matched to the page's artist name when possible,
// so a persona page like Anna Jayne offers Anna Jayne's covers rather than every song the owner has).
async function loadCovers(db, page) {
  const rows = await db.sql`
    SELECT id, title, artist_name, album_title, artwork_url
    FROM halo_song_catalog
    WHERE owner_member_id = ${page.owner_member_id} AND status = 'active'
      AND artwork_url IS NOT NULL AND artwork_url <> ''
    ORDER BY updated_at DESC
    LIMIT 120
  `;
  const name = String(page.artist_name || "").toLowerCase();
  const matching = rows.filter(row => String(row.artist_name || "").toLowerCase().includes(name));
  return (matching.length ? matching : rows)
    .map(row => ({ id: row.id, title: row.title, artist: row.artist_name || "", album: row.album_title || "", coverUrl: safeImageUrl(row.artwork_url) }))
    .filter(row => row.coverUrl);
}

async function headerResponse(db, page, canEdit) {
  const body = {
    artist: { slug: page.slug, artistName: page.artist_name },
    header: serialiseHeader(await loadHeaderRow(db, page.slug)),
    canEdit
  };
  if (canEdit) body.releases = await loadCovers(db, page);
  return body;
}

async function saveHeader(db, page, header, previousKey) {
  await db.sql`
    INSERT INTO halo_shop_headers (artist_slug, source_type, image_url, image_key, song_id, label, focal, scrim, updated_at)
    VALUES (${page.slug}, ${header.sourceType}, ${header.imageUrl}, ${header.imageKey}, ${header.songId}, ${header.label},
            ${header.focal}, ${header.scrim}, NOW())
    ON CONFLICT (artist_slug) DO UPDATE SET
      source_type = EXCLUDED.source_type, image_url = EXCLUDED.image_url, image_key = EXCLUDED.image_key,
      song_id = EXCLUDED.song_id, label = EXCLUDED.label, focal = EXCLUDED.focal, scrim = EXCLUDED.scrim, updated_at = NOW()
  `;
  // An upload that is no longer the header is removed so old images don't linger.
  if (previousKey && previousKey !== header.imageKey) {
    try { await store().delete(previousKey); } catch { /* best effort */ }
  }
}

async function serveImage(key) {
  if (!IMAGE_KEY.test(key)) return new Response("Not found", { status: 404 });
  const result = await store().getWithMetadata(key, { type: "arrayBuffer" });
  if (!result?.data) return new Response("Not found", { status: 404 });
  return new Response(result.data, {
    headers: {
      "Content-Type": result.metadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

// Checks the leading bytes so a renamed non-image can't be stored as a header.
function sniffImage(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return "";
}

async function handleUpload(db, page, form, current) {
  const file = form.get("image");
  if (!file || typeof file === "string") return { error: "Choose an image to upload" };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "Header images must be 4 MB or smaller" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!UPLOAD_TYPES[type]) return { error: "Upload a JPEG, PNG or WebP image" };
  const key = `${page.slug}/${randomUUID()}.${UPLOAD_TYPES[type]}`;
  await store().set(key, bytes, { metadata: { contentType: type, artistSlug: page.slug } });
  const name = cleanText(file.name, 100) || "image";
  await saveHeader(db, page, {
    sourceType: "upload",
    imageUrl: `${API}?image=${encodeURIComponent(key)}`,
    imageKey: key,
    songId: null,
    label: `Upload: ${name}`,
    focal: form.has("focal") ? normaliseFocal(String(form.get("focal"))) : current.focal,
    scrim: form.has("scrim") ? clampScrim(form.get("scrim")) : current.scrim
  }, current.imageKey);
  return {};
}

async function handleAction(db, page, body, current) {
  const action = cleanText(body.action, 40);
  const focal = body.focal !== undefined ? normaliseFocal(body.focal) : current.focal;
  const scrim = body.scrim !== undefined ? clampScrim(body.scrim) : current.scrim;
  const keep = { sourceType: current.sourceType, imageUrl: current.imageUrl, imageKey: current.imageKey, songId: current.songId || null, label: current.label };

  if (action === "frame") {
    if (body.focal !== undefined && !HEADER_FOCALS.includes(body.focal)) return { error: "Choose a focal point" };
    await saveHeader(db, page, { ...keep, focal, scrim }, current.imageKey);
    return {};
  }
  if (action === "theme") {
    await saveHeader(db, page, { sourceType: "theme", imageUrl: "", imageKey: "", songId: null, label: "Theme backdrop", focal, scrim }, current.imageKey);
    return {};
  }
  if (action === "url") {
    const imageUrl = safeImageUrl(body.url);
    if (!imageUrl) return { error: "Paste an https:// image link" };
    await saveHeader(db, page, { sourceType: "url", imageUrl, imageKey: "", songId: null, label: "Custom image URL", focal, scrim }, current.imageKey);
    return {};
  }
  if (action === "cover") {
    const songId = cleanText(body.songId, 80);
    const cover = (await loadCovers(db, page)).find(item => item.id === songId);
    if (!cover) return { error: "Choose one of this artist's own release covers" };
    await saveHeader(db, page, {
      sourceType: "album_cover", imageUrl: cover.coverUrl, imageKey: "", songId: cover.id,
      label: `Cover: ${cleanText(cover.title, 120) || "Release"}`, focal, scrim
    }, current.imageKey);
    return {};
  }
  return { error: "Unknown header action" };
}

export default async function shopHeader(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const url = new URL(request.url);
    const imageKey = url.searchParams.get("image");
    if (request.method === "GET" && imageKey) return await serveImage(imageKey);

    const db = getDatabase();
    const user = await getUser();
    const membership = user?.id ? await ensureMembership(db, user) : null;

    if (request.method === "GET") {
      const slug = cleanText(url.searchParams.get("artist"), 80).toLowerCase();
      if (!SLUG.test(slug)) return json({ message: "Artist shop not found" }, 404);
      const page = await loadPage(db, slug);
      const canEdit = Boolean(membership && page?.owner_member_id === membership.member_id);
      if (!page || (!canEdit && (page.status !== "published" || !page.owner_member_id))) return json({ message: "Artist shop not found" }, 404);
      return json(await headerResponse(db, page, canEdit));
    }

    if (!membership) return json({ message: "Sign in to change your shop header" }, 401);
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin header edits are not accepted" }, 403);
    }

    const isUpload = (request.headers.get("content-type") || "").includes("multipart/form-data");
    const length = Number(request.headers.get("content-length") || 0);
    if (isUpload && length > MAX_UPLOAD_BYTES + 64 * 1024) return json({ message: "Header images must be 4 MB or smaller" }, 413);
    const form = isUpload ? await request.formData().catch(() => null) : null;
    const body = isUpload ? null : await request.json().catch(() => null);
    if (!form && (!body || typeof body !== "object")) return json({ message: "Send a header change" }, 400);

    const slug = cleanText(isUpload ? form.get("artist") : body.artist, 80).toLowerCase();
    const page = SLUG.test(slug) ? await loadPage(db, slug) : null;
    if (!page || page.owner_member_id !== membership.member_id) return json({ message: "You can only change your own shop header" }, 403);

    const row = await loadHeaderRow(db, page.slug);
    const current = { ...serialiseHeader(row), imageKey: row?.image_key || "" };
    const result = isUpload ? await handleUpload(db, page, form, current) : await handleAction(db, page, body, current);
    if (result.error) return json({ message: result.error }, 422);
    return json(await headerResponse(db, page, true));
  } catch (error) {
    console.error("HALO shop header request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The shop header couldn't be updated right now" }, 500);
  }
}

export const config = { path: "/api/shop-header" };
