CREATE TABLE analytics_events (
  id BIGSERIAL PRIMARY KEY,
  event_name VARCHAR(64) NOT NULL,
  anonymous_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  page_path VARCHAR(256) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX analytics_events_created_at_idx
  ON analytics_events (created_at DESC);

CREATE INDEX analytics_events_event_created_idx
  ON analytics_events (event_name, created_at DESC);

CREATE INDEX analytics_events_visitor_created_idx
  ON analytics_events (anonymous_id, created_at DESC);
