import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { RELEASE_STAGES, runReleaseConveyor, validateRelease, releaseFingerprint } from "../netlify/lib/release-conveyor.mjs";
import { retryReleaseWork } from "../netlify/lib/release-conveyor-retry.mjs";
import { claimConveyor, conveyorPorts } from "../netlify/lib/release-conveyor-store.mjs";
import { recoverCatalogReleases } from "../netlify/lib/release-conveyor-service.mjs";

const song = { id: "song", owner_member_id: "creator", title: "Signal", artist_name: "Artist",
  genre: "Soul", isrc: "GB-AAA-26-00001", artwork_url: "/cover.jpg",
  lyrics_text: "[00:01] Signal || At dawn", rights_status: "cleared", sale_status: "not_for_sale",
  notes: "Private production notes", metadata_issues: [], updated_at: "2026-10-08T10:00:00Z" };
const versions = ["sale_master", "radio_edit"].map(type => ({
  id: type, song_id: song.id, version_type: type, audio_url: `/${type}.wav`,
  mastering_status: "approved", duration_seconds: 180, updated_at: song.updated_at,
}));
let prepareCalls = 0, handoffs = 0;
const checkpoints = [];
const ports = {
  sleep: async () => {},
  prepareAudio: async () => { prepareCalls++; return { originalPreserved: true, issues: [], repairs: [] }; },
  checkpoint: async state => checkpoints.push(structuredClone(state)),
  finish: async () => {}, assertCurrent: async () => {},
  handoff: async () => { handoffs++; return { status: "ready_for_publication", externalDistribution: "not_submitted" }; },
};
const run = changes => runReleaseConveyor({ song, versions, ports, ...changes });
const ready = await run();
assert.equal(ready.status, "ready");
assert.deepEqual(ready.receipt.passed, RELEASE_STAGES);
assert.equal(ready.package.dreamweaver.lyrics.lines[0].insight, "At dawn");
assert.equal(ready.package.documents.notes, song.notes);
assert(!JSON.stringify(ready.package.promotion).includes(song.notes));
assert.equal(ready.package.handoff.externalDistribution, "not_submitted");
assert(ready.receipt.nextSteps.some(step => step.includes("existing publication controls")));
assert.deepEqual(checkpoints.map(state => state.stages.at(-1).name), RELEASE_STAGES);
assert.equal(ready.sourceUpdatedAt, "2026-10-08T10:00:00.000Z");
const copiedSong = structuredClone(song);
await run({ previous: ready });
assert.equal(prepareCalls, 1);
assert.equal(handoffs, 1);
assert.deepEqual(song, copiedSong, "preparation must not change publication or rights");
const metadataFailure = await run({ song: { ...song, isrc: "" } });
assert.equal(metadataFailure.package.council.outcome, "repair");
assert.equal(metadataFailure.receipt.ready, false);
assert.equal(metadataFailure.package.documents, undefined);
for (const rights of ["", "needs_review", "disputed"]) {
  const blocked = await run({ song: { ...song, rights_status: rights } });
  assert.equal(blocked.receipt.ready, false);
  assert.equal(blocked.package.promotion, undefined);
  assert.equal(blocked.package.council.outcome, rights === "disputed" ? "block" : "escalate");
}
assert(validateRelease(song, [...versions, { ...versions[0], id: "duplicate" }]).issues.some(item => item.field === "catalog"));
assert(validateRelease(song, versions.map(version => ({ ...version, song_id: "foreign" }))).issues.some(item => item.field === "radio_master"));
const unapproved = await run({ versions: versions.map(version => version.version_type === "sale_master" ? { ...version, mastering_status: "review" } : version) });
assert.equal(unapproved.receipt.ready, false, "an audio adapter cannot bypass catalog mastering approval");
assert.equal(unapproved.package.council.outcome, "escalate");
const customCover = await run({ song: { ...song, artwork_url: "" }, versions: versions.map(version => ({ ...version, artwork_url: "/master-cover.jpg" })) });
assert.equal(customCover.package.promotion.artworkUrl, "/master-cover.jpg");

let transientAttempts = 0;
const recovered = await run({ ports: { ...ports, prepareAudio: async () => {
  if (++transientAttempts < 3) throw Object.assign(new Error("private storage details"), { status: 503 });
  return { issues: [], repairs: [], originalPreserved: true };
} } });
assert.equal(recovered.status, "ready");
assert.equal(transientAttempts, 3);
assert.equal(recovered.stages.find(stage => stage.name === "audio_preflight").attempts, 3);
assert(recovered.receipt.repaired.some(repair => repair.includes("transient retries")));
assert(!JSON.stringify(recovered).includes("private storage details"));
let permanentAttempts = 0;
await assert.rejects(retryReleaseWork(async () => {
  permanentAttempts++;
  throw Object.assign(new Error("invalid mapping"), { code: "23505" });
}, { sleep: async () => {} }));
assert.equal(permanentAttempts, 1, "ambiguous uniqueness errors must not blindly overwrite mappings");
let previous;
const failingPorts = { ...ports, handoff: async () => { throw new Error("private database exception"); } };
const beforeFailures = prepareCalls;
for (let attempt = 1; attempt <= 5; attempt++) {
  previous = await run({ previous, ports: failingPorts, automatic: true });
  assert.equal(previous.automaticAttempts, attempt);
  assert.equal(previous.status, attempt === 5 ? "escalated" : "retryable");
  assert.equal(Boolean(previous.receipt.nextRetryAt), attempt < 5);
  if (attempt < 5) previous.nextRetryAt = "2026-01-01T00:00:00Z";
}
assert.equal(prepareCalls, beforeFailures + 1, "durable retries reuse completed audio work");
assert(!JSON.stringify(previous).includes("private database exception"));
let accidentalRuns = 0;
await run({ previous, automatic: true, ports: { ...ports, handoff: async () => { accidentalRuns++; return {}; } } });
assert.equal(accidentalRuns, 0, "incidental catalog review must not restart exhausted recovery");
const manualRecovery = await run({ previous });
assert.equal(manualRecovery.status, "ready");
assert.equal(manualRecovery.automaticAttempts, 0);
const edited = { ...song, updated_at: "2026-10-08T11:00:00Z" };
assert.equal(releaseFingerprint(song, versions), releaseFingerprint(edited, versions));
assert.equal(releaseFingerprint(song, versions), releaseFingerprint(song, versions.map(version => ({ ...version, updated_at: edited.updated_at }))));
const refreshed = await run({ song: edited, previous: ready });
assert.equal(refreshed.sourceUpdatedAt, "2026-10-08T11:00:00.000Z", "capture the input watermark, not the finish time");
const removedVersion = await run({ song: { ...song, source_updated_at: "2026-10-08T12:00:00.123456Z" }, previous: ready });
assert.equal(removedVersion.sourceUpdatedAt, "2026-10-08T12:00:00.123456Z", "inactive version changes and microsecond precision must not cause endless recovery");

let leaseToken, claims = 0;
const claimDb = { async sql(strings, ...values) {
  claims++;
  assert(strings.join("?").includes("lease_token = EXCLUDED.lease_token"));
  if (!leaseToken) {
    leaseToken = values[2];
    throw Object.assign(new Error("claim acknowledgement lost"), { code: "ECONNRESET" });
  }
  assert.equal(values[2], leaseToken);
  return [{ state: {} }];
} };
assert.equal((await claimConveyor(claimDb, song.owner_member_id, song.id)).token, leaseToken);
assert.equal(claims, 2, "claim recovery must not strand a lease with a different token");

// Simulate a lost database acknowledgement after the atomic finish committed.
let savedEvent, writes = 0;
const uncertainDb = { async sql(strings, ...values) {
  const sql = strings.join("?");
  if (sql.includes("WITH checkpoint")) {
    writes++;
    if (!savedEvent) {
      savedEvent = values[7];
      throw Object.assign(new Error("connection lost after commit"), { code: "ECONNRESET" });
    }
    assert.equal(values[7], savedEvent, "retry must preserve the audit event key");
    return [];
  }
  if (sql.includes("SELECT id FROM halo_release_conveyor_events")) {
    assert.equal(values[0], savedEvent);
    assert.equal(values[1], song.id);
    assert.equal(values[2], song.owner_member_id);
    return [{ id: savedEvent }];
  }
  throw new Error(`Unexpected query ${sql}`);
} };
await conveyorPorts(uncertainDb, song.owner_member_id, song.id, "lease", { song, versions }, { humHz: 0 }, ports.prepareAudio).finish(ready);
assert.equal(writes, 2);

let state = null, token = null, audit = [], selector, candidateCalls = 0;
const db = { async sql(strings, ...values) {
  const sql = strings.join("?");
  if (sql.includes("LEFT JOIN halo_release_conveyor")) {
    selector = sql;
    candidateCalls++;
    assert.equal(values.at(-1), 10, "worker batch must be bounded");
    return [{ id: song.id, owner_member_id: song.owner_member_id }];
  }
  if (sql.includes("FROM halo_song_catalog")) return [structuredClone(song)];
  if (sql.includes("FROM halo_song_versions")) return structuredClone(versions);
  if (sql.includes("INSERT INTO halo_release_conveyor (")) {
    token = values[2];
    return [{ state: state || {} }];
  }
  if (sql.includes("WITH checkpoint")) {
    assert.equal(values[6], token);
    state = JSON.parse(values[1]);
    audit.push(values[10]);
    if (values[3]) token = null;
    return [{ id: values[7] }];
  }
  if (sql.includes("SELECT song_id FROM halo_release_conveyor")) return token === values[2] ? [{ song_id: song.id }] : [];
  if (sql.includes("SET lease_token = NULL")) { token = null; return []; }
  throw new Error(`Unexpected query ${sql}`);
} };
const recovery = await recoverCatalogReleases(db, ports.prepareAudio, 200);
assert.deepEqual(recovery, { scanned: 1, results: [{ releaseId: song.id, status: "ready" }] });
assert.equal(state.receipt.ready, true);
assert.equal(state.package.handoff.publicationAction, "existing_catalog_controls");
assert.equal(state.package.handoff.originalMasterPreserved, true);
assert.deepEqual(audit, [...RELEASE_STAGES, "ready"]);
const auditCount = audit.length;
await recoverCatalogReleases(db, ports.prepareAudio);
assert.equal(audit.length, auditCount, "unchanged ready inputs do not append redundant audit events");
assert.match(selector, /nextRetryAt/);
assert.match(selector, /locked_until < NOW/);
assert.match(selector, /sourceUpdatedAt/);
assert(!selector.includes("'blocked', 'escalated'"), "unchanged blocked/escalated releases are not automatic candidates");
assert.equal(candidateCalls, 2);
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
assert.match(await read("netlify/functions/release-conveyor-recover.mjs"), /schedule: "\*\/15 \* \* \* \*"/);
assert.match(await read("netlify/functions/song-catalog.ts"), /automatic recovery will retry/);
assert.match(await read("song-catalog/index.html"), /option value="both"/);
console.log("Automated release pipeline, gates, bounded recovery, durable audit and publication preservation contracts passed");
