import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createPlaylistsHandler, playlistMutation } from "../netlify/lib/playlists.mjs";
import { playlistWorld } from "../lib/playlist-world.js";

test("playlist input rejects privilege fields, duplicate IDs, invalid chapters and room states", () => {
  const body = { action: "create", sourceId: "local-one", name: "Journey", releaseIds: ["one"], world: {} };
  assert.equal(playlistMutation(body).name, "Journey");
  for (const invalid of [
    { ...body, owner: "someone" }, { ...body, releaseIds: ["one", "one"] },
    { ...body, world: { chapters: [{ releaseId: "other", energy: 1, label: "Start" }] } },
    { ...body, name: " " }, { ...body, world: { preferences: { discovery: 101 } } }
  ]) assert.throws(() => playlistMutation(invalid));
  assert.throws(() => playlistMutation({ action: "room", id: "00000000-0000-4000-8000-000000000001", state: { releaseId: "one", playing: true, seconds: -1 } }));
});

test("real PostgreSQL migration and handler enforce ownership, links, collaboration, rooms and rewards", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE TABLE halo_memberships(member_id TEXT PRIMARY KEY, display_name TEXT);
      CREATE TABLE halo_release_campaigns(id TEXT PRIMARY KEY, title TEXT, artist TEXT, artwork_url TEXT,
        bpm INTEGER, genres TEXT[], content_rating TEXT, status TEXT, visibility TEXT);
      CREATE TABLE halo_song_catalog(source_release_id TEXT, owner_member_id TEXT);
      CREATE TABLE halo_member_notification_preferences(member_id TEXT PRIMARY KEY REFERENCES halo_memberships,
        rewards_enabled BOOLEAN NOT NULL DEFAULT FALSE);
      CREATE TABLE halo_member_reward_events(member_id TEXT REFERENCES halo_memberships, reward_key TEXT,
        points INTEGER NOT NULL, reason TEXT, PRIMARY KEY(member_id,reward_key));
      INSERT INTO halo_memberships VALUES ('owner','Owner'),('editor','Editor'),('contributor','Contributor'),('stranger','Stranger');
      INSERT INTO halo_member_notification_preferences VALUES ('owner', FALSE);
      INSERT INTO halo_release_campaigns VALUES
        ('one','One','A',NULL,120,ARRAY['House'],'clean','published','public'),
        ('two','Two','B',NULL,122,ARRAY['House'],'clean','published','public'),
        ('three','Three','C',NULL,124,ARRAY['House'],'explicit','published','public'),
        ('four','Four','A',NULL,126,ARRAY['House'],'clean','published','public'),
        ('five','Five','B',NULL,128,ARRAY['House'],'clean','published','public'),
        ('hidden','PRIVATE TITLE','Private artist',NULL,125,ARRAY['House'],'clean','published','private');
    `);
    await pg.exec(await readFile(new URL("../netlify/database/migrations/20261112050000_playlist_worlds.sql", import.meta.url), "utf8"));
    const db = { sql: async (strings, ...values) => {
      const query = strings.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ""), "");
      return (await pg.query(query, values)).rows;
    } };
    let actor = "owner", identityCalls = 0;
    const handler = createPlaylistsHandler({
      getDatabase: async () => db,
      getUser: async () => { identityCalls++; return actor ? { id: actor } : null; },
      ensureMembership: async () => {}, verifyRequestOrigin: async () => true
    });
    const post = body => handler(new Request("https://halo.test/api/playlists", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://halo.test" },
      body: JSON.stringify(body)
    }));
    const mutation = async body => {
      const response = await post(body), result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      return result;
    };
    const get = async query => {
      const response = await handler(new Request(`https://halo.test/api/playlists${query}`));
      return { status: response.status, body: await response.json() };
    };
    const create = { action: "create", sourceId: "local-one", name: "Night drive", releaseIds: ["one", "two"], world: playlistWorld({ request: "My private inspiration" }) };
    const created = await mutation(create), id = created.id;
    assert.equal(created.result, "saved");
    assert.equal((await mutation(create)).result, "exists", "an interrupted save can be retried without duplicates");
    let detail = (await get(`?id=${id}`)).body.playlist;
    assert.equal(detail.role, "owner");
    actor = "stranger";
    assert.equal((await get(`?id=${id}`)).status, 404);
    assert.equal((await post({ action: "delete", id })).status, 404);
    actor = "owner";
    assert.equal((await post({ ...create, sourceId: "hidden-source", releaseIds: ["hidden"] })).status, 409);
    const shared = await mutation({ action: "share", id, enabled: true });
    const previousCalls = identityCalls;
    actor = null;
    const publicView = await get(`?share=${shared.token}`);
    assert.equal(publicView.status, 200);
    assert.equal(identityCalls, previousCalls, "public listening links do not load account identity");
    assert.equal(publicView.body.playlist.role, "listener");
    assert.ok(!("collaborators" in publicView.body.playlist));
    assert.ok(!("sourceId" in publicView.body.playlist));
    assert.equal(publicView.body.playlist.world.request, "", "private prompts are never published with listening links");
    assert.doesNotMatch(JSON.stringify(publicView.body), /owner_member_id|stream_url|email/);
    actor = "owner";
    await mutation({ action: "share", id, enabled: false });
    assert.equal((await get(`?share=${shared.token}`)).status, 404);
    const invite = await mutation({ action: "invite", id, role: "editor" });
    actor = "editor";
    assert.equal((await mutation({ action: "join", token: invite.token })).result, "joined");
    actor = "stranger";
    assert.equal((await post({ action: "join", token: invite.token })).status, 404, "invites are single-use");
    actor = "editor";
    detail = (await get(`?id=${id}`)).body.playlist;
    assert.equal(detail.role, "editor");
    await mutation({ action: "update", id, revision: detail.revision, name: "Together", releaseIds: ["two", "one"], world: detail.world });
    assert.equal((await post({ action: "update", id, revision: detail.revision, name: "Stale", releaseIds: ["one"], world: detail.world })).status, 409);
    assert.equal((await post({ action: "share", id, enabled: true })).status, 403);
    actor = "owner";
    const contributor = await mutation({ action: "invite", id, role: "contributor" });
    actor = "contributor";
    await mutation({ action: "join", token: contributor.token });
    detail = (await get(`?id=${id}`)).body.playlist;
    assert.equal((await post({ action: "update", id, revision: detail.revision, name: "No", releaseIds: ["one"], world: detail.world })).status, 403);
    await mutation({ action: "suggest", id, releaseId: "three" });
    const suggestion = (await get(`?id=${id}`)).body.playlist.suggestions[0];
    await mutation({ action: "vote", id, suggestionId: suggestion.id });
    await mutation({ action: "vote", id, suggestionId: suggestion.id });
    assert.equal((await get(`?id=${id}`)).body.playlist.suggestions[0].votes, 1);
    actor = "owner";
    await mutation({ action: "moderate", id, suggestionId: suggestion.id, approve: true });
    detail = (await get(`?id=${id}`)).body.playlist;
    assert.deepEqual(detail.releaseIds, ["two", "one", "three"]);
    await mutation({ action: "room", id, state: { releaseId: "one", playing: true, seconds: 12 } });
    assert.equal((await get(`?id=${id}`)).body.playlist.room.seconds, 12);
    const roomView = (await get(`?room=${id}`)).body.playlist;
    assert.deepEqual(Object.keys(roomView), ["id", "room", "roomRevision"], "room polling never reloads private world metadata");
    actor = "editor";
    assert.equal((await post({ action: "room", id, state: null })).status, 403);
    actor = "owner";
    await mutation({ action: "room", id, state: null });
    assert.equal((await get(`?id=${id}`)).body.playlist.room, null);
    await mutation({ action: "revoke", id, memberId: "editor" });
    actor = "editor";
    assert.equal((await get(`?id=${id}`)).status, 404);
    assert.equal((await get(`?room=${id}`)).status, 404);
    actor = "owner";
    detail = (await get(`?id=${id}`)).body.playlist;
    await mutation({ action: "update", id, revision: detail.revision, name: "Together",
      releaseIds: ["one", "two", "three", "four", "five"], world: detail.world });
    assert.equal((await post({ action: "reward", id })).status, 409, "reward consent cannot be bypassed");
    await pg.exec("UPDATE halo_member_notification_preferences SET rewards_enabled = TRUE WHERE member_id = 'owner'");
    await pg.exec("INSERT INTO halo_song_catalog VALUES ('one','owner')");
    assert.equal((await post({ action: "reward", id })).status, 409, "own releases do not qualify as discovering other artists");
    await pg.exec("DELETE FROM halo_song_catalog");
    const reward = await mutation({ action: "reward", id });
    assert.equal(reward.points, 25);
    assert.equal((await mutation({ action: "reward", id })).points, 0);
    assert.equal((await get("")).body.rewards.points, 25);
    await pg.exec(`INSERT INTO halo_release_campaigns(id,title,artist,status,visibility,content_rating,genres)
      SELECT 'extra-' || n, 'Extra ' || n, 'Artist ' || n, 'published', 'public', 'clean', ARRAY['House']
      FROM generate_series(6,10) n`);
    detail = (await get(`?id=${id}`)).body.playlist;
    await mutation({ action: "update", id, revision: detail.revision, name: detail.name,
      releaseIds: [...detail.releaseIds, ...Array.from({ length: 5 }, (_, index) => `extra-${index + 6}`)], world: detail.world });
    assert.equal((await mutation({ action: "reward", id })).points, 50);
    assert.equal((await mutation({ action: "reward", id })).points, 0);
    assert.equal((await get("")).body.rewards.points, 75);
    await pg.exec("UPDATE halo_release_campaigns SET visibility = 'private' WHERE id = 'one'");
    detail = (await get(`?id=${id}`)).body.playlist;
    assert.deepEqual(detail.tracks[0], { id: "one", available: false }, "private titles and artists are not returned");
    await mutation({ action: "update", id, revision: detail.revision, name: "Together", releaseIds: detail.releaseIds, world: detail.world });
    const cors = await handler(new Request("https://halo.test/api/playlists", { method: "POST",
      headers: { Origin: "https://evil.test", "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) }));
    assert.equal(cors.status, 403);
    const large = await handler(new Request("https://halo.test/api/playlists", { method: "POST",
      headers: { Origin: "https://halo.test", "Content-Type": "application/json" }, body: "x".repeat(24_001) }));
    assert.equal(large.status, 413);
    await mutation({ action: "delete", id });
    assert.equal((await get(`?id=${id}`)).status, 404);
    assert.equal((await pg.query("SELECT COUNT(*)::int AS count FROM halo_member_reward_events")).rows[0].count, 2, "deletion cannot reset earned milestones");
  } finally { await pg.close(); }
});
