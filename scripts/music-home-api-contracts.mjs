import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMusicHomeHandler } from "../netlify/lib/music-home.mjs";
import { CURATED_LOOPS, defaultMusicHomeConfig, MAX_CUSTOM_VIDEO_BYTES } from "../lib/music-home.js";
import { creatorPassFromRow } from "../netlify/lib/creator-pass.mjs";

const owner = "member-owner_123";
const other = "member-other";
const customUrl = `/api/music-home?creator=${owner}&asset=background`;
const premium = { subscriptionTier: "PREMIUM", subscriptionStatus: "active", subscriptionExpiresAt: "2099-01-01T00:00:00Z" };
const standard = { subscriptionTier: "STANDARD", subscriptionStatus: "inactive" };
const mp4 = new Uint8Array(await readFile(new URL(`..${CURATED_LOOPS[0].url}`, import.meta.url)));

function fixture(options = {}) {
  const state = { user: options.anonymous ? null : { id: "identity-not-member" }, origin: true,
    pass: standard, profile: { display_name: "Creator", bio: "Public bio", roles: ["Producer"], discoverable: true },
    config: null, customUrl: "", stems: 0, splits: 0, reads: 0, dbCalls: 0, writes: 0, storeCalls: 0,
    blobs: new Map(), queries: [], ...options };
  const db = { async sql(strings, ...values) {
    state.dbCalls++;
    const query = strings.join("?");
    state.queries.push(query);
    if (state.failDb) throw new Error("secret database password and table internals");
    if (query.includes("INSERT INTO halo_music_homes")) {
      const [id, config, url, gated] = values;
      assert.equal(id, owner, "writes derive ownership from the membership");
      if (gated && (state.rejectFinalGate || state.pass.subscriptionTier !== "PREMIUM")) return [];
      state.config = JSON.parse(config);
      state.customUrl = url;
      state.writes++;
      return [{ member_id: owner }];
    }
    if (query.includes("FROM halo_music_homes")) return state.config ? [{ config: state.config, custom_background_url: state.customUrl }] : [];
    if (query.includes("FROM halo_creator_profiles")) return state.profile ? [state.profile] : [];
    if (query.includes("AS stem_uploads")) {
      assert.match(query, /JOIN halo_stem_packs/);
      assert.match(query, /pack\.status = 'private'/);
      assert.match(query, /pack\.rights_attested = TRUE/);
      assert.equal(values[0], values.at(-1));
      return [{ stem_uploads: state.stems }];
    }
    if (query.includes("AS completed_splits")) {
      assert.match(query, /work\.rights_status = 'cleared'/);
      assert.match(query, /project\.owner_member_id = \?/);
      assert.match(query, /project\.rights_work_id = work\.id/);
      assert.match(query, /work\.work_type = 'recording'\s+AND SUM\(participant\.share_bps\) FILTER \(WHERE participant\.role = 'master_owner'\) = 10000/);
      assert.match(query, /work\.work_type = 'composition'\s+AND SUM\(participant\.share_bps\) FILTER \(WHERE participant\.role = 'songwriter'\) = 10000/);
      assert.match(query, /FILTER \(WHERE participant\.role = 'master_owner'\) = 10000/);
      assert.match(query, /FILTER \(WHERE participant\.role = 'songwriter'\) = 10000/);
      assert.match(query, /FILTER \(WHERE participant\.role = 'publisher'\) = 10000/);
      assert.doesNotMatch(query, /smart_split|draft/i);
      return [{ completed_splits: state.splits }];
    }
    if (query.includes("FROM halo_release_campaigns")) {
      assert.match(query, /JOIN halo_artist_pages/);
      assert.match(query, /page\.owner_member_id = \?/);
      assert.match(query, /page\.status = 'published'/);
      assert.match(query, /campaign\.status = 'published' AND campaign\.visibility = 'public'/);
      assert.doesNotMatch(query, /audio_version|song_version|stem|preview|evidence/);
      return [{ id: "release", title: "Published release", artist: "Creator",
        artwork_url: "/cover.jpg", official_url: "https://example.com/release", private_evidence: "secret" }];
    }
    throw new Error(`Unexpected SQL: ${query}`);
  } };
  const handler = createMusicHomeHandler({
    getDatabase: async () => db, getUser: async () => state.user,
    membershipFor: async (_db, user) => {
      assert.equal(user.id, "identity-not-member");
      return { member_id: state.memberId || owner };
    },
    verifyRequestOrigin: async () => state.origin,
    passFor: async () => {
      state.reads++;
      return state.pass;
    },
    getStore: options => {
      assert.deepEqual(options, { name: "halo-music-home", consistency: "strong" });
      state.storeCalls++;
      return {
        async set(key, bytes, { metadata }) {
          assert.equal(key, `background/${owner}`);
          assert.deepEqual(metadata, { memberId: owner, contentType: "video/mp4" });
          if (state.failStore) throw new Error("secret storage details");
          state.blobs.set(key, bytes);
          if (state.downgradeAfterUpload) state.pass = standard;
        },
        async get(key) {
          const result = state.blobs.get(key);
          if (state.downgradeDuringRead) state.pass = standard;
          if (state.hideDuringRead) state.profile.discoverable = false;
          if (state.disableDuringRead) state.config.backgroundMode = "SOLID_OBSIDIAN";
          return result || null;
        }
      };
    }
  });
  return { handler, state };
}

const request = (query = "", options = {}) => new Request(`https://halo.example/api/music-home${query}`, options);
const saveRequest = (config, extra = {}) => request("", { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, ...extra }) });
const uploadRequest = (bytes = mp4, headers = {}) => request("", { method: "POST",
  headers: { "Content-Type": "video/mp4", ...headers }, body: bytes });
const uploadHome = { ...defaultMusicHomeConfig(owner), backgroundMode: "CUSTOM_UPLOAD", selectedBackgroundUrl: customUrl, isSovereignModeActive: true };

let f = fixture({ anonymous: true });
assert.equal((await f.handler(request())).status, 401);
const deniedUpload = uploadRequest();
assert.equal((await f.handler(deniedUpload)).status, 401);
assert.equal(deniedUpload.bodyUsed, false, "authentication precedes body consumption");
assert.equal(f.state.dbCalls, 0, "unauthenticated writes never access DB or body/store");
assert.equal(f.state.storeCalls, 0);
assert.equal((await f.handler(request("", { method: "PUT" }))).status, 405);

f = fixture({ origin: false });
const deniedSave = saveRequest(defaultMusicHomeConfig(owner));
assert.equal((await f.handler(deniedSave)).status, 403);
assert.equal(deniedSave.bodyUsed, false, "origin validation precedes body consumption");
assert.equal(f.state.dbCalls, 0);
assert.equal(f.state.storeCalls, 0);

f = fixture();
let payload = await (await f.handler(request())).json();
assert.deepEqual(Object.keys(payload).sort(), ["config", "creatorPass", "milestones", "unlocks", "customBackgroundUrl"].sort());
assert.equal(payload.config.creatorId, owner);
assert.equal(payload.creatorPass.displayName, "Creator");
assert.deepEqual(payload.creatorPass.roles, ["Producer"]);
assert.deepEqual(payload.milestones, { stemUploads: 0, completedSplits: 0 });
assert.deepEqual(payload.unlocks.themes, ["GOLD"]);
assert.equal((await f.handler(saveRequest({ ...defaultMusicHomeConfig(owner), theme: "BRONZE" }))).status, 400);
assert.equal((await f.handler(saveRequest({ ...defaultMusicHomeConfig(other) }))).status, 400);
assert.equal((await f.handler(saveRequest({ ...defaultMusicHomeConfig(owner), isSovereignModeActive: true }))).status, 400);
assert.equal((await f.handler(saveRequest(defaultMusicHomeConfig(owner), { creatorPass: premium }))).status, 400);
assert.equal((await f.handler(saveRequest({ ...defaultMusicHomeConfig(owner), customBackgroundUrl: customUrl }))).status, 400);
assert.equal((await f.handler(saveRequest({ ...defaultMusicHomeConfig(owner), layoutModules: [] }))).status, 400);
const duplicate = defaultMusicHomeConfig(owner);
duplicate.layoutModules[1].order = 0;
assert.equal((await f.handler(saveRequest(duplicate))).status, 400);
assert.equal((await f.handler(saveRequest({ ...defaultMusicHomeConfig(owner), selectedBackgroundUrl: "https://evil.test" }))).status, 200);
assert.equal(f.state.config.selectedBackgroundUrl, "", "solid config cannot persist arbitrary background metadata");
assert.equal((await f.handler(uploadRequest())).status, 403);
assert.equal(f.state.storeCalls, 0);
f.state.pass = { ...standard, entitlements: { customArtistRoom: true } };
assert.equal((await f.handler(uploadRequest())).status, 403, "forged entitlements are ignored");
f.state.pass = { ...premium, subscriptionExpiresAt: "2020-01-01T00:00:00Z" };
assert.equal((await f.handler(uploadRequest())).status, 403);
f.state.pass = premium;
assert.equal((await f.handler(saveRequest(uploadHome))).status, 400, "Premium cannot invent owned custom uploads");
assert.equal((await f.handler(uploadRequest(new Uint8Array([1, 2, 3])))).status, 400);
const invalidContainer = mp4.slice();
invalidContainer.fill(0, 0, 4);
assert.equal((await f.handler(uploadRequest(invalidContainer))).status, 400);
const unsupportedBrand = mp4.slice();
unsupportedBrand[8] = 120;
assert.equal((await f.handler(uploadRequest(unsupportedBrand))).status, 400);
assert.equal((await f.handler(uploadRequest(mp4, { "Content-Length": "2" }))).status, 400);
assert.equal((await f.handler(uploadRequest(mp4, { "Content-Length": String(MAX_CUSTOM_VIDEO_BYTES + 1) }))).status, 413);
assert.equal((await f.handler(uploadRequest(new Uint8Array(MAX_CUSTOM_VIDEO_BYTES + 1)))).status, 413);
let cancelled = false, chunksRead = 0;
const streamedUpload = request("", { method: "POST", headers: { "Content-Type": "video/mp4" }, duplex: "half",
  body: new ReadableStream({
    pull(controller) {
      chunksRead++;
      controller.enqueue(new Uint8Array(1024 * 1024));
      if (chunksRead === 8) controller.close();
    },
    cancel() { cancelled = true; }
  })
});
assert.equal((await f.handler(streamedUpload)).status, 413);
assert.equal(cancelled, true, "overflow cancels the stream rather than reading the remaining body");
assert.ok(chunksRead < 8);
assert.equal((await f.handler(uploadRequest(mp4, { "Content-Length": "-1" }))).status, 400);
assert.equal((await f.handler(uploadRequest(mp4, { "Content-Type": "image/gif" }))).status, 415);
assert.equal(f.state.storeCalls, 0);
assert.equal((await f.handler(request("", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status, 400);
assert.equal((await f.handler(request("", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(16385) }))).status, 413);

f.state.stems = 5;
f.state.splits = 1;
const earned = { ...defaultMusicHomeConfig(owner), theme: "PLATINUM",
  layoutModules: defaultMusicHomeConfig(owner).layoutModules.map(module => ({ ...module, isVisible: false })) };
assert.equal((await f.handler(saveRequest(earned))).status, 200);
payload = await (await f.handler(uploadRequest())).json();
assert.equal(payload.config.backgroundMode, "CUSTOM_UPLOAD");
assert.equal(payload.config.theme, "PLATINUM");
assert.deepEqual(payload.config.layoutModules, earned.layoutModules);
assert.equal(payload.config.selectedBackgroundUrl, customUrl);
assert.equal(payload.customBackgroundUrl, customUrl);
assert.equal(f.state.blobs.size, 1);
assert.equal((await f.handler(uploadRequest())).status, 200);
assert.equal(f.state.blobs.size, 1, "repeated uploads replace a single owned blob");
assert.equal((await f.handler(saveRequest({ ...payload.config, selectedBackgroundUrl: `/api/music-home?creator=${other}&asset=background` }))).status, 400);
assert.equal((await f.handler(saveRequest({ ...payload.config, selectedBackgroundUrl: "https://evil.test/background.mp4" }))).status, 400);
let response = await f.handler(request(`?creator=${owner}&asset=background`));
assert.equal(response.status, 200);
assert.match(response.headers.get("cache-control"), /private, no-store/);
assert.equal(response.headers.get("x-content-type-options"), "nosniff");
assert.deepEqual(new Uint8Array(await response.arrayBuffer()), mp4);
response = await f.handler(request(`?creator=${owner}&asset=background`, { headers: { Range: "bytes=0-15" } }));
assert.equal(response.status, 206);
assert.equal(response.headers.get("content-range"), `bytes 0-15/${mp4.length}`);
assert.equal((await response.arrayBuffer()).byteLength, 16);
response = await f.handler(request(`?creator=${owner}&asset=background`, { method: "HEAD" }));
assert.equal(response.headers.get("content-length"), String(mp4.length));
assert.equal((await response.arrayBuffer()).byteLength, 0);
response = await f.handler(request(`?creator=${owner}&asset=background`, { headers: { Range: "bytes=-4" } }));
assert.equal(response.status, 206);
assert.equal((await response.arrayBuffer()).byteLength, 4);
for (const range of [`bytes=${mp4.length}-`, "bytes=4-2", "bytes=0-1,4-5", "bytes=-0", "bytes=9007199254740992-"]) {
  assert.equal((await f.handler(request(`?creator=${owner}&asset=background`, { headers: { Range: range } }))).status, 416);
}
f.state.downgradeDuringRead = true;
assert.equal((await f.handler(request(`?creator=${owner}&asset=background`))).status, 404);
payload = await (await f.handler(request())).json();
assert.equal(payload.config.backgroundMode, "SOLID_OBSIDIAN");
assert.equal(payload.config.selectedBackgroundUrl, "");
assert.equal(payload.customBackgroundUrl, "");
assert.equal(payload.config.isSovereignModeActive, false);
assert.equal((await f.handler(request(`?creator=${owner}&asset=background`))).status, 404);

f = fixture({ pass: premium, config: uploadHome, customUrl, anonymous: true,
  blobs: new Map([[`background/${owner}`, mp4.buffer]]), hideDuringRead: true });
assert.equal((await f.handler(request(`?creator=${owner}&asset=background`))).status, 404,
  "a creator becoming private during blob I/O blocks the public asset");
f = fixture({ pass: premium, config: structuredClone(uploadHome), customUrl,
  blobs: new Map([[`background/${owner}`, mp4.buffer]]), disableDuringRead: true });
assert.equal((await f.handler(request(`?creator=${owner}&asset=background`))).status, 404,
  "disabling a custom background during blob I/O blocks the asset");

f = fixture({ pass: premium, downgradeAfterUpload: true });
assert.equal((await f.handler(uploadRequest())).status, 403);
assert.equal(f.state.writes, 0, "pass is checked again after storage");
assert.equal(f.state.blobs.size, 1, "even a denied persistence leaves at most one bounded owned blob");
f = fixture({ pass: premium, rejectFinalGate: true });
assert.equal((await f.handler(uploadRequest())).status, 403);
assert.equal(f.state.writes, 0, "SQL gates final persistence against a concurrent downgrade");

f = fixture({ anonymous: true });
response = await f.handler(request(`?creator=${owner}`));
assert.equal(response.status, 200);
payload = await response.json();
assert.deepEqual(Object.keys(payload).sort(), ["config", "profile", "milestones", "modules"].sort());
assert.deepEqual(payload.profile, { displayName: "Creator", bio: "Public bio" });
assert.deepEqual(payload.modules.SIGNAL_FEED, []);
assert.deepEqual(payload.modules.COLLAB_BRIEFS, []);
assert.deepEqual(payload.modules.SOVEREIGN_VAULT, [{ id: "release", title: "Published release",
  description: "Published release", url: "/music/?song=release" }]);
assert.ok(payload.modules.SOVEREIGN_VAULT.every(entry => entry.url.startsWith("/") && !entry.url.startsWith("//")));
assert.doesNotMatch(JSON.stringify(payload), /secret|entitlements|subscriptionStatus|roles/);
f.state.profile.discoverable = false;
assert.equal((await f.handler(request(`?creator=${owner}`))).status, 404);
assert.equal((await f.handler(request(`?creator=${owner}&asset=background`))).status, 404);
f.state.user = { id: "identity-not-member" };
assert.equal((await f.handler(request(`?creator=${owner}`))).status, 200, "owner can preview a private home");
f.state.memberId = other;
assert.equal((await f.handler(request(`?creator=${owner}`))).status, 404);
for (const id of ["", "../owner", "a".repeat(129), "owner@private", "owner/child"]) {
  assert.equal((await f.handler(request(`?creator=${encodeURIComponent(id)}`))).status, 400);
}
assert.equal((await f.handler(request("?asset=background"))).status, 400);
assert.equal((await f.handler(request(`?creator=${owner}&asset=other`))).status, 400);
assert.equal((await f.handler(request(`?creator=${owner}`, { method: "HEAD" }))).status, 405);
assert.equal((await f.handler(request(`?creator=${owner}`, { method: "POST" }))).status, 400);
f = fixture({ failDb: true });
response = await f.handler(request());
assert.equal(response.status, 503);
assert.doesNotMatch(await response.text(), /password|internals/);
f = fixture({ pass: premium, failStore: true });
response = await f.handler(uploadRequest());
assert.equal(response.status, 503);
assert.doesNotMatch(await response.text(), /secret|storage details/);

const realPassFixture = fixture();
const databasePass = creatorPassFromRow({ member_id: owner, subscription_tier: "PREMIUM",
  subscription_status: "active", subscription_expires_at: new Date("2099-01-01") });
realPassFixture.state.pass = databasePass;
assert.equal((await realPassFixture.handler(uploadRequest())).status, 200);
const migration = await readFile(new URL("../netlify/database/migrations/20261004050000_create_music_homes.sql", import.meta.url), "utf8");
assert.match(migration, /member_id TEXT PRIMARY KEY REFERENCES halo_memberships/);
assert.match(migration, /config JSONB NOT NULL/);
assert.match(migration, /halo_valid_music_home_layout/);
assert.match(migration, /REVOKE ALL ON TABLE halo_music_homes FROM PUBLIC/);
assert.match(migration, /custom_background_url = '\/api\/music-home\?creator='/);
console.log("Music Home API contracts passed (auth, origin, ownership, milestones, entitlement gates, bounded uploads, public privacy, downgrade, Range/HEAD, errors).");
