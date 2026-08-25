import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dailyReportEmailParameters } from "../netlify/lib/halo-x.mjs";

const [scheduled, library, template, docs, packageJson] = await Promise.all([
  readFile(new URL("../netlify/functions/halo-daily-report.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/lib/halo-x.mjs", import.meta.url), "utf8"),
  readFile(new URL("../emails/halo-daily-summary/index.html", import.meta.url), "utf8"),
  readFile(new URL("../HALO_X_ACCESS.md", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

assert.match(scheduled, /schedule: "0 8 \* \* \*"/, "the owner summary must run every 24 hours");
assert.match(scheduled, /sendReportEmail/, "the scheduled report must trigger email delivery");
assert.match(library, /NETLIFY_EMAILS_SECRET/, "email delivery must authenticate with the Netlify Email Integration");
assert.match(library, /HALO_DAILY_REPORT_FROM_EMAIL/, "email delivery must require an authorized sender");
assert.match(library, /emails\/halo-daily-summary/, "email delivery must target the versioned summary template");
assert.match(template, /{{reportDate}}/, "the email template must show the report date");
assert.match(template, /{{uniqueVisitorsToday}}/, "the email template must include audience activity");
assert.match(template, /{{artistProAwaitingReview}}/, "the email template must include actionable lead activity");
assert.match(docs, /Netlify Email Integration/, "owner documentation must explain email delivery setup");

const parameters = dailyReportEmailParameters({
  date: "2026-08-18",
  metrics: {
    totalMembers: "12",
    joinedToday: 2,
    active24h: 7,
    uniqueVisitorsToday: 21,
    artistProAwaitingReview: 3
  }
});
assert.deepEqual(parameters, {
  reportDate: "2026-08-18",
  totalMembers: 12,
  joinedToday: 2,
  active24h: 7,
  onlineNow: 0,
  uniqueVisitorsToday: 21,
  pageViewsToday: 0,
  siteSessionsToday: 0,
  passesRedeemedToday: 0,
  roomMessagesToday: 0,
  roomPinsUpdatedToday: 0,
  supportSignalsToday: 0,
  djSessionsSavedToday: 0,
  artistProLeadsToday: 0,
  artistProAwaitingReview: 3
});

const parsedPackage = JSON.parse(packageJson);
assert.match(parsedPackage.scripts.test, /daily-email-contracts\.mjs/, "daily email contracts must run in the test suite");

console.log("HALO daily email contracts passed.");
