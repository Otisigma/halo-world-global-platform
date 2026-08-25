CREATE TABLE "halo_dreamweaver_song_reviews" (
	"id" text PRIMARY KEY,
	"song_id" text NOT NULL,
	"owner_member_id" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"issues" jsonb DEFAULT '[]' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "halo_song_versions" (
	"id" text PRIMARY KEY,
	"song_id" text NOT NULL,
	"version_type" text NOT NULL,
	"label" text NOT NULL,
	"destination" text NOT NULL,
	"audio_url" text DEFAULT '' NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"mastering_status" text DEFAULT 'not_started' NOT NULL,
	"target_lufs" integer DEFAULT -14 NOT NULL,
	"true_peak_dbtp_tenths" integer DEFAULT -10 NOT NULL,
	"clean_lyrics" boolean DEFAULT false NOT NULL,
	"sale_enabled" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "halo_song_catalog" (
	"id" text PRIMARY KEY,
	"owner_member_id" text NOT NULL,
	"source_release_id" text,
	"artist_name" text NOT NULL,
	"title" text NOT NULL,
	"album_title" text DEFAULT '' NOT NULL,
	"isrc" text DEFAULT '' NOT NULL,
	"upc" text DEFAULT '' NOT NULL,
	"genre" text DEFAULT '' NOT NULL,
	"explicit_lyrics" boolean DEFAULT false NOT NULL,
	"rights_status" text DEFAULT 'needs_review' NOT NULL,
	"sale_status" text DEFAULT 'for_sale' NOT NULL,
	"sale_price_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"metadata_status" text DEFAULT 'needs_review' NOT NULL,
	"metadata_score" integer DEFAULT 0 NOT NULL,
	"metadata_issues" jsonb DEFAULT '[]' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "halo_dreamweaver_song_reviews_song_idx" ON "halo_dreamweaver_song_reviews" ("song_id","created_at");--> statement-breakpoint
CREATE INDEX "halo_song_versions_song_updated_idx" ON "halo_song_versions" ("song_id","updated_at");--> statement-breakpoint
CREATE INDEX "halo_song_versions_mastering_idx" ON "halo_song_versions" ("mastering_status","destination");--> statement-breakpoint
CREATE INDEX "halo_song_catalog_owner_updated_idx" ON "halo_song_catalog" ("owner_member_id","updated_at");--> statement-breakpoint
CREATE INDEX "halo_song_catalog_source_release_idx" ON "halo_song_catalog" ("source_release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "halo_song_catalog_owner_source_unique" ON "halo_song_catalog" ("owner_member_id","source_release_id");--> statement-breakpoint
ALTER TABLE "halo_dreamweaver_song_reviews" ADD CONSTRAINT "halo_dreamweaver_song_reviews_song_id_halo_song_catalog_id_fkey" FOREIGN KEY ("song_id") REFERENCES "halo_song_catalog"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "halo_song_versions" ADD CONSTRAINT "halo_song_versions_song_id_halo_song_catalog_id_fkey" FOREIGN KEY ("song_id") REFERENCES "halo_song_catalog"("id") ON DELETE CASCADE;