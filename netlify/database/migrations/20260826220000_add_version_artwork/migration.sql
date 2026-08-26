ALTER TABLE "halo_song_versions"
  ADD COLUMN IF NOT EXISTS "artwork_url" text,
  ADD COLUMN IF NOT EXISTS "artwork_blob_prefix" text,
  ADD COLUMN IF NOT EXISTS "artwork_chunk_count" integer,
  ADD COLUMN IF NOT EXISTS "artwork_content_type" text,
  ADD COLUMN IF NOT EXISTS "artwork_byte_size" integer,
  ADD COLUMN IF NOT EXISTS "artwork_filename" text,
  ADD COLUMN IF NOT EXISTS "artwork_uploaded_at" timestamptz;
