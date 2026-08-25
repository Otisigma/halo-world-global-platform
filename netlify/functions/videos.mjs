import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";

const MAX_UPLOAD_BYTES = 5_000_000;
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const VIDEO_EXTENSION_TYPES = new Map([["mp4", "video/mp4"], ["webm", "video/webm"], ["mov", "video/quicktime"]]);

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function youtubeId(value) {
  const input = String(value || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, "");
    const candidate = host === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop();
    return /^[A-Za-z0-9_-]{11}$/.test(candidate || "") ? candidate : "";
  } catch {
    return "";
  }
}

function serializeVideo(row) {
  const isYouTube = row.source_type === "youtube";
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    artistSlug: row.artist_slug || "",
    artistName: row.artist_name || "",
    sourceType: row.source_type,
    sourceUrl: isYouTube ? row.source_url : `/api/videos?media=${row.id}`,
    embedUrl: isYouTube ? `https://www.youtube.com/embed/${row.youtube_id}` : "",
    thumbnailUrl: row.thumbnail_url || (isYouTube ? `https://i.ytimg.com/vi/${row.youtube_id}/hqdefault.jpg` : ""),
    galleryVisible: Boolean(row.gallery_visible),
    sofaVisible: Boolean(row.sofa_visible),
    featured: Boolean(row.featured),
    createdAt: new Date(row.created_at).toISOString()
  };
}

async function loadVideos(db, artistSlug = "") {
  const rows = artistSlug
    ? await db.sql`
        SELECT video.*, page.artist_name
        FROM halo_videos video
        LEFT JOIN halo_artist_pages page ON page.slug = video.artist_slug
        WHERE video.status = 'published' AND video.artist_slug = ${artistSlug}
        ORDER BY video.featured DESC, video.created_at DESC
        LIMIT 40
      `
    : await db.sql`
        SELECT video.*, page.artist_name
        FROM halo_videos video
        LEFT JOIN halo_artist_pages page ON page.slug = video.artist_slug
        WHERE video.status = 'published' AND (video.gallery_visible = TRUE OR video.sofa_visible = TRUE)
        ORDER BY video.featured DESC, video.created_at DESC
        LIMIT 60
      `;
  return rows.map(serializeVideo);
}

async function serveMedia(db, id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ""))) {
    return json({ message: "Video not found" }, 404);
  }
  const rows = await db.sql`
    SELECT blob_key, content_type, source_filename
    FROM halo_videos
    WHERE id::text = ${id} AND source_type = 'upload' AND status = 'published'
    LIMIT 1
  `;
  const video = rows[0];
  if (!video) return json({ message: "Video not found" }, 404);
  const blob = await getStore("halo-video-gallery").get(video.blob_key, { type: "blob" });
  if (!blob) return json({ message: "Video file is unavailable" }, 404);
  return new Response(blob, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": video.content_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${String(video.source_filename || "halo-video").replace(/[^a-zA-Z0-9._ -]/g, "")}"`
    }
  });
}

async function createVideo(request, db, user) {
  if (!user?.id) return json({ message: "Join or sign in to add a HALO TV video" }, 401);
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin video uploads are not accepted" }, 403);
  }

  const membership = await ensureMembership(db, user);
  const form = await request.formData();
  const title = cleanText(form.get("title"), 160);
  const description = cleanText(form.get("description"), 1000);
  const artistSlug = cleanText(form.get("artistSlug"), 80);
  const sourceType = form.get("sourceType") === "upload" ? "upload" : "youtube";
  const galleryVisible = form.get("galleryVisible") !== "false";
  const sofaVisible = form.get("sofaVisible") !== "false";
  if (!title) return json({ message: "Give the video a title" }, 400);

  if (artistSlug) {
    const owned = await db.sql`
      SELECT slug FROM halo_artist_pages
      WHERE slug = ${artistSlug} AND owner_member_id = ${membership.member_id}
      LIMIT 1
    `;
    if (!owned.length) return json({ message: "Choose an artist room you own" }, 403);
  }

  const id = randomUUID();
  let sourceUrl = "";
  let parsedYouTubeId = "";
  let blobKey = "";
  let contentType = "";
  let sourceFilename = "";
  let thumbnailUrl = cleanText(form.get("thumbnailUrl"), 1000);

  if (sourceType === "youtube") {
    sourceUrl = cleanText(form.get("youtubeUrl"), 1000);
    parsedYouTubeId = youtubeId(sourceUrl);
    if (!parsedYouTubeId) return json({ message: "Paste a valid YouTube video or live stream URL" }, 400);
    sourceUrl = `https://www.youtube.com/watch?v=${parsedYouTubeId}`;
    thumbnailUrl = `https://i.ytimg.com/vi/${parsedYouTubeId}/hqdefault.jpg`;
  } else {
    const file = form.get("videoFile");
    if (!(file instanceof File) || !file.size) return json({ message: "Choose a video file" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return json({ message: "Direct clip uploads are limited to 5 MB; use YouTube ingest for full-length video" }, 413);
    sourceFilename = cleanText(file.name, 180) || "halo-video";
    const extension = sourceFilename.split(".").pop()?.toLowerCase() || "";
    const inferredContentType = VIDEO_EXTENSION_TYPES.get(extension) || "";
    if (!VIDEO_TYPES.has(file.type) && !inferredContentType) return json({ message: "Upload an MP4, WebM, or MOV video" }, 415);
    contentType = VIDEO_TYPES.has(file.type) ? file.type : inferredContentType;
    blobKey = `videos/${membership.member_id}/${id}`;
    await getStore("halo-video-gallery").set(blobKey, file);
  }

  const rows = await db.sql`
    INSERT INTO halo_videos (
      id, owner_member_id, artist_slug, title, description, source_type, source_url,
      youtube_id, blob_key, content_type, source_filename, thumbnail_url,
      gallery_visible, sofa_visible
    ) VALUES (
      ${id}, ${membership.member_id}, ${artistSlug || null}, ${title}, ${description}, ${sourceType}, ${sourceUrl},
      ${parsedYouTubeId}, ${blobKey}, ${contentType}, ${sourceFilename}, ${thumbnailUrl},
      ${galleryVisible}, ${sofaVisible}
    )
    RETURNING *
  `;
  return json({ video: serializeVideo(rows[0]), message: "Video added to HALO TV and its connected rooms" }, 201);
}

export default async function videosHandler(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const db = getDatabase();
    const url = new URL(request.url);
    if (request.method === "GET" && url.searchParams.get("media")) return serveMedia(db, url.searchParams.get("media"));

    const user = await getUser();
    if (request.method === "POST") return createVideo(request, db, user);

    const artistSlug = cleanText(url.searchParams.get("artistSlug"), 80);
    const membership = user?.id ? await ensureMembership(db, user) : null;
    const ownedArtists = membership
      ? await db.sql`
          SELECT slug, artist_name
          FROM halo_artist_pages
          WHERE owner_member_id = ${membership.member_id}
          ORDER BY artist_name
        `
      : [];
    return json({
      authenticated: Boolean(user?.id),
      videos: await loadVideos(db, artistSlug),
      ownedArtists: ownedArtists.map(row => ({ slug: row.slug, artistName: row.artist_name }))
    });
  } catch (error) {
    console.error("HALO video gallery request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The HALO video gallery could not be loaded right now" }, 500);
  }
}

export const config = { path: "/api/videos" };
