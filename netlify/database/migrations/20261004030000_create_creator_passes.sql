CREATE TABLE IF NOT EXISTS halo_creator_passes (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  subscription_tier TEXT NOT NULL DEFAULT 'STANDARD'
    CHECK (subscription_tier IN ('STANDARD', 'PREMIUM')),
  subscription_status TEXT NOT NULL DEFAULT 'inactive'
    CHECK (subscription_status IN ('inactive', 'trialing', 'active', 'past_due', 'canceled', 'expired')),
  subscription_expires_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (subscription_status <> 'active' OR subscription_expires_at IS NOT NULL),
  CHECK (subscription_status <> 'trialing' OR trial_ends_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS halo_creator_passes_discovery_idx
  ON halo_creator_passes(subscription_tier, subscription_status, subscription_expires_at);
