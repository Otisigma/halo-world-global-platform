ALTER TABLE halo_creator_profiles
  ADD COLUMN IF NOT EXISTS creative_dna_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS creative_dna_audience TEXT NOT NULL DEFAULT 'private'
    CHECK (creative_dna_audience IN ('private', 'members', 'public')),
  ADD COLUMN IF NOT EXISTS creative_dna_discovery BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS creative_dna_revision BIGINT NOT NULL DEFAULT 0 CHECK (creative_dna_revision >= 0);

CREATE TABLE IF NOT EXISTS halo_creator_interest_terms (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('sound', 'disciplines', 'tools', 'themes', 'beyond')),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 48),
  normalized_key TEXT GENERATED ALWAYS AS (LOWER(REGEXP_REPLACE(BTRIM(label), '\s+', ' ', 'g'))) STORED,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  aliases TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(aliases) <= 8),
  UNIQUE (id, category)
);
ALTER TABLE halo_creator_interest_terms
  ADD COLUMN IF NOT EXISTS normalized_key TEXT GENERATED ALWAYS AS (LOWER(REGEXP_REPLACE(BTRIM(label), '\s+', ' ', 'g'))) STORED,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS halo_creator_interest_normalized_unique
  ON halo_creator_interest_terms(category, normalized_key);
INSERT INTO halo_creator_interest_terms (id, category, label, aliases) VALUES
  ('sound.house', 'sound', 'House', ARRAY['house music']),
  ('sound.jazz', 'sound', 'Jazz', '{}'),
  ('sound.ambient', 'sound', 'Ambient', ARRAY['ambient music']),
  ('sound.hip-hop', 'sound', 'Hip-hop', ARRAY['hip hop', 'hiphop']),
  ('sound.soul', 'sound', 'Soul', '{}'),
  ('sound.afrobeat', 'sound', 'Afrobeat', '{}'),
  ('disciplines.songwriting', 'disciplines', 'Songwriting', ARRAY['song writing']),
  ('disciplines.production', 'disciplines', 'Music production', ARRAY['production', 'producing']),
  ('disciplines.dj', 'disciplines', 'DJing', ARRAY['dj', 'deejaying']),
  ('disciplines.visual-art', 'disciplines', 'Visual art', ARRAY['visual arts']),
  ('disciplines.dance', 'disciplines', 'Dance', ARRAY['dancing']),
  ('disciplines.film', 'disciplines', 'Filmmaking', ARRAY['film making']),
  ('tools.field-recording', 'tools', 'Field recording', ARRAY['field recordings']),
  ('tools.sampling', 'tools', 'Sampling', '{}'),
  ('tools.synthesis', 'tools', 'Synthesis', ARRAY['synthesizers', 'synths']),
  ('tools.ableton', 'tools', 'Ableton Live', ARRAY['ableton']),
  ('tools.logic', 'tools', 'Logic Pro', ARRAY['logic']),
  ('tools.modular', 'tools', 'Modular synthesis', ARRAY['modular synth']),
  ('themes.minimalism', 'themes', 'Minimalism', ARRAY['minimalist']),
  ('themes.futurism', 'themes', 'Futurism', ARRAY['futurist']),
  ('themes.nature', 'themes', 'Nature', '{}'),
  ('themes.storytelling', 'themes', 'Storytelling', ARRAY['story telling']),
  ('themes.nostalgia', 'themes', 'Nostalgia', ARRAY['nostalgic']),
  ('themes.surrealism', 'themes', 'Surrealism', ARRAY['surrealist']),
  ('beyond.cooking', 'beyond', 'Cooking', ARRAY['culinary arts']),
  ('beyond.gardening', 'beyond', 'Gardening', '{}'),
  ('beyond.hiking', 'beyond', 'Hiking', '{}'),
  ('beyond.photography', 'beyond', 'Photography', '{}'),
  ('beyond.gaming', 'beyond', 'Gaming', ARRAY['video games']),
  ('beyond.astronomy', 'beyond', 'Astronomy', '{}')
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, aliases = EXCLUDED.aliases;

CREATE TABLE IF NOT EXISTS halo_creator_interests (
  member_id TEXT NOT NULL REFERENCES halo_creator_profiles(member_id) ON DELETE CASCADE,
  position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 23),
  term_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('sound', 'disciplines', 'tools', 'themes', 'beyond')),
  custom_label TEXT,
  relationship TEXT NOT NULL DEFAULT '' CHECK (relationship IN ('', 'inspired', 'practicing', 'learning')),
  audience TEXT NOT NULL DEFAULT 'private' CHECK (audience IN ('private', 'members', 'public')),
  PRIMARY KEY (member_id, position),
  FOREIGN KEY (term_id, category) REFERENCES halo_creator_interest_terms(id, category),
  CHECK ((term_id IS NOT NULL AND custom_label IS NULL) OR
    (term_id IS NULL AND custom_label IS NOT NULL AND char_length(BTRIM(custom_label)) BETWEEN 1 AND 48
      AND custom_label !~ '[[:cntrl:]]'))
);
CREATE UNIQUE INDEX IF NOT EXISTS halo_creator_interest_term_unique
  ON halo_creator_interests(member_id, term_id) WHERE term_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS halo_creator_interest_custom_unique
  ON halo_creator_interests(member_id, category, LOWER(BTRIM(custom_label))) WHERE term_id IS NULL;
CREATE INDEX IF NOT EXISTS halo_creator_interest_lookup
  ON halo_creator_interests(term_id, member_id) WHERE term_id IS NOT NULL;

CREATE OR REPLACE FUNCTION halo_check_interest_limits() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE total_count INTEGER; category_count INTEGER; custom_count INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.member_id <> OLD.member_id THEN
    RAISE EXCEPTION 'Interest identity cannot change';
  END IF;
  PERFORM 1 FROM halo_creator_profiles WHERE member_id = NEW.member_id FOR UPDATE;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE category = NEW.category),
    COUNT(*) FILTER (WHERE term_id IS NULL)
    INTO total_count, category_count, custom_count
    FROM halo_creator_interests WHERE member_id = NEW.member_id
      AND (TG_OP = 'INSERT' OR position <> OLD.position);
  IF total_count >= 24 OR category_count >= 6 OR (NEW.term_id IS NULL AND custom_count >= 4) THEN
    RAISE EXCEPTION 'Creative DNA assignment limit exceeded';
  END IF;
  IF NEW.term_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM halo_creator_interest_terms WHERE id = NEW.term_id AND active
  ) THEN RAISE EXCEPTION 'Unknown or inactive canonical term'; END IF;
  IF NEW.term_id IS NULL AND EXISTS (
    SELECT 1 FROM halo_creator_interest_terms t WHERE t.category = NEW.category
      AND LOWER(REGEXP_REPLACE(BTRIM(NEW.custom_label), '\s+', ' ', 'g')) = ANY (
        SELECT LOWER(REGEXP_REPLACE(BTRIM(alias), '\s+', ' ', 'g')) FROM unnest(array_append(t.aliases, t.normalized_key)) AS alias
      )
  ) THEN RAISE EXCEPTION 'Use the canonical term'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER halo_creator_interest_limits
  BEFORE INSERT OR UPDATE ON halo_creator_interests
  FOR EACH ROW EXECUTE FUNCTION halo_check_interest_limits();

-- Row lock, revision compare, replacement, and revision increment are one transaction.
-- No data-modifying CTE reads its own pre-write snapshot.
CREATE OR REPLACE FUNCTION halo_save_creative_dna(
  target TEXT, creator_name TEXT, expected BIGINT, enabled BOOLEAN,
  audience TEXT, discovery BOOLEAN, items JSONB
) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE current_revision BIGINT; item JSONB; ordinal BIGINT;
BEGIN
  IF expected < 0 OR enabled IS NULL OR discovery IS NULL OR audience NOT IN ('private', 'members', 'public')
    OR jsonb_typeof(items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid Creative DNA'; END IF;
  IF jsonb_array_length(items) > 24 THEN RAISE EXCEPTION 'Creative DNA limit exceeded'; END IF;
  INSERT INTO halo_creator_profiles(member_id, display_name)
    SELECT target, LEFT(COALESCE(NULLIF(creator_name, ''), 'HALO creator'), 100) WHERE expected = 0
    ON CONFLICT (member_id) DO NOTHING;
  SELECT creative_dna_revision INTO current_revision FROM halo_creator_profiles
    WHERE member_id = target FOR UPDATE;
  IF current_revision IS DISTINCT FROM expected THEN RETURN NULL; END IF;
  DELETE FROM halo_creator_interests WHERE member_id = target;
  FOR item, ordinal IN SELECT value, ordinality FROM jsonb_array_elements(items) WITH ORDINALITY LOOP
    INSERT INTO halo_creator_interests(member_id, position, term_id, category, custom_label, relationship, audience)
      VALUES (target, ordinal - 1, NULLIF(item->>'termId', ''), item->>'category',
        CASE WHEN NULLIF(item->>'termId', '') IS NULL THEN item->>'label' ELSE NULL END,
        COALESCE(item->>'relationship', ''), item->>'audience');
  END LOOP;
  UPDATE halo_creator_profiles SET creative_dna_enabled = enabled, creative_dna_audience = audience,
    creative_dna_discovery = discovery, creative_dna_revision = creative_dna_revision + 1
    WHERE member_id = target RETURNING creative_dna_revision INTO current_revision;
  RETURN current_revision;
END $$;

CREATE OR REPLACE FUNCTION halo_creative_dna_projection(
  target TEXT, viewer TEXT, destination TEXT, for_discovery BOOLEAN DEFAULT FALSE, artist TEXT DEFAULT ''
) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('termId', i.term_id, 'category', i.category,
    'label', COALESCE(t.label, i.custom_label), 'relationship', i.relationship) ORDER BY i.position), '[]'::jsonb)
  FROM halo_creator_profiles p JOIN halo_creator_interests i ON i.member_id = p.member_id
  LEFT JOIN halo_creator_interest_terms t ON t.id = i.term_id
  WHERE p.member_id = target AND p.creative_dna_enabled
    AND p.creative_dna_audience IN ('members', 'public') AND i.audience IN ('members', 'public')
    AND ((viewer IS NOT NULL AND destination IN ('network', 'signal'))
      OR (p.creative_dna_audience = 'public' AND i.audience = 'public'))
    AND (i.term_id IS NULL OR t.active)
    AND (NOT for_discovery OR (p.creative_dna_discovery AND i.term_id IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM halo_signal_blocks b
      WHERE (b.member_id = viewer AND b.target_member_id = target)
        OR (b.member_id = target AND b.target_member_id = viewer))
    AND CASE destination
      WHEN 'network' THEN p.discoverable
      WHEN 'public-network' THEN p.discoverable
      WHEN 'home' THEN p.discoverable AND NOT EXISTS (
        SELECT 1 FROM halo_music_homes h, jsonb_array_elements(h.config->'layoutModules') module
        WHERE h.member_id = target AND module->>'type' = 'CREATIVE_DNA' AND module->'isVisible' = 'false'::jsonb)
      WHEN 'signal' THEN EXISTS (SELECT 1 FROM halo_signal_profiles s WHERE s.member_id = target AND s.discoverable)
      WHEN 'artist' THEN p.artist_slug = artist AND EXISTS (SELECT 1 FROM halo_artist_pages a
        WHERE a.slug = artist AND a.owner_member_id = target AND a.status = 'published')
      ELSE FALSE END
$$;

CREATE OR REPLACE FUNCTION halo_creative_dna_matches(
  target TEXT, viewer TEXT, destination TEXT, category_filter TEXT, ids TEXT[], mode TEXT
) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT (category_filter = '' OR EXISTS (SELECT 1 FROM jsonb_array_elements(visible) item
      WHERE item->>'category' = category_filter))
    AND (cardinality(ids) = 0 OR CASE WHEN mode = 'all' THEN
      NOT EXISTS (SELECT 1 FROM unnest(ids) id WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(visible) item WHERE item->>'termId' = id))
      ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(visible) item WHERE item->>'termId' = ANY(ids)) END)
  FROM (SELECT halo_creative_dna_projection(target, viewer, destination, TRUE) visible) projected
$$;

CREATE OR REPLACE FUNCTION halo_creative_dna_shared(target TEXT, viewer TEXT, destination TEXT)
RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
  FROM jsonb_array_elements(halo_creative_dna_projection(target, viewer, destination, TRUE)) item
  WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(
    halo_creative_dna_projection(viewer, viewer, destination, TRUE)) own_item
    WHERE own_item->>'termId' = item->>'termId')
$$;

-- Existing four-module configurations remain valid; a fifth optional module contains no profile content.
CREATE OR REPLACE FUNCTION halo_valid_music_home_layout(modules JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(modules) = 'array' THEN CASE WHEN jsonb_array_length(modules) IN (4, 5) THEN (
    SELECT COUNT(DISTINCT item->>'type') = jsonb_array_length(modules)
      AND COUNT(DISTINCT item->>'order') = jsonb_array_length(modules)
      AND COUNT(*) FILTER (WHERE item->>'type' IN ('PEARL_HALL', 'SOVEREIGN_VAULT', 'SIGNAL_FEED', 'COLLAB_BRIEFS')) = 4
      AND BOOL_AND(COALESCE(
        item ?& ARRAY['id', 'type', 'order', 'isVisible']
        AND (item - ARRAY['id', 'type', 'order', 'isVisible']) = '{}'::jsonb
        AND item->>'type' IN ('PEARL_HALL', 'SOVEREIGN_VAULT', 'SIGNAL_FEED', 'COLLAB_BRIEFS', 'CREATIVE_DNA')
        AND item->>'id' = item->>'type'
        AND item->'order' IN ('0'::jsonb, '1'::jsonb, '2'::jsonb, '3'::jsonb, '4'::jsonb)
        AND (jsonb_array_length(modules) = 5 OR item->'order' <> '4'::jsonb)
        AND jsonb_typeof(item->'isVisible') = 'boolean', FALSE
      )) IS TRUE FROM jsonb_array_elements(modules) item
  ) ELSE FALSE END ELSE FALSE END
$$;
REVOKE ALL ON TABLE halo_creator_interest_terms, halo_creator_interests FROM PUBLIC;
REVOKE ALL ON FUNCTION halo_save_creative_dna(TEXT, TEXT, BIGINT, BOOLEAN, TEXT, BOOLEAN, JSONB) FROM PUBLIC;
