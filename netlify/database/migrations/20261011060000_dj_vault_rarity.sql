-- Curated exclusivity label for DJ Vault editions; drives white-label card variants and crate-digger filters.
ALTER TABLE halo_dj_vault_tracks ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'white_label';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'halo_dj_vault_tracks'::regclass AND conname = 'halo_dj_vault_tracks_rarity_check'
  ) THEN
    ALTER TABLE halo_dj_vault_tracks ADD CONSTRAINT halo_dj_vault_tracks_rarity_check
      CHECK (rarity IN ('white_label', 'test_press', 'promo_copy', 'vault_only', 'selector_exclusive'));
  END IF;
END $$;
