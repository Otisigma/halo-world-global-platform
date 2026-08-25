ALTER TABLE halo_visual_mix_projects
  DROP CONSTRAINT IF EXISTS halo_visual_mix_projects_package_type_check;

ALTER TABLE halo_visual_mix_projects
  ADD CONSTRAINT halo_visual_mix_projects_package_type_check
  CHECK (package_type IN ('complete', 'logo', 'hybrid', 'full_visual'));
