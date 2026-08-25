-- HALO Outreach Desk
--
-- The existing halo_relationship_* tables are an inbound CRM: every row keys on a member_id and
-- describes someone who already joined HALO. Getting a record out to radio, DJs, press, playlists,
-- labels, and sync is the opposite motion — the people involved are not members, have no account,
-- and have not asked to hear from us. That difference is why this is a separate spine rather than
-- more columns on the member tables.
--
-- Because these are real professionals receiving unsolicited mail, the constraints below are the
-- product. They are in the schema rather than in a handler or a prompt so that no future function,
-- model, or scheduled job can route around them.

CREATE TABLE IF NOT EXISTS halo_outreach_targets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  organisation TEXT NOT NULL DEFAULT '',
  territory TEXT NOT NULL DEFAULT 'Global',
  genres TEXT[] NOT NULL DEFAULT '{}',
  tempo_min INTEGER,
  tempo_max INTEGER,
  contact_email TEXT NOT NULL DEFAULT '',
  contact_url TEXT NOT NULL DEFAULT '',
  preferred_channel TEXT NOT NULL DEFAULT 'email',

  -- Provenance is mandatory. A target cannot exist without a written record of where the contact
  -- point came from, which makes silent scraping impossible to represent in this table.
  source_note TEXT NOT NULL,
  lawful_basis TEXT NOT NULL DEFAULT 'public_professional_listing',

  contact_status TEXT NOT NULL DEFAULT 'active',
  opted_out_at TIMESTAMPTZ,
  opt_out_note TEXT NOT NULL DEFAULT '',

  -- The frequency cap lives on the target, so a contact who asks for less gets less, permanently.
  min_days_between_contacts INTEGER NOT NULL DEFAULT 45,
  last_contacted_at TIMESTAMPTZ,

  pitches_sent INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  placements INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',

  added_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (kind IN ('radio', 'dj', 'playlist', 'press', 'label', 'sync', 'promoter')),
  CHECK (preferred_channel IN ('email', 'form', 'portal', 'post')),
  CHECK (lawful_basis IN ('public_professional_listing', 'legitimate_interest', 'consent')),
  CHECK (contact_status IN ('active', 'paused', 'opted_out', 'bounced')),
  CHECK (char_length(name) BETWEEN 2 AND 160),
  CHECK (char_length(source_note) BETWEEN 4 AND 300),
  CHECK (char_length(notes) <= 1200),
  CHECK (char_length(opt_out_note) <= 300),
  CHECK (min_days_between_contacts BETWEEN 7 AND 365),
  CHECK (cardinality(genres) <= 12),
  CHECK (tempo_min IS NULL OR (tempo_min BETWEEN 40 AND 220)),
  CHECK (tempo_max IS NULL OR (tempo_max BETWEEN 40 AND 220)),
  CHECK (tempo_min IS NULL OR tempo_max IS NULL OR tempo_min <= tempo_max),

  -- An opt-out must carry the moment it happened, so "we did not know" is not a storable state.
  CHECK (contact_status <> 'opted_out' OR opted_out_at IS NOT NULL),

  -- There has to be somewhere to actually send it.
  CHECK (contact_email <> '' OR contact_url <> '')
);

CREATE TABLE IF NOT EXISTS halo_outreach_runs (
  id TEXT PRIMARY KEY,
  release_id TEXT REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'complete',
  targets_considered INTEGER NOT NULL DEFAULT 0,
  targets_eligible INTEGER NOT NULL DEFAULT 0,
  pitches_kept INTEGER NOT NULL DEFAULT 0,
  pitches_dropped INTEGER NOT NULL DEFAULT 0,
  blocked_suppressed INTEGER NOT NULL DEFAULT 0,
  blocked_frequency INTEGER NOT NULL DEFAULT 0,
  briefing TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  inference_calls INTEGER NOT NULL DEFAULT 0,
  fallback_calls INTEGER NOT NULL DEFAULT 0,
  created_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (trigger_type IN ('manual', 'scheduled')),
  CHECK (status IN ('complete', 'partial', 'failed')),
  CHECK (char_length(briefing) <= 4000)
);

CREATE TABLE IF NOT EXISTS halo_outreach_pitches (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES halo_release_campaigns(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES halo_outreach_targets(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES halo_outreach_runs(id) ON DELETE SET NULL,
  agent_key TEXT NOT NULL DEFAULT 'pen',

  fit_score INTEGER NOT NULL DEFAULT 0,
  fit_reasons TEXT[] NOT NULL DEFAULT '{}',
  signal_keys TEXT[] NOT NULL,

  channel TEXT NOT NULL DEFAULT 'email',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'proposed',
  approved_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  sent_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,

  outcome TEXT NOT NULL DEFAULT 'pending',
  outcome_note TEXT NOT NULL DEFAULT '',
  outcome_recorded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (status IN ('proposed', 'approved', 'sent', 'archived')),
  CHECK (outcome IN ('pending', 'replied', 'declined', 'placed', 'no_response')),
  CHECK (channel IN ('email', 'form', 'portal', 'post')),
  CHECK (fit_score BETWEEN 0 AND 100),
  CHECK (char_length(subject) <= 200),
  CHECK (char_length(body) BETWEEN 2 AND 4000),
  CHECK (char_length(outcome_note) <= 600),
  CHECK (cardinality(fit_reasons) <= 8),

  -- The grounding gate. A pitch that cites nothing about this record or this contact is a form
  -- letter, and a form letter is what gets a sender blocked.
  CHECK (cardinality(signal_keys) BETWEEN 1 AND 8),

  -- The approval gate. Nothing reaches a human inbox on the platform's own authority: a pitch
  -- cannot be stored as approved or sent without the member id of the person who approved it.
  CHECK (status NOT IN ('approved', 'sent') OR approved_by_member_id IS NOT NULL),

  -- HALO holds no mail credentials and sends nothing. 'sent' is a human recording what they did,
  -- so it requires both the person and the moment.
  CHECK (status <> 'sent' OR (sent_by_member_id IS NOT NULL AND sent_at IS NOT NULL)),

  -- One pitch per contact per release, enforced by the database rather than by good intentions.
  -- This is the single strongest anti-spam guarantee in the system.
  UNIQUE (release_id, target_id)
);

CREATE TABLE IF NOT EXISTS halo_outreach_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pitch_id BIGINT REFERENCES halo_outreach_pitches(id) ON DELETE CASCADE,
  target_id TEXT REFERENCES halo_outreach_targets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (event_type IN ('target_added', 'target_updated', 'approved', 'unapproved', 'sent', 'replied', 'declined', 'placed', 'no_response', 'opted_out', 'suppressed', 'archived')),
  CHECK (char_length(note) <= 600)
);

CREATE INDEX IF NOT EXISTS halo_outreach_targets_kind_idx
  ON halo_outreach_targets(contact_status, kind, territory);
CREATE INDEX IF NOT EXISTS halo_outreach_targets_contacted_idx
  ON halo_outreach_targets(last_contacted_at DESC NULLS FIRST);
CREATE INDEX IF NOT EXISTS halo_outreach_pitches_release_idx
  ON halo_outreach_pitches(release_id, status, fit_score DESC);
CREATE INDEX IF NOT EXISTS halo_outreach_pitches_target_idx
  ON halo_outreach_pitches(target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_outreach_pitches_queue_idx
  ON halo_outreach_pitches(status, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_outreach_runs_release_idx
  ON halo_outreach_runs(release_id, created_at DESC);
CREATE INDEX IF NOT EXISTS halo_outreach_events_target_idx
  ON halo_outreach_events(target_id, created_at DESC);

-- No targets are seeded. Contact details for real DJs, stations, journalists, and labels are not
-- something to invent: a plausible-looking address for a real person is worse than an empty table,
-- because someone would eventually send to it. The desk starts empty and is filled by the owner
-- from contacts they actually hold, each with its provenance recorded.
