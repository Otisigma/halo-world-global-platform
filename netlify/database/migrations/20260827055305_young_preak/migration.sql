CREATE TABLE "halo_catalog_layouts" (
	"owner_member_id" text PRIMARY KEY,
	"section_order" jsonb DEFAULT '["summary","catalog","producer","radio"]' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "halo_song_catalog" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;