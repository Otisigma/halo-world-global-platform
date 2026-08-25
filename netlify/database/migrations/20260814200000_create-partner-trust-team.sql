-- HALO Partner Trust Team
--
-- Platform providers are not ordinary release-promotion contacts. These records keep HALO's
-- intended use, safeguards, source provenance, and every owner-controlled communication together.
-- No table stores mail credentials and no state transition represents an automated send.

CREATE TABLE IF NOT EXISTS halo_partner_contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  relationship_status TEXT NOT NULL DEFAULT 'prospective',
  platform_url TEXT NOT NULL,
  account_url TEXT NOT NULL DEFAULT '',
  contact_url TEXT NOT NULL DEFAULT '',
  source_note TEXT NOT NULL,
  usage_summary TEXT NOT NULL,
  safeguards TEXT[] NOT NULL DEFAULT '{}',
  owner_notes TEXT NOT NULL DEFAULT '',
  min_days_between_contacts INTEGER NOT NULL DEFAULT 90,
  last_shared_at TIMESTAMPTZ,
  added_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (relationship_status IN ('prospective', 'active', 'paused', 'closed')),
  CHECK (char_length(name) BETWEEN 2 AND 160),
  CHECK (platform_url ~ '^https://'),
  CHECK (account_url = '' OR account_url ~ '^https://'),
  CHECK (contact_url = '' OR contact_url ~ '^https://'),
  CHECK (char_length(source_note) BETWEEN 8 AND 500),
  CHECK (char_length(usage_summary) BETWEEN 20 AND 2000),
  CHECK (cardinality(safeguards) BETWEEN 1 AND 12),
  CHECK (char_length(owner_notes) <= 2000),
  CHECK (min_days_between_contacts BETWEEN 14 AND 365)
);

CREATE TABLE IF NOT EXISTS halo_partner_briefs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES halo_partner_contacts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'introduction',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  evidence_keys TEXT[] NOT NULL,
  review_notes TEXT NOT NULL DEFAULT '',
  recommended_channel TEXT NOT NULL DEFAULT 'support_portal',
  status TEXT NOT NULL DEFAULT 'proposed',
  approved_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  shared_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  shared_at TIMESTAMPTZ,
  response_note TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  inference_used BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (purpose IN ('introduction', 'usage_disclosure', 'partnership', 'policy_review')),
  CHECK (recommended_channel IN ('email', 'support_portal', 'partner_form', 'meeting')),
  CHECK (status IN ('proposed', 'approved', 'shared', 'responded', 'archived')),
  CHECK (char_length(subject) <= 240),
  CHECK (char_length(body) BETWEEN 40 AND 6000),
  CHECK (cardinality(evidence_keys) BETWEEN 1 AND 20),
  CHECK (char_length(review_notes) <= 1200),
  CHECK (char_length(response_note) <= 2000),
  CHECK (status <> 'approved' OR (approved_by_member_id IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status NOT IN ('shared', 'responded') OR (shared_by_member_id IS NOT NULL AND shared_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS halo_partner_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partner_id TEXT REFERENCES halo_partner_contacts(id) ON DELETE CASCADE,
  brief_id BIGINT REFERENCES halo_partner_briefs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (event_type IN ('partner_added', 'brief_drafted', 'brief_approved', 'brief_archived', 'brief_shared', 'response_recorded')),
  CHECK (char_length(note) <= 1200)
);

CREATE INDEX IF NOT EXISTS halo_partner_briefs_partner_created_idx
  ON halo_partner_briefs(partner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS halo_partner_events_partner_created_idx
  ON halo_partner_events(partner_id, created_at DESC);

INSERT INTO halo_partner_contacts (
  id, name, relationship_status, platform_url, account_url, source_note, usage_summary, safeguards, owner_notes
) VALUES (
  'suno',
  'Suno',
  'prospective',
  'https://suno.com/',
  'https://suno.com/@halomusicworld5',
  'HALO owner supplied the new public Suno account on 2026-08-14 for a transparent platform-use review.',
  'HALO intends to create original loops, transitions, stems, atmospheres, vocal textures, and soundscapes, then download permitted assets and transform them through human-led DJ arrangement, effects, mixing, recording, and release review.',
  ARRAY[
    'Use only assets created under terms and plan rights that allow the intended release.',
    'Keep creation dates, prompts, plan status, downloads, and rights notes with each asset.',
    'Do not scrape, bypass limits, share credentials, or automate outside an approved API.',
    'Do not imitate named artists or upload third-party recordings, vocals, or samples without permission.',
    'Keep every external message, publication, and commercial release behind human approval.',
    'Review policy changes before scaling generation or downloads.'
  ],
  'Treat Suno as a prospective platform relationship unless Suno confirms a formal partnership.'
) ON CONFLICT (id) DO NOTHING;
