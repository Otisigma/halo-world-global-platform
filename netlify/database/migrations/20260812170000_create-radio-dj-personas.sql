-- Radio DJ personas.
--
-- The mix personas (DJ HALO, DJ BUTTERFLY, DJ ROMY) have only ever existed inside the live deck as
-- performance styles. This migration makes them station residents: a registry with a lane and an
-- earned level, sets planned ahead of air from rotation-approved tracks, grounded talk breaks,
-- deterministic performance evaluations, and per-persona working memory.
--
-- Two rules are enforced here rather than left to application code:
--   1. A persona never reaches air on its own. A set cannot be stored as approved or aired without
--      the member id of the owner who approved it.
--   2. A level is an amount of authority, not decoration. It is recomputed from recorded evidence
--      and is allowed to fall.

CREATE TABLE IF NOT EXISTS halo_radio_personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  lane TEXT NOT NULL DEFAULT '',
  home_room TEXT NOT NULL,
  bpm_min INTEGER NOT NULL DEFAULT 100,
  bpm_max INTEGER NOT NULL DEFAULT 140,
  transition_palette JSONB NOT NULL DEFAULT '[]'::jsonb,
  signature_move TEXT NOT NULL DEFAULT '',
  voice TEXT NOT NULL DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT '#f4f4f5',
  level SMALLINT NOT NULL DEFAULT 1,
  experience INTEGER NOT NULL DEFAULT 0,
  craft_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  reach_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  sets_aired INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'resident',
  last_aired_at TIMESTAMPTZ,
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (home_room IN ('club', 'chill', 'lounge')),
  CHECK (status IN ('resident', 'guest', 'rested', 'retired')),
  CHECK (level BETWEEN 1 AND 7),
  CHECK (experience >= 0),
  CHECK (craft_score BETWEEN 0 AND 100),
  CHECK (reach_score BETWEEN 0 AND 100),
  CHECK (sets_aired >= 0),
  CHECK (bpm_min BETWEEN 40 AND 240),
  CHECK (bpm_max BETWEEN 40 AND 240 AND bpm_max >= bpm_min),
  CHECK (char_length(name) BETWEEN 1 AND 80),
  CHECK (char_length(tagline) <= 200),
  CHECK (char_length(lane) <= 80),
  CHECK (char_length(signature_move) <= 200),
  CHECK (char_length(voice) <= 600),
  CHECK (jsonb_typeof(transition_palette) = 'array')
);

-- A planned set is an inspectable proposal: the running order, the transition chosen for each
-- handoff, and the talk breaks, all stored before the hour it is meant for.
CREATE TABLE IF NOT EXISTS halo_radio_persona_sets (
  id UUID PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES halo_radio_personas(id) ON DELETE CASCADE,
  room TEXT NOT NULL,
  show_id TEXT REFERENCES halo_radio_shows(id) ON DELETE SET NULL,
  planned_for TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'planned',
  energy_arc TEXT NOT NULL DEFAULT 'journey',
  seed BIGINT NOT NULL DEFAULT 0,
  tracks JSONB NOT NULL DEFAULT '[]'::jsonb,
  talk_breaks JSONB NOT NULL DEFAULT '[]'::jsonb,
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  talk_lines_kept INTEGER NOT NULL DEFAULT 0,
  talk_lines_dropped INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '',
  used_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  error_summary TEXT NOT NULL DEFAULT '',
  approved_by_member_id TEXT REFERENCES halo_memberships(member_id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  aired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (persona_id, planned_for),
  CHECK (room IN ('club', 'chill', 'lounge')),
  CHECK (status IN ('planned', 'approved', 'aired', 'skipped', 'archived')),
  CHECK (duration_minutes BETWEEN 15 AND 480),
  CHECK (talk_lines_kept >= 0 AND talk_lines_dropped >= 0),
  CHECK (char_length(error_summary) <= 1000),
  CHECK (jsonb_typeof(tracks) = 'array'),
  CHECK (jsonb_typeof(talk_breaks) = 'array'),
  -- The approval boundary, enforced by the database rather than by a prompt.
  CHECK (status NOT IN ('approved', 'aired') OR approved_by_member_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS halo_radio_persona_sets_upcoming_idx
  ON halo_radio_persona_sets (room, planned_for DESC);

CREATE INDEX IF NOT EXISTS halo_radio_persona_sets_persona_idx
  ON halo_radio_persona_sets (persona_id, planned_for DESC);

-- One evaluation row per persona per day. Craft and reach are kept apart on purpose: a persona
-- should be able to be an excellent DJ to a small room without being punished for the room size.
CREATE TABLE IF NOT EXISTS halo_radio_persona_scores (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  persona_id TEXT NOT NULL REFERENCES halo_radio_personas(id) ON DELETE CASCADE,
  evaluated_on DATE NOT NULL,
  window_days INTEGER NOT NULL DEFAULT 30,
  sets_aired INTEGER NOT NULL DEFAULT 0,
  listener_minutes NUMERIC(12, 2) NOT NULL DEFAULT 0,
  room_listener_minutes NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tune_ins INTEGER NOT NULL DEFAULT 0,
  tune_outs INTEGER NOT NULL DEFAULT 0,
  skips INTEGER NOT NULL DEFAULT 0,
  unique_listeners INTEGER NOT NULL DEFAULT 0,
  follows INTEGER NOT NULL DEFAULT 0,
  subscriptions INTEGER NOT NULL DEFAULT 0,
  retention NUMERIC(5, 4) NOT NULL DEFAULT 0,
  craft_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  reach_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  experience_before INTEGER NOT NULL DEFAULT 0,
  experience_after INTEGER NOT NULL DEFAULT 0,
  level_before SMALLINT NOT NULL DEFAULT 1,
  level_after SMALLINT NOT NULL DEFAULT 1,
  measured BOOLEAN NOT NULL DEFAULT FALSE,
  rationale TEXT NOT NULL DEFAULT '',
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (persona_id, evaluated_on),
  CHECK (level_before BETWEEN 1 AND 7),
  CHECK (level_after BETWEEN 1 AND 7),
  CHECK (craft_score BETWEEN 0 AND 100),
  CHECK (reach_score BETWEEN 0 AND 100),
  CHECK (char_length(rationale) <= 2000)
);

CREATE INDEX IF NOT EXISTS halo_radio_persona_scores_recent_idx
  ON halo_radio_persona_scores (persona_id, evaluated_on DESC);

-- Explicit, reviewable working memory, mirroring halo_agent_memory rather than hiding learning
-- inside a model.
CREATE TABLE IF NOT EXISTS halo_radio_persona_memory (
  persona_id TEXT NOT NULL REFERENCES halo_radio_personas(id) ON DELETE CASCADE,
  memory_key TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  observations INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persona_id, memory_key),
  CHECK (char_length(memory_key) BETWEEN 1 AND 120),
  CHECK (char_length(note) <= 2000),
  CHECK (observations >= 0)
);

-- A show can now name a resident instead of carrying a host as free text.
ALTER TABLE halo_radio_shows
  ADD COLUMN IF NOT EXISTS persona_id TEXT REFERENCES halo_radio_personas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS halo_radio_shows_persona_idx
  ON halo_radio_shows (persona_id)
  WHERE persona_id IS NOT NULL;

-- Planning a set can call the model, so it is metered through the same usage table as the AI DJ
-- rather than being given an unbounded budget of its own. The replacement check must list every
-- feature already recorded in the table -- 'ai_dj' and the 'artist_page_scout' rows added by
-- 20260810120000 -- or existing rows are rejected and the migration fails.
ALTER TABLE halo_ai_usage_events DROP CONSTRAINT IF EXISTS halo_ai_usage_events_feature_check;
ALTER TABLE halo_ai_usage_events ADD CONSTRAINT halo_ai_usage_events_feature_check
  CHECK (feature IN ('ai_dj', 'artist_page_scout', 'radio_persona'));

-- The three personas already defined in the live deck, carried over with the same lanes, tempo
-- ranges, and transition palettes so a resident behaves like the deck version listeners have heard.
INSERT INTO halo_radio_personas (
  id, name, tagline, lane, home_room, bpm_min, bpm_max, transition_palette,
  signature_move, voice, accent_color, level, status
)
VALUES
  (
    'halo', 'DJ HALO', 'Peak hour, full palette.', 'Peak Hour', 'club', 124, 140,
    '["long-blend", "vocal-handoff", "echo-out", "filter-sweep", "percussion-bridge", "drop-swap"]'::jsonb,
    'Reads the room and changes the mode mid-set rather than holding one intensity.',
    'Direct and unhurried. Speaks about the record in front of the room, never about itself. Short sentences.',
    '#f59e0b', 1, 'resident'
  ),
  (
    'butterfly', 'DJ BUTTERFLY', 'The sunset terrace.', 'Sunset Terrace', 'lounge', 118, 123,
    '["vocal-handoff", "long-blend", "filter-sweep", "echo-out", "percussion-bridge"]'::jsonb,
    'Long melodic blends that hand one vocal to the next without breaking the phrase.',
    'Warm and specific. Names what a record is doing emotionally. Never oversells.',
    '#a855f7', 1, 'resident'
  ),
  (
    'romy', 'DJ ROMY', 'After hours.', 'After Hours', 'chill', 90, 118,
    '["percussion-bridge", "drop-swap", "echo-out", "long-blend", "filter-sweep"]'::jsonb,
    'Builds tension with percussion and leaves through an echo rather than a cut.',
    'Quiet and patient. Comfortable with space. Speaks rarely and briefly.',
    '#f43f5e', 1, 'resident'
  )
ON CONFLICT (id) DO NOTHING;
