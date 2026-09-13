ALTER TABLE halo_artist_rights_works
  ADD COLUMN IF NOT EXISTS composition_owner TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS admin_publisher_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS admin_publishing_status TEXT NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'halo_artist_rights_works_composition_owner_length'
  ) THEN
    ALTER TABLE halo_artist_rights_works
      ADD CONSTRAINT halo_artist_rights_works_composition_owner_length CHECK (char_length(composition_owner) <= 180);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'halo_artist_rights_works_admin_publisher_name_length'
  ) THEN
    ALTER TABLE halo_artist_rights_works
      ADD CONSTRAINT halo_artist_rights_works_admin_publisher_name_length CHECK (char_length(admin_publisher_name) <= 180);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'halo_artist_rights_works_admin_publishing_status_check'
  ) THEN
    ALTER TABLE halo_artist_rights_works
      ADD CONSTRAINT halo_artist_rights_works_admin_publishing_status_check CHECK (
        admin_publishing_status IN ('unknown', 'self_administered', 'administered', 'publisher_controlled', 'seeking_admin')
      );
  END IF;
END $$;

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
  ADD COLUMN IF NOT EXISTS approval_status TEXT,
  ADD COLUMN IF NOT EXISTS approved_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_note TEXT NOT NULL DEFAULT '';

UPDATE halo_artist_licensing_opportunities
SET approval_status = CASE
    WHEN stage IN ('pitched', 'negotiating', 'contracted', 'delivered', 'paid') THEN 'approved'
    WHEN stage = 'artist_approval' THEN 'requested'
    WHEN stage = 'declined' THEN 'declined'
    ELSE 'required'
  END,
  approved_by_member_id = CASE
    WHEN stage IN ('pitched', 'negotiating', 'contracted', 'delivered', 'paid') THEN owner_member_id
    ELSE NULL
  END,
  approved_at = CASE
    WHEN stage IN ('pitched', 'negotiating', 'contracted', 'delivered', 'paid') THEN COALESCE(updated_at, created_at, NOW())
    ELSE NULL
  END
WHERE approval_status IS NULL;

ALTER TABLE halo_artist_licensing_opportunities
  ALTER COLUMN approval_status SET DEFAULT 'required',
  ALTER COLUMN approval_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'halo_artist_licensing_approval_status_check'
  ) THEN
    ALTER TABLE halo_artist_licensing_opportunities
      ADD CONSTRAINT halo_artist_licensing_approval_status_check CHECK (
        approval_status IN ('required', 'requested', 'approved', 'declined')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'halo_artist_licensing_approval_note_length'
  ) THEN
    ALTER TABLE halo_artist_licensing_opportunities
      ADD CONSTRAINT halo_artist_licensing_approval_note_length CHECK (char_length(approval_note) <= 2000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'halo_artist_licensing_approval_guard'
  ) THEN
    ALTER TABLE halo_artist_licensing_opportunities
      ADD CONSTRAINT halo_artist_licensing_approval_guard CHECK (
        approval_status <> 'approved' OR (approved_by_member_id IS NOT NULL AND approved_at IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'halo_artist_licensing_stage_requires_approval'
  ) THEN
    ALTER TABLE halo_artist_licensing_opportunities
      ADD CONSTRAINT halo_artist_licensing_stage_requires_approval CHECK (
        stage IN ('brief', 'matched', 'artist_approval', 'declined') OR approval_status = 'approved'
      );
  END IF;
END $$;
