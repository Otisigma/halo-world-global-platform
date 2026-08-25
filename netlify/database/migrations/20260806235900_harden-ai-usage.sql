CREATE TABLE halo_ai_usage_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id TEXT NOT NULL,
  feature TEXT NOT NULL CHECK (feature IN ('ai_dj')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX halo_ai_usage_events_member_feature_created_idx
  ON halo_ai_usage_events (member_id, feature, created_at DESC);
