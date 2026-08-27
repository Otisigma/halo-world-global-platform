ALTER TABLE "halo_song_versions" ADD COLUMN "artwork_url" text;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN "artwork_uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN "artwork_blob_prefix" text;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN "artwork_chunk_count" integer;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN "artwork_content_type" text;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN "artwork_byte_size" integer;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN "artwork_filename" text;--> statement-breakpoint
ALTER TABLE "halo_song_catalog" ADD COLUMN "artwork_url" text;--> statement-breakpoint
ALTER TABLE "halo_song_catalog" ADD COLUMN "artwork_uploaded_at" timestamp with time zone;