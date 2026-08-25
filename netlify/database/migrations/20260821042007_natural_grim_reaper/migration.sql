CREATE TABLE "halo_catalog_package_tracks" (
	"id" text PRIMARY KEY,
	"package_id" text NOT NULL,
	"song_id" text NOT NULL,
	"position" integer NOT NULL,
	"engagement_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "halo_catalog_packages" (
	"id" text PRIMARY KEY,
	"owner_member_id" text NOT NULL,
	"source_job_id" text,
	"package_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"projected_monthly_net_cents" integer DEFAULT 0 NOT NULL,
	"track_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"strategy" text DEFAULT 'dreamweaver' NOT NULL,
	"signals" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "halo_catalog_producer_jobs" (
	"id" text PRIMARY KEY,
	"owner_member_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"package_count" integer DEFAULT 0 NOT NULL,
	"error_message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "halo_catalog_package_tracks_position_unique" ON "halo_catalog_package_tracks" ("package_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "halo_catalog_package_tracks_song_unique" ON "halo_catalog_package_tracks" ("package_id","song_id");--> statement-breakpoint
CREATE INDEX "halo_catalog_packages_owner_idx" ON "halo_catalog_packages" ("owner_member_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "halo_catalog_producer_jobs_owner_idx" ON "halo_catalog_producer_jobs" ("owner_member_id","created_at");--> statement-breakpoint
ALTER TABLE "halo_catalog_package_tracks" ADD CONSTRAINT "halo_catalog_package_tracks_gmFyNXpG2loc_fkey" FOREIGN KEY ("package_id") REFERENCES "halo_catalog_packages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "halo_catalog_package_tracks" ADD CONSTRAINT "halo_catalog_package_tracks_song_id_halo_song_catalog_id_fkey" FOREIGN KEY ("song_id") REFERENCES "halo_song_catalog"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "halo_catalog_packages" ADD CONSTRAINT "halo_catalog_packages_AXmIR4BETU8p_fkey" FOREIGN KEY ("source_job_id") REFERENCES "halo_catalog_producer_jobs"("id") ON DELETE SET NULL;