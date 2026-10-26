import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  RELEASE_POLL_MIN_POINTS,
  RELEASE_POLL_RESULT_LABEL,
  RELEASE_POLL_RULES,
  releasePollRecommendation
} from "../netlify/lib/fan-release-polls.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [functionSource, libSource, migration, script, styles, docs, packageJson] = await Promise.all([
  read("netlify/functions/fan-campaigns.mjs"),
  read("netlify/lib/fan-release-polls.mjs"),
  read("netlify/database/migrations/20261022090000_fan_release_consideration_polls.sql"),
  read("campaign-studio/campaign-studio.js"),
  read("campaign-studio/campaign-studio.css"),
  read("FAN_RELEASE_POLLS.md"),
  read("package.json")
]);

// Load the real /api/fan-campaigns handler with Netlify Identity/Database replaced by in-memory test doubles.
const stubDir = await mkdtemp(join(tmpdir(), "halo-release-poll-"));
await writeFile(join(stubDir, "database.mjs"), "export const getDatabase = () => globalThis.__haloReleasePollDb;\n");
await writeFile(join(stubDir, "identity.mjs"), [
  "export const getUser = async () => globalThis.__haloReleasePollUser || null;",
  "export const verifyRequestOrigin = async () => globalThis.__haloReleasePollOrigin !== false;"
].join("\n"));
const libUrl = pathToFileURL(resolve(root, "netlify/lib")).href;
const patched = functionSource
  .replace('"@netlify/database"', JSON.stringify(pathToFileURL(join(stubDir, "database.mjs")).href))
  .replace('"@netlify/identity"', JSON.stringify(pathToFileURL(join(stubDir, "identity.mjs")).href))
  .replaceAll('"../lib/', `"${libUrl}/`);
await writeFile(join(stubDir, "fan-campaigns.mjs"), patched);
const { default: handler } = await import(pathToFileURL(join(stubDir, "fan-campaigns.mjs")).href);

const HOUR = 3600000;
const FORBIDDEN = /halo_song_publication_sync|halo_release_campaigns|is_chart_eligible|UPDATE\s+halo_song_catalog|UPDATE\s+halo_song_versions|INSERT\s+INTO\s+halo_member_reward_events|halo_track_drop|song-publication/i;

function createDb() {
  const state = {
    queries: [],
    memberships: new Map(),
    prefs: new Map(),
    points: new Map(),
    songs: [],
    radio: [],
    campaigns: new Map(),
    tracks: [],
    votes: new Map(),
    audit: [],
    ledger: [],
    nextTrackId: 1
  };
  const valuesMarker = rows => ({ __values: rows });
  const tallyTracks = campaignId => state.tracks
    .filter(track => track.campaign_id === campaignId)
    .sort((a, b) => a.position - b.position)
    .map(track => ({ ...track, votes: [...state.votes.values()].filter(vote => vote.campaign_track_id === track.id).length }));
  const open = campaign => campaign.status === "published" && campaign.starts_at <= new Date() && campaign.ends_at > new Date();
  const eligibleSong = (song, owner, memberId) => song.status === "active" && song.rights_status === "cleared"
    && ["ready", "reviewed"].includes(song.metadata_status) && song.pipeline_status !== "published"
    && song.master_approved && song.master_audio && (owner || song.owner_member_id === memberId);
  // Mirrors halo_fan_release_poll_vote_guard so the handler sees the same refusals the database would raise.
  function voteGuard(row) {
    const campaign = state.campaigns.get(row.campaign_id);
    if (!campaign || campaign.purpose !== "release_consideration") return;
    if (!row.member_id || row.voter_key !== `member:${row.member_id}`) throw new Error("release_poll_member_required");
    if (!open(campaign)) throw new Error("release_poll_closed");
    if (state.prefs.get(row.member_id) !== true) throw new Error("release_poll_rewards_required");
    if ((state.points.get(row.member_id) || 0) < Math.max(campaign.voter_min_reward_points, 100)) throw new Error("release_poll_rank_required");
  }
  async function sql(strings, ...values) {
    const query = strings.join("?");
    state.queries.push({ query, values });
    assert.doesNotMatch(query, FORBIDDEN, "fan campaigns must never touch publication, release, chart, or reward-grant state");
    if (query.includes("INSERT INTO community_profiles")) return [];
    if (query.includes("INSERT INTO halo_memberships")) {
      const row = { member_id: values[0], actor_id: values[1], display_name: values[3] };
      state.memberships.set(values[0], row);
      return [row];
    }
    if (query.includes("SELECT rewards_enabled FROM halo_member_notification_preferences")) {
      return state.prefs.has(values[0]) ? [{ rewards_enabled: state.prefs.get(values[0]) }] : [];
    }
    if (query.includes("FROM halo_member_reward_events")) return [{ points: state.points.get(values[0]) || 0 }];
    if (query.includes("FROM halo_song_catalog song")) {
      const [ids, owner, memberId] = query.includes("ANY(") ? values : [null, ...values];
      return state.songs
        .filter(song => (!ids || ids.includes(song.id)) && eligibleSong(song, owner, memberId))
        .map(song => ({ id: song.id, title: song.title, artist_name: song.artist_name, genre: song.genre, duration_seconds: song.duration_seconds }));
    }
    if (query.includes("FROM halo_radio_tracks")) {
      const ids = Array.isArray(values[0]) ? values[0] : null;
      return state.radio.filter(track => !ids || ids.includes(track.id));
    }
    if (query.includes("SELECT slug, title, status, vote_goal")) {
      return [...state.campaigns.values()].filter(campaign => campaign.owner_member_id === values[0])
        .map(campaign => ({ ...campaign, votes: 0, track_count: tallyTracks(campaign.id).length }));
    }
    if (query.includes("WITH candidate_input") || query.includes("WITH track_input")) {
      const release = query.includes("WITH candidate_input");
      const rows = values[0].__values;
      const [id, slug, ownerMemberId, title, subtitle, rewardTitle, rewardDescription, voteGoal, endsAt, promotion] = values.slice(1);
      const campaign = {
        id, slug, owner_member_id: ownerMemberId, title, subtitle, reward_title: rewardTitle, reward_description: rewardDescription,
        vote_goal: voteGoal, starts_at: new Date(Date.now() - 1000), ends_at: new Date(endsAt), status: "draft",
        promotion: JSON.parse(promotion), party_theme: {}, host_persona_id: "halo", preflight_id: null, launched_at: null,
        purpose: release ? values[11] : "listening_party", voter_min_reward_points: release ? values[12] : 0,
        recommendation: null, recommendation_recorded_at: null
      };
      if (campaign.purpose === "release_consideration") assert.ok(campaign.voter_min_reward_points >= 100, "release polls must store the Insider threshold");
      state.campaigns.set(id, campaign);
      for (const row of rows) {
        const track = release
          ? { id: state.nextTrackId++, campaign_id: id, source_song_id: row[0], source_track_id: null, title: row[1], artist_name: row[2], description: "", genre: row[3], duration_seconds: row[4], position: row[5] }
          : { id: state.nextTrackId++, campaign_id: id, source_track_id: row[0], source_song_id: null, title: row[1], artist_name: row[2], description: row[3], genre: row[4], duration_seconds: row[5], position: row[6] };
        state.tracks.push(track);
      }
      return [{ ...campaign, inserted_track_count: rows.length }];
    }
    if (query.includes("FROM halo_fan_vote_campaign_tracks track") && query.includes("LEFT JOIN halo_fan_vote_campaign_votes")) {
      return tallyTracks(values[0]);
    }
    if (query.includes("SELECT * FROM halo_fan_vote_campaigns")) {
      const campaign = [...state.campaigns.values()].find(item => item.slug === values[0]);
      if (!campaign) return [];
      if (query.includes("status = 'published'") && !open(campaign)) return [];
      return [{ ...campaign }];
    }
    if (query.includes("SELECT campaign_track_id FROM halo_fan_vote_campaign_votes")) {
      const vote = state.votes.get(`${values[0]}|${values[1]}`);
      return vote ? [{ campaign_track_id: vote.campaign_track_id }] : [];
    }
    if (query.includes("SELECT id FROM halo_fan_vote_campaign_tracks WHERE id =")) {
      return state.tracks.filter(track => track.id === values[0] && track.campaign_id === values[1]).map(track => ({ id: track.id }));
    }
    if (query.includes("SET recommendation =")) {
      const campaign = state.campaigns.get(values[1]);
      if (!campaign || campaign.purpose !== "release_consideration" || campaign.status !== "closed" || campaign.recommendation) return [];
      campaign.recommendation = JSON.parse(values[0]);
      campaign.recommendation_recorded_at = new Date();
      return [{ ...campaign }];
    }
    if (query.includes("UPDATE halo_fan_vote_campaigns SET")) {
      const release = !query.includes("reward_title");
      const id = values.at(-1);
      const campaign = state.campaigns.get(id);
      const status = release ? values[3] : values[10];
      if (campaign.purpose === "release_consideration" && campaign.status === "closed" && status !== "closed") throw new Error("release_poll_closed");
      Object.assign(campaign, release
        ? { title: values[0], subtitle: values[1], ends_at: new Date(values[2]), status }
        : { title: values[0], subtitle: values[1], ends_at: new Date(values[5]), status, launched_at: values[11] ? new Date() : campaign.launched_at });
      return [{ ...campaign }];
    }
    if (query.includes("INSERT INTO halo_ledger")) {
      state.ledger.push({ category: values[3], summary: values[8], outcome: values[12] });
      return [];
    }
    if (query.includes("COUNT(*)::int AS count FROM halo_fan_release_poll_vote_events")) {
      return [{ count: state.audit.filter(event => event.campaign_id === values[0] && event.member_id === values[1]).length }];
    }
    if (query.includes("WITH vote AS (")) {
      const [campaignId, voterKey, memberId, trackId] = values;
      const campaign = state.campaigns.get(campaignId);
      const track = state.tracks.find(item => item.id === trackId && item.campaign_id === values[4]);
      if (!track || !campaign || campaign.purpose !== "release_consideration" || !open(campaign)) return [];
      const row = { campaign_id: campaignId, campaign_track_id: track.id, voter_key: voterKey, member_id: memberId };
      voteGuard(row);
      state.votes.set(`${campaignId}|${voterKey}`, row);
      state.audit.push({ campaign_id: values[5], campaign_track_id: track.id, member_id: values[6], reward_tier: values[7] });
      return [{ campaign_track_id: track.id, audited: 1 }];
    }
    if (query.includes("DELETE FROM halo_fan_vote_campaign_votes")) {
      state.votes.delete(`${values[0]}|${values[1]}`);
      return [];
    }
    if (query.includes("INSERT INTO halo_fan_vote_campaign_votes")) {
      const [campaignId, trackId, voterKey, memberId] = values;
      const row = { campaign_id: campaignId, campaign_track_id: trackId, voter_key: voterKey, member_id: memberId };
      voteGuard(row);
      state.votes.set(`${campaignId}|${voterKey}`, row);
      return [];
    }
    throw new Error(`Unexpected query: ${query.slice(0, 120)}`);
  }
  sql.values = valuesMarker;
  return { sql, state };
}

const artist = { id: "artist-1", email: "artist@example.com", user_metadata: { full_name: "Artist One" } };
const otherArtist = { id: "artist-2", email: "other@example.com", user_metadata: { full_name: "Artist Two" } };
const haloOwner = { id: "halo-owner", email: "owner@example.com", app_metadata: { roles: ["halo-owner"] } };
const fan = id => ({ id, email: `${id}@fans.example.com`, user_metadata: { full_name: `Fan ${id}` } });

function song(id, overrides = {}) {
  return {
    id, owner_member_id: "artist-1", title: `Candidate ${id.slice(5).toUpperCase()}`, artist_name: "Artist One", genre: "soul", duration_seconds: 200,
    status: "active", rights_status: "cleared", metadata_status: "ready", pipeline_status: "approved",
    master_approved: true, master_audio: true, ...overrides
  };
}

let db;
function reset() {
  db = createDb();
  globalThis.__haloReleasePollDb = db;
  globalThis.__haloReleasePollOrigin = true;
  db.state.songs.push(
    song("song-a"), song("song-b", { metadata_status: "reviewed" }), song("song-c"),
    song("song-other", { owner_member_id: "artist-2" }),
    song("song-rights", { rights_status: "needs_review" }),
    song("song-disputed", { rights_status: "disputed" }),
    song("song-metadata", { metadata_status: "needs_attention" }),
    song("song-unmastered", { master_approved: false }),
    song("song-silent", { master_audio: false }),
    song("song-archived", { status: "archived" }),
    song("song-published", { pipeline_status: "published" })
  );
  db.state.radio.push(
    { id: "radio-1", title: "Radio One", artist_name: "Artist One", description: "", genre: "house", duration_seconds: 180 },
    { id: "radio-2", title: "Radio Two", artist_name: "Artist One", description: "", genre: "house", duration_seconds: 190 }
  );
}

async function call(user, body, { method = body === undefined ? "GET" : "POST", query = "", raw } = {}) {
  globalThis.__haloReleasePollUser = user;
  const init = { method, headers: { "Content-Type": "application/json" } };
  if (method === "POST") init.body = raw ?? JSON.stringify(body);
  const response = await handler(new Request(`https://halo.example/api/fan-campaigns${query}`, init));
  return { status: response.status, headers: response.headers, data: await response.json() };
}

function member(id, { rewards = true, points = 0 } = {}) {
  db.state.prefs.set(id, rewards);
  db.state.points.set(id, points);
  return fan(id);
}

async function createPoll(user = artist, songIds = ["song-a", "song-b", "song-c"]) {
  return call(user, { action: "create", purpose: "release_consideration", songIds, title: "Next single", endsAt: new Date(Date.now() + 48 * HOUR).toISOString() });
}

async function publishedPoll() {
  const created = await createPoll();
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const published = await call(artist, { action: "publish", slug: created.data.campaign.slug, title: "Next single" });
  assert.equal(published.status, 200);
  return published.data.campaign;
}

const results = [];
async function check(name, fn) {
  reset();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("release polls must not call external services"); };
  try {
    await fn();
    results.push([true, name]);
  } catch (error) {
    results.push([false, `${name}: ${error instanceof Error ? error.stack : error}`]);
  } finally {
    globalThis.fetch = realFetch;
  }
}

await check("artists draft release polls only from their own eligible, authorized catalog songs", async () => {
  assert.equal((await createPoll(null)).status, 401);
  for (const blocked of ["song-other", "song-rights", "song-disputed", "song-metadata", "song-unmastered", "song-silent", "song-archived", "song-published", "missing-song"]) {
    const response = await createPoll(artist, ["song-a", blocked]);
    assert.equal(response.status, 403, `${blocked} must be rejected`);
  }
  assert.equal((await createPoll(artist, ["song-a"])).status, 400, "a poll needs at least two candidates");
  assert.equal(db.state.campaigns.size, 0, "rejected candidates never create a poll");
  const created = await createPoll();
  assert.equal(created.status, 201);
  assert.equal(created.data.campaign.purpose, "release_consideration");
  assert.equal(created.data.campaign.status, "draft");
  assert.equal(created.data.campaign.releasePoll.publishesRelease, false);
  assert.ok(created.data.campaign.tracks.every(track => !track.audioUrl && !track.artworkUrl), "candidate audio is never exposed by the poll");
  assert.deepEqual(db.state.tracks.map(track => track.source_song_id), ["song-a", "song-b", "song-c"]);
  const ownerPoll = await createPoll(haloOwner, ["song-a", "song-other"]);
  assert.equal(ownerPoll.status, 201, "the HALO owner may shortlist any eligible artist song");
});

await check("candidates stay private until publication and only the owning team manages the poll", async () => {
  const created = await createPoll();
  const slug = created.data.campaign.slug;
  assert.equal((await call(null, undefined, { query: `?slug=${slug}` })).status, 404);
  assert.equal((await call(fan("viewer"), undefined, { query: `?slug=${slug}` })).status, 404);
  assert.equal((await call(otherArtist, { action: "publish", slug })).status, 403);
  assert.equal((await call(artist, { action: "launch", slug })).status, 400, "release polls are not listening-party launches");
  const published = await call(artist, { action: "publish", slug, title: "Next single" });
  assert.equal(published.status, 200);
  assert.equal(published.data.campaign.status, "published");
  assert.equal((await call(null, undefined, { query: `?slug=${slug}` })).status, 200);
});

await check("anonymous voters and device tokens cannot vote in release polls", async () => {
  const poll = await publishedPoll();
  const trackId = poll.tracks[0].id;
  const anonymous = await call(null, { action: "vote", slug: poll.slug, trackId, voterToken: "device-token-1234567890abcdef" });
  assert.equal(anonymous.status, 401);
  assert.equal(db.state.votes.size, 0);
  assert.equal(db.state.queries.some(entry => entry.query.includes("INSERT INTO halo_fan_vote_campaign_votes") && String(entry.values[2]).startsWith("device:")), false);
});

await check("below-threshold, opted-out, and spoofed ranks are denied", async () => {
  const poll = await publishedPoll();
  const trackId = poll.tracks[0].id;
  const optedOut = await call(member("fan-optout", { rewards: false, points: 900 }), { action: "vote", slug: poll.slug, trackId });
  assert.equal(optedOut.status, 403);
  assert.match(optedOut.data.message, /member rewards/);
  const below = await call(member("fan-99", { points: 99 }), { action: "vote", slug: poll.slug, trackId });
  assert.equal(below.status, 403);
  assert.match(below.data.message, /Insider \(100 earned points\)/);
  const spoof = await call(member("fan-spoof", { points: 0 }), {
    action: "vote", slug: poll.slug, trackId, points: 9999, rank: "halo_vip", tier: { id: "halo_vip" }, rewardsEnabled: true, eligible: true
  });
  assert.equal(spoof.status, 403, "client-submitted rank or points are ignored");
  assert.equal(db.state.votes.size, 0);
});

await check("exact threshold and higher tiers vote once each with equal weight and no reward points", async () => {
  const poll = await publishedPoll();
  const [first, second] = poll.tracks;
  for (const [id, points] of [["fan-insider", RELEASE_POLL_MIN_POINTS], ["fan-inner", 300], ["fan-vip", 750]]) {
    const response = await call(member(id, { points }), { action: "vote", slug: poll.slug, trackId: id === "fan-insider" ? first.id : second.id });
    assert.equal(response.status, 200, `${id} should be eligible`);
    assert.match(response.data.message, /does not publish/);
  }
  const counted = db.state.tracks.map(track => [...db.state.votes.values()].filter(vote => vote.campaign_track_id === track.id).length);
  assert.deepEqual(counted, [1, 2, 0], "every eligible vote counts once regardless of tier");
  assert.deepEqual(db.state.audit.map(event => event.reward_tier), ["insider", "inner_circle", "halo_vip"]);
  assert.equal(db.state.queries.some(entry => /INSERT INTO halo_member_reward_events/.test(entry.query)), false);
});

await check("one current vote per member, changeable, audited, and rate limited", async () => {
  const poll = await publishedPoll();
  const voter = member("fan-change", { points: 120 });
  assert.equal((await call(voter, { action: "vote", slug: poll.slug, trackId: poll.tracks[0].id })).status, 200);
  const changed = await call(voter, { action: "vote", slug: poll.slug, trackId: poll.tracks[1].id });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.campaign.viewerVote, poll.tracks[1].id);
  assert.equal(db.state.votes.size, 1, "only the latest choice counts");
  assert.equal(changed.data.campaign.totalVotes, 1);
  assert.equal(db.state.audit.length, 2, "each submission is audited");
  for (let index = 0; index < 8; index++) await call(voter, { action: "vote", slug: poll.slug, trackId: poll.tracks[index % 2].id });
  assert.equal((await call(voter, { action: "vote", slug: poll.slug, trackId: poll.tracks[0].id })).status, 429);
});

await check("vote window and closed polls are enforced", async () => {
  const draft = await createPoll();
  const voter = member("fan-window", { points: 200 });
  assert.equal((await call(voter, { action: "vote", slug: draft.data.campaign.slug, trackId: draft.data.campaign.tracks[0].id })).status, 409);
  const poll = await publishedPoll();
  db.state.campaigns.get(poll.id).ends_at = new Date(Date.now() - 1000);
  assert.equal((await call(voter, { action: "vote", slug: poll.slug, trackId: poll.tracks[0].id })).status, 409);
});

await check("ordinary listening-party campaigns keep open member and device voting", async () => {
  const created = await call(artist, { action: "create", trackIds: ["radio-1", "radio-2"], title: "Listening party", endsAt: new Date(Date.now() + 48 * HOUR).toISOString() });
  assert.equal(created.status, 201);
  assert.equal(created.data.campaign.purpose, "listening_party");
  assert.equal(created.data.campaign.releasePoll, undefined);
  const slug = created.data.campaign.slug;
  await call(artist, { action: "publish", slug, title: "Listening party" });
  const before = db.state.queries.length;
  const anonymous = await call(null, { action: "vote", slug, trackId: created.data.campaign.tracks[0].id, voterToken: "device-token-1234567890abcdef" });
  assert.equal(anonymous.status, 200);
  const unranked = await call(member("fan-new", { rewards: false, points: 0 }), { action: "vote", slug, trackId: created.data.campaign.tracks[1].id });
  assert.equal(unranked.status, 200, "listening parties do not require a reward rank");
  assert.equal(db.state.queries.slice(before).some(entry => entry.query.includes("halo_member_notification_preferences")), false);
  assert.equal(db.state.votes.size, 2);
});

await check("public responses are private, no-store, and disclose the rules", async () => {
  const poll = await publishedPoll();
  await call(member("fan-private", { points: 400 }), { action: "vote", slug: poll.slug, trackId: poll.tracks[0].id });
  const response = await call(null, undefined, { query: `?slug=${poll.slug}` });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = JSON.stringify(response.data);
  for (const secret of ["fans.example.com", "artist@example.com", "fan-private", "artist-1", "member:", "source_song_id", "song-a", "owner_member_id", '"points"', "pointsToGo"]) {
    assert.equal(text.includes(secret), false, `public payload must not include ${secret}`);
  }
  assert.equal(response.data.campaign.releasePoll.reviewPath, null);
  assert.deepEqual(response.data.campaign.releasePoll.rules, RELEASE_POLL_RULES);
  assert.equal(response.data.campaign.releasePoll.weightedByRank, false);
  assert.equal(response.data.campaign.releasePoll.viewerEligibility.eligible, false);
  const own = await call(fan("fan-private"), undefined, { query: `?slug=${poll.slug}` });
  assert.equal(own.data.campaign.releasePoll.viewerEligibility.tier, "Inner Circle");
  assert.equal(/"points"|pointsToGo/.test(JSON.stringify(own.data)), false, "even the viewer's own point total is not returned by the poll");
});

await check("ties are unresolved and recorded for artist-team review", async () => {
  const poll = await publishedPoll();
  await call(member("fan-t1", { points: 100 }), { action: "vote", slug: poll.slug, trackId: poll.tracks[1].id });
  await call(member("fan-t2", { points: 100 }), { action: "vote", slug: poll.slug, trackId: poll.tracks[0].id });
  const closed = await call(artist, { action: "close", slug: poll.slug });
  assert.equal(closed.status, 200);
  const recommendation = closed.data.campaign.releasePoll.recommendation;
  assert.equal(recommendation.outcome, "tie");
  assert.equal(recommendation.label, RELEASE_POLL_RESULT_LABEL);
  assert.equal(recommendation.decisionStatus, "awaiting_artist_team_decision");
  assert.deepEqual(recommendation.leaders.map(leader => leader.trackId), [poll.tracks[0].id, poll.tracks[1].id], "tied leaders are listed in shortlist order");
  assert.match(recommendation.note, /unresolved/);
  assert.equal(closed.data.campaign.releasePoll.reviewPath, "/song-catalog/");
  const direct = releasePollRecommendation([{ id: 9, title: "B", position: 2, votes: 3 }, { id: 8, title: "A", position: 1, votes: 3 }]);
  assert.deepEqual(direct.leaders.map(leader => leader.trackId), [8, 9]);
  assert.equal(direct.outcome, "tie");
});

await check("a winning vote only records a recommendation and never publishes or distributes", async () => {
  const poll = await publishedPoll();
  await call(member("fan-w1", { points: 150 }), { action: "vote", slug: poll.slug, trackId: poll.tracks[2].id });
  await call(member("fan-w2", { points: 800 }), { action: "vote", slug: poll.slug, trackId: poll.tracks[2].id });
  await call(member("fan-w3", { points: 100 }), { action: "vote", slug: poll.slug, trackId: poll.tracks[0].id });
  const songsBefore = JSON.stringify(db.state.songs);
  const closed = await call(artist, { action: "close", slug: poll.slug });
  assert.equal(closed.status, 200);
  assert.match(closed.data.message, /Nothing was published/);
  const recommendation = closed.data.campaign.releasePoll.recommendation;
  assert.equal(recommendation.outcome, "leader");
  assert.equal(recommendation.leaders[0].title, "Candidate C");
  assert.equal(JSON.stringify(db.state.songs), songsBefore, "catalog records are unchanged");
  assert.equal(db.state.ledger.length, 1);
  assert.equal(db.state.ledger[0].outcome, "pending");
  assert.ok(db.state.queries.every(entry => !FORBIDDEN.test(entry.query)));
  assert.equal((await call(fan("fan-w1"), { action: "vote", slug: poll.slug, trackId: poll.tracks[0].id })).status, 409, "closed polls reject votes");
  assert.equal((await call(artist, { action: "publish", slug: poll.slug })).status, 409, "a closed release poll cannot be reopened");
  await call(artist, { action: "close", slug: poll.slug });
  assert.equal(db.state.ledger.length, 1, "the recommendation is recorded once");
});

await check("mutations verify origin and bound the request body", async () => {
  globalThis.__haloReleasePollOrigin = false;
  assert.equal((await createPoll()).status, 403);
  globalThis.__haloReleasePollOrigin = true;
  const huge = await call(artist, undefined, { method: "POST", raw: JSON.stringify({ action: "create", padding: "x".repeat(40_000) }) });
  assert.equal(huge.status, 413);
  assert.equal((await call(artist, undefined, { method: "POST", raw: "[1,2]" })).status, 400);
});

const staticChecks = [
  [migration.includes("ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'listening_party'") && migration.includes("CHECK (purpose IN ('listening_party', 'release_consideration'))"), "existing campaigns default to listening-party purpose"],
  [migration.includes("voter_min_reward_points >= 100") && migration.includes("halo_fan_release_poll_vote_events"), "stores the Insider threshold and an append-only vote audit"],
  [migration.includes("halo_fan_vote_campaign_votes_member_unique_idx") && migration.includes("WHERE member_id IS NOT NULL"), "enforces one vote per member per campaign in the database"],
  [migration.includes("release_poll_member_required") && migration.includes("'member:' || NEW.member_id") && migration.includes("FOR SHARE"), "database rejects device-token voter keys in release polls and serializes votes with close"],
  [migration.includes("release_poll_rewards_required") && migration.includes("release_poll_rank_required") && migration.includes("FROM halo_member_reward_events"), "database re-checks rewards opt-in and earned points"],
  [migration.includes("release_poll_candidates_locked") && migration.includes("campaign_purpose_locked"), "locks candidates after draft and freezes purpose/threshold"],
  [migration.includes("REFERENCES halo_song_catalog(id)") && !/\b(?:DROP TABLE|TRUNCATE|DELETE FROM)\b/i.test(migration), "links candidates to catalog songs without removing data"],
  [libSource.includes("rights_status = 'cleared'") && libSource.includes("metadata_status IN ('ready', 'reviewed')") && libSource.includes("version_type = 'sale_master'") && libSource.includes("mastering_status = 'approved'") && libSource.includes("pipeline_status <> 'published'") && libSource.includes("song.owner_member_id = ${memberId}"), "candidate eligibility uses real catalog status columns and ownership"],
  [libSource.includes("loadMemberRewards") && libSource.includes('REWARD_TIERS.find(tier => tier.id === "insider")') && !libSource.includes("grantMemberReward"), "eligibility reuses member rewards and never grants points"],
  [!/from "\.\/song-publication|from "\.\/catalog-force-push|halo_song_publication_sync|is_chart_eligible|halo_release_campaigns|fetch\(/.test(libSource), "release poll module has no publication or distribution dependency"],
  [functionSource.indexOf("if (isReleasePoll(campaign))") < functionSource.indexOf("const deviceToken = cleanText(body.voterToken, 128);"), "release-poll branch runs before any device-token handling"],
  [script.includes("Insider (100 earned points) or higher") && script.includes("does not publish the song") && script.includes("Fan recommendation / awaiting artist-team decision"), "fan UI discloses eligibility, advisory status, and result label"],
  [script.includes('aria-pressed="${selected}"') && script.includes("aria-describedby") && script.includes('role="status" aria-live="polite"') && script.includes("data-open-auth>Sign in to vote"), "release voting controls are keyboard and screen-reader accessible"],
  [!/async function releasePollVote[\s\S]*?voterToken[\s\S]*?\n  }\n/.test(script.slice(script.indexOf("async function releasePollVote"), script.indexOf("async function vote("))), "release-poll votes never send a device token"],
  [script.includes("Open Song Catalog release controls") && script.includes("Close poll + record recommendation"), "owners get a review route and close action"],
  [styles.includes(".release-candidate .vote-button{min-height:48px") && styles.includes(".picker-track:has(input:focus-visible)") && /@media\(max-width:720px\)\{\.release-candidate-picker/.test(styles), "release poll controls have mobile layouts and visible keyboard focus"],
  [docs.includes("Insider") && docs.includes("advisory") && /listening-party/i.test(docs) && docs.includes("Spotify"), "documents both vote types, rank rule, and non-automatic distribution"],
  [packageJson.includes("node scripts/fan-release-poll-contracts.mjs"), "runs with the repository test suite"]
];
for (const [passed, name] of staticChecks) results.push([passed, name]);

for (const [passed, name] of results) console.log(`${passed ? "PASS" : "FAIL"}: ${name}`);
if (results.some(([passed]) => !passed)) process.exitCode = 1;
else console.log(`Fan release poll contracts: ${results.length}/${results.length} checks passed.`);
