CREATE TABLE IF NOT EXISTS halo_creator_profiles (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  artist_slug TEXT REFERENCES halo_artist_pages(slug) ON DELETE SET NULL,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  bio TEXT NOT NULL DEFAULT '' CHECK (char_length(bio) <= 2000),
  roles TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(roles) <= 12),
  genres TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(genres) <= 12),
  languages TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(languages) <= 12),
  daw_setup TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(daw_setup) <= 12),
  bpm_min INTEGER CHECK (bpm_min BETWEEN 20 AND 300),
  bpm_max INTEGER CHECK (bpm_max BETWEEN 20 AND 300),
  split_preference TEXT NOT NULL DEFAULT '' CHECK (char_length(split_preference) <= 300),
  discoverable BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((bpm_min IS NULL AND bpm_max IS NULL) OR (bpm_min IS NOT NULL AND bpm_max IS NOT NULL AND bpm_min <= bpm_max))
);

CREATE TABLE IF NOT EXISTS halo_creator_projects (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 180),
  brief TEXT NOT NULL DEFAULT '' CHECK (char_length(brief) <= 4000),
  role_needed TEXT NOT NULL DEFAULT '' CHECK (char_length(role_needed) <= 80),
  genre TEXT NOT NULL DEFAULT '' CHECK (char_length(genre) <= 80),
  language TEXT NOT NULL DEFAULT '' CHECK (char_length(language) <= 80),
  bpm INTEGER CHECK (bpm BETWEEN 20 AND 300),
  musical_key TEXT NOT NULL DEFAULT '' CHECK (char_length(musical_key) <= 20),
  kind TEXT NOT NULL DEFAULT 'audio' CHECK (kind IN ('audio', 'visual', 'review')),
  song_id TEXT REFERENCES halo_song_catalog(id) ON DELETE SET NULL,
  song_version_id TEXT REFERENCES halo_song_versions(id) ON DELETE SET NULL,
  stem_pack_id TEXT REFERENCES halo_stem_packs(id) ON DELETE SET NULL,
  rights_work_id TEXT REFERENCES halo_artist_rights_works(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Invitations and applications share one participant lifecycle; acceptance is not a rights agreement.
CREATE TABLE IF NOT EXISTS halo_creator_participants (
  project_id TEXT NOT NULL REFERENCES halo_creator_projects(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  initiated_by TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('invite', 'application')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  message TEXT NOT NULL DEFAULT '' CHECK (char_length(message) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, member_id)
);

CREATE INDEX IF NOT EXISTS halo_creator_profiles_discovery_idx ON halo_creator_profiles(discoverable, updated_at DESC);
CREATE INDEX IF NOT EXISTS halo_creator_projects_discovery_idx ON halo_creator_projects(status, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS halo_creator_projects_owner_idx ON halo_creator_projects(owner_member_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS halo_creator_participants_member_idx ON halo_creator_participants(member_id, status);
