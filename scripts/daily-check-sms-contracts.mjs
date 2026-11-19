import assert from "node:assert/strict";
import { dailyCheckSmsText, sendOwnerSms, textDailyCheck } from "../netlify/lib/owner-alerts.mjs";

const env = { TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`, TWILIO_AUTH_TOKEN: "sample", TWILIO_FROM_NUMBER: "+447700900000", HALO_OWNER_SMS_TO: "+44 7700 900111" };
let request;
const sent = await sendOwnerSms(dailyCheckSmsText({ check: "Agent Council", lines: ["Health 82/100"] }), { env, fetchImpl: async (url, options) => { request = { url, options }; return { ok: true }; } });
assert.deepEqual(sent, { sent: true, configured: true });
assert.match(request.url, /api\.twilio\.com\/2010-04-01\/Accounts\/AC0+\/Messages\.json$/);
const body = new URLSearchParams(request.options.body);
assert.equal(body.get("To"), "+447700900111");
assert.equal(body.get("Body"), "HALO Agent Council: done\nHealth 82/100");
assert.deepEqual(await sendOwnerSms("x", { env: {} }), { sent: false, configured: false });
assert.equal((await textDailyCheck("X", { status: "failed", env, fetchImpl: async () => { throw new Error("down"); } })).sent, false);
assert.ok(dailyCheckSmsText({ check: "X", lines: ["y".repeat(900)] }).length <= 320);
console.log("Daily check SMS contracts passed");
