CREATE TABLE IF NOT EXISTS halo_artist_pro_leads (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  artist_name TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT '',
  release_stage TEXT NOT NULL,
  release_title TEXT NOT NULL DEFAULT '',
  target_release_date DATE,
  primary_goal TEXT NOT NULL,
  artist_url TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  requested_plan TEXT NOT NULL DEFAULT 'artist_pro',
  source TEXT NOT NULL DEFAULT 'artist_pro_page',
  consent_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  review_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (email = LOWER(email)),
  CHECK (char_length(email) BETWEEN 5 AND 254),
  CHECK (char_length(artist_name) BETWEEN 2 AND 120),
  CHECK (country_code = '' OR country_code ~ '^[A-Z]{2}$'),
  CHECK (release_stage IN ('idea', 'recording', 'finishing', 'scheduled', 'released')),
  CHECK (char_length(release_title) <= 160),
  CHECK (primary_goal IN ('finish_release', 'build_campaign', 'reach_djs_radio', 'grow_fans', 'organise_team')),
  CHECK (char_length(artist_url) <= 500),
  CHECK (char_length(message) <= 1500),
  CHECK (requested_plan IN ('artist_pro')),
  CHECK (char_length(source) BETWEEN 2 AND 80),
  CHECK (status IN ('new', 'contacted', 'qualified', 'accepted', 'waitlisted', 'declined')),
  CHECK (char_length(review_notes) <= 2000)
);

CREATE INDEX IF NOT EXISTS halo_artist_pro_leads_status_created_idx
  ON halo_artist_pro_leads(status, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_artist_pro_leads_release_date_idx
  ON halo_artist_pro_leads(target_release_date)
  WHERE target_release_date IS NOT NULL;
