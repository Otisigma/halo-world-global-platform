import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, publicationMigration, driveUrlMigration, generatedDriveUrlMigration, config] = await Promise.all([
  read("netlify/database/migrations/20261002013224_faulty_retro_girl/migration.sql"),
  read("netlify/database/migrations/20260919130000_create_song_publication_sync.sql"),
  read("netlify/database/migrations/20261002040000_add_song_version_drive_url.sql"),
  read("netlify/database/migrations/20261002102455_needy_nitro/migration.sql"),
  read("drizzle.config.ts"),
]);

assert.match(config, /out:\s*"netlify\/database\/migrations"/, "Drizzle migrations must use the Netlify migration directory");
assert.match(publicationMigration, /CREATE TABLE IF NOT EXISTS halo_song_publication_sync/, "publication storage is already created by an earlier migration");
assert.match(migration, /CREATE TABLE IF NOT EXISTS "halo_song_publication_sync"/, "the pending migration must preserve the existing publication table");

for (const column of ["audio_storage_key", "drive_file_id", "drive_file_name", "drive_byte_size", "drive_uploaded_at", "video_url", "promo_video_url"]) {
  assert.ok(migration.includes(`ADD COLUMN IF NOT EXISTS "${column}"`), `${column} must not be added twice`);
}

assert.match(migration, /CREATE INDEX IF NOT EXISTS "halo_song_publication_sync_owner_idx"/, "the owner index must be safe to retry");
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "halo_song_versions_single_active_master_idx"/, "the existing active-master index must be preserved");
assert.match(migration, /WHERE version_type = 'sale_master' AND status = 'active'/, "active-master uniqueness must retain its original scope");
assert.match(migration, /IF NOT EXISTS\s*\(\s*SELECT 1 FROM pg_constraint/, "foreign-key creation must be guarded");
assert.match(migration, /conrelid = 'halo_song_publication_sync'::regclass/, "the foreign-key guard must be scoped to the publication table");
assert.match(migration, /contype = 'f'/, "the foreign-key guard must check the constraint type");
assert.match(migration, /'halo_song_publication_sync_song_id_fkey'/, "the guard must recognize the original SQL foreign-key name");
assert.match(migration, /'halo_song_publication_sync_song_id_halo_song_catalog_id_fkey'/, "the guard must recognize the Drizzle foreign-key name on retries");
assert.match(migration, /REFERENCES "halo_song_catalog"\("id"\) ON DELETE CASCADE/, "new publication storage must retain cascading song references");
assert.doesNotMatch(migration, /(?:^|;\s*)(?:DROP|TRUNCATE|DELETE)\s/im, "reconciliation must not remove existing data or schema objects");
assert.match(driveUrlMigration, /ADD COLUMN IF NOT EXISTS drive_url/, "the next pending migration must remain retry-safe");
assert.match(generatedDriveUrlMigration, /^ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "drive_url" text DEFAULT '' NOT NULL;\s*$/, "the generated migration must preserve the drive_url column created by the earlier migration without changing its definition or existing data");

console.log("Database migration contracts passed");
