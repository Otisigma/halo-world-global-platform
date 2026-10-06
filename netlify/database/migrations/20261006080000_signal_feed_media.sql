ALTER TABLE halo_signal_feed_posts
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'PUBLIC'
    CHECK (visibility IN ('PUBLIC', 'INNER_CIRCLE', 'COLLABORATOR_VAULT')),
  ADD COLUMN IF NOT EXISTS audience TEXT[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(audience) <= 20),
  ADD COLUMN IF NOT EXISTS attachment JSONB;

-- Replace only the original post-type guard, preserving every other constraint.
DO $$
DECLARE guard RECORD;
BEGIN
  FOR guard IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'halo_signal_feed_posts'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%release_id IS NOT NULL%'
      AND pg_get_constraintdef(oid) LIKE '%link_url%'
  LOOP
    EXECUTE format('ALTER TABLE halo_signal_feed_posts DROP CONSTRAINT %I', guard.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'halo_signal_feed_posts'::regclass AND conname = 'halo_signal_feed_media_guard') THEN
    ALTER TABLE halo_signal_feed_posts ADD CONSTRAINT halo_signal_feed_media_guard CHECK (
      (attachment IS NULL AND (
        (kind = 'AUDIO' AND release_id IS NOT NULL AND link_url = '')
        OR (kind IN ('VIDEO', 'BRIEF_LINK') AND link_url <> '' AND release_id IS NULL)
        OR (kind = 'TEXT' AND link_url = '' AND release_id IS NULL)))
      OR (attachment IS NOT NULL AND kind IN ('AUDIO', 'VIDEO')
        AND release_id IS NULL AND link_url = '' AND NOT include_purchase)
    );
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS halo_signal_feed_posts_audience_idx
  ON halo_signal_feed_posts USING GIN (audience);
