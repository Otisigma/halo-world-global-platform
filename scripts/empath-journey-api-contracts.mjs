import assert from "node:assert/strict";
import { readFile, mkdir, rm } from "node:fs/promises";
import { spawn, spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHmac } from "node:crypto";
import { createEmpathJourneyHandler, journeyPreviewUrl } from "../netlify/lib/empath-journey.mjs";
import { createJourneyController } from "../empath-journey/journey.js";

const migration = await readFile(new URL("../netlify/database/migrations/20261010040000_empath_journey.sql", import.meta.url), "utf8");
const source = await readFile(new URL("../netlify/lib/empath-journey.mjs", import.meta.url), "utf8");
const secret = "contract-only-journey-identity";
const owner = "private-identity-owner";
const other = "private-identity-other";
const id = "00000000-0000-4000-8000-000000000001";
const env = { JOURNEY_IDENTITY_SECRET: secret };
const accountHash = value => createHmac("sha256", secret).update(`account:${value}`).digest("hex");
const request = (query = "", body, headers = {}) => new Request(`https://halo.example/api/empath-journey${query}`,
  body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json",
    Origin: "https://halo.example", ...headers }, body: JSON.stringify(body) });
const vote = { action: "vote", releaseId: "song-one", kind: "track" };
const album = { action: "album", name: "Personal quiet album", shared: false,
  tracks: [{ releaseId: "song-one", transitionSeconds: 3 }] };
const lyric = { action: "lyric", releaseId: "song-one", seconds: 45 };
function fixture(options = {}) {
  const state = { user: { id: owner }, origin: true, allowed: true, queries: [], ...options };
  const db = { async sql(strings, ...values) {
    const query = strings.join("?");
    state.queries.push({ query, values });
    if (state.fail) throw new Error("SQL secret internal table details");
    if (query.includes("'write', 30, 60")) return [{ allowed: state.allowed }];
    if (query.includes("INSERT INTO halo_journey_votes")) {
      assert.match(query, /WITH eligible[\s\S]+INSERT INTO halo_ledger/);
      assert.match(query, /ON CONFLICT DO NOTHING/);
      assert.equal(values.includes(owner), false);
      return [{ eligible: true, allowed: true, changed: !state.duplicate, ...state.result }];
    }
    if (query.includes("INSERT INTO halo_journey_albums")) {
      assert.match(query, /owners\.album_count < 50/);
      assert.match(query, /WHERE albums\.owner_id = EXCLUDED\.owner_id/);
      assert.match(query, /INSERT INTO halo_ledger/);
      assert.doesNotMatch(query.split("ledger AS")[1].split("RETURNING id")[0], /name|tracks|share|owner/i);
      return [{ eligible: true, allowed: true, album: { id, name: album.name, shared: false,
        tracks: album.tracks, updated_at: "2026-10-10" }, ...state.result }];
    }
    if (query.includes("INSERT INTO halo_journey_lyric_sessions")) {
      assert.match(query, /INSERT INTO halo_ledger/);
      assert.equal(values.includes(owner), false);
      return [{ changed: 1, ...state.result }];
    }
    if (query.includes("FROM halo_journey_albums")) return state.albums || [];
    if (query.includes("SELECT catalog.*")) return [{ id: "song-one", title: "Song", artist: "Artist",
      lyrics_text: "Public lyrics", stream_url: state.preview || "javascript:secret", track_votes: 2,
      owner_id: owner, sale_master: "private-audio", gathering: false }];
    if (query.includes("COUNT(DISTINCT vote.identity_hash)")) return [{ gathering: false }];
    throw new Error(`Unexpected query: ${query}`);
  } };
  return { state, handler: createEmpathJourneyHandler({ getDatabase: () => db, getUser: () => state.user,
    verifyRequestOrigin: () => state.origin, env: state.env || env }) };
}
assert.match(migration, /journey_poll_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
assert.match(migration, /release\.visibility = 'public'/);
assert.match(migration, /catalog\.source_release_id = release\.id AND catalog\.status = 'active'/);
assert.doesNotMatch(migration, /UPDATE halo_release_campaigns/);
assert.match(migration, /version\.version_type IN \('radio_edit', 'clean'\)/);
assert.doesNotMatch(source, /x-forwarded|client-ip|\.transaction\(/i);
assert.equal(journeyPreviewUrl("//evil.example/audio"), "");
assert.equal(journeyPreviewUrl("/\\evil.example/audio"), "");
assert.equal(journeyPreviewUrl("https://user@example.com/audio"), "");
assert.equal(journeyPreviewUrl("javascript:alert(1)"), "");
assert.equal(journeyPreviewUrl("/api/song-catalog/audio?versionId=private"), "");
assert.equal(journeyPreviewUrl("/audio.mp3"), "/audio.mp3");
assert.equal(journeyPreviewUrl("https://example.com/audio.mp3"), "https://example.com/audio.mp3");
assert.equal(journeyPreviewUrl("https://open.spotify.com/track/123"), "");
assert.equal(journeyPreviewUrl("/music/?song=song-one"), "");
let f = fixture({ user: null });
let response = await f.handler(request());
let payload = await response.json();
assert.equal(response.status, 200);
assert.deepEqual(Object.keys(payload), ["tracks", "presence"]);
assert.deepEqual(Object.keys(payload.tracks[0]), ["id", "title", "artist", "lyricsText", "previewUrl", "votes", "momentum"]);
assert.equal(payload.tracks[0].previewUrl, "");
assert.equal(payload.presence, "quiet");
assert.doesNotMatch(JSON.stringify(payload), /private-identity|private-audio/);
assert.equal((await f.handler(request("?mine=1"))).status, 401);
f.state.queries = [];
const anonymous = request("", vote);
assert.equal((await f.handler(anonymous)).status, 401);
assert.equal(anonymous.bodyUsed, false);
assert.equal(f.state.queries.length, 0);
for (const options of [{ origin: false }, { env: {} }, { env: { ...env, JOURNEY_WRITES_DISABLED: "true" } }]) {
  f = fixture(options);
  assert.ok([403, 503].includes((await f.handler(request("", vote))).status));
  assert.equal(f.state.queries.length, 0);
}
for (const origin of [null, "https://attacker.example", "null", "https://halo.example.attacker.example"]) {
  f = fixture();
  const crossOrigin = request("", vote);
  if (origin === null) crossOrigin.headers.delete("origin");
  else crossOrigin.headers.set("origin", origin);
  assert.equal((await f.handler(crossOrigin)).status, 403, "explicit Origin gate must not depend on a no-op helper");
  assert.equal(crossOrigin.bodyUsed, false);
  assert.equal(f.state.queries.length, 0);
}
for (const body of [
  {}, { ...vote, kind: "admin" }, { ...vote, identity_hash: "forged" }, { ...lyric, seconds: -1 },
  { ...lyric, seconds: 86401 }, { ...lyric, seconds: "1.2" }, { ...lyric, seconds: Infinity }, { ...album, shared: "true" },
  { ...album, name: "" }, { ...album, name: "x".repeat(101) }, { ...album, tracks: [] },
  { ...album, tracks: [album.tracks[0], album.tracks[0]] }, { ...album, id: "bad" },
  ...[-1, 13, 1.5].map(transitionSeconds => ({ ...album, tracks: [{ releaseId: "song-one", transitionSeconds }] }))
]) {
  f = fixture();
  assert.equal((await f.handler(request("", body))).status, 400, JSON.stringify(body));
  assert.equal(f.state.queries.length, 0);
}
f = fixture();
assert.equal((await f.handler(request("", { ...album, name: "x".repeat(17000) }))).status, 413);
f = fixture({ allowed: false });
response = await f.handler(request("", vote));
assert.equal(response.status, 429);
assert.equal(response.headers.get("Retry-After"), "60");
assert.equal(f.state.queries.length, 1);
for (const body of [vote, album, lyric]) {
  f = fixture();
  assert.equal((await f.handler(request("", body), { ip: "192.0.2.1" })).status, 200);
  assert.ok(f.state.queries.flatMap(q => q.values).includes(accountHash(owner)));
}
for (const seconds of [0, 1.25, 3601, 86400]) {
  f = fixture();
  assert.equal((await f.handler(request("", { ...lyric, seconds }))).status, 200);
}
f = fixture({ duplicate: true });
assert.deepEqual(await (await f.handler(request("", vote))).json(), { ok: true, duplicate: true });
f = fixture({ result: { allowed: false } });
assert.equal((await f.handler(request("", vote))).status, 429);
assert.equal((await f.handler(request("", { ...album, id }))).status, 403);
f = fixture({ result: { eligible: false } });
assert.equal((await f.handler(request("", vote))).status, 400);
assert.equal((await f.handler(request("", album))).status, 400);
f = fixture({ result: { album: null } });
assert.equal((await f.handler(request("", album))).status, 429);
f = fixture({ fail: true });
response = await f.handler(request());
assert.equal(response.status, 503);
assert.doesNotMatch(await response.text(), /SQL|internal|secret/);
console.log("Empath journey mocked API contracts passed.");

class Element extends EventTarget {
  constructor() {
    super(); this.children = []; this.attributes = new Map(); this.value = ""; this.checked = false;
    this.classList = { add() {}, remove() {} };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  play() { return Promise.resolve(); }
}
async function uiToHandler(seconds, actualHandler) {
  const ids = ["journey", "status", "tracks", "presence", "sequence", "trackCount", "albumName",
    "shared", "shareLink", "albums", "audio", "lyricsRoot", "lyricsList", "lyricsViewport",
    "lyricsMode", "lyricsStatus", "recordLyrics", "nowPlaying", "save", "loadMine", "refresh", "newAlbum"];
  const nodes = Object.fromEntries(ids.map(key => [key, new Element()]));
  const test = fixture({ preview: "/public.mp3",
    albums: [{ id, name: album.name, tracks: album.tracks, shared: false }] });
  const sent = [];
  const pending = [];
  let callbacks;
  const controller = createJourneyController({
    doc: { getElementById: key => nodes[key], createElement: () => new Element() },
    win: { location: { href: "https://halo.example/empath-journey/" } },
    lyricsFactory: options => { callbacks = options; return { setSource() {} }; },
    fetcher: (url, options) => {
      const operation = (async () => {
      assert.equal(options.credentials, "same-origin");
      const headers = { ...options.headers, ...(options.method === "POST" ? { Origin: "https://halo.example" } : {}) };
      if (options.body) sent.push(JSON.parse(options.body));
      const response = await (actualHandler || test.handler)(new Request(new URL(url, "https://halo.example"), { ...options, headers }));
      assert.equal(response.status, 200, await response.clone().text());
      return response;
      })();
      pending.push(operation);
      return operation;
    }
  });
  const click = async node => {
    node.dispatchEvent(new Event("click"));
    while (controller.state.busy) await new Promise(resolve => setImmediate(resolve));
  };
  await controller.init();
  await click(nodes.tracks.children[0].children.at(-1).children[0]);
  assert.equal(sent[0].action, "vote");
  await click(nodes.tracks.children[0].children.at(-1).children[3]);
  nodes.albumName.value = album.name;
  await controller.save();
  if (actualHandler) assert.match(controller.state.albumId, /^[a-f0-9-]{36}$/);
  else assert.equal(controller.state.albumId, id);
  await controller.loadMine();
  await click(nodes.albums.children[0]);
  assert.deepEqual(controller.state.sequence, actualHandler ? [{ releaseId: "song-one", transitionSeconds: 0 }] : album.tracks);
  await click(nodes.sequence.children[0].children[0].children[0]);
  assert.equal(nodes.audio.src, actualHandler ? "/api/radio/audio?id=public-radio" : "/public.mp3");
  callbacks.onSeek(seconds);
  assert.equal(sent.filter(body => body.action === "lyric").length, 0);
  nodes.recordLyrics.checked = true;
  callbacks.onInsight({ time: seconds });
  await Promise.all(pending);
  assert.deepEqual(sent.at(-1), { action: "lyric", releaseId: "song-one", seconds });
  if (!actualHandler) assert.ok(test.state.queries.some(item => item.query.includes("INSERT INTO halo_journey_lyric_sessions")));
}
await uiToHandler(0);
await uiToHandler(1.25);
console.log("Empath journey UI-to-real-handler contracts passed (cookie auth, votes, albums, consent, fractional and untimed lyrics).");

// Exercise the exact tagged-template queries against an isolated real PostgreSQL cluster.
const executable = promisify(execFile);
const pgBin = "/usr/lib/postgresql/16/bin";
const available = spawnSync(`${pgBin}/initdb`, ["--version"]).status === 0;
if (!available) {
  console.log("PostgreSQL persistence contracts skipped: local PostgreSQL binaries unavailable.");
} else {
  const directory = `/tmp/halo-jpg-${process.pid}`;
  let server;
  await mkdir(directory, { recursive: true });
  try {
    await executable(`${pgBin}/initdb`, ["-D", `${directory}/data`, "-A", "trust", "--no-locale"],
      { env: { ...process.env, TMPDIR: directory } });
    server = spawn(`${pgBin}/postgres`, ["-D", `${directory}/data`, "-k", directory, "-h", "", "-p", "5432"],
      { stdio: ["ignore", "ignore", "pipe"] });
    let serverErrors = "";
    server.stderr.on("data", chunk => { serverErrors += chunk; });
    const sql = async query => {
      const { stdout } = await executable("psql", ["-X", "-q", "--csv", "-v", "ON_ERROR_STOP=1",
        "-h", directory, "-U", process.env.USER || "runner", "-d", "postgres", "-c", query]);
      // PostgreSQL CSV escapes JSON fields by doubling quotes.
      const rows = [];
      let row = [], field = "", quoted = false;
      for (let i = 0; i < stdout.length; i++) {
        const ch = stdout[i];
        if (ch === '"') {
          if (quoted && stdout[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
        } else if (!quoted && (ch === "," || ch === "\n")) {
          row.push(field); field = "";
          if (ch === "\n") { rows.push(row); row = []; }
        } else field += ch;
      }
      const keys = rows.shift() || [];
      return rows.map(values => Object.fromEntries(keys.map((key, index) => {
        const value = values[index];
        return [key, value === "t" ? true : value === "f" ? false : value === "" ? null
          : /^[{[]/.test(value) ? JSON.parse(value) : value];
      })));
    };
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { await sql("SELECT 1"); ready = true; break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, serverErrors);
    await sql(`
      CREATE TABLE halo_release_campaigns (id text PRIMARY KEY, title text, artist text, status text,
        visibility text, stream_url text, owner_member_id text);
      CREATE TABLE halo_song_catalog (id text PRIMARY KEY, source_release_id text, status text, lyrics_text text, updated_at timestamptz);
      CREATE TABLE halo_song_versions (id text PRIMARY KEY, song_id text, version_type text, audio_url text);
      CREATE TABLE halo_release_audio_versions (id text PRIMARY KEY, release_id text, status text,
        rights_confirmed boolean, version_type text);
      CREATE TABLE halo_radio_tracks (id text PRIMARY KEY, audio_version_id text, release_id text,
        status text, rights_confirmed boolean, byte_size bigint, blob_key text, updated_at timestamptz);
      CREATE TABLE halo_ledger (id text PRIMARY KEY, actor_id text, actor_type text, event_category text,
        ref_release_id text, summary text, details jsonb);
    `);
    await sql(migration);
    await sql(migration);
    await sql(`
      INSERT INTO halo_release_campaigns VALUES
        ('song-one','Song One','Artist','published','public','/public.mp3','private-owner',false),
        ('song-two','Song Two','Artist','published','public','https://example.com/stream.mp3','private-owner',false),
        ('upcoming','Upcoming','Artist','draft','public','/preview.mp3','private-owner',true),
        ('not-opted','Not Opted','Artist','draft','public','/draft.mp3','private-owner',false),
        ('private-song','Private','Artist','published','private','/secret.mp3','private-owner',true);
      INSERT INTO halo_song_catalog VALUES
        ('catalog-one','song-one','active','Published lyrics', NOW()),
        ('catalog-old','song-one','archived','Private old lyrics', NOW() + INTERVAL '1 day'),
        ('catalog-draft','upcoming','active','Private upcoming lyrics', NOW());
      INSERT INTO halo_song_versions VALUES ('private-master','catalog-one','sale_master','/public.mp3');
      INSERT INTO halo_release_audio_versions VALUES
        ('radio-edit','song-one','active',true,'radio_edit'),
        ('upcoming-edit','upcoming','active',true,'radio_edit'),
        ('master-version','song-two','active',true,'master');
      INSERT INTO halo_radio_tracks VALUES
        ('public-radio','radio-edit','song-one','rotation',true,100,'radio-chunks',NOW()),
        ('upcoming-radio','upcoming-edit','upcoming','rotation',true,100,'draft-chunks',NOW()),
        ('master-radio','master-version','song-two','rotation',true,100,'master-chunks',NOW());
    `);
    const quote = value => value === null ? "NULL" : typeof value === "boolean" ? String(value)
      : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
    const db = { sql(strings, ...values) {
      return sql(strings.reduce((query, fragment, index) => query + fragment +
        (index < values.length ? quote(values[index]) : ""), ""));
    } };
    let userId = owner;
    const handler = createEmpathJourneyHandler({ getDatabase: () => db, getUser: () => userId ? { id: userId } : null,
      verifyRequestOrigin: () => true, env });
    payload = await (await handler(request())).json();
    assert.deepEqual(payload.tracks.map(t => t.id), ["song-one", "song-two", "upcoming"]);
    assert.equal(payload.tracks.find(t => t.id === "song-one").lyricsText, "Published lyrics");
    assert.equal(payload.tracks.find(t => t.id === "upcoming").lyricsText, "");
    assert.equal(payload.tracks.find(t => t.id === "song-one").previewUrl, "/api/radio/audio?id=public-radio");
    assert.equal(payload.tracks.find(t => t.id === "upcoming").previewUrl, "/preview.mp3");
    assert.equal(payload.tracks.find(t => t.id === "song-two").previewUrl, "https://example.com/stream.mp3");
    await sql("UPDATE halo_radio_tracks SET status = 'held' WHERE id = 'public-radio'");
    payload = await (await handler(request())).json();
    assert.equal(payload.tracks.find(t => t.id === "song-one").previewUrl, "", "sale master fallback must stay private");
    await sql("UPDATE halo_radio_tracks SET status = 'rotation' WHERE id = 'public-radio'");
    assert.doesNotMatch(JSON.stringify(payload), /Private|private-owner|catalog-one/);
    response = await handler(request("", vote));
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { ok: true, duplicate: false });
    assert.deepEqual(await (await handler(request("", vote))).json(), { ok: true, duplicate: true });
    assert.equal((await sql("SELECT COUNT(*) AS count FROM halo_journey_votes"))[0].count, "1");
    assert.equal((await sql("SELECT COUNT(*) AS count FROM halo_ledger WHERE details->>'type' = 'journey_vote'"))[0].count, "1");
    assert.equal((await handler(request("", { ...vote, releaseId: "private-song" }))).status, 400);
    assert.equal((await handler(request("", { ...vote, releaseId: "not-opted" }))).status, 400);
    await sql("UPDATE halo_release_campaigns SET visibility = 'private' WHERE id = 'song-two'");
    assert.equal((await handler(request("", { ...vote, releaseId: "song-two" }))).status, 400);
    assert.equal((await handler(request("", { ...lyric, releaseId: "song-two" }))).status, 400);
    assert.equal((await handler(request("", { ...album, tracks: [...album.tracks,
      { releaseId: 'song-two', transitionSeconds: 0 }] }))).status, 400);
    assert.equal((await sql("SELECT COUNT(*) AS count FROM halo_journey_album_owners"))[0].count, "0");
    await sql("UPDATE halo_release_campaigns SET visibility = 'public' WHERE id = 'song-two'");
    response = await handler(request("", { ...album, shared: true, tracks: [
      { releaseId: "song-two", transitionSeconds: 12 }, { releaseId: "song-one", transitionSeconds: 0 }
    ] }));
    assert.equal(response.status, 200, await response.clone().text());
    const saved = (await response.json()).album;
    assert.match(saved.shareRoute, /^\/empath-journey\/\?album=/);
    userId = null;
    payload = await (await handler(request(`?album=${saved.id}`))).json();
    assert.deepEqual(payload.tracks.map(t => t.id), ["song-two", "song-one"]);
    assert.doesNotMatch(JSON.stringify(payload), /owner_id|private-identity/);
    userId = other;
    assert.equal((await handler(request("", { ...album, id: saved.id }))).status, 403);
    userId = owner;
    assert.equal((await handler(request("", { ...album, id: saved.id, shared: false }))).status, 200);
    assert.equal((await (await handler(request("?mine=1"))).json()).albums.length, 1);
    assert.equal((await handler(request(`?album=${saved.id}`))).status, 200);
    userId = null;
    assert.equal((await handler(request(`?album=${saved.id}`))).status, 404);
    userId = owner;
    assert.equal((await handler(request("", lyric))).status, 200);
    assert.equal((await sql("SELECT COUNT(*) AS count FROM halo_journey_lyric_sessions"))[0].count, "1");
    assert.equal((await handler(request("", { ...lyric, seconds: 0 }))).status, 200);
    assert.equal((await handler(request("", { ...lyric, seconds: 1.25 }))).status, 200);
    assert.deepEqual((await sql("SELECT seconds FROM halo_journey_lyric_sessions ORDER BY seconds")).map(row => row.seconds),
      ["0", "1.25", "45"]);
    const operational = await sql("SELECT actor_id, details FROM halo_ledger");
    assert.doesNotMatch(JSON.stringify(operational), /private-identity|Personal quiet|shareRoute|album=|owner_id/);
    assert.ok(operational.every(row => row.actor_id === accountHash(owner)));
    // Ledger failure must roll back each mutation, including reserved album slots.
    await sql(`CREATE FUNCTION reject_journey_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'contract rollback'; END; $$;
      CREATE TRIGGER reject_journey_ledger BEFORE INSERT ON halo_ledger
      FOR EACH ROW EXECUTE FUNCTION reject_journey_ledger();`);
    const before = await sql(`SELECT (SELECT COUNT(*) FROM halo_journey_votes) AS votes,
      (SELECT COUNT(*) FROM halo_journey_albums) AS albums,
      (SELECT album_count FROM halo_journey_album_owners WHERE owner_id = '${owner}') AS slots,
      (SELECT COUNT(*) FROM halo_journey_lyric_sessions) AS lyrics`);
    for (const body of [{ ...vote, kind: "remix" }, album, lyric]) {
      assert.equal((await handler(request("", body))).status, 503);
    }
    assert.deepEqual(await sql(`SELECT (SELECT COUNT(*) FROM halo_journey_votes) AS votes,
      (SELECT COUNT(*) FROM halo_journey_albums) AS albums,
      (SELECT album_count FROM halo_journey_album_owners WHERE owner_id = '${owner}') AS slots,
      (SELECT COUNT(*) FROM halo_journey_lyric_sessions) AS lyrics`), before);
    await sql("DROP TRIGGER reject_journey_ledger ON halo_ledger");
    await sql("TRUNCATE halo_journey_rate_limits");
    // Parallel, independent connections cannot exceed the account minute quota.
    const concurrent = await Promise.all(Array.from({ length: 35 }, () => handler(request("", lyric))));
    assert.equal(concurrent.filter(r => r.status === 200).length, 30);
    assert.equal(concurrent.filter(r => r.status === 429).length, 5);
    await sql("TRUNCATE halo_journey_rate_limits");
    await sql(`UPDATE halo_journey_album_owners SET album_count = 49 WHERE owner_id = '${owner}'`);
    const albumRace = await Promise.all([handler(request("", album)), handler(request("", album))]);
    assert.deepEqual(albumRace.map(r => r.status).sort(), [200, 429]);
    assert.equal((await handler(request("", { ...album, id: saved.id }))).status, 200, "editing at capacity remains allowed");
    await sql("TRUNCATE halo_journey_rate_limits");
    const accountQuota = await Promise.all(Array.from({ length: 13 }, () =>
      sql(`SELECT halo_journey_allow('${accountHash(other)}', 'vote', 10, 3600) AS allowed`)));
    assert.equal(accountQuota.filter(rows => rows[0].allowed).length, 10);
    await sql(`INSERT INTO halo_journey_rate_limits VALUES ('${accountHash(owner)}','vote',NOW(),10)`);
    assert.equal((await handler(request("", { ...vote, kind: "priority" }))).status, 429);
    assert.deepEqual(await (await handler(request("", vote))).json(), { ok: true, duplicate: true });
    await sql("TRUNCATE halo_journey_rate_limits");
    const trustedIp = "192.0.2.42";
    const ipHash = createHmac("sha256", secret).update(`ip:${trustedIp}`).digest("hex");
    await sql(`INSERT INTO halo_journey_rate_limits VALUES ('${ipHash}','ip_vote',NOW(),60)`);
    assert.equal((await handler(request("", { ...vote, kind: "priority" }), { ip: trustedIp })).status, 429);
    assert.equal((await handler(request("", { ...vote, kind: "priority" },
      { "X-Forwarded-For": trustedIp, "Client-IP": trustedIp }))).status, 200, "client headers cannot forge trusted IP");
    await sql(`UPDATE halo_journey_rate_limits SET window_start = NOW() - INTERVAL '2 hours'`);
    assert.equal((await handler(request("", { ...vote, kind: "remix" }), { ip: trustedIp })).status, 200);
    userId = "ui-postgres-owner-zero";
    await uiToHandler(0, handler);
    userId = "ui-postgres-owner-fractional";
    await uiToHandler(1.25, handler);
    const uiPersisted = await sql(`SELECT album.owner_id, album.tracks, session.seconds
      FROM halo_journey_albums album JOIN halo_journey_lyric_sessions session
      ON session.identity_hash = CASE WHEN album.owner_id = 'ui-postgres-owner-zero'
        THEN '${accountHash("ui-postgres-owner-zero")}' ELSE '${accountHash("ui-postgres-owner-fractional")}' END
      WHERE album.owner_id IN ('ui-postgres-owner-zero', 'ui-postgres-owner-fractional') ORDER BY album.owner_id`);
    assert.deepEqual(uiPersisted.map(row => row.seconds), ["1.25", "0"]);
    assert.ok(uiPersisted.every(row => row.tracks[0].releaseId === "song-one"));
    console.log("Empath journey UI-to-handler-to-PostgreSQL contracts passed (votes, albums, consent and exact lyric timestamps).");
    assert.deepEqual(await sql("SELECT id,status,visibility,journey_poll_enabled FROM halo_release_campaigns ORDER BY id"), [
      { id: "not-opted", status: "draft", visibility: "public", journey_poll_enabled: false },
      { id: "private-song", status: "published", visibility: "private", journey_poll_enabled: true },
      { id: "song-one", status: "published", visibility: "public", journey_poll_enabled: false },
      { id: "song-two", status: "published", visibility: "public", journey_poll_enabled: false },
      { id: "upcoming", status: "draft", visibility: "public", journey_poll_enabled: true }
    ]);
    console.log("Empath journey PostgreSQL persistence contracts passed (atomic ledger rollback, concurrent quotas, privacy, revocation).");
  } finally {
    if (server && server.exitCode === null) {
      await new Promise(resolve => { server.once("exit", resolve); server.kill("SIGINT"); });
    }
    await rm(directory, { recursive: true, force: true });
  }
}
