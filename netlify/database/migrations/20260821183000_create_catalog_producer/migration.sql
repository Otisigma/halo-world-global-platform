CREATE TABLE IF NOT EXISTS "halo_catalog_producer_jobs" (
  "id" text PRIMARY KEY,
  "owner_member_id" text NOT NULL REFERENCES "halo_memberships"("member_id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'queued',
  "stage" text NOT NULL DEFAULT 'queued',
  "progress" integer NOT NULL DEFAULT 0,
  "package_count" integer NOT NULL DEFAULT 0,
  "error_message" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CHECK ("status" IN ('queued', 'working', 'ready', 'failed')),
  CHECK ("stage" IN ('queued', 'scanning', 'grouping', 'pricing', 'ready', 'failed')),
  CHECK ("progress" BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS "halo_catalog_packages" (
  "id" text PRIMARY KEY,
  "owner_member_id" text NOT NULL REFERENCES "halo_memberships"("member_id") ON DELETE CASCADE,
  "source_job_id" text REFERENCES "halo_catalog_producer_jobs"("id") ON DELETE SET NULL,
  "package_type" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "rationale" text NOT NULL DEFAULT '',
  "price_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "projected_monthly_net_cents" integer NOT NULL DEFAULT 0,
  "track_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'draft',
  "strategy" text NOT NULL DEFAULT 'dreamweaver',
  "signals" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CHECK ("package_type" IN ('album', 'mix', 'vault')),
  CHECK ("price_cents" BETWEEN 0 AND 10000000),
  CHECK ("projected_monthly_net_cents" >= 0),
  CHECK ("track_count" >= 0),
  CHECK ("status" IN ('draft', 'approved', 'published', 'archived'))
);

CREATE TABLE IF NOT EXISTS "halo_catalog_package_tracks" (
  "id" text PRIMARY KEY,
  "package_id" text NOT NULL REFERENCES "halo_catalog_packages"("id") ON DELETE CASCADE,
  "song_id" text NOT NULL REFERENCES "halo_song_catalog"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "engagement_score" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CHECK ("position" > 0),
  CHECK ("engagement_score" >= 0),
  UNIQUE ("package_id", "position"),
  UNIQUE ("package_id", "song_id")
);

CREATE INDEX IF NOT EXISTS "halo_catalog_producer_jobs_owner_idx"
  ON "halo_catalog_producer_jobs" ("owner_member_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "halo_catalog_packages_owner_idx"
  ON "halo_catalog_packages" ("owner_member_id", "status", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "halo_catalog_package_tracks_package_idx"
  ON "halo_catalog_package_tracks" ("package_id", "position");
