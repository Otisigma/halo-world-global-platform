import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createReleaseHouseHandler } from "../netlify/functions/release-house.mjs";
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
  assert.ok(script.includes("Submission terms: awaiting legal review.") && script.includes("termsAreApproved"));
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
  assert.ok(script.includes("Release submissions are not set up on this deployment yet"));
});

await check("UI success state follows the persisted API response only", async () => {
  assert.match(script, /response\.status === 201 && data\.submission\?\.id && data\.submission\.status === "pending_review"/);
  assert.ok(script.includes("Nothing was submitted."));
  assert.ok(script.includes('setAttribute("aria-busy", "true")'));
  assert.ok(script.includes("No rights were transferred and nothing was published or distributed"));
  assert.ok(page.includes('id="submissionStatus" role="status"') && page.includes('aria-describedby="submissionSmartLinkHelp submissionSmartLinkError"'));
  assert.ok(page.includes("<legend>Submission pathway</legend>"));
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

console.log(`Release House submission contracts: ${checks}/${checks} checks passed.`);
