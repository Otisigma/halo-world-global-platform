ALTER TABLE halo_release_campaigns
  ADD COLUMN IF NOT EXISTS is_site_exclusive BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE halo_signal_feed_posts
  ADD COLUMN IF NOT EXISTS supporter_activity TEXT NOT NULL DEFAULT ''
    CHECK (supporter_activity IN ('', 'purchase', 'presave'));
