-- Give every published artist room a free, scoped starting plan without changing any existing plan.
INSERT INTO halo_artist_agent_plans (
  artist_slug,
  plan_tier,
  status,
  enabled_agents,
  monthly_run_allowance,
  activated_by_member_id
)
SELECT
  page.slug,
  'starter',
  'active',
  '["scout", "circle"]'::jsonb,
  4,
  page.owner_member_id
FROM halo_artist_pages page
WHERE page.status = 'published'
  AND page.owner_member_id IS NOT NULL
ON CONFLICT (artist_slug) DO NOTHING;
