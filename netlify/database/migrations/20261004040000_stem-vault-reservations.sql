-- Reservations are a durable byte ledger, including abandoned uploads and archived packs.
-- Never release a reservation unless its corresponding blob has actually been deleted.
CREATE TABLE IF NOT EXISTS halo_stem_vault_usage (
  member_id TEXT PRIMARY KEY REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  used_bytes BIGINT NOT NULL DEFAULT 0 CHECK (used_bytes >= 0)
);
CREATE TABLE IF NOT EXISTS halo_stem_vault_chunks (
  member_id TEXT NOT NULL REFERENCES halo_memberships(member_id) ON DELETE CASCADE,
  upload_id TEXT NOT NULL,
  stem_type TEXT NOT NULL CHECK (stem_type IN ('full', 'drums', 'bass', 'music', 'vocals', 'fx')),
  chunk_index INTEGER NOT NULL CHECK (chunk_index BETWEEN 0 AND 127),
  chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 128),
  byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 4194304),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (member_id, upload_id, stem_type, chunk_index),
  CHECK (chunk_index < chunk_count),
  CHECK (upload_id ~ '^[0-9a-f-]{36}$')
);

INSERT INTO halo_stem_vault_usage (member_id, used_bytes)
SELECT pack.member_id, SUM(file.byte_size)
FROM halo_stem_files file JOIN halo_stem_packs pack ON pack.id = file.pack_id
GROUP BY pack.member_id
ON CONFLICT (member_id) DO NOTHING;

CREATE OR REPLACE FUNCTION halo_stem_vault_capacity(p_member TEXT)
RETURNS BIGINT LANGUAGE sql VOLATILE AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM halo_creator_passes
    WHERE member_id = p_member AND subscription_tier = 'PREMIUM'
      AND (subscription_expires_at IS NULL OR subscription_expires_at > clock_timestamp())
      AND ((subscription_status = 'active' AND subscription_expires_at > clock_timestamp())
        OR (subscription_status = 'trialing' AND trial_ends_at > clock_timestamp()))
  ) THEN NULL::BIGINT ELSE 5368709120::BIGINT END
$$;

CREATE OR REPLACE FUNCTION halo_reserve_stem_chunk(
  p_member TEXT, p_upload TEXT, p_stem TEXT, p_index INTEGER,
  p_count INTEGER, p_bytes BIGINT, p_hash TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_used BIGINT;
  v_capacity BIGINT;
  v_chunk halo_stem_vault_chunks%ROWTYPE;
BEGIN
  INSERT INTO halo_stem_vault_usage (member_id) VALUES (p_member)
    ON CONFLICT DO NOTHING;
  SELECT used_bytes INTO v_used FROM halo_stem_vault_usage
    WHERE member_id = p_member FOR UPDATE;
  v_capacity := halo_stem_vault_capacity(p_member);
  IF v_capacity IS NOT NULL AND v_used > v_capacity THEN RETURN 'capacity'; END IF;
  SELECT * INTO v_chunk FROM halo_stem_vault_chunks
    WHERE member_id = p_member AND upload_id = p_upload
      AND stem_type = p_stem AND chunk_index = p_index;
  IF FOUND THEN
    IF v_chunk.byte_size <> p_bytes OR v_chunk.content_hash <> p_hash
      OR v_chunk.chunk_count <> p_count THEN RETURN 'conflict'; END IF;
    RETURN 'retry';
  END IF;
  IF EXISTS (SELECT 1 FROM halo_stem_packs WHERE id = p_upload) THEN
    RETURN 'finalized';
  END IF;
  IF EXISTS (SELECT 1 FROM halo_stem_vault_chunks
    WHERE member_id = p_member AND upload_id = p_upload AND stem_type = p_stem
      AND chunk_count <> p_count) THEN RETURN 'conflict'; END IF;
  IF v_capacity IS NOT NULL AND v_used + p_bytes > v_capacity THEN
    RETURN 'capacity';
  END IF;
  INSERT INTO halo_stem_vault_chunks
    (member_id, upload_id, stem_type, chunk_index, chunk_count, byte_size, content_hash)
    VALUES (p_member, p_upload, p_stem, p_index, p_count, p_bytes, p_hash);
  UPDATE halo_stem_vault_usage SET used_bytes = used_bytes + p_bytes
    WHERE member_id = p_member;
  RETURN 'reserved';
END
$$;

CREATE OR REPLACE FUNCTION halo_finalize_stem_pack(
  p_member TEXT, p_upload TEXT, p_metadata JSONB, p_files JSONB
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_used BIGINT;
  v_capacity BIGINT;
  v_file JSONB;
  v_bytes BIGINT;
  v_count INTEGER;
BEGIN
  SELECT used_bytes INTO v_used FROM halo_stem_vault_usage
    WHERE member_id = p_member FOR UPDATE;
  IF NOT FOUND THEN RETURN 'incomplete'; END IF;
  v_capacity := halo_stem_vault_capacity(p_member);
  IF v_capacity IS NOT NULL AND v_used > v_capacity THEN RETURN 'capacity'; END IF;
  IF EXISTS (SELECT 1 FROM halo_stem_packs WHERE id = p_upload AND member_id = p_member) THEN
    RETURN 'saved';
  END IF;
  IF EXISTS (SELECT 1 FROM halo_stem_packs WHERE id = p_upload) THEN RETURN 'conflict'; END IF;
  FOR v_file IN SELECT * FROM jsonb_array_elements(p_files) LOOP
    SELECT COUNT(*), SUM(byte_size) INTO v_count, v_bytes FROM halo_stem_vault_chunks
      WHERE member_id = p_member AND upload_id = p_upload
        AND stem_type = v_file->>'stemType'
        AND chunk_count = (v_file->>'chunkCount')::INTEGER;
    IF v_count <> (v_file->>'chunkCount')::INTEGER
      OR v_bytes <> (v_file->>'byteSize')::BIGINT THEN RETURN 'incomplete'; END IF;
  END LOOP;
  INSERT INTO halo_stem_packs (
    id, member_id, title, description, source_provider, source_project_url,
    generation_prompt, bpm, musical_key, genre, mood, rights_attested, rights_attested_at
  ) VALUES (
    p_upload, p_member, p_metadata->>'title', p_metadata->>'description',
    p_metadata->>'sourceProvider', p_metadata->>'sourceProjectUrl',
    p_metadata->>'generationPrompt', (p_metadata->>'bpm')::NUMERIC,
    p_metadata->>'key', p_metadata->>'genre', p_metadata->>'mood', TRUE, NOW()
  );
  FOR v_file IN SELECT * FROM jsonb_array_elements(p_files) LOOP
    INSERT INTO halo_stem_files (
      pack_id, stem_type, original_filename, blob_key, chunk_count,
      content_type, byte_size, duration_seconds
    ) VALUES (
      p_upload, v_file->>'stemType', v_file->>'filename',
      p_member || '/' || p_upload || '/' || (v_file->>'stemType') || '/',
      (v_file->>'chunkCount')::INTEGER, v_file->>'contentType',
      (v_file->>'byteSize')::BIGINT, (v_file->>'durationSeconds')::NUMERIC
    );
  END LOOP;
  RETURN 'saved';
END
$$;
