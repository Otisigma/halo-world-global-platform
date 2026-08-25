ALTER TABLE halo_ai_usage_events
  DROP CONSTRAINT IF EXISTS halo_ai_usage_events_feature_check;

ALTER TABLE halo_ai_usage_events
  ADD CONSTRAINT halo_ai_usage_events_feature_check
  CHECK (feature IN ('ai_dj', 'artist_page_scout'));
