import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  HANDOFF_TRACKED_VERSION_TYPES,
  RADIO_HANDOFF_VERSION_TYPES,
  describeRadioHandoff,
  runRadioHandoff,
} from "../netlify/lib/radio-handoff.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [publication, catalogApi, unifiedUpload, audioApi, masterUploadApi, radioAudio, musicUpload, songCatalogClient] = await Promise.all([
  read("netlify/lib/song-publication.mjs"),
  read("netlify/functions/song-catalog.ts"),
  read("netlify/functions/unified-upload.mjs"),
  read("netlify/functions/song-catalog-audio.ts"),
  read("netlify/functions/song-catalog-master-upload.ts"),
  read("netlify/functions/radio-audio.mjs"),
  read("music-upload/music-upload.js"),
  read("song-catalog/song-catalog.js"),
]);

// Version model: every new master project provisions sale_master, radio_edit, clean, and demo rows.
for (const versionType of HANDOFF_TRACKED_VERSION_TYPES) {
  assert.match(unifiedUpload, new RegExp(`versionType: "${versionType}"`), `unified upload must provision ${versionType}`);
  assert.match(catalogApi, new RegExp(`\\b${versionType}: \\{ label:`), `song catalog VERSION_ROUTES must define ${versionType}`);
}
assert.match(catalogApi, /radio_edit: \{[^}]*destination: "radio"/, "radio_edit must route to radio");
assert.match(catalogApi, /clean: \{[^}]*destination: "radio"/, "clean must route to radio");
assert.match(catalogApi, /demo: \{[^}]*destination: "archive"/, "demo must stay archived, not broadcast");

// Radio rotation intentionally broadcasts only dedicated radio versions, never the sale master.
assert.match(publication, /const RADIO_VERSION_PRIORITY = \["radio_edit", "clean"\];/);
assert.deepEqual([...RADIO_HANDOFF_VERSION_TYPES], ["radio_edit", "clean"], "handoff types must mirror RADIO_VERSION_PRIORITY");
assert.match(publication, /if \(!rows\[0\] \|\| rows\[0\]\.pipeline_status !== "published"\) return null;/, "radio fan-out stays gated on publication");

// Upload endpoints must report the handoff after persistence, using the owner's actor for the ledger.
for (const [name, source] of [["audio finalize", audioApi], ["direct master register", masterUploadApi]]) {
  assert.match(source, /import \{ runRadioHandoff \} from "\.\.\/lib\/radio-handoff\.mjs";/, `${name} must import the radio handoff`);
  assert.match(source, /const radioHandoff = await runRadioHandoff\(db, \{ songId, ownerMemberId, actorId \}\);/, `${name} must run the radio handoff`);
  assert.match(source, /persisted: true,[\s\S]*radioHandoff,/, `${name} must return radioHandoff feedback`);
  assert.match(source, /membership\.member_id, membership\.actor_id\)/, `${name} must pass the member actor id`);
}

// Radio playback must stream catalog-sourced rotation tracks from the catalog blob store.
assert.match(radioAudio, /getStore\(\{ name: "halo-song-catalog-audio"/, "radio audio must be able to read catalog blobs");
assert.match(radioAudio, /SELECT blob_key, chunk_count, content_type, byte_size, status, master_song_id/);
assert.match(radioAudio, /chunkBytes: catalogFirstPart\.byteLength/, "catalog chunk size must be derived, not assumed to be 3 MB");

// Clients surface the handoff feedback.
assert.match(musicUpload, /radioHandoff: finalized\.radioHandoff \|\| null/);
assert.match(musicUpload, /<span>Radio handoff<\/span>/);
assert.match(songCatalogClient, /Radio handoff: \$\{data\.radioHandoff\.message\}/);

// Behavioural contract for describeRadioHandoff.
const song = (overrides = {}) => ({ id: "song", pipeline_status: "dreamweaver_in_progress", rights_status: "cleared", ...overrides });
const version = (version_type, overrides = {}) => ({ version_type, audio_url: "", audio_blob_prefix: "", mastering_status: "not_started", ...overrides });
const uploaded = (version_type, overrides = {}) => version(version_type, {
  audio_url: `/api/song-catalog/audio?versionId=${version_type}`, audio_blob_prefix: `owner/${version_type}/upload/parts/`, ...overrides,
});
const defaults = ["sale_master", "radio_edit", "clean", "demo"].map(type => version(type));

{
  const handoff = describeRadioHandoff({ song: song(), versions: defaults });
  assert.equal(handoff.status, "awaiting_master");
  assert.equal(handoff.routed, false);
  assert.ok(handoff.blockers.some(item => item.includes("Sale master audio")));
}
{
  const handoff = describeRadioHandoff({ song: song(), versions: [uploaded("sale_master"), version("radio_edit"), version("clean"), version("demo")] });
  assert.equal(handoff.status, "awaiting_radio_version", "master-only upload must explain the missing radio version");
  assert.equal(handoff.versions.sale_master.hasAudio, true);
  assert.equal(handoff.versions.radio_edit.provisioned, true);
  assert.equal(handoff.versions.clean.provisioned, true);
  assert.equal(handoff.versions.demo.provisioned, true);
  assert.ok(handoff.manualSteps.some(item => item.includes("never broadcasts the sale master")));
  assert.ok(handoff.manualSteps.some(item => item.includes("Publish the song")));
}
{
  const handoff = describeRadioHandoff({ song: song(), versions: [uploaded("sale_master"), version("radio_edit"), uploaded("clean", { audio_blob_prefix: "", mastering_status: "approved" })] });
  assert.ok(handoff.blockers.some(item => item.includes("direct object storage")), "direct-storage radio audio is not streamable");
}
{
  const handoff = describeRadioHandoff({ song: song(), versions: [uploaded("sale_master"), uploaded("radio_edit", { mastering_status: "approved" })] });
  assert.equal(handoff.status, "awaiting_publication");
  assert.deepEqual(handoff.blockers, ["Publish the song (Upload pipeline → Published, or Force push) to trigger radio fan-out."]);
}
{
  const handoff = describeRadioHandoff({
    song: song({ pipeline_status: "published" }),
    versions: [uploaded("sale_master")],
    sync: { radio_status: "queued", radio_track_id: null, details: { radio: { reason: "radio_master_missing_or_not_uploaded" } } },
  });
  assert.equal(handoff.status, "queued");
  assert.equal(handoff.reason, "radio_master_missing_or_not_uploaded");
}
{
  const handoff = describeRadioHandoff({
    song: song({ pipeline_status: "published" }),
    versions: [uploaded("sale_master"), uploaded("radio_edit", { mastering_status: "approved" })],
    sync: { radio_status: "rotation", radio_track_id: "track-1", details: {} },
  });
  assert.equal(handoff.status, "in_rotation");
  assert.equal(handoff.routed, true);
  assert.deepEqual(handoff.manualSteps, []);
}
{
  const handoff = describeRadioHandoff({ song: song({ pipeline_status: "published" }), versions: [uploaded("sale_master")], reconcileError: "boom" });
  assert.equal(handoff.status, "error");
  assert.match(handoff.message, /Radio handoff failed: boom/);
}

// runRadioHandoff must never throw: upload success cannot depend on downstream radio fan-out.
{
  const failingDb = { sql: async () => { throw new Error("database offline"); } };
  const originalError = console.error;
  console.error = () => {};
  try {
    const handoff = await runRadioHandoff(failingDb, { songId: "song", ownerMemberId: "owner" });
    assert.equal(handoff.status, "unknown");
    assert.equal(handoff.routed, false);
  } finally {
    console.error = originalError;
  }
}
{
  const queries = [];
  const db = {
    sql: async (strings) => {
      const text = strings.join("?");
      queries.push(text);
      if (text.includes("FROM halo_song_catalog")) return [song()];
      if (text.includes("FROM halo_song_versions")) return [uploaded("sale_master"), version("radio_edit"), version("clean"), version("demo")];
      if (text.includes("FROM halo_song_publication_sync")) return [];
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const handoff = await runRadioHandoff(db, { songId: "song", ownerMemberId: "owner" });
  assert.equal(handoff.status, "awaiting_radio_version");
  assert.ok(!queries.some(text => text.includes("halo_release_campaigns")), "unpublished songs must not trigger publication fan-out");
}

console.log("Radio handoff contracts passed");
