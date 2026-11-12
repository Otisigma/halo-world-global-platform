import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dailyHostTopic, validateHostConversation, publishDailyHostConversation, HOST_IDS, DAILY_TOPICS } from "../netlify/lib/community-hosts.mjs";

const now = new Date("2026-11-12T09:00:00Z");
assert.equal(dailyHostTopic(now).day, "2026-11-12");
assert.deepEqual(dailyHostTopic(now), dailyHostTopic(new Date("2026-11-12T23:59:59Z")));
assert.notEqual(dailyHostTopic(now).topic, dailyHostTopic(new Date("2026-11-13T09:00:00Z")).topic);
assert.equal(new Set(DAILY_TOPICS).size, 14);
assert.throws(() => dailyHostTopic(new Date("invalid")), /Invalid/);
const conversation = { posts: [
  "Daily topic: what makes a song stay with you?",
  "Muse: a contrast between rhythm and space can make a phrase stand out.",
  "Echo: that contrast can also give a playlist shape. What would you choose?"
] };
assert.deepEqual(validateHostConversation(conversation).map(post => post.actorId), HOST_IDS);
for (const invalid of [{}, { posts: [] }, { posts: ["one"] }, { posts: ["one", "two", "three", "four"] },
  { posts: [null, "two", "three"] }, { posts: [" ".repeat(10), "two", "three"] },
  { posts: ["x".repeat(321), "two", "three"] }, { posts: ["Visit https://example.com", "two", "three"] },
  { posts: ["<script>alert(1)</script>", "two", "three"] }, { posts: ["@member hello", "two", "three"] }]) {
  assert.throws(() => validateHostConversation(invalid));
}
assert.equal(validateHostConversation({ posts: ["x".repeat(320), "two", "three"] })[0].body.length, 320);
let generationCount = 0, writes = 0, posts = [], claim = false;
const db = {
  async sql(strings, ...values) {
    const source = strings.join("?");
    if (source.includes("SELECT day")) return claim ? [{ day: values[0] }] : [];
    assert.match(source, /WITH claimed AS/);
    assert.match(source, /ON CONFLICT \(day\) DO NOTHING RETURNING day/);
    assert.match(source, /SELECT .* FROM claimed/);
    assert.match(source, /FROM opener CROSS JOIN/);
    assert.match(source, /reply_to/);
    if (claim) return [];
    claim = true;
    writes++;
    posts = [values[3], values[5], values[7]];
    return [{ id: 1 }, { id: 2 }, { id: 3 }];
  }
};
const generate = async topic => {
  generationCount++;
  assert.equal(topic, dailyHostTopic(now).topic);
  return conversation;
};
const results = await Promise.all([
  publishDailyHostConversation(db, { now, generate }),
  publishDailyHostConversation(db, { now, generate })
]);
assert.equal(results.filter(result => result.published).length, 1);
assert.equal(writes, 1);
assert.deepEqual(posts, conversation.posts);
assert.equal((await publishDailyHostConversation(db, { now, generate })).published, false);
assert.equal(generationCount, 2, "a retry after publication makes no AI request");
claim = false;
await assert.rejects(publishDailyHostConversation(db, { now, generate: async () => ({ posts: [] }) }), /exactly three/);
assert.equal(claim, false, "invalid generation must not claim the day");
await assert.rejects(publishDailyHostConversation(db, { now, generate: async () => { throw new Error("Provider unavailable"); } }), /Provider unavailable/);
assert.equal(claim, false, "generation failure remains retryable");
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, handler, community, halo, metrics, council] = await Promise.all([
  read("netlify/database/migrations/20261112021000_create_daily_community_hosts.sql"),
  read("netlify/functions/community-host-daily.mjs"), read("netlify/functions/community.mjs"),
  read("halo.html"), read("netlify/lib/halo-x.mjs"), read("netlify/lib/agent-team.mjs")
]);
assert.match(migration, /day DATE PRIMARY KEY/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS is_automated/);
assert.doesNotMatch(migration, /INSERT INTO community_messages|INSERT INTO community_reactions|INSERT INTO community_support/);
assert.match(handler, /schedule: "0 9 \* \* \*"/);
assert.match(handler, /HALO_COMMUNITY_HOSTS_ENABLED === "false"/);
assert.match(handler, /recordScheduledHeartbeat\(db, "community-host-daily", "failure"/);
assert.match(handler, /maxRetries: 0/);
assert.match(handler, /not real fans/);
assert.equal((community.match(/NOT p\.is_automated AND p\.last_seen_at/g) || []).length, 2);
assert.match(community, /p\.is_host, p\.is_automated, m\.body/);
assert.match(halo, /host posts are not human activity/);
assert.match(halo, /message\.is_automated \? 'AI host'/);
assert.match(halo, /person\.is_automated \? 'AI HOST'/);
assert.match(metrics, /AND NOT p\.is_automated/);
assert.match(council, /AND NOT p\.is_automated/);
console.log("Daily community host contracts passed: UTC topics, three-post cap, atomic publication contract, duplicate retries, explicit AI labels, and separate human metrics.");
