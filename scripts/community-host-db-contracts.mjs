import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { publishDailyHostConversation } from "../netlify/lib/community-hosts.mjs";

const run = promisify(execFile);
const dsn = process.env.HALO_COMMUNITY_TEST_DSN;
if (!dsn) throw new Error("Set HALO_COMMUNITY_TEST_DSN to an isolated, disposable PostgreSQL database");
if (!/\bdbname=halo_community_test\b/.test(dsn) || !/\bhost=\/tmp\/halo-community-hosts-[a-z0-9]+(?:\s|$)/.test(dsn)) {
  throw new Error("Database contracts require the disposable halo_community_test database on a /tmp/halo-community-hosts-* socket");
}
const command = async (source) => {
  const { stdout } = await run("psql", ["--dbname", dsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", source]);
  return stdout.trim().split("\n").filter(Boolean);
};
for (const file of ["20260804150000_create-halo-community.sql", "20261112021000_create_daily_community_hosts.sql"]) {
  const source = await readFile(new URL(`../netlify/database/migrations/${file}`, import.meta.url), "utf8");
  await command(source);
}
const db = {
  async sql(strings, ...values) {
    const source = strings.reduce((query, text, index) => query + text
      + (index < values.length ? `'${String(values[index]).replaceAll("'", "''")}'` : ""), "");
    return (await command(source)).map(value => ({ id: value, day: value }));
  }
};
const now = new Date("2026-11-12T09:00:00Z");
const generate = async () => ({ posts: ["Nova: what makes a melody memorable?", "Muse: contrast can help a phrase stand out.", "Echo: what sort of contrast would you choose?"] });
const results = await Promise.all([
  publishDailyHostConversation(db, { now, generate }),
  publishDailyHostConversation(db, { now, generate })
]);
assert.equal(results.filter(result => result.published).length, 1);
assert.deepEqual(await command("SELECT count(*) FROM community_host_days"), ["1"]);
const failingDb = {
  sql(strings, ...values) {
    if (strings.join("").includes("WITH claimed")) values[6] = "missing-test-host";
    return db.sql(strings, ...values);
  }
};
await assert.rejects(publishDailyHostConversation(failingDb, {
  now: new Date("2026-11-13T09:00:00Z"), generate
}), /foreign key/);
assert.deepEqual(await command("SELECT count(*) FROM community_host_days"), ["1"], "failed reply insertion rolls back the date claim");
assert.deepEqual(await command("SELECT count(*) FROM community_messages WHERE actor_id LIKE 'halo-ai-%'"), ["3"], "failed reply insertion rolls back the opener");
assert.deepEqual(await command("SELECT count(*) FROM community_messages WHERE actor_id LIKE 'halo-ai-%'"), ["3"]);
assert.deepEqual(await command("SELECT count(*) FROM community_messages m JOIN community_messages opener ON opener.id = m.reply_to WHERE m.actor_id LIKE 'halo-ai-%' AND opener.actor_id = 'halo-ai-nova'"), ["2"]);
assert.equal((await publishDailyHostConversation(db, { now, generate: () => assert.fail("a published date must not call AI") })).published, false);
await assert.rejects(publishDailyHostConversation(db, {
  now: new Date("2026-11-13T09:00:00Z"), generate: async () => ({ posts: ["invalid"] })
}));
assert.deepEqual(await command("SELECT count(*) FROM community_host_days"), ["1"]);
assert.deepEqual(await command("SELECT count(*) FROM community_profiles WHERE is_automated AND last_seen_at >= NOW() - INTERVAL '15 minutes'"), ["3"]);
assert.deepEqual(await command("SELECT count(*) FROM community_profiles WHERE NOT is_automated AND actor_id LIKE 'halo-ai-%'"), ["0"]);
console.log("PostgreSQL daily-host contracts passed: one day, one opener, two replies under concurrency; duplicate/invalid runs and insertion failures preserve atomicity.");
