ALTER TABLE halo_artist_rights_works
  ADD COLUMN composition_owner TEXT NOT NULL DEFAULT '',
  ADD COLUMN admin_publisher_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN admin_publishing_status TEXT NOT NULL DEFAULT 'unknown',
  ADD CONSTRAINT halo_artist_rights_works_composition_owner_length CHECK (char_length(composition_owner) <= 180),
  ADD CONSTRAINT halo_artist_rights_works_admin_publisher_name_length CHECK (char_length(admin_publisher_name) <= 180),
  ADD CONSTRAINT halo_artist_rights_works_admin_publishing_status_check CHECK (
    admin_publishing_status IN ('unknown', 'self_administered', 'administered', 'publisher_controlled', 'seeking_admin')
  );

CREATE TABLE IF NOT EXISTS halo_artist_rights_society_memberships (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_id BIGINT NOT NULL REFERENCES halo_artist_rights_participants(id) ON DELETE CASCADE,
  territory TEXT NOT NULL DEFAULT 'UK',
  society_type TEXT NOT NULL DEFAULT 'pro',
  society_name TEXT NOT NULL DEFAULT '',
  membership_identifier TEXT NOT NULL DEFAULT '',
  membership_status TEXT NOT NULL DEFAULT 'research',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(territory) BETWEEN 2 AND 120),
  CHECK (society_type IN ('pro', 'cmo', 'neighbouring_rights', 'mechanical', 'publisher_admin', 'other')),
  CHECK (char_length(society_name) BETWEEN 1 AND 120),
  CHECK (char_length(membership_identifier) <= 120),
  CHECK (membership_status IN ('research', 'applied', 'active', 'hold')),
  CHECK (char_length(notes) <= 4000)
);

CREATE UNIQUE INDEX IF NOT EXISTS halo_artist_rights_society_memberships_unique_idx
  ON halo_artist_rights_society_memberships(participant_id, territory, society_type, society_name);
CREATE INDEX IF NOT EXISTS halo_artist_rights_society_memberships_participant_idx
  ON halo_artist_rights_society_memberships(participant_id, membership_status, territory);

ALTER TABLE halo_artist_licensing_opportunities
  ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'required',
  ADD COLUMN approved_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  ADD COLUMN approved_at TIMESTAMPTZ,
  ADD COLUMN approval_note TEXT NOT NULL DEFAULT '',
  ADD CONSTRAINT halo_artist_licensing_approval_status_check CHECK (
    approval_status IN ('required', 'requested', 'approved', 'declined')
  ),
  ADD CONSTRAINT halo_artist_licensing_approval_note_length CHECK (char_length(approval_note) <= 2000),
  ADD CONSTRAINT halo_artist_licensing_approval_guard CHECK (
    approval_status <> 'approved' OR (approved_by_member_id IS NOT NULL AND approved_at IS NOT NULL)
  ),
  ADD CONSTRAINT halo_artist_licensing_stage_requires_approval CHECK (
    stage IN ('brief', 'matched', 'artist_approval', 'declined') OR approval_status = 'approved'
  );
