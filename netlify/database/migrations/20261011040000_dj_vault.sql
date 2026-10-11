-- Roles are provisioned by operators, never by profile updates or creator uploads.
CREATE TABLE IF NOT EXISTS halo_dj_vault_roles (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id),
  role TEXT NOT NULL CHECK (role IN ('dj', 'selector', 'admin'))
);

-- Delivery editions reference private uploads, not public song-version URLs.
CREATE TABLE IF NOT EXISTS halo_dj_vault_tracks (
  id TEXT PRIMARY KEY,
  song_id TEXT REFERENCES halo_song_catalog(id),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 140),
  artist TEXT NOT NULL CHECK (char_length(artist) BETWEEN 1 AND 140),
  access_tier TEXT NOT NULL DEFAULT 'dj_vault' CHECK (access_tier IN ('standard', 'dj_vault')),
  visibility TEXT NOT NULL DEFAULT 'hidden' CHECK (visibility IN ('hidden', 'public', 'members')),
  bpm INTEGER NOT NULL CHECK (bpm BETWEEN 40 AND 240),
  musical_key TEXT NOT NULL CHECK (char_length(musical_key) BETWEEN 1 AND 12),
  price_pence INTEGER NOT NULL CHECK (price_pence BETWEEN 100 AND 100000),
  delivery_format TEXT NOT NULL CHECK (delivery_format IN ('wav', 'flac')),
  preview_type TEXT NOT NULL CHECK (preview_type IN ('clip', 'watermarked', 'low_bitrate')),
  preview_pack_id TEXT NOT NULL,
  preview_stem TEXT NOT NULL,
  delivery_pack_id TEXT NOT NULL,
  delivery_stem TEXT NOT NULL,
  routed_by TEXT NOT NULL REFERENCES halo_memberships(member_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (preview_pack_id, preview_stem) REFERENCES halo_stem_files(pack_id, stem_type),
  FOREIGN KEY (delivery_pack_id, delivery_stem) REFERENCES halo_stem_files(pack_id, stem_type),
  CHECK (preview_pack_id <> delivery_pack_id OR preview_stem <> delivery_stem)
);
CREATE INDEX IF NOT EXISTS halo_dj_vault_catalog_idx
  ON halo_dj_vault_tracks(access_tier, visibility, created_at DESC, id);

CREATE TABLE IF NOT EXISTS halo_dj_vault_orders (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id),
  track_id TEXT NOT NULL REFERENCES halo_dj_vault_tracks(id),
  price_pence INTEGER NOT NULL CHECK (price_pence BETWEEN 100 AND 100000),
  stripe_session_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS halo_dj_vault_orders_member_idx
  ON halo_dj_vault_orders(member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS halo_dj_vault_entitlements (
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id),
  track_id TEXT NOT NULL REFERENCES halo_dj_vault_tracks(id),
  order_id TEXT REFERENCES halo_dj_vault_orders(id),
  granted_by TEXT REFERENCES halo_memberships(member_id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (member_id, track_id),
  CHECK (order_id IS NOT NULL OR granted_by IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS halo_dj_vault_access_logs (
  id BIGSERIAL PRIMARY KEY,
  member_id TEXT REFERENCES halo_memberships(member_id),
  track_id TEXT NOT NULL REFERENCES halo_dj_vault_tracks(id),
  action TEXT NOT NULL CHECK (action IN ('route', 'purchase', 'grant', 'preview', 'download')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS halo_dj_vault_rate_limits (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id),
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requests INTEGER NOT NULL DEFAULT 1
);
CREATE OR REPLACE FUNCTION halo_dj_vault_rate_limit(p_member TEXT)
RETURNS BOOLEAN LANGUAGE sql AS $$
  INSERT INTO halo_dj_vault_rate_limits (member_id) VALUES (p_member)
  ON CONFLICT (member_id) DO UPDATE SET
    requests = CASE WHEN halo_dj_vault_rate_limits.window_start < NOW() - INTERVAL '1 minute'
      THEN 1 ELSE halo_dj_vault_rate_limits.requests + 1 END,
    window_start = CASE WHEN halo_dj_vault_rate_limits.window_start < NOW() - INTERVAL '1 minute'
      THEN NOW() ELSE halo_dj_vault_rate_limits.window_start END
  RETURNING requests <= 60;
$$;
