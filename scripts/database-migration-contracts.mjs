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
assert.match(driveUrlMigration, /ADD COLUMN IF NOT EXISTS drive_url/, "the earlier Drive URL migration must remain retry-safe");

function validatePendingMigrations(migration, driveMigration) {
  const statements = migration.split("--> statement-breakpoint").map(statement => statement.trim());
  assert.equal(statements.length, 11, "the pending migration must not add unrelated statements");
  assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS "halo_song_publication_sync"\s*\([\s\S]*\);$/, "the pending migration must preserve the existing publication table");
  assert.equal((statements[0].match(/;/g) || []).length, 1, "table creation must not include additional statements");

  const columns = [
    ["audio_storage_key", "text DEFAULT '' NOT NULL"],
    ["drive_file_id", "text DEFAULT '' NOT NULL"],
    ["drive_file_name", "text DEFAULT '' NOT NULL"],
    ["drive_byte_size", "integer DEFAULT 0 NOT NULL"],
    ["drive_uploaded_at", "timestamp with time zone"],
    ["video_url", "text DEFAULT '' NOT NULL"],
    ["promo_video_url", "text DEFAULT '' NOT NULL"],
  ];
  columns.forEach(([column, definition], index) => {
    assert.equal(statements[index + 1], `ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "${column}" ${definition};`, `${column} must retain its definition and duplicate-column guard`);
  });

  assert.equal(statements[8], 'CREATE INDEX IF NOT EXISTS "halo_song_publication_sync_owner_idx" ON "halo_song_publication_sync" ("owner_member_id","updated_at");', "the owner index must retain its scope and retry guard");
  assert.equal(statements[9], `CREATE UNIQUE INDEX IF NOT EXISTS "halo_song_versions_single_active_master_idx" ON "halo_song_versions" ("song_id") WHERE version_type = 'sale_master' AND status = 'active';`, "active-master uniqueness must retain its original scope and retry guard");
  const foreignKey = statements[10].replace(/\s+/g, " ");
  assert.equal(foreignKey, `DO $$ BEGIN IF NOT EXISTS ( SELECT 1 FROM pg_constraint WHERE conrelid = 'halo_song_publication_sync'::regclass AND contype = 'f' AND conname IN ( 'halo_song_publication_sync_song_id_fkey', 'halo_song_publication_sync_song_id_halo_song_catalog_id_fkey' ) ) THEN ALTER TABLE "halo_song_publication_sync" ADD CONSTRAINT "halo_song_publication_sync_song_id_halo_song_catalog_id_fkey" FOREIGN KEY ("song_id") REFERENCES "halo_song_catalog"("id") ON DELETE CASCADE; END IF; END $$;`, "both foreign-key names must guard only the cascading song reference on the publication table");
  assert.doesNotMatch(migration, /(?:^|;\s*|\bTHEN\s+)(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\s/im, "reconciliation must not mutate existing data or remove schema objects");
  assert.equal(driveMigration.trim(), `ALTER TABLE "halo_song_versions" ADD COLUMN IF NOT EXISTS "drive_url" text DEFAULT '' NOT NULL;`, "the generated Drive URL migration must preserve the column created by the earlier migration");
}

validatePendingMigrations(migration, generatedDriveUrlMigration);

for (const statement of migration.split("--> statement-breakpoint").slice(0, 10)) {
  assert.throws(() => validatePendingMigrations(migration.replace(statement, statement.replace("IF NOT EXISTS ", "")), generatedDriveUrlMigration), assert.AssertionError, "removing any table, column, or index retry guard must fail");
}
for (const [before, after] of [
  ["IF NOT EXISTS (", "IF EXISTS ("],
  ["conrelid = 'halo_song_publication_sync'::regclass", "conrelid = 'halo_song_catalog'::regclass"],
  ["AND contype = 'f'", ""],
  ["'halo_song_publication_sync_song_id_fkey',", ""],
  ["'halo_song_publication_sync_song_id_halo_song_catalog_id_fkey'", "'unrelated_fkey'"],
  ["ON DELETE CASCADE", "ON DELETE SET NULL"],
  ["version_type = 'sale_master' AND status = 'active'", "status = 'active'"],
  ["END IF;", 'END IF; ALTER TABLE "halo_song_publication_sync" ADD CONSTRAINT "duplicate" FOREIGN KEY ("song_id") REFERENCES "halo_song_catalog"("id");'],
]) {
  assert.ok(migration.includes(before), "mutation must target an existing safeguard");
  assert.throws(() => validatePendingMigrations(migration.replace(before, after), generatedDriveUrlMigration), assert.AssertionError, `regression must fail: ${before}`);
}
assert.throws(() => validatePendingMigrations(migration, generatedDriveUrlMigration.replace("IF NOT EXISTS ", "")), assert.AssertionError, "removing the later Drive URL guard must fail");
assert.throws(() => validatePendingMigrations(`${migration}\nCREATE TABLE "halo_song_publication_sync" (song_id text);`, generatedDriveUrlMigration), assert.AssertionError, "appending duplicate creation must fail");

console.log("Database migration contracts and safeguard mutation checks passed");
