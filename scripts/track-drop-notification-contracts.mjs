import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MEMBER_REWARDS,
  REWARD_TIERS,
  absoluteSiteUrl,
  TRACK_DROP_COPY,
  announceTrackDrop,
  dispatchTrackDropEmails,
  rewardProgress,
  safeTrackDropArtwork,
  trackDropCard,
  trackDropEmailParameters,
  trackDropEmailSubject,
  trackDropPublicPath
} from "../netlify/lib/track-drops.mjs";
import { createTrackDropsHandler, config as apiConfig } from "../netlify/functions/track-drops.mjs";
import { config as dispatchConfig } from "../netlify/functions/track-drop-email-dispatch.mjs";
import { reconcilePublishedSong } from "../netlify/lib/song-publication.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [template, page, pageScript, migration, publication, reconcileFn, forcePushFn, forcePushLib, unifiedUpload, uploadPipeline, songCatalog, haloHtml, packageJson] = await Promise.all([
  read("emails/halo-track-drop/index.html"),
  read("track-drops/index.html"),
  read("track-drops/track-drops.js"),
  read("netlify/database/migrations/20261019030000_track_drop_notifications.sql"),
  read("netlify/lib/song-publication.mjs"),
  read("netlify/functions/song-publication-reconcile.mjs"),
  read("netlify/functions/catalog-force-push-track.mjs"),
  read("netlify/lib/catalog-force-push.mjs"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/upload-pipeline.mjs"),
  read("netlify/functions/song-catalog.ts"),
  read("halo.html"),
  read("package.json")
]);

const SITE = "https://halo.world";
const songId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const PRIVATE_PATTERNS = [/drive\.google/i, /\/api\/song-catalog\/audio/i, /\/\.netlify\//i, /netlify-emails-secret/i, /owner_member_id/i, /blob/i, /<script/i, /javascript:/i];

function assertPublicSafe(value, label) {
  const text = JSON.stringify(value);
  for (const pattern of PRIVATE_PATTERNS) assert.doesNotMatch(text, pattern, `${label} must not expose ${pattern}`);
}

// Rewards: deterministic tiers and copy, nothing shown when rewards are off.
assert.deepEqual(REWARD_TIERS.map(tier => [tier.label, tier.minPoints]), [["Listener", 0], ["Insider", 100], ["Inner Circle", 300], ["HALO VIP", 750]]);
assert.deepEqual(rewardProgress(0), { enabled: true, points: 0, tier: { id: "listener", label: "Listener" }, nextTier: { id: "insider", label: "Insider", pointsToGo: 100 }, message: "You're 100 points from Insider." });
assert.equal(rewardProgress(310).tier.label, "Inner Circle");
assert.equal(rewardProgress(310).message, "You're 440 points from HALO VIP.");
assert.deepEqual(rewardProgress(900).nextTier, null);
assert.equal(rewardProgress(900).message, "You've reached HALO VIP. Thank you for being part of HALO.");
assert.equal(rewardProgress(-5).points, 0, "points can never go negative");
assert.deepEqual(rewardProgress(500, false), { enabled: false, points: 0, tier: null, nextTier: null, message: "Turn on member rewards to collect points for new track drops." });
assert.equal(MEMBER_REWARDS.optIn.points, 50);
assert.equal(MEMBER_REWARDS.openDrop.points, 10);
for (const tier of REWARD_TIERS) assert.doesNotMatch(tier.label, /vault|secret|bypass|algorithm/i, "reward copy must stay public-safe");

// Artwork and links: only public HALO paths or public HTTPS artwork.
assert.equal(safeTrackDropArtwork(`/api/song-catalog/artwork?songId=${songId}&versionId=${versionId}`), `/api/song-catalog/artwork?songId=${songId}&versionId=${versionId}`);
assert.equal(safeTrackDropArtwork("https://cdn.example.com/cover.jpg"), "https://cdn.example.com/cover.jpg");
assert.equal(safeTrackDropArtwork("/assets/releases/cover.webp"), "/assets/releases/cover.webp");
for (const unsafe of [
  "https://drive.google.com/uc?id=secret-file", "http://cdn.example.com/cover.jpg", "javascript:alert(1)",
  "https://member@cdn.example.com/a.jpg", "//evil.example/a.jpg", `/api/song-catalog/audio?versionId=${versionId}`,
  "/assets/../netlify/functions/x", "/.netlify/functions/emails/x", "", null
]) {
  assert.equal(safeTrackDropArtwork(unsafe), "/assets/releases/halo-premium-placeholder.svg", `unsafe artwork ${String(unsafe)} must fall back`);
}
assert.equal(trackDropPublicPath("satellite-night-drive"), "/music/?song=satellite-night-drive");
assert.equal(trackDropPublicPath("../admin"), "/music/");
assert.equal(trackDropPublicPath("https://evil.example"), "/music/");

// In-app card: public fields only.
const drop = {
  id: "33333333-3333-4333-8333-333333333333",
  release_id: "owen-anthony-satellite",
  title: "Satellite <script>alert(1)</script>",
  artist: "Owen Anthony",
  artwork_url: "https://drive.google.com/uc?id=private",
  created_at: "2026-10-19T02:00:00.000Z",
  owner_member_id: "owner-1",
  stream_url: `/api/song-catalog/audio?versionId=${versionId}`
};
const card = trackDropCard(drop, { unread: true });
assert.deepEqual(Object.keys(card).sort(), ["artist", "artworkAlt", "artworkUrl", "createdAt", "ctaLabel", "ctaUrl", "eyebrow", "fallbackLabel", "fallbackUrl", "headline", "id", "title", "type", "unread"].sort());
assert.equal(card.title, "Satellite script alert(1) /script");
assert.equal(card.headline, TRACK_DROP_COPY.headline);
assert.equal(card.ctaLabel, "View on HALO");
assert.equal(card.ctaUrl, "/music/?song=owen-anthony-satellite");
assert.equal(card.fallbackUrl, "/music/");
assert.equal(card.unread, true);
assertPublicSafe(card, "in-app track drop card");

// Email card parameters: absolute HTTPS public links, rewards only when enabled.
const emailParams = trackDropEmailParameters(drop, { siteUrl: SITE, recipientName: "Ava", rewards: rewardProgress(60) });
assert.equal(emailParams.ctaUrl, `${SITE}/music/?song=owen-anthony-satellite`);
assert.equal(emailParams.fallbackUrl, `${SITE}/music/`);
assert.equal(emailParams.manageUrl, `${SITE}/track-drops/`);
assert.equal(emailParams.artworkUrl, `${SITE}/assets/releases/halo-premium-placeholder.svg`);
assert.equal(emailParams.greeting, "Hi Ava,");
assert.equal(emailParams.showRewards, true);
assert.equal(emailParams.rewardTier, "Listener");
assert.equal(emailParams.rewardMessage, "You're 40 points from Insider. Open this drop on HALO to collect 10 points.");
assertPublicSafe(emailParams, "email track drop card");
const noRewards = trackDropEmailParameters(drop, { siteUrl: SITE, rewards: rewardProgress(60, false) });
assert.equal(noRewards.showRewards, false);
assert.equal(noRewards.rewardMessage, "");
assert.equal(noRewards.greeting, "Hi,");
assert.equal(trackDropEmailParameters(drop, { siteUrl: "http://halo.world" }).ctaUrl, "", "email links require an HTTPS site");
assert.equal(trackDropEmailParameters({ ...drop, artwork_url: "https://cdn.example.com/cover.jpg" }, { siteUrl: SITE }).artworkUrl, "https://cdn.example.com/cover.jpg");
assert.equal(absoluteSiteUrl("https://evil.example/phish", SITE), "", "email links must stay on the HALO site");
assert.equal(absoluteSiteUrl("//evil.example/phish", SITE), "");
assert.equal(absoluteSiteUrl("/music/", SITE), `${SITE}/music/`);
assert.equal(trackDropEmailSubject(drop), "New on HALO: Satellite script alert(1) /script by Owen Anthony");
for (const key of Object.keys(emailParams)) {
  if (key === "showRewards") continue;
  assert.ok(template.includes(`{{${key}}}`), `email template must render ${key}`);
}
assert.match(template, /{{#if showRewards}}/, "rewards block must be conditional");
assert.doesNotMatch(template, /{{{/, "email template must keep Handlebars escaping on");
assert.match(template, /turn them off at any time/, "every email must explain how to opt out");
assertPublicSafe(template, "email template");

// Announcement: once per song, email queue only for consenting opted-in members, never the publisher.
{
  const queries = [];
  let announced = false;
  const db = { sql: async (strings, ...values) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ text, values });
    if (text.startsWith("INSERT INTO halo_track_drop_events")) {
      assert.match(text, /ON CONFLICT \(song_id\) DO NOTHING/, "drops must be idempotent per song");
      if (announced) return [];
      announced = true;
      return [{ id: values[0] }];
    }
    if (text.startsWith("INSERT INTO halo_track_drop_deliveries")) {
      assert.match(text, /track_drops_email = TRUE/);
      assert.match(text, /email_consent_at IS NOT NULL/);
      assert.match(text, /IS DISTINCT FROM \?/);
      assert.equal(values.at(-1), "owner-1", "the publisher is excluded from their own drop");
      return [{ member_id: "fan-1" }, { member_id: "fan-2" }];
    }
    if (text.startsWith("INSERT INTO halo_ledger")) return [];
    throw new Error(`Unexpected query: ${text}`);
  } };
  const song = { id: songId, title: "Satellite", artist_name: "Owen Anthony", owner_member_id: "owner-1", artwork_url: "" };
  const release = { id: "owen-anthony-satellite", artworkUrl: `/api/song-catalog/artwork?songId=${songId}` };
  const first = await announceTrackDrop(db, { song, release });
  assert.equal(first.announced, true);
  assert.equal(first.emailCardsQueued, 2);
  const insert = queries.find(query => query.text.startsWith("INSERT INTO halo_track_drop_events"));
  assert.equal(insert.values[6], `/api/song-catalog/artwork?songId=${songId}`);
  assert.equal(insert.values[7], "/music/?song=owen-anthony-satellite");
  const count = queries.length;
  assert.deepEqual(await announceTrackDrop(db, { song, release }), { announced: false, reason: "already_announced" });
  assert.equal(queries.length, count + 1, "a repeated publish must not queue emails again");
  assert.deepEqual(await announceTrackDrop(db, { song: { ...song, title: " " }, release }), { announced: false, reason: "missing_title" });
}

// Publication hook: explicit publishes announce, scheduled repairs never do, and failures never block publishing.
{
  const makeDb = ({ failDrop = false } = {}) => {
    const queries = [];
    const sql = async (strings, ...values) => {
      const text = strings.join("?").replace(/\s+/g, " ").trim();
      queries.push(text);
      if (text.includes("FROM halo_song_catalog song")) {
        return [{ id: songId, owner_member_id: "owner-1", source_release_id: "owen-anthony-satellite", artist_name: "Owen Anthony", title: "Satellite", genre: "deep house", pipeline_status: "published", metadata_issues: [] }];
      }
      if (text.startsWith("INSERT INTO halo_release_campaigns")) return [{ id: values[0], official_url: "", stream_url: "" }];
      if (text.startsWith("INSERT INTO halo_track_drop_events")) {
        if (failDrop) throw new Error("relation does not exist");
        return [{ id: values[0] }];
      }
      return [];
    };
    return { queries, sql };
  };
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const repairDb = makeDb();
    const repaired = await reconcilePublishedSong(repairDb, { songId, ownerMemberId: "owner-1" });
    assert.equal(repaired.ok, true);
    assert.equal(repaired.trackDrop, undefined);
    assert.ok(!repairDb.queries.some(text => text.includes("halo_track_drop")), "scheduled repairs must not announce drops");

    const publishDb = makeDb();
    const published = await reconcilePublishedSong(publishDb, { songId, ownerMemberId: "owner-1", announceDrop: true });
    assert.equal(published.ok, true);
    assert.equal(published.trackDrop.announced, true);

    const failingDb = makeDb({ failDrop: true });
    const resilient = await reconcilePublishedSong(failingDb, { songId, ownerMemberId: "owner-1", announceDrop: true });
    assert.equal(resilient.ok, true, "notification failures must never block shop publication");
    assert.deepEqual(resilient.trackDrop, { announced: false, reason: "unavailable" });
  } finally {
    console.warn = quiet;
  }
}
assert.match(publication, /announceDrop = false/, "announcements are opt-in per call");
assert.doesNotMatch(reconcileFn, /announceDrop/, "the reconcile repair job must never announce drops");
for (const [name, source] of [["catalog force push", forcePushFn], ["force push library", forcePushLib], ["unified upload", unifiedUpload], ["upload pipeline", uploadPipeline], ["song catalog", songCatalog]]) {
  assert.match(source, /announceDrop: true/, `${name} must announce new shop entries`);
}
assert.equal((publication.match(/announceDrop: true/g) || []).length, 1, "only the explicit force push in song-publication announces");

// Member API: sign-in, origin, consent and rewards are respected.
{
  const state = { prefs: null, rewards: new Map(), skippedQueued: false };
  const olderDrop = { ...drop, id: "66666666-6666-4666-8666-666666666666", created_at: "2020-01-01T00:00:00.000Z" };
  let user = { id: "fan-1" };
  let rejectOrigin = false;
  const db = { sql: async (strings, ...values) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    if (text.startsWith("SELECT track_drops_in_app")) return state.prefs ? [state.prefs] : [];
    if (text.startsWith("INSERT INTO halo_member_notification_preferences")) {
      const [, inApp, email, rewards] = values;
      state.prefs = { track_drops_in_app: inApp, track_drops_email: email, rewards_enabled: rewards, email_consent_at: email ? new Date("2026-10-01T00:00:00.000Z") : null, enabled_at: new Date("2026-10-01T00:00:00.000Z"), last_seen_at: new Date(0) };
      return [];
    }
    if (text.startsWith("UPDATE halo_track_drop_deliveries")) {
      assert.match(text, /status IN \('queued', 'sending'\)/, "opting out withdraws in-flight cards too");
      state.skippedQueued = true;
      return [];
    }
    if (text.startsWith("UPDATE halo_member_notification_preferences")) return [];
    if (text.startsWith("SELECT COALESCE(SUM(points)")) return [{ points: [...state.rewards.values()].reduce((sum, points) => sum + points, 0) }];
    if (text.startsWith("INSERT INTO halo_member_reward_events")) {
      if (state.rewards.has(values[1])) return [];
      state.rewards.set(values[1], values[2]);
      return [{ reward_key: values[1] }];
    }
    if (text.startsWith("SELECT id, release_id, title, artist, artwork_url, created_at, (created_at")) {
      assert.match(text, /owner_member_id IS DISTINCT FROM/, "members never see their own drop");
      return [{ ...drop, unread: true }];
    }
    if (text.startsWith("SELECT id, release_id, title, artist, artwork_url, created_at FROM halo_track_drop_events")) {
      assert.match(text, /created_at >= \?::timestamptz/, "open rewards only cover drops after opt-in");
      const eligible = [drop, olderDrop].filter(entry => new Date(entry.created_at) >= new Date(values[2]));
      return eligible.filter(entry => entry.id === values[0]);
    }
    throw new Error(`Unexpected API query: ${text}`);
  } };
  const handler = createTrackDropsHandler({
    database: () => db,
    currentUser: async () => user,
    verifyOrigin: () => { if (rejectOrigin) throw new Error("origin"); },
    membershipFor: async (_db, current) => ({ member_id: current.id })
  });
  const post = body => handler(new Request(`${SITE}/api/track-drops`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const prefs = (overrides = {}) => ({ action: "update-preferences", trackDropsInApp: true, trackDropsEmail: false, rewardsEnabled: true, ...overrides });

  assert.equal(apiConfig.path, "/api/track-drops");
  assert.equal(dispatchConfig.schedule, "*/10 * * * *");
  user = null;
  assert.equal((await handler(new Request(`${SITE}/api/track-drops`))).status, 401);
  user = { id: "fan-1" };
  const empty = await (await handler(new Request(`${SITE}/api/track-drops`))).json();
  assert.deepEqual(empty, { preferences: { trackDropsInApp: false, trackDropsEmail: false, rewardsEnabled: false, emailConsentGiven: false }, unreadCount: 0, notifications: [], rewards: rewardProgress(0, false) });
  assert.equal((await handler(new Request(`${SITE}/api/track-drops`, { method: "DELETE" }))).status, 405);
  rejectOrigin = true;
  assert.equal((await post(prefs())).status, 403);
  rejectOrigin = false;
  assert.equal((await handler(new Request(`${SITE}/api/track-drops`, { method: "POST", body: "{}" }))).status, 415);
  assert.equal((await post({ action: "update-preferences", trackDropsInApp: "yes" })).status, 400);
  assert.equal((await post(prefs({ trackDropsEmail: true }))).status, 400, "email alerts require explicit consent");
  assert.equal(state.prefs, null, "rejected preferences must not be stored");
  assert.equal((await post({ action: "open-drop", dropId: drop.id })).status, 409, "drops cannot be opened for rewards before opting in");

  const saved = await (await post(prefs({ trackDropsEmail: true, emailConsent: true }))).json();
  assert.equal(saved.preferences.trackDropsEmail, true);
  assert.equal(saved.rewardGranted, true);
  assert.equal(saved.message, "Track drop alerts saved. You've unlocked a new member reward: +50 points.");
  assert.equal(saved.rewards.points, 50);
  assert.equal(saved.unreadCount, 1);
  assertPublicSafe(saved.notifications, "in-app inbox");
  const again = await (await post(prefs({ trackDropsEmail: true, emailConsent: true }))).json();
  assert.equal(again.rewardGranted, false, "the opt-in reward is granted once");
  assert.equal(again.rewards.points, 50);

  const opened = await (await post({ action: "open-drop", dropId: drop.id })).json();
  assert.equal(opened.ctaUrl, "/music/?song=owen-anthony-satellite");
  assert.equal(opened.rewardGranted, true);
  assert.equal(opened.rewards.points, 60);
  assert.equal(opened.message, "+10 points. You're 40 points from Insider.");
  assert.equal((await (await post({ action: "open-drop", dropId: drop.id })).json()).rewardGranted, false, "each drop rewards once");
  assert.equal((await post({ action: "open-drop", dropId: olderDrop.id })).status, 404, "drops from before opting in earn no rewards");
  assert.equal((await post({ action: "open-drop", dropId: "../../etc" })).status, 400);
  assert.equal((await post({ action: "open-drop", dropId: "44444444-4444-4444-8444-444444444444" })).status, 404);

  // Email-only members are measured from email consent, never from a stale in-app opt-in.
  const current = state.prefs;
  state.prefs = { ...current, track_drops_in_app: false, track_drops_email: true, enabled_at: new Date("2019-01-01T00:00:00.000Z"), email_consent_at: new Date("2026-10-10T00:00:00.000Z") };
  assert.equal((await post({ action: "open-drop", dropId: olderDrop.id })).status, 404, "a stale in-app opt-in must not widen reward eligibility");
  state.prefs = current;
  await post(prefs({ trackDropsEmail: false, rewardsEnabled: false }));
  assert.equal(state.skippedQueued, true, "turning email off withdraws unsent cards");
  const off = await (await handler(new Request(`${SITE}/api/track-drops`))).json();
  assert.equal(off.rewards.enabled, false);
  assert.equal(off.rewards.points, 0, "rewards stay private when switched off");
  assert.equal((await post({ action: "unknown" })).status, 400);
}

// Email dispatch: safely skipped when unconfigured; sends public-safe cards when configured.
{
  const updates = [];
  const db = { sql: async (strings, ...values) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    if (text.startsWith("UPDATE halo_track_drop_deliveries")) { updates.push({ text, values }); return []; }
    if (text.startsWith("WITH claimed AS")) {
      assert.match(text, /SET status = 'sending'/, "rows are claimed before sending");
      assert.match(text, /FOR UPDATE OF queued SKIP LOCKED/, "overlapping runs never claim the same card");
      assert.match(text, /consent\.track_drops_email = TRUE AND consent\.email_consent_at IS NOT NULL/, "consent is re-checked when claiming");
      assert.match(text, /status = 'queued'/);
      return [
        { ...drop, drop_id: drop.id, member_id: "fan-1", attempts: 0, email: "fan@example.com", display_name: "Ava", rewards_enabled: true, reward_points: 60 },
        { ...drop, drop_id: drop.id, member_id: "fan-2", attempts: 2, email: "fan2@example.com", display_name: "", rewards_enabled: false, reward_points: 60 },
        { ...drop, drop_id: drop.id, member_id: "fan-3", attempts: 0, email: null, display_name: "", rewards_enabled: false, reward_points: 0 }
      ];
    }
    throw new Error(`Unexpected dispatch query: ${text}`);
  } };
  let sends = 0;
  const unconfigured = await dispatchTrackDropEmails(db, { settings: { secret: "", siteUrl: SITE, from: "" }, send: async () => { sends++; } });
  assert.deepEqual(unconfigured, { configured: false, sent: 0, failed: 0 });
  assert.equal(sends, 0, "nothing is sent without the Netlify Email Integration");
  assert.equal(updates.length, 1, "unconfigured runs only expire stale cards");
  assert.match(updates[0].text, /status = 'skipped', last_error = 'expired'/, "stale cards expire instead of sending late");

  const sent = [];
  const result = await dispatchTrackDropEmails(db, {
    settings: { secret: "test-secret", siteUrl: SITE, from: "drops@halo.world" },
    send: async (endpoint, init) => {
      sent.push({ endpoint, init, body: JSON.parse(init.body) });
      return { ok: sent.length === 1 };
    }
  });
  assert.deepEqual(result, { configured: true, sent: 1, failed: 1 });
  assert.equal(sent[0].endpoint, `${SITE}/.netlify/functions/emails/halo-track-drop`);
  assert.equal(sent[0].init.headers["netlify-emails-secret"], "test-secret");
  assert.equal(sent[0].body.to, "fan@example.com");
  assert.equal(sent[0].body.parameters.showRewards, true);
  assert.equal(sent[1].body.parameters.showRewards, false);
  assert.equal(sent.length, 2, "members without an email are skipped, not sent");
  assert.ok(updates.some(update => /last_error = 'no_email'/.test(update.text)));
  assert.ok(updates.some(update => /WHERE status = 'sending' AND claimed_at </.test(update.text)), "abandoned claims return to the queue");
  assertPublicSafe(sent[0].body.parameters, "dispatched email parameters");
  assert.ok(updates.some(update => /status = 'sent'/.test(update.text)));
  assert.ok(updates.some(update => update.values[0] === "failed"), "deliveries stop retrying after the attempt limit");
}

// Storage and member surfaces.
for (const table of ["halo_member_notification_preferences", "halo_track_drop_events", "halo_track_drop_deliveries", "halo_member_reward_events"]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must be created retry-safely`);
}
assert.match(migration, /song_id TEXT NOT NULL UNIQUE/, "one announcement per song");
assert.match(migration, /'queued', 'sending', 'sent', 'skipped', 'failed'/, "deliveries are claimed before sending");
assert.match(migration, /PRIMARY KEY \(member_id, reward_key\)/, "rewards are granted once per key");
assert.match(migration, /track_drops_email BOOLEAN NOT NULL DEFAULT FALSE/, "email alerts are off until a member opts in");
assert.doesNotMatch(migration, /(?:^|;\s*)(?:DROP|TRUNCATE|DELETE)\s/im);
assert.match(page, /Dreamweaver email cards/);
assert.match(page, /Yes, email me track drops/);
assert.match(page, /\/track-drops\/track-drops\.js/);
assert.doesNotMatch(pageScript, /innerHTML/, "track drop cards must render with text nodes only");
assert.match(pageScript, /\/api\/track-drops/);
assert.match(haloHtml, /href="\/track-drops\/"/, "the existing alerts dialog links to track drop settings");
assert.match(packageJson, /track-drop-notification-contracts\.mjs/, "contracts must run with npm test");

console.log("Track drop notification contracts passed");
