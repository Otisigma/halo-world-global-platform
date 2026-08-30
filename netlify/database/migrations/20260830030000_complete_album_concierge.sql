ALTER TABLE halo_album_concierge_sessions
  ADD COLUMN IF NOT EXISTS selected_title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS generated_why TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS generated_style_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS genre_direction TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS track_count INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS tone_direction TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS artwork_style TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS final_dedication TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cover_blob_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cover_content_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS voice_note_blob_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS voice_note_content_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS voice_note_filename TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS share_token UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS booklet_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS unlocked_extras JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS premium_status TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS premium_checkout_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_refinement TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

ALTER TABLE halo_album_concierge_sessions
  DROP CONSTRAINT IF EXISTS halo_album_concierge_track_count_check,
  ADD CONSTRAINT halo_album_concierge_track_count_check CHECK (track_count BETWEEN 5 AND 12),
  DROP CONSTRAINT IF EXISTS halo_album_concierge_premium_status_check,
  ADD CONSTRAINT halo_album_concierge_premium_status_check CHECK (premium_status IN ('free', 'pending', 'active'));

CREATE UNIQUE INDEX IF NOT EXISTS halo_album_concierge_share_token_idx
  ON halo_album_concierge_sessions(share_token);

CREATE INDEX IF NOT EXISTS halo_album_concierge_mode_updated_idx
  ON halo_album_concierge_sessions(mode, updated_at DESC);
