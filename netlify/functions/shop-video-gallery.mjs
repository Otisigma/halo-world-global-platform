import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { cleanText, ensureMembership } from "../lib/halo-x.mjs";
import { GALLERY_MODES, PUBLISH_SCOPES, VIDEO_ORIGINS, normaliseSettings, resolveGallery, youtubePackage } from "../lib/shop-video-gallery.mjs";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHOP_PATH = "/artist-shop/";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function youtubeId(value) {
  const input = String(value || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (!["youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) return "";
    const candidate = host === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop();
    return /^[A-Za-z0-9_-]{11}$/.test(candidate || "") ? candidate : "";
  } catch {
    return "";
  }
}

function safeCoverUrl(value) {
  const raw = cleanText(value, 1000);
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try { return new URL(raw).protocol === "https:" ? raw : ""; } catch { return ""; }
}

function serializeVideo(row) {
  const isYouTube = row.source_type === "youtube";
  return {
    id: String(row.id),
    title: row.title,
    description: row.description || "",
    artistSlug: row.artist_slug || "",
    artistName: row.artist_name || "",
    sourceType: row.source_type,
    sourceUrl: isYouTube ? row.source_url : `/api/videos?media=${row.id}`,
    embedUrl: isYouTube ? `https://www.youtube.com/embed/${row.youtube_id}` : "",
    thumbnailUrl: row.thumbnail_url || (isYouTube ? `https://i.ytimg.com/vi/${row.youtube_id}/hqdefault.jpg` : ""),
    origin: row.origin === "dreamweaver" ? "dreamweaver" : "manual",
    publishScope: row.publish_scope === "shop_only" ? "shop_only" : "halo_feed",
    songId: row.song_id || "",
    versionId: row.song_version_id || "",
    songTitle: row.song_title || "",
    versionLabel: row.version_label || "",
    versionType: row.version_type || "",
    createdAt: new Date(row.created_at).toISOString()
  };
}

async function loadPage(db, slug) {
  const rows = await db.sql`
    SELECT slug, artist_name, owner_member_id, status FROM halo_artist_pages WHERE slug = ${slug} LIMIT 1
  `;
  return rows[0] || null;
}

async function loadState(db, page) {
  const [settingsRows, videoRows, itemRows] = await Promise.all([
    db.sql`SELECT * FROM halo_shop_video_galleries WHERE artist_slug = ${page.slug} LIMIT 1`,
    // Only the shop owner's own videos are ever candidates.
    db.sql`
      SELECT video.*, owner_page.artist_name, song.title AS song_title,
             version.label AS version_label, version.version_type
      FROM halo_videos video
      LEFT JOIN halo_artist_pages owner_page ON owner_page.slug = video.artist_slug
      LEFT JOIN halo_song_catalog song ON song.id = video.song_id
      LEFT JOIN halo_song_versions version ON version.id = video.song_version_id
      WHERE video.owner_member_id = ${page.owner_member_id}
        AND video.status = 'published'
        AND (video.artist_slug IS NULL OR video.artist_slug = ${page.slug})
      ORDER BY video.created_at DESC
      LIMIT 200
    `,
    db.sql`SELECT * FROM halo_shop_video_gallery_items WHERE artist_slug = ${page.slug}`
  ]);
  return { settings: normaliseSettings(settingsRows[0]), videos: videoRows.map(serializeVideo), items: itemRows };
}

// Songs and versions this artist can link to videos or turn into Dreamweaver videos.
async function loadSongs(db, page) {
  const rows = await db.sql`
    SELECT song.id, song.title, song.artist_name, song.album_title, song.isrc, song.artwork_url,
           COALESCE(json_agg(json_build_object('id', version.id, 'label', version.label, 'versionType', version.version_type)
             ORDER BY version.created_at) FILTER (WHERE version.id IS NOT NULL), '[]') AS versions
    FROM halo_song_catalog song
    LEFT JOIN halo_song_versions version ON version.song_id = song.id AND version.status = 'active'
    WHERE song.owner_member_id = ${page.owner_member_id} AND song.status = 'active'
    GROUP BY song.id
    ORDER BY song.updated_at DESC
    LIMIT 120
  `;
  const name = String(page.artist_name || "").toLowerCase();
  const matching = rows.filter(row => String(row.artist_name || "").toLowerCase().includes(name));
  return (matching.length ? matching : rows).map(row => ({
    id: row.id, title: row.title, artistName: row.artist_name, albumTitle: row.album_title || "", isrc: row.isrc || "",
    artworkUrl: row.artwork_url || "", versions: Array.isArray(row.versions) ? row.versions : []
  }));
}

async function publicShops(db) {
  const rows = await db.sql`
    SELECT page.slug, page.artist_name
    FROM halo_artist_pages page
    LEFT JOIN halo_shop_video_galleries settings ON settings.artist_slug = page.slug
    WHERE page.status = 'published' AND page.owner_member_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM halo_shop_video_gallery_items item
        JOIN halo_videos video ON video.id = item.video_id AND video.status = 'published' AND video.owner_member_id = page.owner_member_id
        WHERE item.artist_slug = page.slug AND item.added_manually AND NOT item.hidden
      ) OR (
        COALESCE(settings.mode, 'dreamweaver_only') = 'dreamweaver_only' AND EXISTS (
          SELECT 1 FROM halo_videos video
          WHERE video.artist_slug = page.slug AND video.origin = 'dreamweaver' AND video.status = 'published'
            AND video.owner_member_id = page.owner_member_id
            AND NOT EXISTS (SELECT 1 FROM halo_shop_video_gallery_items item WHERE item.artist_slug = page.slug AND item.video_id = video.id AND item.hidden)
        )
      )
    )
    ORDER BY page.artist_name
    LIMIT 40
  `;
  return rows.map(row => ({ slug: row.slug, artistName: row.artist_name }));
}

async function ownedArtists(db, memberId) {
  const rows = await db.sql`
    SELECT slug, artist_name FROM halo_artist_pages WHERE owner_member_id = ${memberId} ORDER BY artist_name
  `;
  return rows.map(row => ({ slug: row.slug, artistName: row.artist_name }));
}

async function galleryResponse(db, page, { canEdit, origin, owned = [] }) {
  const state = await loadState(db, page);
  const entries = resolveGallery({ artistSlug: page.slug, ...state, includeHidden: canEdit });
  const shopUrl = `${origin}${SHOP_PATH}?artist=${encodeURIComponent(page.slug)}#video-gallery`;
  const body = {
    artist: { slug: page.slug, artistName: page.artist_name },
    mode: state.settings.mode,
    pinnedVideoId: state.settings.pinnedVideoId,
    emptyState: state.settings.emptyState,
    videos: entries,
    canEdit,
    ownedArtists: owned
  };
  if (canEdit) {
    const songs = await loadSongs(db, page);
    const songById = new Map(songs.map(song => [song.id, song]));
    const inGallery = new Set(entries.map(entry => entry.id));
    body.videos = entries.map(entry => {
      const song = songById.get(entry.songId) || null;
      const version = song?.versions.find(item => item.id === entry.versionId) || null;
      return { ...entry, youtubePackage: youtubePackage({ video: entry, song, version, artistName: page.artist_name, shopUrl }) };
    });
    body.library = state.videos.filter(video => !inGallery.has(video.id));
    const withVideo = new Set(state.videos.filter(video => video.songId).map(video => video.songId));
    body.songs = songs.map(song => ({ ...song, hasVideo: withVideo.has(song.id) }));
    body.shopUrl = shopUrl;
  }
  return body;
}

async function requireOwnedVideo(db, page, videoId) {
  if (!UUID.test(videoId)) return null;
  const rows = await db.sql`
    SELECT id, artist_slug FROM halo_videos
    WHERE id::text = ${videoId} AND owner_member_id = ${page.owner_member_id} AND status = 'published'
      AND (artist_slug IS NULL OR artist_slug = ${page.slug})
    LIMIT 1
  `;
  return rows[0] || null;
}

async function validateSongLink(db, page, songId, versionId) {
  if (!songId) return { songId: null, versionId: null };
  const rows = await db.sql`
    SELECT id FROM halo_song_catalog WHERE id = ${songId} AND owner_member_id = ${page.owner_member_id} AND status = 'active' LIMIT 1
  `;
  if (!rows.length) return { error: "Choose one of this artist's own songs" };
  if (!versionId) return { songId, versionId: null };
  const versions = await db.sql`
    SELECT id FROM halo_song_versions WHERE id = ${versionId} AND song_id = ${songId} AND status = 'active' LIMIT 1
  `;
  if (!versions.length) return { error: "Choose a version of that song" };
  return { songId, versionId };
}

async function ensureSettingsRow(db, slug) {
  await db.sql`INSERT INTO halo_shop_video_galleries (artist_slug) VALUES (${slug}) ON CONFLICT (artist_slug) DO NOTHING`;
}

async function nextPosition(db, slug) {
  const rows = await db.sql`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM halo_shop_video_gallery_items WHERE artist_slug = ${slug}`;
  return Math.min(Number(rows[0]?.next || 0), 10000);
}

async function applyAction(db, page, body, memberId) {
  const action = cleanText(body.action, 40);
  const videoId = cleanText(body.videoId, 36);

  if (action === "settings") {
    const mode = GALLERY_MODES.includes(body.mode) ? body.mode : null;
    const empty = body.emptyState && typeof body.emptyState === "object" ? body.emptyState : null;
    let releaseAt = null;
    if (empty?.releaseAt) {
      const parsed = new Date(String(empty.releaseAt));
      if (Number.isNaN(parsed.getTime())) return "Choose a valid release date";
      releaseAt = parsed.toISOString();
    }
    await ensureSettingsRow(db, page.slug);
    if (mode) await db.sql`UPDATE halo_shop_video_galleries SET mode = ${mode}, updated_at = NOW() WHERE artist_slug = ${page.slug}`;
    if (empty) {
      await db.sql`
        UPDATE halo_shop_video_galleries SET
          empty_title = ${cleanText(empty.title, 120)},
          empty_note = ${cleanText(empty.note, 400)},
          empty_cover_url = ${safeCoverUrl(empty.coverUrl)},
          empty_release_at = ${releaseAt},
          updated_at = NOW()
        WHERE artist_slug = ${page.slug}
      `;
    }
    return null;
  }

  if (action === "addLink") {
    const parsedId = youtubeId(body.youtubeUrl);
    if (!parsedId) return "Paste a valid YouTube video link";
    const title = cleanText(body.title, 160);
    if (!title) return "Give the video a title";
    const link = await validateSongLink(db, page, cleanText(body.songId, 80), cleanText(body.versionId, 80));
    if (link.error) return link.error;
    const origin = VIDEO_ORIGINS.includes(body.origin) ? body.origin : "manual";
    const scope = PUBLISH_SCOPES.includes(body.publishScope) ? body.publishScope : "shop_only";
    const id = randomUUID();
    await db.sql`
      INSERT INTO halo_videos (
        id, owner_member_id, artist_slug, title, description, source_type, source_url, youtube_id, thumbnail_url,
        gallery_visible, sofa_visible, origin, song_id, song_version_id, publish_scope
      ) VALUES (
        ${id}, ${memberId}, ${page.slug}, ${title}, ${cleanText(body.description, 1000)}, 'youtube',
        ${`https://www.youtube.com/watch?v=${parsedId}`}, ${parsedId}, ${`https://i.ytimg.com/vi/${parsedId}/hqdefault.jpg`},
        ${scope === "halo_feed"}, ${scope === "halo_feed"}, ${origin}, ${link.songId}, ${link.versionId}, ${scope}
      )
    `;
    await db.sql`
      INSERT INTO halo_shop_video_gallery_items (artist_slug, video_id, added_manually, position)
      VALUES (${page.slug}, ${id}, TRUE, ${await nextPosition(db, page.slug)})
    `;
    return null;
  }

  if (action === "reorder") {
    const ids = Array.isArray(body.videoIds) ? [...new Set(body.videoIds.map(value => cleanText(value, 36)))].slice(0, 200) : [];
    for (const [position, id] of ids.entries()) {
      if (!(await requireOwnedVideo(db, page, id))) continue;
      await db.sql`
        INSERT INTO halo_shop_video_gallery_items (artist_slug, video_id, position)
        VALUES (${page.slug}, ${id}, ${position})
        ON CONFLICT (artist_slug, video_id) DO UPDATE SET position = EXCLUDED.position, updated_at = NOW()
      `;
    }
    return null;
  }

  if (action === "pin" && !videoId) {
    await ensureSettingsRow(db, page.slug);
    await db.sql`UPDATE halo_shop_video_galleries SET pinned_video_id = NULL, updated_at = NOW() WHERE artist_slug = ${page.slug}`;
    return null;
  }

  const video = await requireOwnedVideo(db, page, videoId);
  if (!video) return "Choose one of this artist's own videos";

  if (action === "add") {
    await db.sql`
      INSERT INTO halo_shop_video_gallery_items (artist_slug, video_id, added_manually, hidden, position)
      VALUES (${page.slug}, ${videoId}, TRUE, FALSE, ${await nextPosition(db, page.slug)})
      ON CONFLICT (artist_slug, video_id) DO UPDATE SET added_manually = TRUE, hidden = FALSE, updated_at = NOW()
    `;
    return null;
  }
  if (action === "remove") {
    // Removes the placement only; the video itself stays in the artist's library.
    await db.sql`DELETE FROM halo_shop_video_gallery_items WHERE artist_slug = ${page.slug} AND video_id = ${videoId}`;
    await db.sql`UPDATE halo_shop_video_galleries SET pinned_video_id = NULL WHERE artist_slug = ${page.slug} AND pinned_video_id::text = ${videoId}`;
    return null;
  }
  if (action === "visibility") {
    const hidden = body.hidden === true;
    await db.sql`
      INSERT INTO halo_shop_video_gallery_items (artist_slug, video_id, hidden, position)
      VALUES (${page.slug}, ${videoId}, ${hidden}, ${await nextPosition(db, page.slug)})
      ON CONFLICT (artist_slug, video_id) DO UPDATE SET hidden = EXCLUDED.hidden, updated_at = NOW()
    `;
    return null;
  }
  if (action === "pin") {
    await ensureSettingsRow(db, page.slug);
    await db.sql`UPDATE halo_shop_video_galleries SET pinned_video_id = ${videoId}, updated_at = NOW() WHERE artist_slug = ${page.slug}`;
    return null;
  }
  if (action === "link") {
    const link = await validateSongLink(db, page, cleanText(body.songId, 80), cleanText(body.versionId, 80));
    if (link.error) return link.error;
    await db.sql`
      UPDATE halo_videos SET song_id = ${link.songId}, song_version_id = ${link.versionId}, updated_at = NOW()
      WHERE id::text = ${videoId}
    `;
    return null;
  }
  if (action === "scope") {
    if (!PUBLISH_SCOPES.includes(body.publishScope)) return "Choose shop only or HALO feed";
    const feed = body.publishScope === "halo_feed";
    // Shop-only videos are withdrawn from the shared HALO gallery and sofa screens.
    await db.sql`
      UPDATE halo_videos SET publish_scope = ${body.publishScope},
        gallery_visible = ${feed}, sofa_visible = ${feed}, updated_at = NOW()
      WHERE id::text = ${videoId}
    `;
    return null;
  }
  return "Unknown gallery action";
}

export default async function shopVideoGallery(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  try {
    const db = getDatabase();
    const url = new URL(request.url);
    const user = await getUser();
    const membership = user?.id ? await ensureMembership(db, user) : null;
    const owned = membership ? await ownedArtists(db, membership.member_id) : [];

    if (request.method === "GET") {
      let slug = cleanText(url.searchParams.get("artist"), 80).toLowerCase();
      if (!slug && owned.length) slug = owned[0].slug;
      if (!slug) return json({ artist: null, videos: [], canEdit: false, ownedArtists: [], shops: await publicShops(db) });
      if (!SLUG.test(slug)) return json({ message: "Artist shop not found" }, 404);
      const page = await loadPage(db, slug);
      const canEdit = Boolean(membership && page?.owner_member_id === membership.member_id);
      if (!page || (!canEdit && (page.status !== "published" || !page.owner_member_id))) return json({ message: "Artist shop not found" }, 404);
      return json(await galleryResponse(db, page, { canEdit, origin: url.origin, owned }));
    }

    if (!membership) return json({ message: "Sign in to edit your shop gallery" }, 401);
    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin gallery edits are not accepted" }, 403);
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ message: "Send a gallery action" }, 400);
    const slug = cleanText(body.artist, 80).toLowerCase();
    const page = SLUG.test(slug) ? await loadPage(db, slug) : null;
    if (!page || page.owner_member_id !== membership.member_id) return json({ message: "You can only edit your own shop gallery" }, 403);
    const problem = await applyAction(db, page, body, membership.member_id);
    if (problem) return json({ message: problem }, 422);
    return json(await galleryResponse(db, page, { canEdit: true, origin: url.origin, owned }));
  } catch (error) {
    console.error("HALO shop video gallery request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The shop video gallery could not be loaded right now" }, 500);
  }
}

export const config = { path: "/api/shop-video-gallery" };
