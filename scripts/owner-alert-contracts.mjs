import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createStripeWebhookHandler, verifyStripeSignature } from "../netlify/lib/stripe-webhook.mjs";
import { ownerAlertText, sendOwnerAlert } from "../netlify/lib/owner-alerts.mjs";
import { createDreamweaverFanSignupHandler } from "../netlify/functions/dreamweaver-fan-signups.mjs";
import { createRelationshipEventHandler } from "../netlify/functions/relationship-event.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, route, relationshipEvent, identity] = await Promise.all([
  read("netlify/database/migrations/20261101100000_stripe_purchase_events.sql"),
  read("netlify/functions/stripe-webhook.mjs"),
  read("netlify/functions/relationship-event.mjs"),
  read("identity.js")
]);
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_stripe_purchase_events/);
assert.match(migration, /checkout_session_id TEXT NOT NULL UNIQUE/);
assert.doesNotMatch(migration, /email/i, "Purchase ledger stores no buyer contact details");
assert.doesNotMatch(migration, /(?:^|;\s*)(?:DROP|TRUNCATE|DELETE)\s/im);
assert.match(route, /path: "\/api\/stripe-webhook"/);
assert.match(relationshipEvent, /event_type = 'signup'/);
assert.match(relationshipEvent, /notifyOwnerSafely/);
assert.match(identity, /recordRelationshipEvent\("signup"\)/, "Verified identity signup events reach the alert path");

const secret = "whsec_test";
const now = 1_800_000_000;
const sign = (payload, timestamp = now, key = secret) =>
  `t=${timestamp},v1=${createHmac("sha256", key).update(`${timestamp}.${payload}`).digest("hex")}`;

assert.equal(verifyStripeSignature("{}", sign("{}"), secret, now), true);
assert.equal(verifyStripeSignature("{}", sign("{}", now, "wrong"), secret, now), false);
assert.equal(verifyStripeSignature("{ }", sign("{}"), secret, now), false, "Body tampering is rejected");
assert.equal(verifyStripeSignature("{}", sign("{}", now - 301), secret, now), false, "Replays outside tolerance are rejected");
assert.equal(verifyStripeSignature("{}", `t=${now},v1=zz`, secret, now), false);
assert.equal(verifyStripeSignature("{}", `t=${now},v1=${"0".repeat(64)},${sign("{}").split(",")[1]}`, secret, now), true, "Any valid v1 signature is accepted during secret rotation");

function event(overrides = {}, session = {}) {
  return {
    id: "evt_1", type: "checkout.session.completed", livemode: true, ...overrides,
    data: { object: {
      object: "checkout.session", id: "cs_1", payment_status: "paid", amount_total: 999, currency: "gbp",
      client_reference_id: "mix-1", metadata: { mix_id: "mix-1" },
      customer_details: { email: "fan@example.com", name: "Private Fan" }, ...session
    } }
  };
}

function fixture({ inserted = true, configured = true, fail = false } = {}) {
  const calls = [], alerts = [];
  const handler = createStripeWebhookHandler({
    secret: () => configured ? secret : "",
    now: () => now,
    notify: async alert => { alerts.push(alert); },
    database: async () => ({
      sql: async (parts, ...params) => {
        const query = parts.join("?").replace(/\s+/g, " ").trim();
        calls.push({ query, params });
        if (fail) throw new Error("database down");
        if (query.startsWith("INSERT")) return inserted ? [{ stripe_event_id: params[0] }] : [];
        if (query.includes("FROM halo_mixes")) return [{ title: "Night *Drive*", original_artist: "HALO" }];
        return [];
      }
    })
  });
  const send = (body, headers = {}) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    return handler(new Request("https://halo.test/api/stripe-webhook", {
      method: "POST", body: payload, headers: { "stripe-signature": sign(payload), ...headers }
    }));
  };
  return { calls, alerts, send, handler };
}

const paid = fixture();
const paidResponse = await paid.send(event());
assert.equal(paidResponse.status, 200);
assert.deepEqual(paid.calls[1].params, ["evt_1", "cs_1", "mix-1", 999, "GBP", true]);
assert.equal(paid.alerts.length, 1);
assert.equal(paid.alerts[0].title, "New HALO purchase");
assert.deepEqual(paid.alerts[0].lines, ["Item: Night *Drive* — HALO", "Amount: £9.99"]);
assert.doesNotMatch(JSON.stringify([paid.calls, paid.alerts]), /fan@example\.com|Private Fan/, "Buyer identity is never stored or alerted");
const yen = fixture();
await yen.send(event({}, { amount_total: 500, currency: "jpy" }));
assert.equal(yen.alerts[0].lines[1], "Amount: JP¥500", "Zero-decimal currencies use Stripe's minor-unit scale");

const testMode = fixture();
await testMode.send(event({ livemode: false }));
assert.match(testMode.alerts[0].title, /^\[TEST\]/);

const duplicate = fixture({ inserted: false });
assert.deepEqual(await (await duplicate.send(event())).json(), { received: true, duplicate: true });
assert.equal(duplicate.alerts.length, 0, "Stripe retries never re-alert");

const forged = fixture();
const forgedResponse = await forged.send(event(), { "stripe-signature": sign("{}") });
assert.equal(forgedResponse.status, 400);
assert.equal(forged.calls.length, 0);
assert.equal(forged.alerts.length, 0);
const unsigned = fixture();
assert.equal((await unsigned.send(event(), { "stripe-signature": "" })).status, 400);

const unconfigured = fixture({ configured: false });
assert.equal((await unconfigured.send(event())).status, 503);
assert.equal(unconfigured.calls.length, 0);

for (const ignored of [event({ type: "charge.succeeded" }), event({}, { payment_status: "unpaid" })]) {
  const f = fixture();
  assert.deepEqual(await (await f.send(ignored)).json(), { received: true, ignored: true });
  assert.equal(f.calls.length + f.alerts.length, 0);
}
const asyncPaid = fixture();
assert.equal((await asyncPaid.send(event({ type: "checkout.session.async_payment_succeeded" }))).status, 200);
assert.equal(asyncPaid.alerts.length, 1);

const malformed = fixture();
assert.equal((await malformed.send(event({}, { amount_total: "9.99" }))).status, 400);
assert.equal((await malformed.send(event({ id: "invalid" }))).status, 400);
assert.equal((await malformed.send(event({}, { id: "not-a-session" }))).status, 400);
assert.equal((await malformed.send("{")).status, 400);
assert.equal((await malformed.handler(new Request("https://halo.test/api/stripe-webhook"))).status, 405);
const tooLarge = fixture();
assert.equal((await tooLarge.send("x".repeat(256 * 1024 + 1))).status, 413);
const down = fixture({ fail: true });
assert.equal((await down.send(event())).status, 500, "Stripe retries if the purchase was not recorded");
assert.equal(down.alerts.length, 0);

assert.equal(ownerAlertText({ title: "New\nsale", lines: ["Track:\u0000 A", "", "Amount: £1"] }), "New sale\nTrack: A\nAmount: £1");
assert.deepEqual(await sendOwnerAlert({ title: "x" }, { env: {}, fetchImpl: () => assert.fail("No delivery when unconfigured") }), { sent: [], failed: [], configured: false });
const requests = [];
const delivered = await sendOwnerAlert({ title: "Sale", lines: ["Track: *bold* @everyone"] }, {
  env: {
    TELEGRAM_BOT_TOKEN: "123:abc_DEF", TELEGRAM_CHAT_ID: "42",
    HALO_OWNER_ALERT_DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/token"
  },
  fetchImpl: async (url, init) => { requests.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true }; }
});
assert.deepEqual(delivered.sent, ["telegram", "discord"]);
assert.equal(requests[0].url, "https://api.telegram.org/bot123:abc_DEF/sendMessage");
assert.equal("parse_mode" in requests[0].body, false, "Telegram uses plain text so titles cannot inject Markdown");
assert.deepEqual(requests[1].body.allowed_mentions, { parse: [] }, "Discord alerts cannot mention everyone");
const rejected = [];
await sendOwnerAlert({ title: "x" }, {
  env: { TELEGRAM_BOT_TOKEN: "bad token", TELEGRAM_CHAT_ID: "42", HALO_OWNER_ALERT_DISCORD_WEBHOOK_URL: "https://evil.test/api/webhooks/1" },
  fetchImpl: async url => { rejected.push(url); return { ok: true }; }
});
assert.equal(rejected.length, 0, "Invalid Telegram tokens and non-Discord hosts are not contacted");
const partial = await sendOwnerAlert({ title: "x" }, {
  env: { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_ID: "42" },
  fetchImpl: async () => { throw new Error("network"); }
});
assert.deepEqual(partial.failed, ["telegram"]);

function signupFixture(inserted) {
  const alerts = [];
  const handler = createDreamweaverFanSignupHandler({
    verifyOrigin: () => true,
    notify: async alert => { alerts.push(alert); },
    database: async () => ({ sql: async parts => parts.join("").includes("halo_dreamweaver_fan_signups")
      ? [{ id: "s", email: "fan@example.com", first_name: "Fan", favorite_platform: "spotify", inserted }] : [] })
  });
  const send = () => handler(new Request("https://halo.test/api/dreamweaver-fan-signups", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fan@example.com", firstName: "Fan", consent: true, favoritePlatform: "spotify" })
  }));
  return { alerts, send };
}
const newFan = signupFixture(true);
assert.equal((await newFan.send()).status, 201);
assert.equal(newFan.alerts.length, 1);
assert.doesNotMatch(JSON.stringify(newFan.alerts), /fan@example\.com/);
const repeatFan = signupFixture(false);
assert.equal((await repeatFan.send()).status, 200);
assert.equal(repeatFan.alerts.length, 0, "Repeat signups do not re-alert");

function memberSignupFixture({ inserted = true, signupCount = 1, authenticated = true, originAllowed = true } = {}) {
  const alerts = [], queries = [];
  let databaseCalls = 0;
  const handler = createRelationshipEventHandler({
    database: async () => {
      databaseCalls++;
      return { sql: async (parts, ...params) => {
        const query = parts.join("?").replace(/\s+/g, " ").trim();
        queries.push({ query, params });
        if (query.startsWith("INSERT INTO halo_relationship_auth_events")) return inserted ? [{ member_id: "member-1" }] : [];
        if (query.startsWith("SELECT COUNT(*)")) return [{ count: signupCount }];
        return [];
      } };
    },
    currentUser: async () => authenticated ? { id: "member-1", email: "private@example.com" } : null,
    verifyOrigin: () => { if (!originAllowed) throw new Error("bad origin"); },
    membershipFor: async () => ({ member_id: "member-1", display_name: "New Creator" }),
    notify: async alert => { alerts.push(alert); }
  });
  const send = (eventType = "signup", sessionKey = "session-key-123") => handler(new Request("https://halo.test/api/relationship-event", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventType, sessionKey })
  }));
  return { alerts, queries, send, databaseCalls: () => databaseCalls };
}
const newMember = memberSignupFixture();
assert.equal((await newMember.send()).status, 200);
assert.deepEqual(newMember.alerts, [{ title: "New HALO member signup", lines: ["Member: New Creator"] }]);
assert.doesNotMatch(JSON.stringify(newMember.alerts), /private@example\.com/);
assert.ok(newMember.queries.some(({ query }) => query.includes("ON CONFLICT (member_id, event_type, session_key) DO NOTHING")));
const duplicateMemberEvent = memberSignupFixture({ inserted: false });
assert.equal((await duplicateMemberEvent.send()).status, 200);
assert.equal(duplicateMemberEvent.alerts.length, 0, "Duplicate member signup events do not re-alert");
const returningMember = memberSignupFixture({ signupCount: 2 });
await returningMember.send();
assert.equal(returningMember.alerts.length, 0, "Existing members never receive a new-member alert");
const ordinaryLogin = memberSignupFixture();
await ordinaryLogin.send("login");
assert.equal(ordinaryLogin.alerts.length, 0, "Logins do not trigger signup alerts");
const anonymousMember = memberSignupFixture({ authenticated: false });
assert.equal((await anonymousMember.send()).status, 401);
assert.equal(anonymousMember.databaseCalls(), 0, "Unauthenticated activity never opens a database connection");
const rejectedOrigin = memberSignupFixture({ originAllowed: false });
assert.equal((await rejectedOrigin.send()).status, 403);
assert.equal(rejectedOrigin.databaseCalls(), 0);

console.log("Owner alert contracts passed");
