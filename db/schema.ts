import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const songs = pgTable("halo_song_catalog", {
  id: text("id").primaryKey(),
  ownerMemberId: text("owner_member_id").notNull(),
  sourceReleaseId: text("source_release_id"),
  artistName: text("artist_name").notNull(),
  title: text("title").notNull(),
  albumTitle: text("album_title").notNull().default(""),
  isrc: text("isrc").notNull().default(""),
  upc: text("upc").notNull().default(""),
  genre: text("genre").notNull().default(""),
  explicitLyrics: boolean("explicit_lyrics").notNull().default(false),
  rightsStatus: text("rights_status").notNull().default("needs_review"),
  saleStatus: text("sale_status").notNull().default("for_sale"),
  salePriceCents: integer("sale_price_cents"),
  currency: text("currency").notNull().default("USD"),
  notes: text("notes").notNull().default(""),
  metadataStatus: text("metadata_status").notNull().default("needs_review"),
  metadataScore: integer("metadata_score").notNull().default(0),
  metadataIssues: jsonb("metadata_issues").notNull().default([]),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("halo_song_catalog_owner_updated_idx").on(table.ownerMemberId, table.updatedAt),
  index("halo_song_catalog_source_release_idx").on(table.sourceReleaseId),
  uniqueIndex("halo_song_catalog_owner_source_unique").on(table.ownerMemberId, table.sourceReleaseId),
]);

export const songVersions = pgTable("halo_song_versions", {
  id: text("id").primaryKey(),
  songId: text("song_id").notNull().references(() => songs.id, { onDelete: "cascade" }),
  versionType: text("version_type").notNull(),
  label: text("label").notNull(),
  destination: text("destination").notNull(),
  audioUrl: text("audio_url").notNull().default(""),
  audioBlobPrefix: text("audio_blob_prefix").notNull().default(""),
  audioChunkCount: integer("audio_chunk_count").notNull().default(0),
  audioContentType: text("audio_content_type").notNull().default(""),
  audioByteSize: integer("audio_byte_size").notNull().default(0),
  audioFilename: text("audio_filename").notNull().default(""),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  masteringStatus: text("mastering_status").notNull().default("not_started"),
  targetLufs: integer("target_lufs").notNull().default(-14),
  truePeakDbtpTenths: integer("true_peak_dbtp_tenths").notNull().default(-10),
  cleanLyrics: boolean("clean_lyrics").notNull().default(false),
  saleEnabled: boolean("sale_enabled").notNull().default(false),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("halo_song_versions_song_updated_idx").on(table.songId, table.updatedAt),
  index("halo_song_versions_mastering_idx").on(table.masteringStatus, table.destination),
]);

export const dreamweaverSongReviews = pgTable("halo_dreamweaver_song_reviews", {
  id: text("id").primaryKey(),
  songId: text("song_id").notNull().references(() => songs.id, { onDelete: "cascade" }),
  ownerMemberId: text("owner_member_id").notNull(),
  status: text("status").notNull().default("completed"),
  score: integer("score").notNull().default(0),
  issues: jsonb("issues").notNull().default([]),
  summary: text("summary").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("halo_dreamweaver_song_reviews_song_idx").on(table.songId, table.createdAt),
]);

export const catalogProducerJobs = pgTable("halo_catalog_producer_jobs", {
  id: text("id").primaryKey(),
  ownerMemberId: text("owner_member_id").notNull(),
  status: text("status").notNull().default("queued"),
  stage: text("stage").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  packageCount: integer("package_count").notNull().default(0),
  errorMessage: text("error_message").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, table => [
  index("halo_catalog_producer_jobs_owner_idx").on(table.ownerMemberId, table.createdAt),
]);

export const catalogPackages = pgTable("halo_catalog_packages", {
  id: text("id").primaryKey(),
  ownerMemberId: text("owner_member_id").notNull(),
  sourceJobId: text("source_job_id").references(() => catalogProducerJobs.id, { onDelete: "set null" }),
  packageType: text("package_type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  rationale: text("rationale").notNull().default(""),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  projectedMonthlyNetCents: integer("projected_monthly_net_cents").notNull().default(0),
  trackCount: integer("track_count").notNull().default(0),
  status: text("status").notNull().default("draft"),
  strategy: text("strategy").notNull().default("dreamweaver"),
  signals: jsonb("signals").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("halo_catalog_packages_owner_idx").on(table.ownerMemberId, table.status, table.updatedAt),
]);

export const catalogPackageTracks = pgTable("halo_catalog_package_tracks", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull().references(() => catalogPackages.id, { onDelete: "cascade" }),
  songId: text("song_id").notNull().references(() => songs.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  engagementScore: integer("engagement_score").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("halo_catalog_package_tracks_position_unique").on(table.packageId, table.position),
  uniqueIndex("halo_catalog_package_tracks_song_unique").on(table.packageId, table.songId),
]);
