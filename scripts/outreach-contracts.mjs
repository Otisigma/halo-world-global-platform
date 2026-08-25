import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OUTREACH_CRITIC,
  OUTREACH_MODEL,
  OUTREACH_ROLES,
  buildOutreachSignalIndex,
  groundPitch,
  scoreTargetFit
} from "../netlify/lib/outreach.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The roster. Four working seats and a critic that is not one of them, so the thing reviewing the
// approaches is never the same thing that wrote them.
assert.deepEqual(Object.keys(OUTREACH_ROLES).sort(), ["angle", "cadence", "pen", "prospect"]);
assert.equal(OUTREACH_CRITIC.key, "ledger");
assert.ok(!Object.hasOwn(OUTREACH_ROLES, "ledger"), "the critic must not review its own draft");
for (const [key, role] of Object.entries(OUTREACH_ROLES)) {
  assert.ok(role.name && role.title && role.mission, `${key} needs a name, title, and mission`);
}
assert.ok(OUTREACH_MODEL.startsWith("gpt-"), "the desk must name the model it runs on");

const baseTarget = Object.freeze({
  id: "test-station",
  kind: "radio",
  name: "Alex Fen",
  organisation: "Night Signal FM",
  territory: "United Kingdom",
  genres: ["house", "techno"],
  tempo_min: 118,
  tempo_max: 130,
  contact_status: "active",
  min_days_between_contacts: 45,
  last_contacted_at: null,
  pitches_sent: 0,
  replies: 0,
  placements: 0,
  preferred_channel: "email",
  notes: ""
});

const baseRelease = Object.freeze({
  title: "Ghost To Me",
  artist: "Owen Anthony",
  release_date: "2026-07-31",
  genres: ["house"],
  bpm: 124,
  territory: "United Kingdom",
  official_url: "https://distrokid.com/hyperfollow/owenanthony/ghost-to-me",
  radio_url: "/release-kit.html?audience=radio&slug=ghost-to-me",
  press_url: "",
  dj_url: "/release-kit.html?audience=dj&slug=ghost-to-me"
});

// Fit is computed, so the same inputs must always produce the same number. If this ever stops being
// true the owner can no longer argue with a score before anything is drafted.
const first = scoreTargetFit(baseTarget, baseRelease);
const second = scoreTargetFit(baseTarget, baseRelease);
assert.deepEqual(first, second, "fit scoring must be deterministic");
assert.ok(first.eligible, "a well matched active contact should be eligible");
assert.ok(first.score >= 60, `a strong match should score well, got ${first.score}`);
assert.ok(first.reasons.length, "a score must come with its reasons");

// Eligibility is a gate, never a weighting. A contact who opted out is not a high scoring lead to be
// balanced against other factors — they are simply not contactable.
for (const status of ["opted_out", "bounced", "paused"]) {
  const blocked = scoreTargetFit({ ...baseTarget, contact_status: status }, baseRelease);
  assert.equal(blocked.eligible, false, `a ${status} contact must never be eligible`);
  assert.ok(blocked.blocks.length, `a ${status} contact must say why it was blocked`);
}

// The frequency cap belongs to the contact. Someone who asked for less gets less.
const recentlyContacted = scoreTargetFit({
  ...baseTarget,
  last_contacted_at: new Date(Date.now() - 10 * 86_400_000).toISOString()
}, baseRelease);
assert.equal(recentlyContacted.eligible, false, "a contact inside their own frequency cap must be blocked");

const restedContact = scoreTargetFit({
  ...baseTarget,
  last_contacted_at: new Date(Date.now() - 90 * 86_400_000).toISOString()
}, baseRelease);
assert.equal(restedContact.eligible, true, "a contact past their frequency cap becomes eligible again");

// One pitch per contact per release, checked before anything is drafted as well as in the schema.
const duplicate = scoreTargetFit(baseTarget, baseRelease, { existingPitch: true });
assert.equal(duplicate.eligible, false, "a contact already pitched this release must be blocked");

// A record that is not ready for that audience is not pitched to that audience. Pitching a press
// contact with no press kit is the fastest way to lose them permanently.
const noPressKit = scoreTargetFit({ ...baseTarget, kind: "press" }, baseRelease);
assert.equal(noPressKit.eligible, false, "a press contact must be blocked when there is no press kit");
assert.ok(noPressKit.blocks.some(block => /press kit/i.test(block)), "the block must name the missing asset");

// Unknown is scored neutrally rather than punished, so a thin contact record does not read as a bad
// match. This mirrors how unlabelled keys are handled in radio programming.
const unknownTempo = scoreTargetFit({ ...baseTarget, tempo_min: null, tempo_max: null }, baseRelease);
assert.ok(unknownTempo.reasons.some(reason => /neutrally/i.test(reason)), "unknown tempo must be scored neutrally and said so");

// A contact repeatedly approached with no reply is pushed down rather than silently retried.
const unresponsive = scoreTargetFit({ ...baseTarget, pitches_sent: 4, replies: 0 }, baseRelease);
assert.ok(unresponsive.score < first.score, "an unresponsive contact must score below a fresh one");
assert.ok(unresponsive.reasons.some(reason => /resting/i.test(reason)), "the desk must suggest resting an unresponsive contact");

const signalIndex = buildOutreachSignalIndex(baseRelease, baseTarget, first);
const knownKeys = new Set(Object.keys(signalIndex));
assert.ok(knownKeys.has("release.title"), "the signal index must expose the release title");
assert.ok(knownKeys.has("target.name"), "the signal index must expose the contact");
assert.ok(!knownKeys.has("release.pressUrl"), "an empty value must not become a citable signal");

const goodBody = "Hi Alex, sending Ghost To Me by Owen Anthony — 124 BPM house, which sits inside the tempo range Night Signal FM programmes. The radio kit with the clean edit is linked below if it is useful for the show.";

// The grounding gate. An approach that cites nothing is a form letter, and a form letter is what
// gets a sender blocked.
assert.equal(
  groundPitch({ subject: "New record", body: goodBody, signalKeys: [] }, knownKeys, { target: baseTarget, fit: first }).ok,
  false,
  "an uncited approach must be dropped"
);

assert.equal(
  groundPitch({ subject: "New record", body: goodBody, signalKeys: ["release.invented"] }, knownKeys, { target: baseTarget, fit: first }).ok,
  false,
  "an approach citing a signal that does not exist must be dropped"
);

const accepted = groundPitch(
  { subject: "Ghost To Me — Owen Anthony", body: goodBody, channel: "email", signalKeys: ["release.title", "target.name"] },
  knownKeys,
  { target: baseTarget, fit: first }
);
assert.ok(accepted.ok, "a grounded, specific, named approach must survive the gate");
assert.equal(accepted.pitch.fitScore, first.score, "the stored pitch must carry the computed score, not a claimed one");
assert.ok(accepted.pitch.signalKeys.length, "a surviving approach keeps the signals it cited");

// Claims the platform has no standing to make on an artist's behalf.
for (const phrase of ["guaranteed", "viral", "chart-topping"]) {
  const hyped = groundPitch(
    { subject: "New", body: `Hi Alex, this record is ${phrase} and you should hear it before anyone else does today.`, signalKeys: ["release.title"] },
    knownKeys,
    { target: baseTarget, fit: first }
  );
  assert.equal(hyped.ok, false, `an approach claiming "${phrase}" must be dropped`);
}

// If the draft would read identically to any other recipient, it is a mailshot wearing a pitch's
// clothes, and the whole point of the desk is that it is not one.
const impersonal = groundPitch(
  { subject: "New record", body: "Hello, sending over a new house record at 124 BPM that might suit the station's evening programming this month.", signalKeys: ["release.title"] },
  knownKeys,
  { target: baseTarget, fit: first }
);
assert.equal(impersonal.ok, false, "an approach that does not address the contact by name must be dropped");

// The gates that matter live in the schema, where no future handler, model, or scheduled job can
// route around them. These assertions exist so a later refactor cannot quietly soften them.
const migration = await readFile(
  resolve(root, "netlify/database/migrations/20260812140000_create-outreach-desk.sql"),
  "utf8"
);

assert.ok(
  migration.includes("CHECK (status NOT IN ('approved', 'sent') OR approved_by_member_id IS NOT NULL)"),
  "the database must refuse an approved or sent approach with no named approver"
);
assert.ok(
  migration.includes("CHECK (status <> 'sent' OR (sent_by_member_id IS NOT NULL AND sent_at IS NOT NULL))"),
  "sending is a human action and must record who and when"
);
assert.ok(
  migration.includes("UNIQUE (release_id, target_id)"),
  "one approach per contact per release must be enforced by the database"
);
assert.ok(
  migration.includes("CHECK (cardinality(signal_keys) BETWEEN 1 AND 8)"),
  "the database must refuse an approach that cites nothing"
);
assert.ok(
  migration.includes("CHECK (char_length(source_note) BETWEEN 4 AND 300)"),
  "a contact must not be storable without recorded provenance"
);
assert.ok(
  migration.includes("CHECK (contact_status <> 'opted_out' OR opted_out_at IS NOT NULL)"),
  "an opt-out must carry the moment it happened"
);
assert.ok(
  migration.includes("CHECK (contact_email <> '' OR contact_url <> '')"),
  "a target needs somewhere to actually reach them"
);

// Contact details for real people are not something to invent. An empty desk is correct; a desk
// pre-filled with plausible-looking addresses would eventually be sent to.
assert.ok(
  !/INSERT\s+INTO\s+halo_outreach_targets/i.test(migration),
  "no outreach targets may be seeded — real contact details are never invented"
);

const deskFunction = await readFile(resolve(root, "netlify/functions/outreach-desk.mjs"), "utf8");
assert.ok(deskFunction.includes("isOwner"), "the outreach desk must be owner-only");
assert.ok(deskFunction.includes("verifyRequestOrigin"), "the outreach desk must verify request origin");
assert.ok(
  deskFunction.includes("t.contact_status = 'active'"),
  "approval must re-check the contact's status inside the statement"
);
assert.ok(
  /status = 'archived'[\s\S]{0,200}WHERE target_id/.test(deskFunction),
  "an opt-out must withdraw anything still queued for that contact"
);

const scheduled = await readFile(resolve(root, "netlify/functions/outreach-weekly.mjs"), "utf8");
assert.ok(scheduled.includes("schedule:"), "the weekly desk run must declare a schedule");
assert.ok(
  !/sendMail|nodemailer|smtp|sendgrid|postmark|resend\./i.test(deskFunction + scheduled),
  "HALO holds no mail credentials and must never send on anyone's behalf"
);

console.log("outreach contracts ok");
