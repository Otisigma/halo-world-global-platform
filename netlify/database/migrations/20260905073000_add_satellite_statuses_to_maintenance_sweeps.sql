ALTER TABLE halo_maintenance_sweeps
  ADD COLUMN IF NOT EXISTS satellite_statuses JSONB NOT NULL DEFAULT '[]'::jsonb;
