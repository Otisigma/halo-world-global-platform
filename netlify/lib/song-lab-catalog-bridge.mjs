import { createHash } from "node:crypto";
import { audioChunkKey, audioUploadPrefix, storeAudioChunk, AUDIO_CHUNK_MAX_BYTES, AUDIO_UPLOAD_MAX_BYTES } from "./chunked-audio-upload.mjs";

export class SongLabBridgeError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

export async function bindSongLabProject({ db, sourceStore, audioStore, ownerMemberId, projectId }) {
  if (typeof projectId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
    throw new SongLabBridgeError("Choose a valid saved Song Lab project.", 400);
  }
  const [project] = await db.sql`
    SELECT * FROM halo_dreamweaver_songs WHERE id = ${projectId} AND member_id = ${ownerMemberId} LIMIT 1
  `;
  if (!project) throw new SongLabBridgeError("Song Lab project not found.", 404);
  if (!project.rights_attested) throw new SongLabBridgeError("Confirm recording permission in Song Lab first.", 422);
  if (!project.title?.trim() || !project.artist_name?.trim()) {
    throw new SongLabBridgeError("Add a song title and artist before connecting this project.", 422);
  }
  const sourcePrefix = String(project.blob_prefix || "");
  const uploadId = sourcePrefix.slice(`${ownerMemberId}/`.length, -"/parts/".length);
  const count = Number(project.chunk_count), byteSize = Number(project.byte_size);
  if (sourcePrefix !== `${ownerMemberId}/${uploadId}/parts/` || !/^[a-z0-9-]{16,80}$/i.test(uploadId)
    || !Number.isInteger(count) || count < 1 || count > 64
    || !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > AUDIO_UPLOAD_MAX_BYTES
    || !/^audio\/(wav|x-wav|mpeg|mp4|aac|ogg|webm)$/.test(project.content_type || "")) {
    throw new SongLabBridgeError("The saved project audio reference is invalid.");
  }
  // Project UUIDs are stable private draft identities; retries never create another song.
  const songId = project.id, versionId = project.id;
  const findBinding = async () => {
    const [row] = await db.sql`
      SELECT song.owner_member_id, song.status AS song_status, song.source_upload_surface,
        version.id, version.status, version.audio_blob_prefix, version.audio_storage_key
      FROM halo_song_catalog song
      LEFT JOIN halo_song_versions version ON version.song_id = song.id AND version.id = ${versionId}
      WHERE song.id = ${songId} LIMIT 1
    `;
    if (!row) return null;
    if (row.owner_member_id !== ownerMemberId || row.song_status !== "active"
      || row.source_upload_surface !== "dreamweaver_lab" || row.id !== versionId || row.status !== "active"
      || !(row.audio_blob_prefix || row.audio_storage_key)) {
      throw new SongLabBridgeError("The catalog draft was changed or archived. Open Song Catalog to manage it.");
    }
    return { songId, versionId, audioUrl: `/api/song-catalog/audio?versionId=${encodeURIComponent(versionId)}` };
  };
  const existing = await findBinding();
  if (existing) return existing;
  const prefix = audioUploadPrefix(ownerMemberId, versionId, project.id);
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const key = audioChunkKey(sourcePrefix, index);
    const metadata = (await sourceStore.getMetadata(key))?.metadata;
    const copied = (await audioStore.getMetadata(audioChunkKey(prefix, index)))?.metadata;
    if (copied?.sha256 && copied.sha256 === metadata?.sha256
      && Number(copied.chunkCount) === count && Number(copied.byteSize) === byteSize
      && Number.isSafeInteger(copied.size) && copied.size > 0 && copied.size <= AUDIO_CHUNK_MAX_BYTES) {
      total += copied.size;
      continue;
    }
    const bytes = await sourceStore.get(key, { type: "arrayBuffer" });
    if (!bytes || bytes.byteLength < 1 || bytes.byteLength > AUDIO_CHUNK_MAX_BYTES) {
      throw new SongLabBridgeError("Saved audio is incomplete. Resume the original Song Lab upload.");
    }
    const checksum = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
    if (metadata?.sha256 && metadata.sha256 !== checksum) throw new SongLabBridgeError("Saved audio failed its checksum check.");
    total += bytes.byteLength;
    const stored = await storeAudioChunk(audioStore, {
      prefix, chunkIndex: index, chunkCount: count, byteSize,
      chunk: new Blob([bytes], { type: project.content_type }), checksum,
    });
    if (!stored.ok) throw new SongLabBridgeError(stored.message, stored.status);
  }
  if (total !== byteSize) throw new SongLabBridgeError("Saved audio size does not match the project.");
  const audioUrl = `/api/song-catalog/audio?versionId=${encodeURIComponent(versionId)}`;
  const duration = Math.max(0, Math.min(21600, Math.round(Number(project.duration_seconds) || 0)));
  await db.sql`
    WITH draft AS (
      INSERT INTO halo_song_catalog (
        id, owner_member_id, artist_name, title, source_upload_surface, sale_status, rights_status
      ) VALUES (${songId}, ${ownerMemberId}, ${project.artist_name}, ${project.title}, 'dreamweaver_lab', 'not_for_sale', 'needs_review')
      ON CONFLICT (id) DO NOTHING RETURNING id
    )
    INSERT INTO halo_song_versions (
      id, song_id, version_type, label, destination, audio_url, audio_blob_prefix, audio_chunk_count,
      audio_content_type, audio_byte_size, audio_filename, duration_seconds, mastering_status, sale_enabled
    )
    SELECT ${versionId}, draft.id, 'sale_master', 'Sale master', 'storefront', ${audioUrl}, ${prefix}, ${count},
      ${project.content_type}, ${byteSize}, ${project.file_name}, ${duration}, 'not_started', FALSE FROM draft
  `;
  const binding = await findBinding();
  if (!binding) throw new SongLabBridgeError("The catalog draft could not be connected. Retry the connection.");
  return binding;
}
