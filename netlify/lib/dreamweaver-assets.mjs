import { createHash } from "node:crypto";

export class BindingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function bindingSongId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BindingError("A valid catalog songId is required");
  }
  return value.toLowerCase();
}

function mediaUrl(value) {
  if (typeof value !== "string" || !value || value.length > 1200 || /[\s\\<>"'`]/.test(value)) return "";
  try {
    if (value.startsWith("/")) {
      const url = new URL(value, "https://halo.invalid");
      if (url.origin !== "https://halo.invalid") return "";
      return url.href.length <= 1200 && (url.pathname.startsWith("/assets/") || url.pathname === "/api/song-catalog/artwork")
        ? `${url.pathname}${url.search}` : "";
    }
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.href.length <= 1200 ? url.href : "";
  } catch {
    return "";
  }
}

export function validateCustomImages(value) {
  if (!Array.isArray(value) || value.length > 4) throw new BindingError("Supply at most four custom image URLs");
  return Array.from(value, image => {
    if (image === null || image === "") return null;
    const url = mediaUrl(image);
    if (!url) throw new BindingError("Custom images must use HTTPS or a platform artwork URL");
    return url;
  });
}

// The same visibility gate protects both the binding and delivery of its master.
export async function loadDreamweaverSong(db, songId, memberId = "", ownerOnly = false) {
  const [song] = await db.sql`
    SELECT song.* FROM halo_song_catalog song
    WHERE song.id = ${songId} AND song.status = 'active'
      AND (song.owner_member_id = ${memberId} OR (
        ${!ownerOnly} AND song.pipeline_status = 'published' AND song.rights_status = 'cleared'
        AND EXISTS (
          SELECT 1 FROM halo_release_campaigns release
          WHERE release.id = song.source_release_id AND release.status = 'published'
            AND release.visibility = 'public'
        )
      ))
    LIMIT 1
  `;
  if (!song) throw new BindingError("That song was not found or is not available", 404);
  const masters = await db.sql`
    SELECT * FROM halo_song_versions
    WHERE song_id = ${song.id} AND version_type = 'sale_master' AND status = 'active'
    LIMIT 2
  `;
  if (masters.length !== 1) throw new BindingError("Exactly one active canonical master is required", 409);
  return { song, master: masters[0] };
}

export function canonicalMasterUrl(song, master) {
  if (master.audio_storage_key || master.audio_blob_prefix) {
    return `/api/song-catalog/audio?versionId=${encodeURIComponent(master.id)}&dreamweaver=1&songId=${encodeURIComponent(song.id)}`;
  }
  const url = mediaUrl(master.audio_url);
  if (!url || url.startsWith("/api/") || url.startsWith("/assets/")) {
    throw new BindingError("Upload a canonical master before opening Dreamweaver", 409);
  }
  return url;
}

// Procedural frames need no external model, network call, lyric disclosure, or unbounded work.
export function generateActVisual(song, act) {
  const seed = createHash("sha256").update(JSON.stringify([
    String(song.title || "").slice(0, 180), String(song.artist_name || "").slice(0, 180),
    String(song.genre || "").slice(0, 180), String(song.lyrics_text || "").slice(0, 8000), act
  ])).digest();
  const x = 220 + seed[0] * 3;
  const y = 150 + seed[1];
  const radius = 140 + seed[2];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><radialGradient id="gold"><stop stop-color="#c8a45c" stop-opacity=".8"/><stop offset="1" stop-color="#09090d" stop-opacity="0"/></radialGradient></defs><rect width="1280" height="720" fill="#09090d"/><ellipse cx="${x}" cy="${y}" rx="${radius * 2}" ry="${radius}" fill="url(#gold)"/><g fill="none" stroke="#c8a45c" stroke-opacity=".55"><circle cx="${x}" cy="${y}" r="${radius}"/><circle cx="640" cy="360" r="${200 + act * 38}"/><path d="M0 ${530 - act * 30} Q640 ${seed[3]} 1280 ${420 + act * 40}"/></g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function buildBinding(song, master, customImages = [], audioSource = canonicalMasterUrl(song, master)) {
  const images = validateCustomImages(customImages);
  const cover = mediaUrl(master.artwork_url || song.artwork_url);
  const visuals = Array.from({ length: 4 }, (_, index) => {
    const supplied = images[index] || (index === 0 && images.length === 0 ? cover : "");
    return { act: index + 1, sourceType: supplied ? "upload" : "generated", uri: supplied || generateActVisual(song, index + 1), status: "ready" };
  });
  const revision = createHash("sha256").update(JSON.stringify([master.id, audioSource, images, visuals])).digest("hex");
  return { songId: song.id, masterVersionId: master.id, audioSource, visualActs: visuals, revision, status: "ready" };
}

export async function resolveDreamweaverBinding(db, { songId, memberId = "", customImages, resolveAudioProxy, proxyTimeoutMs = 1500 }) {
  const { song, master } = await loadDreamweaverSong(db, songId, memberId, customImages !== undefined);
  let fallbackAudioSource = "";
  if (resolveAudioProxy) {
    let timer;
    try {
      fallbackAudioSource = await Promise.race([
        (async () => {
          const [release] = song.source_release_id ? await db.sql`
            SELECT stream_url FROM halo_release_campaigns
            WHERE id = ${song.source_release_id} AND status = 'published' AND visibility = 'public'
            LIMIT 1
          ` : [];
          return resolveAudioProxy([master.audio_url, release?.stream_url]);
        })(),
        new Promise(resolve => { timer = setTimeout(() => resolve(""), proxyTimeoutMs); })
      ]);
    } catch {
      fallbackAudioSource = "";
    } finally {
      clearTimeout(timer);
    }
  }
  let audioSource;
  try { audioSource = canonicalMasterUrl(song, master); } catch (error) {
    if (!fallbackAudioSource) throw error;
    audioSource = fallbackAudioSource;
  }
  if (/^https:\/\/(?:drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com)\//i.test(audioSource)) {
    if (!fallbackAudioSource) throw new BindingError("Publish this song in the authorized Drive catalog before opening Dreamweaver", 409);
    audioSource = fallbackAudioSource;
  }
  // Compare-and-swap prevents a concurrent reader from overwriting newly uploaded visuals.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [existing] = await db.sql`SELECT * FROM halo_release_assets WHERE song_id = ${song.id}`;
    const images = customImages === undefined ? existing?.custom_images || [] : customImages;
    const binding = buildBinding(song, master, images, audioSource);
    if (fallbackAudioSource && fallbackAudioSource !== audioSource) binding.fallbackAudioSource = fallbackAudioSource;
    if (existing?.revision === binding.revision && existing.status === "ready") return binding;
    const [saved] = await db.sql`
      INSERT INTO halo_release_assets (
        song_id, master_version_id, canonical_master_url,
        visual_act_1, visual_act_2, visual_act_3, visual_act_4, custom_images, revision, status
      ) VALUES (
        ${song.id}, ${master.id}, ${binding.audioSource},
        ${binding.visualActs[0].uri}, ${binding.visualActs[1].uri},
        ${binding.visualActs[2].uri}, ${binding.visualActs[3].uri},
        ${JSON.stringify(images)}::jsonb, ${binding.revision}, 'ready'
      )
      ON CONFLICT (song_id) DO UPDATE SET
        master_version_id = EXCLUDED.master_version_id, canonical_master_url = EXCLUDED.canonical_master_url,
        visual_act_1 = EXCLUDED.visual_act_1, visual_act_2 = EXCLUDED.visual_act_2,
        visual_act_3 = EXCLUDED.visual_act_3, visual_act_4 = EXCLUDED.visual_act_4,
        custom_images = EXCLUDED.custom_images, revision = EXCLUDED.revision, status = 'ready', updated_at = NOW()
      WHERE halo_release_assets.revision = ${existing?.revision || ""}
      RETURNING song_id
    `;
    if (saved) return binding;
  }
  throw new BindingError("Assets changed during binding; please retry", 409);
}
