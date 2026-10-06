ALTER TABLE halo_creator_profiles ADD COLUMN IF NOT EXISTS public_profile_id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS halo_creator_profiles_public_id_idx ON halo_creator_profiles(public_profile_id);

CREATE TABLE IF NOT EXISTS halo_creator_dna (
  member_id TEXT PRIMARY KEY REFERENCES halo_creator_profiles(member_id) ON DELETE CASCADE,
  creative_statement TEXT NOT NULL DEFAULT '' CHECK (char_length(creative_statement) <= 600),
  creative_goals TEXT NOT NULL DEFAULT '' CHECK (char_length(creative_goals) <= 1000),
  workflow_notes TEXT NOT NULL DEFAULT '' CHECK (char_length(workflow_notes) <= 1000),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'members', 'public')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION halo_creator_dna_valid_aliases(term_aliases TEXT[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT term_aliases IS NOT NULL AND cardinality(term_aliases) <= 12 AND NOT EXISTS (
    SELECT 1 FROM unnest(term_aliases) item(value) WHERE item.value IS NULL OR char_length(item.value) NOT BETWEEN 1 AND 80
  );
$$;
CREATE TABLE IF NOT EXISTS halo_creator_dna_terms (
  id TEXT PRIMARY KEY,
  dimension TEXT NOT NULL CHECK (dimension IN ('sonic', 'mood', 'influence', 'skill', 'looking_for', 'collaboration')),
  key TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 64 AND key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80 AND BTRIM(label) <> ''),
  aliases TEXT[] NOT NULL DEFAULT '{}' CHECK (halo_creator_dna_valid_aliases(aliases)),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (dimension, key),
  UNIQUE (id, dimension),
  CHECK (id = dimension || ':' || key)
);
CREATE TABLE IF NOT EXISTS halo_creator_dna_tags (
  member_id TEXT NOT NULL REFERENCES halo_creator_dna(member_id) ON DELETE CASCADE,
  term_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  PRIMARY KEY (member_id, term_id),
  FOREIGN KEY (term_id, dimension) REFERENCES halo_creator_dna_terms(id, dimension)
);
CREATE INDEX IF NOT EXISTS halo_creator_dna_tags_term_idx ON halo_creator_dna_tags(term_id, member_id);
CREATE INDEX IF NOT EXISTS halo_creator_profiles_roles_gin ON halo_creator_profiles USING GIN(roles);
CREATE INDEX IF NOT EXISTS halo_creator_profiles_genres_gin ON halo_creator_profiles USING GIN(genres);
CREATE INDEX IF NOT EXISTS halo_creator_profiles_languages_gin ON halo_creator_profiles USING GIN(languages);
CREATE INDEX IF NOT EXISTS halo_creator_profiles_text_gin ON halo_creator_profiles
  USING GIN(to_tsvector('simple', display_name || ' ' || bio));
CREATE INDEX IF NOT EXISTS halo_creator_dna_text_gin ON halo_creator_dna
  USING GIN(to_tsvector('simple', creative_statement || ' ' || creative_goals));
CREATE INDEX IF NOT EXISTS halo_creator_dna_audience_idx ON halo_creator_dna(visibility, member_id);

CREATE TABLE IF NOT EXISTS halo_creator_dna_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO halo_creator_dna_terms (id, dimension, key, label, aliases)
SELECT dimension || ':' || key, dimension, key, label, aliases
FROM (VALUES
  ('sonic','atmospheric','Atmospheric',ARRAY['ambient textures']),
  ('sonic','warm','Warm',ARRAY[]::text[]), ('sonic','raw','Raw',ARRAY[]::text[]),
  ('sonic','polished','Polished',ARRAY[]::text[]), ('sonic','organic','Organic',ARRAY[]::text[]),
  ('sonic','electronic','Electronic',ARRAY[]::text[]), ('sonic','minimal','Minimal',ARRAY[]::text[]),
  ('sonic','cinematic','Cinematic',ARRAY[]::text[]), ('sonic','experimental','Experimental',ARRAY[]::text[]),
  ('mood','uplifting','Uplifting',ARRAY['upbeat']), ('mood','melancholic','Melancholic',ARRAY['wistful']),
  ('mood','introspective','Introspective',ARRAY[]::text[]), ('mood','energetic','Energetic',ARRAY[]::text[]),
  ('mood','dreamy','Dreamy',ARRAY[]::text[]), ('mood','dark','Dark',ARRAY[]::text[]),
  ('mood','playful','Playful',ARRAY[]::text[]), ('mood','peaceful','Peaceful',ARRAY[]::text[]),
  ('mood','intense','Intense',ARRAY[]::text[]),
  ('influence','house','House roots',ARRAY['house music']), ('influence','jazz','Jazz traditions',ARRAY[]::text[]),
  ('influence','soul','Soul traditions',ARRAY[]::text[]), ('influence','hip-hop','Hip-hop roots',ARRAY['hip hop']),
  ('influence','african-rhythms','African rhythms',ARRAY[]::text[]),
  ('influence','classical','Classical composition',ARRAY[]::text[]),
  ('influence','folk','Folk storytelling',ARRAY[]::text[]), ('influence','dub','Dub culture',ARRAY[]::text[]),
  ('influence','film','Film scores',ARRAY[]::text[]),
  ('skill','production','Production',ARRAY['producing']), ('skill','songwriting','Songwriting',ARRAY[]::text[]),
  ('skill','vocals','Vocals',ARRAY['singing']), ('skill','mixing','Mixing',ARRAY[]::text[]),
  ('skill','mastering','Mastering',ARRAY[]::text[]), ('skill','sound-design','Sound design',ARRAY[]::text[]),
  ('skill','arrangement','Arrangement',ARRAY[]::text[]), ('skill','instrumentation','Instrumentation',ARRAY[]::text[]),
  ('skill','visuals','Visual storytelling',ARRAY[]::text[]),
  ('looking_for','vocalist','Vocalist',ARRAY['singer']), ('looking_for','producer','Producer',ARRAY[]::text[]),
  ('looking_for','songwriter','Songwriter',ARRAY[]::text[]), ('looking_for','mix-engineer','Mix engineer',ARRAY[]::text[]),
  ('looking_for','instrumentalist','Instrumentalist',ARRAY[]::text[]),
  ('looking_for','visual-artist','Visual artist',ARRAY[]::text[]), ('looking_for','remixer','Remixer',ARRAY[]::text[]),
  ('looking_for','feedback','Constructive feedback',ARRAY[]::text[]), ('looking_for','mentor','Mentor',ARRAY[]::text[]),
  ('collaboration','remote','Remote',ARRAY['online']), ('collaboration','in-person','In person',ARRAY['in person']),
  ('collaboration','async','Asynchronous',ARRAY['asynchronous']),
  ('collaboration','live-session','Live sessions',ARRAY[]::text[]),
  ('collaboration','co-writing','Co-writing',ARRAY['cowriting']),
  ('collaboration','iterative','Iterative',ARRAY[]::text[]),
  ('collaboration','structured','Structured briefs',ARRAY[]::text[]),
  ('collaboration','improvisation','Improvisation',ARRAY[]::text[]),
  ('collaboration','long-term','Long-term partnerships',ARRAY[]::text[])
) AS vocabulary(dimension, key, label, aliases)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, aliases = EXCLUDED.aliases;

CREATE OR REPLACE FUNCTION halo_creator_dna_tag_cap() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM halo_creator_dna WHERE member_id = NEW.member_id FOR UPDATE;
  IF (SELECT count(*) FROM halo_creator_dna_tags WHERE member_id = NEW.member_id
      AND (TG_OP <> 'UPDATE' OR term_id <> OLD.term_id OR member_id <> OLD.member_id)) >= 48
    OR (SELECT count(*) FROM halo_creator_dna_tags WHERE member_id = NEW.member_id AND dimension = NEW.dimension
      AND (TG_OP <> 'UPDATE' OR term_id <> OLD.term_id OR member_id <> OLD.member_id)) >= 8 THEN
    RAISE EXCEPTION 'Creative DNA term cap exceeded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS halo_creator_dna_tag_cap_trigger ON halo_creator_dna_tags;
CREATE TRIGGER halo_creator_dna_tag_cap_trigger BEFORE INSERT OR UPDATE ON halo_creator_dna_tags
FOR EACH ROW EXECUTE FUNCTION halo_creator_dna_tag_cap();

-- Lock the existing profile even on first save: revision zero has exactly one winner.
CREATE OR REPLACE FUNCTION halo_save_creator_dna(
  owner_id TEXT, statement TEXT, goals TEXT, notes TEXT, audience TEXT,
  expected_revision INTEGER, selected_terms TEXT[]
) RETURNS SETOF halo_creator_dna LANGUAGE plpgsql AS $$
DECLARE current_revision INTEGER;
BEGIN
  PERFORM 1 FROM halo_creator_profiles WHERE member_id = owner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT revision INTO current_revision FROM halo_creator_dna WHERE member_id = owner_id;
  IF COALESCE(current_revision, 0) <> expected_revision THEN RETURN; END IF;
  IF selected_terms IS NULL OR cardinality(selected_terms) > 48 OR EXISTS (
    SELECT 1 FROM unnest(selected_terms) selected(id) LEFT JOIN halo_creator_dna_terms t ON t.id = selected.id
    WHERE t.id IS NULL OR t.active = FALSE
  ) OR EXISTS (
    SELECT 1 FROM halo_creator_dna_terms WHERE id = ANY(selected_terms)
    GROUP BY dimension HAVING count(*) > 8
  ) OR cardinality(selected_terms) <> (SELECT count(DISTINCT id) FROM unnest(selected_terms) selected(id)) THEN
    RAISE EXCEPTION 'Invalid Creative DNA terms' USING ERRCODE = '23514';
  END IF;
  INSERT INTO halo_creator_dna(member_id, creative_statement, creative_goals, workflow_notes, visibility, revision)
  VALUES (owner_id, statement, goals, notes, audience, expected_revision + 1)
  ON CONFLICT (member_id) DO UPDATE SET creative_statement = EXCLUDED.creative_statement,
    creative_goals = EXCLUDED.creative_goals, workflow_notes = EXCLUDED.workflow_notes,
    visibility = EXCLUDED.visibility, revision = EXCLUDED.revision, updated_at = NOW();
  DELETE FROM halo_creator_dna_tags WHERE member_id = owner_id;
  INSERT INTO halo_creator_dna_tags(member_id, term_id, dimension)
  SELECT owner_id, id, dimension FROM halo_creator_dna_terms WHERE id = ANY(selected_terms) AND active = TRUE;
  RETURN QUERY SELECT * FROM halo_creator_dna WHERE member_id = owner_id;
END;
$$;
