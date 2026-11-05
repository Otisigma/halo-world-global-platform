import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  auditInfrastructureRoutes,
  buildDepartmentDiagnostics,
  buildDreamweaverAssetGraph,
  HALO_MASTER_DEPARTMENTS,
  HALO_MASTER_INTENT,
  prefillMetadataFromHistory,
  queueRadioLane,
  reconcileDreamweaverAssetGraph,
  RADIO_BROADCAST_DEFAULTS,
} from "../netlify/lib/halo-master-orchestrator.mjs";

const song = {
  id: "12345678-1234-4123-8123-123456789012",
  owner_member_id: "creator",
  title: "A Signal",
  artist_name: "Artist",
};

function taggedSql(respond) {
  const calls = [];
  return {
    calls,
    async sql(strings, ...values) {
      const query = strings.join("?");
      calls.push({ query, values });
      return respond(query, values);
    },
  };
}

const radioDb = taggedSql(query => {
  if (query.includes("UPDATE halo_song_versions")) return [{ id: "radio-lane", version_type: "radio_edit" }];
  if (query.includes("SELECT id FROM halo_song_versions")) return [{ id: "sale-master" }];
  throw new Error(`Unexpected radio query: ${query}`);
});
const radio = await queueRadioLane(radioDb, song);
assert.deepEqual(radio, { versionId: "radio-lane", versionType: "radio_edit", created: false });
assert.equal(radioDb.calls.length, 2);
assert.equal(radioDb.calls[1].values[0], RADIO_BROADCAST_DEFAULTS.targetLufs);
assert.equal(radioDb.calls[1].values[1], -10, "the stored tenths value represents -1.0 dBTP");
assert.match(radioDb.calls[1].query, /mastering_status = 'approved'/);
assert.match(radioDb.calls[1].query, /COALESCE\(audio_url, ''\) = ''/);

const noMasterDb = taggedSql(() => []);
assert.equal(await queueRadioLane(noMasterDb, song), null);
assert.equal(noMasterDb.calls.length, 1, "radio is never queued without an approved uploaded sale master");

const insertRadioDb = taggedSql(query => {
  if (query.includes("UPDATE halo_song_versions")) return [];
  if (query.includes("SELECT id FROM halo_song_versions")) return [{ id: "sale-master" }];
  if (query.includes("INSERT INTO halo_song_versions")) return [{ id: "new-radio", version_type: "radio_edit" }];
  throw new Error(`Unexpected radio insert query: ${query}`);
});
assert.deepEqual(await queueRadioLane(insertRadioDb, song), {
  versionId: "new-radio", versionType: "radio_edit", created: true,
});
assert.match(insertRadioDb.calls[2].query, /NOT EXISTS/);
assert.equal(insertRadioDb.calls[2].values[2], RADIO_BROADCAST_DEFAULTS.targetLufs);
assert.equal(insertRadioDb.calls[2].values[3], -10);

const metadataDb = taggedSql(query => {
  if (query.includes("FROM halo_song_catalog")) return [{ genre: "Soul", album_title: "Dawn" }];
  if (query.includes("UPDATE halo_song_catalog")) return [{ id: song.id }];
  throw new Error(`Unexpected metadata query: ${query}`);
});
const metadataRepair = await prefillMetadataFromHistory(metadataDb, song);
assert.equal(metadataRepair.source, "same_owner_exact_artist_title_reviewed_catalog_history");
assert.deepEqual(metadataRepair.fields, ["genre", "album_title"]);
assert.equal(metadataRepair.rightsStatusChanged, false);
assert.equal(metadataRepair.isrcCopied, false);
assert.match(metadataDb.calls[0].query, /owner_member_id = \?/);
assert.match(metadataDb.calls[0].query, /metadata_status IN \('ready', 'reviewed'\)/);
assert.match(metadataDb.calls[0].query, /rights_status = 'cleared'/);
assert.match(metadataDb.calls[0].query, /LOWER\(TRIM\(artist_name\)\)/);
assert.doesNotMatch(metadataDb.calls[1].query, /rights_status\s*=|isrc\s*=/i);
assert.match(metadataDb.calls[1].query, /COALESCE\(NULLIF\(genre, ''\)/);

const noHistoryDb = taggedSql(() => []);
assert.equal(await prefillMetadataFromHistory(noHistoryDb, song), null);
assert.equal(noHistoryDb.calls.length, 1);

const graphVersions = [
  { id: "version-1", artwork_url: "https://cdn.example/a-signal-alt.jpg", video_url: "https://cdn.example/loop.mp4" },
  { id: "bad", video_url: "javascript:alert(1)" },
];
const graph = buildDreamweaverAssetGraph({ ...song, artwork_url: "/covers/a-signal.jpg" }, graphVersions);
assert.equal(graph.locked, true);
assert.deepEqual(graph.assets.map(asset => asset.kind), ["artwork", "artwork", "video"]);
assert.equal(buildDreamweaverAssetGraph(song, []), null);
const unchangedGraph = reconcileDreamweaverAssetGraph(buildDreamweaverAssetGraph(
  { ...song, artwork_url: "/covers/a-signal.jpg" },
  graphVersions,
), graph);
assert.equal(unchangedGraph.action, null, "a locked graph remains stable when its assets have not changed");
const changedGraph = reconcileDreamweaverAssetGraph(buildDreamweaverAssetGraph(
  { ...song, artwork_url: "/covers/a-signal-new.jpg" }, [],
), graph);
assert.equal(changedGraph.action, "dreamweaver_asset_graph_updated");
assert.equal(changedGraph.graph.assets[0].url, "/covers/a-signal-new.jpg");
assert.equal(reconcileDreamweaverAssetGraph(null, graph).action, "dreamweaver_asset_graph_unlocked");

const diagnostics = buildDepartmentDiagnostics(
  { ...song, pipeline_status: "ready_for_radio", rights_status: "cleared", isrc: "GB-AAA-26-00001" },
  [{ version_type: "sale_master", mastering_status: "approved" }, { version_type: "radio_edit", mastering_status: "queued" }],
  { stages: [{ name: "council", status: "passed" }] },
  graph,
);
assert.equal(diagnostics.audio_preflight, "approved");
assert.equal(diagnostics.metadata_rights, "passed");
assert.equal(diagnostics.council, "passed");
assert.equal(diagnostics.dreamweaver, "locked");
assert.equal(diagnostics.radio, "queued");
assert.deepEqual(HALO_MASTER_DEPARTMENTS.slice(0, 6),
  ["intake", "audio_preflight", "metadata_rights", "council", "dreamweaver", "distribution"]);
assert.match(HALO_MASTER_INTENT.safeguards.join(" "), /Never infer rights clearance/);

const auditedRoutes = await auditInfrastructureRoutes({
  routes: [{ name: "catalog", route: "/song-catalog/" }, { name: "radio", route: "/radio/" }],
  baseUrl: "https://halo.example",
  fetcher: async (url, options) => {
    assert.equal(options.method, "HEAD");
    return { ok: url.pathname === "/song-catalog/", status: url.pathname === "/song-catalog/" ? 200 : 404 };
  },
});
assert.deepEqual(auditedRoutes.map(route => route.status), ["ok", "broken"]);
const unconfiguredRoutes = await auditInfrastructureRoutes({
  routes: [{ name: "console", route: "/halo" }], baseUrl: "http://localhost:8888",
});
assert.equal(unconfiguredRoutes[0].status, "not_configured");

const [schedule, migration, releaseApi, releaseCatalog] = await Promise.all([
  readFile(new URL("../netlify/functions/halo-master-orchestrator.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/database/migrations/20261015133000_create_halo_master_orchestrator.sql", import.meta.url), "utf8"),
  readFile(new URL("../netlify/lib/release-conveyor-http.mjs", import.meta.url), "utf8"),
  readFile(new URL("../netlify/functions/release-catalog.mjs", import.meta.url), "utf8"),
]);
assert.match(schedule, /schedule:\s*"\*\/15 \* \* \* \*"/);
assert.match(schedule, /runHaloMasterPulse/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_master_orchestrator_state/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_master_orchestrator_events/);
assert.match(releaseApi, /infrastructure:\s*infrastructureState\?\.state/);
assert.match(releaseCatalog, /orchestrator\.state->'dreamweaverAssetGraph'/);
assert.match(releaseCatalog, /assetGraph:\s*values\.assetGraph\?\.locked === true/);

console.log("HALO master orchestrator contracts passed");
