import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, chown } from "node:fs/promises";
import { loadOwnerOutcomes } from "../netlify/lib/owner-outcomes.mjs";

const exec = promisify(execFile);
const pgBin = (await exec("pg_config", ["--bindir"])).stdout.trim();
const directory = await mkdtemp("/tmp/halo-outcome-contracts-");
const root = new URL("../", import.meta.url);
const asPostgres = (command, args) => process.getuid?.() === 0
  ? exec("runuser", ["-u", "postgres", "--", command, ...args]) : exec(command, args);
const user = process.getuid?.() === 0 ? "postgres" : process.env.USER;
const execute = async query => (await exec(`${pgBin}/psql`, [
  "-X", "-qAt", "-h", directory, "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", query
], { maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const db = { sql: async (strings, ...values) => {
  const query = strings.reduce((sql, part, index) => sql + (index ? literal(values[index - 1]) : "") + part, "");
  return JSON.parse(await execute(`SELECT json_agg(row) FROM (${query}) row`));
} };
const owner = { id: "owner", app_metadata: { roles: ["owner"] } };
const now = new Date("2026-11-10T08:00:00Z");
let running = false;
try {
  if (process.getuid?.() === 0) {
    const uid = Number((await exec("id", ["-u", "postgres"])).stdout);
    const gid = Number((await exec("id", ["-g", "postgres"])).stdout);
    await chown(directory, uid, gid);
  }
  await asPostgres(`${pgBin}/initdb`, ["-D", `${directory}/data`, "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  await asPostgres(`${pgBin}/pg_ctl`, ["-D", `${directory}/data`, "-o", `-k ${directory} -h '' -p 5432`,
    "-l", `${directory}/postgres.log`, "-w", "start"]);
  running = true;
  await execute(`
    CREATE TABLE halo_memberships (member_id TEXT PRIMARY KEY);
    CREATE TABLE halo_release_campaigns (id TEXT PRIMARY KEY);
    ${await readFile(new URL("netlify/database/migrations/20260813120000_create-release-house.sql", root), "utf8")}
    ${await readFile(new URL("netlify/database/migrations/20261027070000_listening_telemetry.sql", root), "utf8")}
    ${await readFile(new URL("netlify/database/migrations/20260731120000_create-analytics-events.sql", root), "utf8")}
    ${await readFile(new URL("netlify/database/migrations/20260804120000_create-maintenance-issues.sql", root), "utf8")}
  `);
  let result = await loadOwnerOutcomes(db, owner, now);
  assert.ok(Object.values(result.sources).every(source => source.status === "available"));
  assert.equal(result.sources.creators.metrics.preparationRate, null);
  assert.equal(result.sources.listeners.metrics.returnRate, null);
  assert.equal(result.sources.playback.metrics.startRate, null);
  await execute(`
    INSERT INTO halo_memberships VALUES ('returner'), ('prior-only'), ('new'), ('revoked'), ('no-consent');
    INSERT INTO halo_release_campaigns VALUES ('release');
    INSERT INTO halo_listening_preferences(member_id, enabled, consent_at)
      VALUES ('returner', TRUE, '2026-10-01'), ('prior-only', TRUE, '2026-10-01'),
        ('new', TRUE, '2026-11-03T08:00:00Z'), ('revoked', FALSE, '2026-10-01'), ('no-consent', TRUE, NULL);
    INSERT INTO halo_listening_sessions(member_id, release_id, started_at) VALUES
      ('returner', 'release', '2026-10-27T08:00:00Z'),
      ('returner', 'release', '2026-11-04T08:00:00Z'),
      ('returner', 'release', '2026-11-05T08:00:00Z'),
      ('prior-only', 'release', '2026-11-02T08:00:00Z'),
      ('prior-only', 'release', '2026-11-10T08:00:00Z'),
      ('new', 'release', '2026-11-01T08:00:00Z'),
      ('new', 'release', '2026-11-03T08:00:00Z'),
      ('revoked', 'release', '2026-11-01T08:00:00Z'),
      ('revoked', 'release', '2026-11-04T08:00:00Z'),
      ('no-consent', 'release', '2026-11-01T08:00:00Z');
    INSERT INTO halo_release_house_projects(id, owner_member_id, project_name, created_at, completed_rooms) VALUES
      ('00000000-0000-4000-8000-000000000001', 'returner', 'Prepared', '2026-11-03T08:00:00Z', ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13]),
      ('00000000-0000-4000-8000-000000000002', 'returner', 'Partial', '2026-11-04', ARRAY[1,1,1,1,1,1,1,1,1,1,1,1,1]),
      ('00000000-0000-4000-8000-000000000003', 'returner', 'Old', '2026-11-01', ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13]),
      ('00000000-0000-4000-8000-000000000004', 'returner', 'Future', '2026-11-10T08:00:00Z', ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13]);
    INSERT INTO analytics_events(event_name, anonymous_id, session_id, page_path, metadata, created_at) VALUES
      ('shop_playback_attempt', 'browser-a', 'session-a', '/music/', '{"play_id":"same"}', '2026-11-03T08:00:00Z'),
      ('shop_playback_attempt', 'browser-a', 'session-a', '/music/', '{"play_id":"same"}', '2026-11-03T08:00:01Z'),
      ('shop_playback_ready', 'browser-a', 'session-a', '/music/', '{"play_id":"same"}', '2026-11-03T08:00:02Z'),
      ('shop_playback_ready', 'browser-a', 'session-a', '/music/', '{"play_id":"same"}', '2026-11-03T08:00:03Z'),
      ('shop_playback_failed', 'browser-a', 'session-a', '/music/', '{"play_id":"same"}', '2026-11-03T08:01:00Z'),
      ('shop_playback_attempt', 'browser-b', 'session-b', '/music/', '{"play_id":"same"}', '2026-11-04'),
      ('shop_playback_failed', 'browser-b', 'session-b', '/music/', '{"play_id":"same"}', '2026-11-04T01:00:00Z'),
      ('shop_playback_attempt', 'browser-c', 'session-c', '/music/', '{"play_id":"unknown"}', '2026-11-04'),
      ('shop_playback_attempt', 'browser-c', 'session-c', '/music/', '{}', '2026-11-04'),
      ('shop_playback_ready', 'browser-c', 'session-c', '/music/', '{"play_id":"orphan"}', '2026-11-04'),
      ('shop_playback_attempt', 'browser-d', 'session-d', '/music/', '{"play_id":"old"}', '2026-11-02'),
      ('shop_playback_attempt', 'browser-d', 'session-d', '/music/', '{"play_id":"future"}', '2026-11-10T08:00:00Z');
    INSERT INTO maintenance_issues(issue_key, source, category, severity, title, details, status, first_seen_at, healed_at) VALUES
      ('one', 'scheduled', 'test', 'high', 'Fixture', 'Fixture', 'open', '2026-11-03T08:00:00Z', NULL),
      ('two', 'browser', 'test', 'medium', 'Fixture', 'Fixture', 'healed', '2026-11-04', '2026-11-05'),
      ('three', 'browser', 'test', 'medium', 'Fixture', 'Fixture', 'open', '2026-10-01', NULL),
      ('four', 'scheduled', 'test', 'medium', 'Fixture', 'Fixture', 'healed', '2026-10-01', '2026-10-02');
  `);
  result = await loadOwnerOutcomes(db, owner, now);
  assert.deepEqual(result.sources.creators.metrics, { projects: 2, prepared: 1, preparationRate: 50 });
  assert.deepEqual(result.sources.listeners.metrics, {
    previousListeners: 2, currentListeners: 2, returningListeners: 1, returnRate: 50
  });
  assert.deepEqual(result.sources.playback.metrics, { attempts: 3, ready: 1, failed: 2, unknown: 1, startRate: 33.3 });
  assert.deepEqual(result.sources.operations.metrics, { openIssues: 2, newIssues: 2, scheduledIssues: 1, healedIssues: 1 });
  await execute("UPDATE halo_listening_preferences SET enabled = FALSE WHERE member_id = 'returner'");
  result = await loadOwnerOutcomes(db, owner, now);
  assert.equal(result.sources.listeners.metrics.returningListeners, 0, "revocation immediately changes aggregate eligibility");
  assert.equal(result.sources.listeners.metrics.previousListeners, 1);
  console.log("Owner outcome PostgreSQL contracts passed: real migrations, empty samples, cohort boundaries, consent, duplicate rooms, attempt deduplication and unknowns.");
} finally {
  if (running) await asPostgres(`${pgBin}/pg_ctl`, ["-D", `${directory}/data`, "-m", "fast", "-w", "stop"]);
  await rm(directory, { recursive: true, force: true });
}
