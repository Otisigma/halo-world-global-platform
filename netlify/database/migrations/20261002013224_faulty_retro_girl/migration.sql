CREATE TABLE IF NOT EXISTS "halo_song_publication_sync" (
	"song_id" text PRIMARY KEY,
	"owner_member_id" text NOT NULL,
	"release_id" text,
	"radio_track_id" text,
	"canonical_url" text DEFAULT '' NOT NULL,
	"release_status" text DEFAULT 'pending' NOT NULL,
	"radio_status" text DEFAULT 'pending' NOT NULL,
	"dreamweaver_status" text DEFAULT 'pending' NOT NULL,
	"details" jsonb DEFAULT '{}' NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reconciled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "audio_storage_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "drive_file_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "drive_file_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "drive_byte_size" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "drive_uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "video_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "promo_video_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "halo_song_publication_sync_owner_idx" ON "halo_song_publication_sync" ("owner_member_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "halo_song_versions_single_active_master_idx" ON "halo_song_versions" ("song_id") WHERE version_type = 'sale_master' AND status = 'active';--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'halo_song_publication_sync'::regclass
			AND contype = 'f'
			AND conname IN (
				'halo_song_publication_sync_song_id_fkey',
				'halo_song_publication_sync_song_id_halo_song_catalog_id_fkey'
			)
	) THEN
		ALTER TABLE "halo_song_publication_sync" ADD CONSTRAINT "halo_song_publication_sync_song_id_halo_song_catalog_id_fkey" FOREIGN KEY ("song_id") REFERENCES "halo_song_catalog"("id") ON DELETE CASCADE;
	END IF;
END
$$;
