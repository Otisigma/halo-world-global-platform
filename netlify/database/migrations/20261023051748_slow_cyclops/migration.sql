CREATE TABLE "halo_release_assets" (
	"song_id" text PRIMARY KEY,
	"master_version_id" text NOT NULL,
	"canonical_master_url" text NOT NULL,
	"visual_act_1" text NOT NULL,
	"visual_act_2" text NOT NULL,
	"visual_act_3" text NOT NULL,
	"visual_act_4" text NOT NULL,
	"custom_images" jsonb DEFAULT '[]' NOT NULL,
	"revision" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "halo_release_conveyor" (
	"song_id" text PRIMARY KEY,
	"owner_member_id" text NOT NULL,
	"input_hash" text DEFAULT '' NOT NULL,
	"state" jsonb DEFAULT '{}' NOT NULL,
	"lease_token" text,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "halo_release_conveyor_events" (
	"id" text PRIMARY KEY,
	"song_id" text NOT NULL,
	"owner_member_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"stage" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "halo_song_catalog" ADD COLUMN "lyrics_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "halo_release_conveyor_events_song_idx" ON "halo_release_conveyor_events" ("song_id","created_at");--> statement-breakpoint
ALTER TABLE "halo_release_assets" ADD CONSTRAINT "halo_release_assets_song_id_halo_song_catalog_id_fkey" FOREIGN KEY ("song_id") REFERENCES "halo_song_catalog"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "halo_release_assets" ADD CONSTRAINT "halo_release_assets_7lNdvp8fKZXX_fkey" FOREIGN KEY ("master_version_id") REFERENCES "halo_song_versions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "halo_release_conveyor" ADD CONSTRAINT "halo_release_conveyor_song_id_halo_song_catalog_id_fkey" FOREIGN KEY ("song_id") REFERENCES "halo_song_catalog"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "halo_release_conveyor_events" ADD CONSTRAINT "halo_release_conveyor_events_song_id_halo_song_catalog_id_fkey" FOREIGN KEY ("song_id") REFERENCES "halo_song_catalog"("id") ON DELETE CASCADE;