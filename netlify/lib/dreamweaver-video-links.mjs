import { createHash } from "node:crypto";
import { cleanDreamweaverSongId, cleanDreamweaverMixId } from "../../lib/dreamweaver-storefront.js";

export function catalogSelection(type, id) {
  const recordId = type === "song" ? cleanDreamweaverSongId(id) : type === "mix" ? cleanDreamweaverMixId(id) : "";
  return recordId ? { type, id: recordId } : null;
}

export function linkedYouTubeVideoId(memberId, selection, youtubeId) {
  const hex = createHash("sha256").update(JSON.stringify([memberId, selection.type, selection.id, youtubeId])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function loadDreamweaverCatalog(db, memberId, selection = null) {
  const songs = !selection || selection.type === "song" ? await db.sql`
    SELECT song.id, song.title, song.artist_name, release.id AS release_id,
      release.status AS release_status, release.visibility AS release_visibility,
      page.slug AS artist_slug,
      EXISTS (SELECT 1 FROM halo_song_versions version WHERE version.song_id = song.id
        AND version.status = 'active' AND version.version_type = 'sale_master') AS has_master,
      EXISTS (SELECT 1 FROM halo_videos video WHERE video.linked_song_id = song.id
        AND video.status = 'published' AND video.gallery_visible) AS gallery_linked,
      EXISTS (SELECT 1 FROM halo_videos video WHERE video.linked_song_id = song.id
        AND video.status = 'published' AND video.sofa_visible) AS sofa_linked
    FROM halo_song_catalog song
    LEFT JOIN halo_release_campaigns release ON release.id = song.source_release_id
      AND release.owner_member_id = song.owner_member_id
    LEFT JOIN halo_artist_pages page ON page.slug = release.artist_slug
      AND page.owner_member_id = song.owner_member_id AND page.status = 'published'
    WHERE song.owner_member_id = ${memberId} AND song.status = 'active'
      AND (${selection?.id || ""} = '' OR song.id = ${selection?.id || ""})
    ORDER BY song.updated_at DESC
  ` : [];
  const mixes = !selection || selection.type === "mix" ? await db.sql`
    SELECT mix.id, mix.title, profile.display_name AS artist_name, mix.visibility,
      EXISTS (SELECT 1 FROM halo_videos video WHERE video.linked_mix_id = mix.id
        AND video.status = 'published' AND video.gallery_visible) AS gallery_linked,
      EXISTS (SELECT 1 FROM halo_videos video WHERE video.linked_mix_id = mix.id
        AND video.status = 'published' AND video.sofa_visible) AS sofa_linked
    FROM halo_mixes mix
    JOIN community_profiles profile ON profile.actor_id = mix.actor_id
    WHERE mix.member_id = ${memberId}
      AND (${selection?.id || ""} = '' OR mix.id = ${selection?.id || ""})
    ORDER BY mix.created_at DESC
  ` : [];
  return [
    ...songs.map(row => ({
      id: row.id, type: "song", title: row.title, artistName: row.artist_name,
      artistSlug: row.artist_slug || "", canPublish: Boolean(row.has_master),
      destinations: {
        shop: row.release_status === "published" && row.release_visibility === "public" ? "/music-world.html" : "",
        mix: "",
        artist: row.artist_slug ? `/artists/${encodeURIComponent(row.artist_slug)}/` : "",
        gallery: row.gallery_linked ? "/halo" : "",
        tv: row.sofa_linked ? "/halo" : ""
      }
    })),
    ...mixes.map(row => ({
      id: row.id, type: "mix", title: row.title, artistName: row.artist_name,
      artistSlug: "", canPublish: true,
      destinations: {
        shop: row.visibility === "room" ? `/mixes/?mix=${encodeURIComponent(row.id)}#editions` : "",
        mix: row.visibility === "room" ? `/mixes/?mix=${encodeURIComponent(row.id)}` : "",
        artist: "", gallery: row.gallery_linked ? "/halo" : "",
        tv: row.sofa_linked ? "/halo" : ""
      }
    }))
  ];
}

export async function saveCatalogVideo(db, memberId, selection, video) {
  const rows = await db.sql`
    WITH target AS (
      SELECT song.id AS song_id, NULL::text AS mix_id FROM halo_song_catalog song
      WHERE ${selection.type} = 'song' AND song.id = ${selection.id}
        AND song.owner_member_id = ${memberId} AND song.status = 'active'
        AND EXISTS (SELECT 1 FROM halo_song_versions version WHERE version.song_id = song.id
          AND version.version_type = 'sale_master' AND version.status = 'active')
      UNION ALL
      SELECT NULL::text, mix.id FROM halo_mixes mix
      WHERE ${selection.type} = 'mix' AND mix.id = ${selection.id} AND mix.member_id = ${memberId}
    ), saved AS (
      INSERT INTO halo_videos (
        id, owner_member_id, artist_slug, title, description, source_type, source_url,
        youtube_id, blob_key, content_type, source_filename, thumbnail_url,
        gallery_visible, sofa_visible, linked_song_id, linked_mix_id
      )
      SELECT ${video.id}::uuid, ${memberId}, ${video.artistSlug || null}, ${video.title}, ${video.description},
        ${video.sourceType}, ${video.sourceUrl}, ${video.youtubeId}, ${video.blobKey},
        ${video.contentType}, ${video.sourceFilename}, ${video.thumbnailUrl},
        ${video.galleryVisible}, ${video.sofaVisible}, target.song_id, target.mix_id
      FROM target WHERE TRUE
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title, description = EXCLUDED.description, artist_slug = EXCLUDED.artist_slug,
        gallery_visible = EXCLUDED.gallery_visible, sofa_visible = EXCLUDED.sofa_visible,
        status = 'published', updated_at = NOW()
      WHERE halo_videos.owner_member_id = EXCLUDED.owner_member_id
        AND halo_videos.linked_song_id IS NOT DISTINCT FROM EXCLUDED.linked_song_id
        AND halo_videos.linked_mix_id IS NOT DISTINCT FROM EXCLUDED.linked_mix_id
      RETURNING *
    ), synced AS (
      UPDATE halo_song_versions version
      SET video_url = CASE WHEN saved.source_type = 'upload'
        THEN '/api/videos?media=' || saved.id::text ELSE saved.source_url END,
        updated_at = NOW()
      FROM saved
      WHERE version.song_id = saved.linked_song_id
        AND version.version_type = 'sale_master' AND version.status = 'active'
      RETURNING version.id
    )
    SELECT * FROM saved
  `;
  return rows[0] || null;
}
