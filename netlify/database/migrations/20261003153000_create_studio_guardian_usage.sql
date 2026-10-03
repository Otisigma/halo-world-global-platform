-- Durable hourly reservations: no provider request proceeds without both quotas.
CREATE TABLE IF NOT EXISTS halo_studio_guardian_usage (
  scope_key TEXT NOT NULL CHECK (char_length(scope_key) BETWEEN 1 AND 200),
  bucket_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count BETWEEN 1 AND 60),
  PRIMARY KEY (scope_key, bucket_start)
);
