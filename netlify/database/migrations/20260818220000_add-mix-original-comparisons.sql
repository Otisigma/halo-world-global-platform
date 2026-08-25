ALTER TABLE halo_mixes
  ADD COLUMN IF NOT EXISTS original_blob_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS original_chunk_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_content_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS original_byte_size BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_duration_seconds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE halo_mixes
  DROP CONSTRAINT IF EXISTS halo_mixes_original_audio_check,
  ADD CONSTRAINT halo_mixes_original_audio_check CHECK (
    (
      original_blob_key = ''
      AND original_chunk_count = 0
      AND original_content_type = ''
      AND original_byte_size = 0
      AND original_duration_seconds = 0
    ) OR (
      original_blob_key <> ''
      AND original_chunk_count BETWEEN 1 AND 64
      AND original_content_type IN ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-wav')
      AND original_byte_size BETWEEN 1 AND 134217728
      AND original_duration_seconds BETWEEN 0 AND 43200
    )
  );
