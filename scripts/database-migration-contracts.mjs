import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = resolve(root, "netlify/database/migrations");

function verifySongSchemaMigrations(migrations) {
  const relations = new Set();
  const columns = new Set();

  function record(objects, name, guarded, migration) {
    assert.ok(!objects.has(name) || guarded, `${migration} recreates ${name} without IF NOT EXISTS`);
    objects.add(name);
  }

  for (const { name, sql } of migrations) {
    const statements = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").split(";");
    for (const statement of statements) {
      const relation = statement.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(IF\s+NOT\s+EXISTS\s+)?"?(halo_song_[a-z_]+)"?/i);
      if (relation) record(relations, relation[2], Boolean(relation[1]), name);

      const alteration = statement.match(/ALTER\s+TABLE\s+"?(halo_song_[a-z_]+)"?/i);
      if (!alteration) continue;
      for (const column of statement.matchAll(/ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?"?([a-z_]+)"?/gi)) {
        record(columns, `${alteration[1]}.${column[2]}`, Boolean(column[1]), name);
      }
    }
  }
}

for (const sql of [
  'CREATE TABLE "halo_song_publication_sync" (song_id text);',
  'ALTER TABLE "halo_song_versions" ADD COLUMN "drive_file_id" text;',
  'CREATE UNIQUE INDEX "halo_song_versions_single_active_master_idx" ON halo_song_versions (song_id);',
]) {
  assert.throws(() => verifySongSchemaMigrations([{ name: "first", sql }, { name: "duplicate", sql }]), /without IF NOT EXISTS/);
}
verifySongSchemaMigrations([
  { name: "first", sql: "ALTER TABLE halo_song_versions ADD COLUMN drive_url text;" },
  { name: "guarded", sql: "ALTER TABLE halo_song_versions ADD COLUMN IF NOT EXISTS drive_url text;" },
]);

const entries = await readdir(migrationDirectory, { withFileTypes: true });
const migrations = [];
for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
  if (!entry.isDirectory() && !entry.name.endsWith(".sql")) continue;
  const path = resolve(migrationDirectory, entry.name, ...(entry.isDirectory() ? ["migration.sql"] : []));
  migrations.push({ name: entry.name, sql: await readFile(path, "utf8") });
}
verifySongSchemaMigrations(migrations);
console.log("Song database migration contracts passed.");
