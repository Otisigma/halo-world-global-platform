import { isOwnedMasterObjectKey } from "./direct-upload-storage.mjs";

// These are the supported publication genre families, not inferred show/block genres.
const rooms = new Map([
  ...["house", "deep house", "afro house", "dance", "electronic", "techno", "garage", "club",
    "afrobeat", "afrobeats", "amapiano", "drill", "grime", "hip hop", "rap"].map(genre => [genre, "club"]),
  ...["ambient", "neo soul", "soul", "r&b", "rnb", "gospel", "worship", "acoustic", "ballad", "chill"]
    .map(genre => [genre, "chill"]),
]);

export function proposedRadioRoom(genre) {
  const normalized = String(genre || "").trim().toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");
  return rooms.get(normalized) || "";
}

export function canPrepareRadio(song, versions) {
  const masters = versions.filter(version => version.version_type === "sale_master");
  const master = masters.length === 1 ? masters[0] : null;
  if (song.broadcast_requested !== true || song.rights_status !== "cleared"
    || !song.owner_member_id || !master || master.song_id !== song.id || master.status !== "active"
    || master.mastering_status !== "approved" || !Number.isFinite(Number(master.duration_seconds))
    || Number(master.duration_seconds) <= 0 || !Number.isFinite(Number(master.audio_byte_size))
    || Number(master.audio_byte_size) <= 0 || !/^(audio\/|video\/mp4$)/.test(master.audio_content_type || "")
    || master.audio_url !== `/api/song-catalog/audio?versionId=${encodeURIComponent(master.id)}`) return false;
  const prefix = String(master.audio_blob_prefix || "");
  const ownedChunks = prefix.startsWith(`${song.owner_member_id}/${master.id}/`)
    && prefix.endsWith("/parts/") && !prefix.includes("..")
    && Number.isInteger(Number(master.audio_chunk_count)) && Number(master.audio_chunk_count) > 0;
  const ownedObject = master.audio_storage_key && isOwnedMasterObjectKey(master.audio_storage_key, {
    ownerMemberId: song.owner_member_id, songId: song.id, versionId: master.id,
  });
  if (master.audio_storage_key && prefix) return false;
  return Boolean(ownedChunks || ownedObject);
}
