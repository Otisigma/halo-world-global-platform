import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { createReleaseHouseHandler } from "../netlify/functions/release-house.mjs";
import { createReleaseHouseReviewHandler } from "../netlify/functions/release-house-review.mjs";
import {
  RIGHTS_ATTESTATION, SUBMISSION_PATHWAYS, SUBMISSION_TERMS, submissionPolicy, validateSmartLink, validateSubmission
} from "../netlify/lib/release-house-submission.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const [page, script, styles, api, lib, migration, packageJson] = await Promise.all([
  read("release-house/index.html"),
  read("release-house/release-house.js"),
  read("release-house/release-house.css"),
  read("netlify/functions/release-house.mjs"),
  read("netlify/lib/release-house-submission.mjs"),
  read("netlify/database/migrations/20261028010000_release_house_submissions.sql"),
  read("package.json")
]);

let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const membership = { member_id: "member-a", display_name: "Artist A" };

function fakeDatabase({ missingSubmissions = false } = {}) {
  const queries = [];
  const submissions = [];
  const projects = [{ id: PROJECT_ID, owner_member_id: "member-a", status: "active" }, { id: OTHER_PROJECT_ID, owner_member_id: "member-b", status: "active" }];
  const db = {
    queries,
    submissions,
    sql: async (strings, ...values) => {
      const text = strings.join("?");
      queries.push({ text, values });
      assert.doesNotMatch(text, /halo_release_campaigns\s+SET|INSERT INTO halo_release_campaigns|halo_song_catalog|halo_radio_tracks\s+SET|INSERT INTO halo_radio_tracks|halo_song_publication/i,
        "submissions must not write catalog, radio or publication records");
      if (missingSubmissions && text.includes("halo_release_house_submissions")) {
        throw Object.assign(new Error('relation "halo_release_house_submissions" does not exist'), { code: "42P01" });
      }
      if (text.includes("FROM halo_release_house_projects project")) return [];
      if (text.includes("SELECT id FROM halo_release_house_projects")) {
        const [id, owner] = values;
        return projects.filter(project => project.id === id && project.owner_member_id === owner && project.status !== "archived").map(({ id: projectId }) => ({ id: projectId }));
      }
      if (text.includes("INSERT INTO halo_release_house_submissions")) {
        const [id, projectId, ownerMemberId, pathway, artistName, trackTitle, smartLinkUrl, attestationVersion, termsVersion] = values;
        if (submissions.some(row => row.project_id === projectId && row.status === "pending_review")) return [];
        const now = new Date("2026-10-28T00:00:00Z");
        const row = { id, project_id: projectId, owner_member_id: ownerMemberId, pathway, artist_name: artistName, track_title: trackTitle,
          smart_link_url: smartLinkUrl, rights_attestation_version: attestationVersion, rights_attested_at: now, terms_version: termsVersion,
          status: "pending_review", created_at: now, updated_at: now };
        submissions.push(row);
        return [row];
      }
      if (text.includes("UPDATE halo_release_house_submissions")) {
        const [id, owner] = values;
        const row = submissions.find(item => item.id === id && item.owner_member_id === owner && item.status === "pending_review");
        if (!row) return [];
        row.status = "withdrawn";
        return [row];
      }
      if (text.includes("FROM halo_release_house_submissions")) return submissions.filter(row => row.owner_member_id === values[0]);
      throw new Error(`Unexpected query: ${text}`);
    }
  };
  return db;
}

function handlerFor(db, { user = { id: "user-a" }, originOk = true } = {}) {
  return createReleaseHouseHandler({
    database: async () => db,
    currentUser: async () => user,
    verifyOrigin: () => { if (!originOk) throw new Error("cross-origin"); },
    membershipFor: async () => membership
  });
}

const post = body => new Request("https://halo.example/api/release-house", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
});
const validSubmission = (overrides = {}) => ({
  action: "submit", projectId: PROJECT_ID, pathway: "independent_discovery", artistName: "Owen Anthony",
  trackTitle: "The Cold Is Lasting Longer", smartLinkUrl: "https://distrokid.com/hyperfollow/owenanthony/blessed",
  rightsAttested: true, attestationVersion: RIGHTS_ATTESTATION.version, ...overrides
});

await check("pathway validation accepts only the two review pathways", async () => {
  assert.deepEqual(Object.keys(SUBMISSION_PATHWAYS).sort(), ["halo_catalog_review", "independent_discovery"]);
  for (const pathway of ["", "halo_managed_rights", "master_assignment", "__proto__", "toString", null]) {
    const result = validateSubmission(validSubmission({ pathway }));
    assert.equal(result.ok, false, `rejects pathway ${pathway}`);
    assert.ok(result.errors.pathway);
  }
  assert.equal(validateSubmission(validSubmission({ pathway: "halo_catalog_review" })).ok, true);
  assert.match(migration, /CHECK \(pathway IN \('halo_catalog_review', 'independent_discovery'\)\)/);
});

await check("pathway copy never claims HALO owns, administers or receives rights", async () => {
  for (const pathway of Object.values(SUBMISSION_PATHWAYS)) {
    const copy = `${pathway.label} ${pathway.summary} ${pathway.boundary}`.toLowerCase();
    assert.match(copy, /does not transfer/);
    assert.doesNotMatch(copy, /halo (owns|administers|controls) (your|the) master|zero liability|indemnif|waive/);
  }
  assert.match(SUBMISSION_PATHWAYS.halo_catalog_review.boundary, /separate written agreement/);
  assert.match(SUBMISSION_PATHWAYS.halo_catalog_review.label, /catalog review/i);
  const ui = `${page}\n${script}`.toLowerCase();
  assert.doesNotMatch(ui, /zero liability|indemnif|signal successfully registered|halo owns your master|no copyright (protection|enforcement)/);
  assert.ok(page.includes("does not transfer rights, grant a licence, or authorise distribution"));
});

await check("rights attestation is required and pinned to the current server version", async () => {
  assert.ok(validateSubmission(validSubmission({ rightsAttested: false })).errors.rightsAttested);
  assert.ok(validateSubmission(validSubmission({ rightsAttested: "true" })).errors.rightsAttested);
  assert.ok(validateSubmission(validSubmission({ attestationVersion: "old" })).errors.rightsAttested);
  assert.match(RIGHTS_ATTESTATION.text, /does not transfer any rights to HALO/);
});

await check("unapproved terms are never fabricated as accepted", async () => {
  assert.equal(SUBMISSION_TERMS.status, "counsel_review_required");
  assert.equal(SUBMISSION_TERMS.version, null);
  assert.equal(SUBMISSION_TERMS.url, null);
  const claimed = validateSubmission(validSubmission({ termsVersion: "2026-10" }));
  assert.equal(claimed.ok, false);
  assert.match(claimed.errors.terms, /No approved submission terms/);
  assert.equal(validateSubmission(validSubmission()).value.termsVersion, null);
  const approved = { status: "approved", version: "v1", url: "/terms/" };
  assert.ok(validateSubmission(validSubmission(), { terms: approved }).errors.terms, "approved terms require explicit acceptance");
  assert.equal(validateSubmission(validSubmission({ termsVersion: "v1" }), { terms: approved }).value.termsVersion, "v1");
  assert.ok(validateSubmission(validSubmission({ termsVersion: "old" }), { terms: approved }).errors.terms);
  for (const terms of [{ ...approved, version: null }, { ...approved, url: null }]) {
    assert.equal(validateSubmission(validSubmission({ termsVersion: terms.version }), { terms }).ok, false,
      "an incomplete approved terms policy must fail closed");
  }
  assert.ok(validateSubmission(validSubmission({ termsVersion: "v1" }), {
    terms: { ...approved, status: "counsel_review_required" }
  }).errors.terms, "a version alone is not counsel approval");
  assert.ok(script.includes("Submission terms: awaiting legal review.") && script.includes("termsAreApproved"));
});

await check("UI requires confirmed storage availability and never enables unapproved terms", async () => {
  const controls = [{ disabled: false }, { disabled: false }];
  const submission = Object.fromEntries([
    "submissionAvailability", "submissionForm", "submissionRecord", "submissionPathwayOptions",
    "submissionArtist", "submissionTrack", "submissionSmartLink", "submissionAttest",
    "submissionAttestText", "submissionTerms"
  ].map(id => [id, {}]));
  submission.submissionSubmit = controls[1];
  submission.submissionForm.querySelectorAll = () => controls;
  const state = {
    policyLoaded: true, authenticated: true, submitting: false,
    current: { id: PROJECT_ID }, policy: { ...submissionPolicy() }
  };
  const context = {
    state, submission, escapeHtml: value => String(value),
    submissionDraftFor: () => ({ artistName: "Artist", trackTitle: "Track", smartLinkUrl: "", attested: false })
  };
  const ui = script.slice(script.indexOf("function termsAreApproved()"), script.indexOf("function formatDateTime("));
  runInNewContext(ui, context);
  for (const available of [undefined, null, false, "true", true]) {
    state.policy.available = available;
    const ready = runInNewContext("renderSubmission(); submissionAvailability().ready", context);
    assert.equal(ready, available === true);
    assert.ok(controls.every(control => control.disabled === !ready));
    assert.doesNotMatch(submission.submissionTerms.innerHTML, /data-submission-terms|type="checkbox"/);
    assert.match(submission.submissionTerms.innerHTML, /awaiting legal review/);
  }
  for (const overrides of [
    { policyLoaded: false }, { authenticated: false }, { current: { id: "guest" } }, { current: { id: "sample" } }
  ]) {
    const original = { ...state };
    Object.assign(state, overrides);
    assert.equal(runInNewContext("renderSubmission(); submissionAvailability().ready", context), false);
    assert.ok(controls.every(control => control.disabled));
    Object.assign(state, original);
  }
});

await check("smart links are HTTPS allowlisted references and suspicious URLs are rejected", async () => {
  for (const url of [
    "https://distrokid.com/hyperfollow/owenanthony/blessed",
    "https://ffm.to/my-release",
    "https://artist.lnk.to/single",
    ""
  ]) assert.equal(validateSmartLink(url).ok, true, url);
  for (const url of [
    "http://distrokid.com/hyperfollow/a/b",
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://distrokid.com.evil.example/hyperfollow/a/b",
    "https://evildistrokid.com/hyperfollow/a/b",
    "https://distrokid.com/dashboard",
    ["https:", "", ["user", "pw"].join(":") + "@ffm.to", "x"].join("/"),
    "https://ffm.to:8443/x",
    "https://127.0.0.1/hyperfollow/a/b",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "//ffm.to/x",
    "https://ffm.to/a b",
    "https://ffm.to\\@evil.example/",
    `https://ffm.to/${"a".repeat(600)}`,
    `https://lnk.to/${"é".repeat(480)}`
  ]) assert.equal(validateSmartLink(url).ok, false, url);
  assert.doesNotMatch(lib, /\bfetch\(|scoutHyperFollow|Response\.redirect/, "submission links are never fetched or redirected");
  assert.doesNotMatch(api, /scoutHyperFollow|Response\.redirect/);
  assert.match(migration, /smart_link_url LIKE 'https:\/\/%'/);
});

await check("metadata is required, bounded and cleaned", async () => {
  assert.ok(validateSubmission(validSubmission({ artistName: "   " })).errors.artistName);
  assert.ok(validateSubmission(validSubmission({ trackTitle: "" })).errors.trackTitle);
  assert.ok(validateSubmission(validSubmission({ artistName: "a".repeat(121) })).errors.artistName);
  assert.ok(validateSubmission(validSubmission({ trackTitle: "t".repeat(161) })).errors.trackTitle);
  assert.ok(validateSubmission(validSubmission({ projectId: "../etc" })).errors.projectId);
  assert.equal(validateSubmission(validSubmission({ artistName: "  Owen\u0000  Anthony " })).value.artistName, "Owen Anthony");
});

await check("unauthenticated and cross-origin submissions are refused before any database work", async () => {
  const db = fakeDatabase();
  let touched = false;
  const guest = createReleaseHouseHandler({
    database: async () => { touched = true; return db; },
    currentUser: async () => null,
    verifyOrigin: () => {},
    membershipFor: async () => { touched = true; return membership; }
  });
  const guestResponse = await guest(post(validSubmission()));
  assert.equal(guestResponse.status, 401);
  assert.equal(touched, false);
  const guestGet = await (await guest(new Request("https://halo.example/api/release-house"))).json();
  assert.equal(guestGet.authenticated, false);
  assert.equal(guestGet.submissionPolicy.terms.status, "counsel_review_required");

  const crossOrigin = await handlerFor(db, { originOk: false })(post(validSubmission()));
  assert.equal(crossOrigin.status, 403);
  assert.equal(db.queries.length, 0);
});

await check("valid submissions persist through the authenticated API and return the stored record", async () => {
  const db = fakeDatabase();
  const handler = handlerFor(db);
  const response = await handler(post(validSubmission()));
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(db.submissions.length, 1);
  assert.equal(data.submission.id, db.submissions[0].id);
  assert.equal(data.submission.status, "pending_review");
  assert.equal(data.submission.pathway, "independent_discovery");
  assert.equal(data.submission.termsVersion, null);
  assert.equal(data.submission.attestationVersion, RIGHTS_ATTESTATION.version);
  assert.match(data.message, /approvals still apply/);
  assert.equal(db.submissions[0].owner_member_id, "member-a");

  const duplicate = await handler(post(validSubmission()));
  assert.equal(duplicate.status, 409);
  assert.equal(db.submissions.length, 1);

  const listed = await (await handler(new Request("https://halo.example/api/release-house"))).json();
  assert.equal(listed.submissionPolicy.available, true);

  const withdrawn = await handler(post({ action: "withdrawSubmission", submissionId: data.submission.id }));
  assert.equal(withdrawn.status, 200);
  assert.equal((await withdrawn.json()).submission.status, "withdrawn");
  assert.equal((await handler(post(validSubmission()))).status, 201, "a withdrawn submission can be resubmitted");
});

await check("both pathways store only review metadata without fetching links or accepting client privileges", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Submission links must never be fetched"); };
  try {
    for (const pathway of Object.keys(SUBMISSION_PATHWAYS)) {
      const db = fakeDatabase();
      const response = await handlerFor(db)(post(validSubmission({
        pathway, ownerMemberId: "member-b", status: "approved", role: "admin",
        isrc: "unverified", upc: "unverified", masterRights: "halo", publish: true
      })));
      assert.equal(response.status, 201);
      const { submission } = await response.json();
      assert.equal(submission.status, "pending_review");
      assert.equal(db.submissions[0].owner_member_id, membership.member_id);
      assert.equal(submission.termsVersion, null);
      for (const field of ["isrc", "upc", "masterRights", "publish", "role"]) {
        assert.equal(Object.hasOwn(submission, field), false);
      }
      assert.equal(db.queries.filter(({ text }) => /INSERT INTO|UPDATE/i.test(text)).length, 1);
      assert.match(db.queries.find(({ text }) => /INSERT INTO/i.test(text)).text, /INSERT INTO halo_release_house_submissions/);
      const forbidden = await handlerFor(db)(post({ action: "approveSubmission", submissionId: submission.id, role: "admin" }));
      assert.equal(forbidden.status, 400, "client claims must not enable an unsupported staff action");
      assert.equal(db.submissions[0].status, "pending_review");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await check("invalid submissions and other members' projects are not recorded", async () => {
  const db = fakeDatabase();
  const handler = handlerFor(db);
  const invalid = await handler(post(validSubmission({ smartLinkUrl: "https://169.254.169.254/", rightsAttested: false, pathway: "rights_transfer" })));
  assert.equal(invalid.status, 400);
  const body = await invalid.json();
  assert.ok(body.errors.smartLinkUrl && body.errors.rightsAttested && body.errors.pathway);
  const foreign = await handler(post(validSubmission({ projectId: OTHER_PROJECT_ID })));
  assert.equal(foreign.status, 404);
  assert.equal(db.submissions.length, 0);
  const foreignWithdraw = await handler(post({ action: "withdrawSubmission", submissionId: PROJECT_ID }));
  assert.equal(foreignWithdraw.status, 404);
});

await check("an unmigrated deployment discloses that nothing was recorded", async () => {
  const db = fakeDatabase({ missingSubmissions: true });
  const handler = handlerFor(db);
  const response = await handler(post(validSubmission()));
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.code, "submissions_unavailable");
  assert.match(data.message, /Nothing was recorded/);
  assert.equal(data.submission, undefined);
  const listed = await (await handler(new Request("https://halo.example/api/release-house"))).json();
  assert.equal(listed.submissionPolicy.available, false);
  const withdrawn = await handler(post({ action: "withdrawSubmission", submissionId: PROJECT_ID }));
  assert.equal(withdrawn.status, 503);
  assert.equal((await withdrawn.json()).code, "submissions_unavailable");
  assert.ok(script.includes("Release submissions are not set up on this deployment yet"));
});

await check("UI success state follows the persisted API response only", async () => {
  assert.match(script, /response\.status === 201 && data\.submission\?\.id && data\.submission\.status === "pending_review"/);
  assert.ok(script.includes("Nothing was submitted."));
  assert.ok(script.includes('setAttribute("aria-busy", "true")'));
  assert.ok(script.includes("No rights were transferred and nothing was published or distributed"));
  assert.ok(page.includes('id="submissionStatus" role="status"') && page.includes('aria-describedby="submissionSmartLinkHelp submissionSmartLinkError"'));
  assert.ok(page.includes("<legend>Submission pathway</legend>"));
  assert.ok(page.includes("ISRC and UPC are not extracted or assigned from this link."));
  assert.ok(page.includes("unverified reference only"));
  for (const copy of [page, script]) assert.ok(copy.includes("not entry into active signal or radio rotation") ||
    copy.includes("not approval, a discovery listing, or entry into active signal or radio rotation"));
  assert.ok(page.includes("No review timeframe is promised."));
  assert.ok(script.includes('setAttribute("aria-invalid"'));
  assert.ok(styles.includes(".submission-desk") && styles.includes(".submission-fields { grid-template-columns: 1fr; }"));
});

await check("submissions never bypass existing release approvals", async () => {
  assert.doesNotMatch(lib, /halo_release_campaigns|halo_song_catalog|halo_radio_tracks|halo_song_publication|rights_status|mastering_status|pipeline_status/i);
  assert.doesNotMatch(migration, /halo_release_campaigns|halo_song_catalog|rights_status|(?:^|;\s*)(?:DROP|TRUNCATE|DELETE|UPDATE)\s/im);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_release_house_submissions/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS halo_release_house_submissions_pending_idx/);
  const policy = submissionPolicy();
  assert.deepEqual(policy.smartLinkHosts, ["distrokid.com", "hyperfollow.com", "ffm.to", "lnk.to", "found.ee", "linktr.ee"]);
  assert.ok(packageJson.includes("node scripts/release-house-submission-contracts.mjs"));
});

await check("staff review refuses guests, members and client-controlled roles before database access", async () => {
  for (const user of [null, { id: "member" }, { id: "member", userMetadata: { roles: ["admin"] } }]) {
    const handler = createReleaseHouseReviewHandler({
      currentUser: async () => user,
      database: async () => { throw new Error("Unauthorized database access"); }
    });
    for (const request of [new Request("https://halo.example/api/release-house-review"), post({ role: "admin" })]) {
      const response = await handler(request);
      assert.equal(response.status, user ? 403 : 401);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  }
  const handler = createReleaseHouseReviewHandler({
    currentUser: async () => ({ id: "staff", appMetadata: { roles: ["admin"] } }),
    verifyOrigin: () => { throw new Error("Cross-origin"); },
    database: async () => { throw new Error("Cross-origin database access"); }
  });
  assert.equal((await handler(post({ action: "note" }))).status, 403);
});

await check("staff notes are authenticated append-only audit entries, never approval or publication", async () => {
  const submissionDb = fakeDatabase();
  await handlerFor(submissionDb)(post(validSubmission()));
  const record = submissionDb.submissions[0];
  const notes = [];
  const queries = [];
  let missing = false;
  const db = { sql: async (strings, ...values) => {
    const text = strings.join("?");
    queries.push(text);
    assert.doesNotMatch(text, /\bUPDATE\b|\bDELETE\b|halo_song|halo_radio|halo_release_campaigns/i);
    if (missing) throw Object.assign(new Error("Missing review storage"), { code: "42P01" });
    if (text.includes("INSERT INTO halo_release_house_review_notes")) {
      const [id, reviewer, action, note, submissionId] = values;
      assert.match(text, /status = 'pending_review'/);
      if (submissionId !== record.id || record.status !== "pending_review") return [];
      const row = { id, submission_id: submissionId, reviewer_member_id: reviewer, action, note, created_at: new Date().toISOString() };
      notes.push(row);
      return [row];
    }
    assert.match(text, /LIMIT 20/);
    assert.match(text, /LIMIT 50/);
    assert.match(text, /submission.status = 'pending_review'/);
    return [{ ...record, review_history: notes }];
  }};
  const handler = createReleaseHouseReviewHandler({
    currentUser: async () => ({ id: "staff", app_metadata: { roles: ["owner"] } }),
    verifyOrigin: () => {}, database: async () => db,
    membershipFor: async () => ({ member_id: "staff-member" })
  });
  const request = overrides => post({ submissionId: record.id, action: "note", note: "Check supporting credits.", ...overrides });
  for (const overrides of [
    { action: "approve" }, { action: "publish" }, { action: "license" }, { note: "" },
    { note: "x".repeat(2001) }, { submissionId: "../other" }
  ]) assert.equal((await handler(request(overrides))).status, 400);
  assert.equal((await handler(request({ note: "x".repeat(13000) }))).status, 413);
  assert.equal(queries.length, 0, "invalid requests do not touch storage");
  for (const action of ["note", "follow_up_needed"]) {
    const response = await handler(request({ action, reviewerMemberId: "spoofed", status: "approved" }));
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.review.reviewer_member_id, "staff-member");
    assert.match(body.message, /no artist notification was sent/);
    assert.equal(record.status, "pending_review");
  }
  const listed = await (await handler(new Request("https://halo.example/api/release-house-review"))).json();
  assert.equal(listed.submissions[0].reviews.length, 2);
  assert.equal(listed.submissions[0].status, "pending_review");
  record.status = "withdrawn";
  assert.equal((await handler(request({}))).status, 404);
  assert.equal(notes.length, 2);
  missing = true;
  for (const req of [new Request("https://halo.example/api/release-house-review"), request({})]) {
    const response = await handler(req);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "review_unavailable");
  }
});

await check("staff migration and UI preserve restricted internal-only review boundaries", async () => {
  const [reviewMigration, reviewApi, reviewPage, reviewScript] = await Promise.all([
    read("netlify/database/migrations/20261028020000_release_house_review_notes.sql"),
    read("netlify/functions/release-house-review.mjs"), read("release-house/review.html"), read("release-house/review.js")
  ]);
  assert.match(reviewMigration, /CREATE TABLE IF NOT EXISTS halo_release_house_review_notes/);
  assert.match(reviewMigration, /reviewer_member_id TEXT NOT NULL REFERENCES halo_memberships/);
  assert.match(reviewMigration, /CHECK \(action IN \('note', 'follow_up_needed'\)\)/);
  assert.match(reviewMigration, /created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.doesNotMatch(`${reviewMigration}\n${reviewApi}`, /\b(?:UPDATE|DELETE|TRUNCATE|DROP)\s|halo_release_campaigns|halo_song_catalog|halo_radio_tracks|halo_song_publication/i);
  assert.doesNotMatch(reviewApi, /\bfetch\s*\(/);
  assert.ok(reviewPage.includes('id="reviewForm" hidden'));
  assert.ok(reviewPage.includes("apply the submission migration, then the review-note migration"));
  assert.ok(reviewPage.includes("Legal terms remain blocked on qualified counsel"));
  assert.match(reviewScript, /response.status === 201 && data.review\?\.id/);
  assert.doesNotMatch(reviewScript, /innerHTML|window\.open|location\.href/);
  assert.match(reviewScript, /\[401, 403, 503\]/);
});

console.log(`Release House submission contracts: ${checks}/${checks} checks passed.`);
