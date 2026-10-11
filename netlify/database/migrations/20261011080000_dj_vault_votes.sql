-- Shared community votes for DJ Vault editions (/api/dj-vault/vote).
-- One active vote per verified member per edition; un-voting deletes the row,
-- so /api/dj-vault/tracks can rank editions by COUNT(*) per track.
CREATE TABLE IF NOT EXISTS halo_dj_vault_votes (
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES halo_dj_vault_tracks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, track_id)
);

CREATE INDEX IF NOT EXISTS halo_dj_vault_votes_track_idx
  ON halo_dj_vault_votes(track_id);
