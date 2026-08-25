ALTER TABLE halo_mixes
  ADD COLUMN IF NOT EXISTS review_intent TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS review_context TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS protected_moments TEXT NOT NULL DEFAULT '';

ALTER TABLE halo_mixes
  DROP CONSTRAINT IF EXISTS halo_mixes_review_intent_length_check,
  DROP CONSTRAINT IF EXISTS halo_mixes_review_context_length_check,
  DROP CONSTRAINT IF EXISTS halo_mixes_protected_moments_length_check;

ALTER TABLE halo_mixes
  ADD CONSTRAINT halo_mixes_review_intent_length_check CHECK (char_length(review_intent) <= 1000),
  ADD CONSTRAINT halo_mixes_review_context_length_check CHECK (char_length(review_context) <= 1000),
  ADD CONSTRAINT halo_mixes_protected_moments_length_check CHECK (char_length(protected_moments) <= 1000);

CREATE TABLE IF NOT EXISTS halo_mix_review_cycles (
  id TEXT PRIMARY KEY,
  mix_id TEXT NOT NULL REFERENCES halo_mixes(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'queued',
  overall_score NUMERIC(5,2),
  scored_area_count INTEGER NOT NULL DEFAULT 0,
  abstained_area_count INTEGER NOT NULL DEFAULT 0,
  blocker_count INTEGER NOT NULL DEFAULT 0,
  final_summary TEXT NOT NULL DEFAULT '',
  finalized_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mix_id, cycle_number),
  CHECK (cycle_number BETWEEN 1 AND 100),
  CHECK (status IN ('queued', 'in_review', 'needs_context', 'ready', 'approved', 'revise', 'hold')),
  CHECK (overall_score IS NULL OR overall_score BETWEEN 1 AND 100),
  CHECK (scored_area_count BETWEEN 0 AND 6),
  CHECK (abstained_area_count BETWEEN 0 AND 6),
  CHECK (blocker_count BETWEEN 0 AND 6),
  CHECK (char_length(final_summary) <= 2000)
);

CREATE TABLE IF NOT EXISTS halo_mix_area_reviews (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES halo_mix_review_cycles(id) ON DELETE CASCADE,
  area TEXT NOT NULL,
  reviewer_member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  outcome TEXT NOT NULL DEFAULT 'abstain',
  score INTEGER,
  confidence TEXT NOT NULL DEFAULT 'medium',
  evidence TEXT NOT NULL DEFAULT '',
  recommendation TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, area),
  CHECK (area IN ('creative_intent', 'technical_sound', 'transitions_breaks', 'audience_programming', 'rights_credits', 'release_readiness')),
  CHECK (outcome IN ('scored', 'abstain', 'blocker')),
  CHECK (
    (outcome = 'scored' AND score IS NOT NULL AND score BETWEEN 1 AND 100)
    OR (outcome IN ('abstain', 'blocker') AND score IS NULL)
  ),
  CHECK (confidence IN ('low', 'medium', 'high')),
  CHECK (char_length(evidence) BETWEEN 5 AND 2000),
  CHECK (char_length(recommendation) <= 1200)
);

CREATE TABLE IF NOT EXISTS halo_mix_break_observations (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES halo_mix_area_reviews(id) ON DELETE CASCADE,
  timestamp_seconds INTEGER NOT NULL,
  break_type TEXT NOT NULL DEFAULT 'transition',
  observation TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'note',
  intent_understood BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (timestamp_seconds BETWEEN 0 AND 43200),
  CHECK (break_type IN ('transition', 'breakdown', 'drop', 'blend', 'energy_shift', 'other')),
  CHECK (severity IN ('note', 'strength', 'question', 'risk')),
  CHECK (char_length(observation) BETWEEN 3 AND 600)
);

INSERT INTO halo_mix_review_cycles (id, mix_id, cycle_number)
SELECT 'review-' || m.id, m.id, 1
FROM halo_mixes m
ON CONFLICT (mix_id, cycle_number) DO NOTHING;

CREATE INDEX IF NOT EXISTS halo_mix_review_cycles_queue_idx
  ON halo_mix_review_cycles(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS halo_mix_area_reviews_cycle_idx
  ON halo_mix_area_reviews(cycle_id, area);

CREATE INDEX IF NOT EXISTS halo_mix_break_observations_review_idx
  ON halo_mix_break_observations(review_id, timestamp_seconds);
