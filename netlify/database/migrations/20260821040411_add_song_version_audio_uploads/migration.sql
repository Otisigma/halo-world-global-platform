ALTER TABLE "halo_song_versions" ADD COLUMN "audio_blob_prefix" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN "audio_chunk_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN "audio_content_type" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN "audio_byte_size" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN "audio_filename" text DEFAULT '' NOT NULL;