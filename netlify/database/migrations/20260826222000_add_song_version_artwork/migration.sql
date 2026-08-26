ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "artwork_url" text;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "artwork_uploaded_at" timestamptz;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "artwork_blob_prefix" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "artwork_chunk_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "artwork_content_type" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "artwork_byte_size" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "artwork_filename" text DEFAULT '';
