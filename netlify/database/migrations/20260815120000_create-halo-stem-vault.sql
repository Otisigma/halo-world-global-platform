CREATE TABLE IF NOT EXISTS halo_stem_packs (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_provider TEXT NOT NULL DEFAULT 'suno',
  source_project_url TEXT NOT NULL DEFAULT '',
  generation_prompt TEXT NOT NULL DEFAULT '',
  bpm NUMERIC(6, 2) NOT NULL DEFAULT 124,
  musical_key TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL DEFAULT '',
  rights_attested BOOLEAN NOT NULL DEFAULT FALSE,
  rights_attested_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'private',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id ~ '^[0-9a-f-]{36}$'),
  CHECK (char_length(title) BETWEEN 2 AND 140),
  CHECK (char_length(description) <= 600),
  CHECK (source_provider IN ('suno', 'halo', 'other')),
  CHECK (char_length(source_project_url) <= 500),
  CHECK (char_length(generation_prompt) <= 3000),
  CHECK (bpm BETWEEN 40 AND 240),
  CHECK (char_length(musical_key) <= 12),
  CHECK (char_length(genre) <= 80),
  CHECK (char_length(mood) <= 120),
  CHECK (status IN ('private', 'archived')),
  CHECK (rights_attested = FALSE OR rights_attested_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS halo_stem_files (
  pack_id TEXT NOT NULL REFERENCES halo_stem_packs(id) ON DELETE CASCADE,
  stem_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  blob_key TEXT NOT NULL UNIQUE,
  chunk_count INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  duration_seconds NUMERIC(10, 3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pack_id, stem_type),
  CHECK (stem_type IN ('full', 'drums', 'bass', 'music', 'vocals', 'fx')),
  CHECK (char_length(original_filename) BETWEEN 1 AND 240),
  CHECK (chunk_count BETWEEN 1 AND 128),
  CHECK (content_type IN ('audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/flac', 'audio/x-flac')),
  CHECK (byte_size > 0 AND byte_size <= 536870912),
  CHECK (duration_seconds BETWEEN 0 AND 43200)
);

CREATE INDEX IF NOT EXISTS halo_stem_packs_member_idx
  ON halo_stem_packs(member_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS halo_stem_files_pack_idx
  ON halo_stem_files(pack_id, stem_type);
