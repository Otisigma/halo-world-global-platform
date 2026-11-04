-- Verified Stripe purchase events for idempotent owner alerts. No buyer contact details are stored.
CREATE TABLE IF NOT EXISTS halo_stripe_purchase_events (
  stripe_event_id TEXT PRIMARY KEY CHECK (char_length(stripe_event_id) BETWEEN 1 AND 255),
  checkout_session_id TEXT NOT NULL UNIQUE CHECK (char_length(checkout_session_id) BETWEEN 1 AND 255),
  mix_id TEXT CHECK (mix_id IS NULL OR char_length(mix_id) <= 100),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS halo_stripe_purchase_events_received_idx
  ON halo_stripe_purchase_events(received_at DESC);
