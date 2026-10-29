import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import vm from "node:vm";
import { extractId3Artwork, parseId3Metadata, titleFromFileName } from "../netlify/lib/audio-metadata.mjs";

function safeHttpsUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href.replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

function normalizeAzuraCastNowPlaying(payload, slug = "") {
  const stations = Array.isArray(payload) ? payload : [payload];
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  const matchingStation = normalizedSlug
    ? stations.find(entry => {
      const station = entry?.station || {};
      return [station.shortcode, station.id, station.name]
        .some(value => String(value || "").trim().toLowerCase() === normalizedSlug);
    })
    : null;
  return matchingStation || (stations.length === 1 ? stations[0] : null);
}

function azuraCastStreamUrl(data) {
  const station = data?.station || {};
  const defaultMount = Array.isArray(station.mounts) ? station.mounts.find(mount => mount?.is_default) : null;
  const mountUrls = Array.isArray(station.mounts) ? station.mounts.map(mount => mount?.url) : [];
  const remoteUrls = Array.isArray(station.remotes) ? station.remotes.map(remote => remote?.url) : [];
  const hlsUrl = station.hls_enabled ? station.hls_url : "";
  const candidates = station.hls_is_default
    ? [hlsUrl, station.listen_url, defaultMount?.url, ...mountUrls, ...remoteUrls]
    : [station.listen_url, defaultMount?.url, ...mountUrls, ...remoteUrls, hlsUrl];
  return candidates.map(safeHttpsUrl).find(Boolean) || "";
}

const files = {
  page: await readFile(new URL("../radio/index.html", import.meta.url), "utf8"),
  client: await readFile(new URL("../radio/radio.js", import.meta.url), "utf8"),
  styles: await readFile(new URL("../radio/radio.css", import.meta.url), "utf8"),
  stations: await readFile(new URL("../netlify/functions/radio-stations.mjs", import.meta.url), "utf8"),
  health: await readFile(new URL("../netlify/functions/radio-health.mjs", import.meta.url), "utf8"),
  scout: await readFile(new URL("../netlify/functions/radio-health-scout.mjs", import.meta.url), "utf8"),
  healthLibrary: await readFile(new URL("../netlify/lib/radio-health.mjs", import.meta.url), "utf8"),
  submissions: await readFile(new URL("../netlify/functions/radio-submissions.mjs", import.meta.url), "utf8"),
  resolver: await readFile(new URL("../netlify/functions/resolve-track.mjs", import.meta.url), "utf8"),
  audio: await readFile(new URL("../netlify/functions/radio-audio.mjs", import.meta.url), "utf8"),
  mixes: await readFile(new URL("../netlify/functions/mixes.mjs", import.meta.url), "utf8"),
  mixAudio: await readFile(new URL("../netlify/functions/mix-audio.mjs", import.meta.url), "utf8"),
  gemma: await readFile(new URL("../netlify/functions/gemma-radio-operator.mjs", import.meta.url), "utf8"),
  managerCouncil: await readFile(new URL("../netlify/functions/radio-manager-council.mjs", import.meta.url), "utf8"),
  managerCouncilLibrary: await readFile(new URL("../netlify/lib/radio-manager-council.mjs", import.meta.url), "utf8"),
  managerCouncilMigration: await readFile(new URL("../netlify/database/migrations/20260817150000_create-radio-manager-council.sql", import.meta.url), "utf8"),
  gemmaRelay: await readFile(new URL("../ops/gemma-relay/server.mjs", import.meta.url), "utf8"),
  migration: await readFile(new URL("../netlify/database/migrations/20260809120000_create-halo-radio.sql", import.meta.url), "utf8"),
  intelligenceMigration: await readFile(new URL("../netlify/database/migrations/20260812190000_add-radio-track-intelligence.sql", import.meta.url), "utf8"),
  reviewMigration: await readFile(new URL("../netlify/database/migrations/20260812230000_add-radio-rotation-review.sql", import.meta.url), "utf8"),
  artistSubmissionMigration: await readFile(new URL("../netlify/database/migrations/20260812234000_link-artist-radio-submissions.sql", import.meta.url), "utf8"),
  releaseAudioMigration: await readFile(new URL("../netlify/database/migrations/20260812234500_link-release-audio-versions.sql", import.meta.url), "utf8"),
  artistReviewMigration: await readFile(new URL("../netlify/database/migrations/20260812235000_add-radio-artist-review-updates.sql", import.meta.url), "utf8"),
  developmentMigration: await readFile(new URL("../netlify/database/migrations/20260814120000_create-radio-artist-development.sql", import.meta.url), "utf8"),
  trackVersionMigration: await readFile(new URL("../netlify/database/migrations/20260812235500_link-radio-track-versions.sql", import.meta.url), "utf8"),
  longPlayMigration: await readFile(new URL("../netlify/database/migrations/20260812210000_add-curated-radio-long-plays.sql", import.meta.url), "utf8"),
  haloTvMigration: await readFile(new URL("../netlify/database/migrations/20260812220000_add-ghost-to-me-halo-tv.sql", import.meta.url), "utf8"),
  audioMetadata: await readFile(new URL("../netlify/lib/audio-metadata.mjs", import.meta.url), "utf8")
};

async function verifyAudioHandler() {
  const chunkBytes = 3 * 1024 * 1024;
  const manualBlobPrefix = "member/manual-upload-123/parts/";
  const catalogTrack = {
    blob_key: "member/version/upload/parts/", chunk_count: 1, byte_size: 5,
    content_type: "audio/mpeg", status: "preview", member_id: "member", actor_id: "actor",
    release_id: "release", master_song_id: "song", audio_version_id: "audio",
    rights_confirmed: true, duration_seconds: 120,
    release_audio: { id: "audio", release_id: "release", owner_member_id: "member",
      version_type: "radio_edit", blob_key: "member/version/upload/parts/", chunk_count: 1,
      byte_size: 5, content_type: "audio/mpeg", duration_seconds: 120, rights_confirmed: true, status: "active" },
    catalog_release: { id: "release", owner_member_id: "member", status: "published" },
    catalog_song: { id: "song", owner_member_id: "member", status: "active",
      pipeline_status: "published", rights_status: "cleared", broadcast_requested: true, explicit_lyrics: false },
    catalog_version: { id: "version", song_id: "song", version_type: "radio_edit", status: "active",
      mastering_status: "approved", clean_lyrics: false, duration_seconds: 120,
      audio_blob_prefix: "member/version/upload/parts/", audio_chunk_count: 1, audio_byte_size: 5,
      audio_content_type: "audio/mpeg" },
    owner_membership: { member_id: "member", actor_id: "actor" }
  };
  function harness(track, parts = [Uint8Array.of(1, 2, 3, 4, 5)], missing = false) {
    const reads = [];
    const queries = [];
    let plays = 0;
    const sandbox = {
      Response, URL, ReadableStream, Uint8Array, console: { error() {} },
      cleanText: value => value || "",
      getUser: async () => null,
      getDatabase: async () => ({
        async sql(strings) {
          const query = strings.join("?");
          queries.push(query);
          if (query.includes("UPDATE")) { plays += 1; return []; }
          return track ? [track] : [];
        }
      }),
      getStore: ({ name, consistency }) => {
        assert.equal(consistency, "strong");
        return { async get(key, options) {
          reads.push({ name, key });
          assert.equal(options.type, "arrayBuffer");
          return missing ? null : parts[Number(key.slice(-3))]?.buffer;
        } };
      }
    };
    vm.runInNewContext(files.audio.replace(/^import .*;\n/gm, "")
      .replace("export default async function", "async function")
      .replace("export const config", "const config")
      + "\nglobalThis.handler = radioAudioHandler;", sandbox);
    return {
      reads, queries, get plays() { return plays; },
      request: (method = "GET", range) => sandbox.handler(new Request("https://halo.world/api/radio/audio?id=track", {
        method, headers: range ? { Range: range } : {}
      }))
    };
  }
  const fresh = () => structuredClone(catalogTrack);
  const catalog = harness(fresh());
  const full = await catalog.request();
  assert.equal(full.status, 200);
  assert.deepEqual(Array.from(new Uint8Array(await full.arrayBuffer())), [1, 2, 3, 4, 5]);
  assert.deepEqual(catalog.reads.map(read => read.name), ["halo-song-catalog-audio"]);
  assert.equal(catalog.plays, 1);
  assert.ok(catalog.queries[0].includes("audio.id = track.audio_version_id"));
  assert.ok(catalog.queries[0].includes("release.id = track.release_id"));
  assert.ok(catalog.queries[0].includes("song.id = track.master_song_id"));
  assert.ok(catalog.queries[0].includes("version.song_id = track.master_song_id"));
  assert.ok(catalog.queries[0].includes("version.audio_blob_prefix = track.blob_key"));
  assert.ok(catalog.queries[0].includes("version.version_type = audio.version_type"));
  assert.ok(catalog.queries[0].includes("membership.member_id = song.owner_member_id"));
  assert.ok(catalog.queries[0].includes("track.reviewed_at, track.reviewed_by_member_id"));
  assert.ok(!JSON.stringify([...full.headers]).includes(catalogTrack.blob_key));

  for (const method of ["HEAD", "GET"]) {
    const ranged = harness(fresh());
    const response = await ranged.request(method, "bytes=1-3");
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 1-3/5");
    assert.equal(response.headers.get("content-length"), "3");
    assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), method === "HEAD" ? [] : [2, 3, 4]);
    assert.equal(ranged.reads.length, method === "HEAD" ? 0 : 1);
    assert.equal(ranged.plays, 0);
  }
  for (const [range, bytes] of [["bytes=-2", [4, 5]], ["bytes=3-", [4, 5]], ["bytes=0-1", [1, 2]]]) {
    const ranged = harness(fresh());
    const response = await ranged.request("GET", range);
    assert.equal(response.status, 206);
    assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), bytes);
    assert.equal(ranged.plays, range === "bytes=0-1" ? 1 : 0);
  }
  const spanningTrack = fresh();
  for (const row of [spanningTrack, spanningTrack.release_audio]) {
    row.byte_size = chunkBytes + 3;
    row.chunk_count = 2;
  }
  spanningTrack.catalog_version.audio_byte_size = chunkBytes + 3;
  spanningTrack.catalog_version.audio_chunk_count = 2;
  const firstPart = new Uint8Array(chunkBytes);
  firstPart[chunkBytes - 1] = 7;
  const spanning = harness(spanningTrack, [firstPart, Uint8Array.of(8, 9, 10)]);
  const across = await spanning.request("GET", `bytes=${chunkBytes - 1}-${chunkBytes + 1}`);
  assert.equal(across.status, 206);
  assert.deepEqual(Array.from(new Uint8Array(await across.arrayBuffer())), [7, 8, 9]);
  assert.deepEqual(spanning.reads.map(read => [read.name, read.key.slice(-3)]),
    [["halo-song-catalog-audio", "000"], ["halo-song-catalog-audio", "001"]]);

  const catalogChunkBytes = 4 * 1024 * 1024;
  const sizedTrack = (byteSize, chunkCount) => {
    const track = fresh();
    for (const row of [track, track.release_audio]) {
      row.byte_size = byteSize;
      row.chunk_count = chunkCount;
    }
    track.catalog_version.audio_byte_size = byteSize;
    track.catalog_version.audio_chunk_count = chunkCount;
    return track;
  };
  const catalogFirst = new Uint8Array(catalogChunkBytes);
  catalogFirst[chunkBytes] = 6;
  catalogFirst[catalogChunkBytes - 1] = 7;
  const singleCatalog = harness(sizedTrack(catalogChunkBytes, 1), [catalogFirst]);
  assert.equal((await singleCatalog.request("HEAD")).status, 200, "A single 4MiB catalog part passes preflight");
  const singleFull = await singleCatalog.request();
  assert.equal(singleFull.status, 200);
  assert.equal((await singleFull.arrayBuffer()).byteLength, catalogChunkBytes);
  const singleTail = await singleCatalog.request("GET", `bytes=${chunkBytes}-${chunkBytes}`);
  assert.equal(singleTail.status, 206);
  assert.deepEqual(Array.from(new Uint8Array(await singleTail.arrayBuffer())), [6]);

  const catalogSecond = new Uint8Array(1024 * 1024);
  catalogSecond.set([8, 9, 10]);
  const fiveMiB = sizedTrack(5 * 1024 * 1024, 2);
  const catalogBoundary = harness(fiveMiB, [catalogFirst, catalogSecond]);
  const boundaryRange = await catalogBoundary.request("GET", `bytes=${catalogChunkBytes - 1}-${catalogChunkBytes + 1}`);
  assert.equal(boundaryRange.status, 206);
  assert.deepEqual(Array.from(new Uint8Array(await boundaryRange.arrayBuffer())), [7, 8, 9]);
  assert.deepEqual(catalogBoundary.reads.map(read => read.key.slice(-3)), ["000", "001"]);
  const beforeBoundary = harness(fiveMiB, [catalogFirst, catalogSecond]);
  const threeMiBRange = await beforeBoundary.request("GET", `bytes=${chunkBytes}-${chunkBytes}`);
  assert.equal(threeMiBRange.status, 206);
  assert.deepEqual(Array.from(new Uint8Array(await threeMiBRange.arrayBuffer())), [6],
    "A range at 3MiB still reads the first 4MiB catalog part");
  assert.deepEqual(beforeBoundary.reads.map(read => read.key.slice(-3)), ["000"]);
  const secondPartOnly = harness(fiveMiB, [catalogFirst, catalogSecond]);
  const afterBoundary = await secondPartOnly.request("GET", `bytes=${catalogChunkBytes}-${catalogChunkBytes + 1}`);
  assert.equal(afterBoundary.status, 206);
  assert.deepEqual(Array.from(new Uint8Array(await afterBoundary.arrayBuffer())), [8, 9]);
  assert.deepEqual(secondPartOnly.reads.map(read => read.key.slice(-3)), ["000", "001"]);
  const manualBoundaryTrack = structuredClone(spanningTrack);
  manualBoundaryTrack.blob_key = manualBlobPrefix;
  manualBoundaryTrack.master_song_id = null;
  manualBoundaryTrack.catalog_version = manualBoundaryTrack.catalog_song = manualBoundaryTrack.owner_membership = null;
  const manualBoundary = harness(manualBoundaryTrack, [firstPart, Uint8Array.of(8, 9, 10)]);
  const manualAcross = await manualBoundary.request("GET", `bytes=${chunkBytes - 1}-${chunkBytes + 1}`);
  assert.equal(manualAcross.status, 206);
  assert.deepEqual(Array.from(new Uint8Array(await manualAcross.arrayBuffer())), [7, 8, 9]);
  assert.ok(manualBoundary.reads.every(read => read.name === "halo-radio-submissions"));

  const invalidChanges = [
    ["member_id", "another-member"], ["actor_id", "another-actor"],
    ["release_id", "another-release"], ["master_song_id", "another-song"],
    ["audio_version_id", "another-audio"], ["blob_key", "arbitrary/parts/"],
    ["rights_confirmed", false], ["byte_size", 6], ["chunk_count", 2], ["duration_seconds", 121],
    ["content_type", "audio/wav"], ["catalog_song", null], ["catalog_version", null],
    ["release_audio", null], ["catalog_release", null], ["owner_membership", null],
    ["release_audio.owner_member_id", "another-member"], ["release_audio.release_id", "another-release"],
    ["release_audio.status", "archived"], ["release_audio.rights_confirmed", false],
    ["release_audio.version_type", "clean"], ["release_audio.blob_key", "another/parts/"],
    ["release_audio.chunk_count", 2], ["release_audio.byte_size", 6],
    ["release_audio.duration_seconds", 121], ["release_audio.content_type", "audio/wav"],
    ["catalog_release.owner_member_id", "another-member"], ["catalog_release.status", "draft"],
    ["catalog_song.owner_member_id", "another-member"], ["catalog_song.status", "archived"],
    ["catalog_song.pipeline_status", "draft"], ["catalog_song.rights_status", "needs_review"],
    ["catalog_song.broadcast_requested", false], ["catalog_song.explicit_lyrics", true],
    ["catalog_version.song_id", "another-song"], ["catalog_version.status", "archived"],
    ["catalog_version.mastering_status", "review"], ["catalog_version.version_type", "sale_master"],
    ["catalog_version.audio_blob_prefix", "another/parts/"], ["catalog_version.audio_byte_size", 0],
    ["catalog_version.audio_chunk_count", 0], ["catalog_version.duration_seconds", 0],
    ["catalog_version.audio_content_type", "text/html"],
    ["owner_membership.member_id", "another-member"], ["owner_membership.actor_id", ""]
  ];
  for (const [path, value] of invalidChanges) {
    const track = fresh();
    const keys = path.split(".");
    (keys.length === 1 ? track : track[keys[0]])[keys.at(-1)] = value;
    const invalid = harness(track);
    const response = await invalid.request();
    assert.equal(response.status, 404, `Reject invalid catalog provenance: ${path}`);
    assert.equal(invalid.reads.length, 0, `No store fallback: ${path}`);
    assert.equal(invalid.plays, 0);
    assert.ok(!(await response.text()).includes(catalogTrack.blob_key));
  }
  for (const type of ["radio_edit", "clean"]) {
    const clean = fresh();
    clean.catalog_song.explicit_lyrics = true;
    clean.catalog_version.clean_lyrics = true;
    clean.catalog_version.version_type = clean.release_audio.version_type = type;
    const response = await harness(clean).request("HEAD");
    assert.equal(response.status, 200, "Explicit songs require an explicitly clean-approved version");
    clean.catalog_version.clean_lyrics = false;
    assert.equal((await harness(clean).request("HEAD")).status, 404, "A clean label alone is not approval");
  }
  const missing = harness(fresh(), undefined, true);
  assert.equal((await missing.request("GET", "bytes=0-1")).status, 500);
  assert.deepEqual(missing.reads.map(read => read.name), ["halo-song-catalog-audio"]);
  const invalidRange = harness(fresh());
  assert.equal((await invalidRange.request("GET", "bytes=6-7")).status, 416);
  assert.equal(invalidRange.reads.length, 0);

  for (const linked of [false, true]) {
    const track = fresh();
    track.blob_key = manualBlobPrefix;
    track.master_song_id = null;
    track.catalog_version = track.catalog_song = track.owner_membership = null;
    if (!linked) track.audio_version_id = track.release_id = track.release_audio = track.catalog_release = null;
    // A user URL cannot override the owned manual uploader namespace.
    track.source_url = "/api/song-catalog/audio?versionId=untrusted";
    const manual = harness(track);
    const response = await manual.request();
    assert.equal(response.status, 200);
    assert.equal((await response.arrayBuffer()).byteLength, 5);
    assert.deepEqual(manual.reads.map(read => read.name), ["halo-radio-submissions"]);
    const range = await manual.request("GET", "bytes=2-4");
    assert.equal(range.status, 206);
    assert.deepEqual(Array.from(new Uint8Array(await range.arrayBuffer())), [3, 4, 5]);
    assert.equal((await manual.request("HEAD")).status, 200);
    assert.ok(manual.reads.every(read => read.name === "halo-radio-submissions"));
  }
  for (const status of ["preview", "rotation"]) {
    const linkedManual = { ...fresh(), status, blob_key: manualBlobPrefix,
      audio_version_id: null, catalog_version: null, release_audio: null,
      reviewed_at: "2026-10-25T12:00:00Z", reviewed_by_member_id: "operator" };
    linkedManual.catalog_song.broadcast_requested = false;
    const manual = harness(linkedManual);
    const response = await manual.request();
    assert.equal(response.status, 200, `Song-linked manual ${status} keeps its original radio-store audio`);
    assert.equal((await response.arrayBuffer()).byteLength, 5);
    assert.deepEqual(manual.reads.map(read => read.name), ["halo-radio-submissions"]);
    assert.equal((await manual.request("HEAD")).status, 200);
  }
  for (const change of [
    { catalog_version: null },
    { catalog_version: { ...fresh().catalog_version, status: "archived" } },
    { catalog_version: null, blob_key: "member/version/replaced-upload/parts/" },
    { catalog_version: null, blob_key: "member/version/parts/nested/" },
    { catalog_version: null, blob_key: "member/short/parts/" },
    { catalog_version: null, blob_key: "another-member/manual-upload-123/parts/" },
    { catalog_version: { ...fresh().catalog_version, audio_blob_prefix: manualBlobPrefix }, blob_key: manualBlobPrefix }
  ]) {
    const invalid = harness({ ...fresh(), ...change });
    assert.equal((await invalid.request()).status, 404, "Missing, archived, replaced or malformed catalog audio never falls back");
    assert.equal(invalid.reads.length, 0);
  }
  const rotation = fresh();
  rotation.status = "rotation";
  for (const [reviewedAt, reviewedBy] of [[null, null], ["2026-10-25T12:00:00Z", null], [null, "operator"]]) {
    const unreviewed = harness({ ...rotation, reviewed_at: reviewedAt, reviewed_by_member_id: reviewedBy });
    for (const method of ["GET", "HEAD"]) {
      assert.equal((await unreviewed.request(method)).status, 404, "Catalog rotation requires both persisted operator-review fields");
    }
    assert.equal(unreviewed.reads.length, 0);
    assert.equal(unreviewed.plays, 0);
  }
  rotation.reviewed_at = "2026-10-25T12:00:00Z";
  rotation.reviewed_by_member_id = "operator";
  const rotated = await harness(rotation).request("HEAD");
  assert.equal(rotated.status, 200);
  assert.equal(rotated.headers.get("cache-control"), "public, max-age=3600");
  const reviewedPlayback = harness(rotation);
  const reviewedResponse = await reviewedPlayback.request();
  assert.equal(reviewedResponse.status, 200);
  assert.equal((await reviewedResponse.arrayBuffer()).byteLength, 5);
  assert.deepEqual(reviewedPlayback.reads.map(read => read.name), ["halo-song-catalog-audio"]);
  const manualRotation = { ...fresh(), blob_key: manualBlobPrefix, status: "rotation", master_song_id: null,
    catalog_version: null, catalog_song: null, owner_membership: null };
  const manualRotationResponse = await harness(manualRotation).request();
  assert.equal(manualRotationResponse.status, 200, "Manual rotation playback does not acquire a catalog review gate");
  assert.equal((await manualRotationResponse.arrayBuffer()).byteLength, 5);
}

await verifyAudioHandler();

function synchsafe(value) {
  return [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
}

function id3TextFrame(id, value) {
  const body = new Uint8Array([3, ...new TextEncoder().encode(value)]);
  return new Uint8Array([...new TextEncoder().encode(id), ...synchsafe(body.length), 0, 0, ...body]);
}

const titleFrame = id3TextFrame("TIT2", "Contract Song");
const artistFrame = id3TextFrame("TPE1", "Contract Artist");
const artworkBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const artworkBody = new Uint8Array([3, ...new TextEncoder().encode("image/jpeg"), 0, 3, 0, ...artworkBytes]);
const artworkFrame = new Uint8Array([...new TextEncoder().encode("APIC"), ...synchsafe(artworkBody.length), 0, 0, ...artworkBody]);
const tagBody = new Uint8Array([...titleFrame, ...artistFrame, ...artworkFrame]);
const parsedMetadata = parseId3Metadata(new Uint8Array([73, 68, 51, 4, 0, 0, ...synchsafe(tagBody.length), ...tagBody]));
const parsedArtwork = extractId3Artwork(new Uint8Array([73, 68, 51, 4, 0, 0, ...synchsafe(tagBody.length), ...tagBody]));

const sampleStation = {
  station: {
    id: 1,
    shortcode: "azuratest_radio",
    listen_url: "http://localhost:8000/radio.mp3",
    mounts: [{ url: "http://localhost:8000/radio.mp3", is_default: true }],
    hls_enabled: true,
    hls_is_default: true,
    hls_url: "https://example.com/hls/azuratest_radio/live.m3u8"
  }
};
const normalizedSample = normalizeAzuraCastNowPlaying([sampleStation], "azuratest_radio");

const checks = [
  ["official service song import", files.page.includes('id="resolveTrackButton"') && files.client.includes("resolveOfficialTrack") && files.resolver.includes("DistroKid HyperFollow")],
  ["owned release audio library", files.page.includes('id="submissionRelease"') && files.client.includes("releaseLibrary") && files.submissions.includes("listReleaseLibrary")],
  ["saved release version submission", files.page.includes('id="submissionAudioVersion"') && files.client.includes('payload.action = "submitReleaseVersion"') && files.submissions.includes("submitReleaseVersion")],
  ["editable connected track versions", files.page.includes("PUT YOUR WORK") && files.page.includes('name="linkedTrackId"') && files.client.includes("versionRelationshipLabels") && files.submissions.includes("linked_track_id") && files.trackVersionMigration.includes("version_relationship")],
  ["four channel controls", files.page.includes("LONG PLAY / 04") && files.client.includes('id: "longplay"')],
  ["three room demos", ["Pressure Test 01", "Last Light Drift", "Velvet Frequency"].every(value => files.stations.includes(value))],
  ["music fallback instead of oscillator", files.client.includes("playLongPlay") && !files.client.includes("createOscillator")],
  ["HALO artist playlist rotation", files.client.includes("PLcmaoB9ss1YE") && files.client.includes('listType: "playlist"') && files.client.includes("setLoop(true)") && files.client.includes("playFallbackMix") && files.page.includes('id="fallbackVideo"')],
  ["complete mix catalog", files.mixes.includes("Math.min(100") && files.client.includes("/api/mixes?limit=100&station=longplay")],
  ["curated YouTube long plays", ["IbwPoo-b1bs", "Bn1V4lvhFTA", "d8Nd2jb7BDs", "GKjU4Ac1Pzw"].every(value => files.longPlayMigration.includes(value)) && files.haloTvMigration.includes("yh7qQGvzmdw") && files.mixes.includes("alternateLongPlays") && files.mixes.includes("loadCuratedLongPlays")],
  ["automatic YouTube long play advancement", files.client.includes("playYouTubeLongPlay") && files.client.includes("youtubeLongPlayActive") && files.client.includes("PlayerState?.ENDED) advanceLongPlay()")],
  ["DJ HALO X takeover long play mix", files.mixes.includes("preview-pool-60-minute-mix") && files.mixes.includes("DJ HALO X 60 MIN TAKEOVER MIX") && files.mixes.includes("stationFallback: true") && files.client.includes("advanceLongPlay")],
  ["visible backup takeover state", files.page.includes('id="backupStatus"') && files.page.includes('id="manualTakeoverButton"') && files.client.includes("renderBackupBanner") && files.client.includes("toggleManualTakeover")],
  ["preflighted station backup audio", files.client.includes("validateAudioSource") && files.client.includes("readyRotationTarget") && files.client.includes("readyTakeoverTarget") && files.mixes.includes("content_type LIKE 'audio/%'")],
  ["latest recorded hour leads long play", files.mixes.includes("prioritizeLatestHourSession") && files.mixes.includes("hourSessionMinimumSeconds") && files.mixes.includes("hourSessionMaximumSeconds")],
  ["long form audio range playback", files.mixAudio.includes('consistency: "strong"') && files.mixAudio.includes('"Accept-Ranges"') && files.mixAudio.includes('"Access-Control-Allow-Origin"') && files.mixAudio.includes('"Access-Control-Expose-Headers"') && files.mixAudio.includes('status: 206') && files.mixAudio.includes('"Content-Range"')],
  ["persistent station player", files.page.includes('id="stationAudio"') && files.client.includes("playCurrentRoom")],
  ["creator submission form", files.page.includes('id="submissionForm"') && files.page.includes("rightsConfirmed")],
  ["generated covers for artwork-free uploads", files.client.includes("generatedArtworkMarkup") && files.client.includes('20 * 60') && files.client.includes("Original signal") && files.client.includes("Long play") && files.styles.includes(".preview-artwork-generated.is-long-play")],
  ["owner bulk upload desk", files.page.includes('id="bulkUploadForm"') && files.page.includes("multiple required") && files.client.includes("submitBulkTracks") && files.client.includes("files.slice(0, 25)")],
  ["owner-only direct rotation", files.submissions.includes("isOwner(user)") && files.submissions.includes("ownerBulk") && files.submissions.includes('"rotation" : "preview"')],
  ["AI track cataloging", files.submissions.includes('intelligenceModel = "gpt-5.4-mini"') && files.submissions.includes("enrichCatalog") && files.submissions.includes("Never claim to hear or acoustically analyze")],
  ["embedded MP3 metadata", parsedMetadata.title === "Contract Song" && parsedMetadata.artist === "Contract Artist" && titleFromFileName("Contract Song-4.mp3") === "Contract Song"],
  ["embedded cover artwork", parsedArtwork?.mime === "image/jpeg" && parsedArtwork.byteSize === artworkBytes.length && files.submissions.includes("artwork_key") && files.client.includes("preview-artwork")],
  ["newest-first room takeover cycle", files.stations.includes("ORDER BY room, created_at DESC") && files.client.includes("playTakeoverFallback") && files.client.includes("advanceTakeoverFallback") && files.client.includes("rotationIndex(room) >= room.rotation.length - 1")],
  ["community voting client", files.client.includes('action: "vote"') && files.client.includes("castVote")],
  ["owner upload management", files.client.includes('action: "update"') && files.client.includes('action: "delete"') && files.client.includes("openTrackEditor") && files.submissions.includes("updateTrack") && files.submissions.includes("deleteTrack") && files.submissions.includes("member_id = ${membership.member_id}") && files.submissions.includes("audioStore.delete")],
  ["station route", files.stations.includes('path: "/api/radio/stations"')],
  ["azuracast integration", files.stations.includes("HALO_RADIO_AZURACAST_URL") && files.stations.includes("/api/nowplaying/")],
  ["azuracast station-list response", normalizedSample === sampleStation],
  ["azuracast default HLS stream", azuraCastStreamUrl(normalizedSample) === sampleStation.station.hls_url],
  ["station-wide YouTube recovery fallback", files.client.includes("playFallbackMix") && files.client.includes("youtube.com/iframe_api") && files.client.includes("PLcmaoB9ss1YE") && !files.client.includes("HALO AutoDJ")],
  ["visible long play queue", files.page.includes('id="longPlayQueue"') && files.client.includes("renderLongPlayQueue")],
  ["dual-deck seamless playback", files.page.includes('id="stationAudio" preload="auto"') && files.page.includes('id="standbyAudio" preload="auto"') && files.client.includes("startSeamlessTransition") && files.client.includes("prepareStandbyAudio")],
  ["incoming tracks start at zero", files.client.includes("incoming.currentTime = 0") && files.client.includes("await incoming.play()")],
  ["equal-power no-dead-air blend", files.client.includes("Math.cos(progress * Math.PI / 2)") && files.client.includes("Math.sin(progress * Math.PI / 2)") && files.page.includes("no dead air")],
  ["continuity guard bridge monitor", files.page.includes('/dj-continuity-guard.js') && files.page.includes('id="continuityStatus"') && files.client.includes("ensureRadioContinuityGuard") && files.client.includes("window.__haloRadioContinuity")],
  ["continuity bridge telemetry", files.client.includes("radio_continuity_bridge") && files.client.includes("radio_continuity_preroll_ready") && files.client.includes("Continuity Guard")],
  ["listener transition controls", files.page.includes('id="transitionSeconds"') && files.page.includes('id="transitionMode"') && files.client.includes("tempoMatchRate")],
  ["azuracast source timing", files.stations.includes("played_at") && files.healthLibrary.includes("sourcePosition")],
  ["station health route", files.health.includes('path: "/api/radio/health"') && files.healthLibrary.includes("probeStream")],
  ["background station agents", files.scout.includes('schedule: "*/5 * * * *"') && files.scout.includes("reportIssue")],
  ["visible signal monitor", files.page.includes('id="signalWatch"') && files.page.includes('id="signalScope"') && files.client.includes("loadHealth")],
  ["always-on browser QA monitor", files.page.includes('src="/site-monitor.js"') && files.page.includes('id="previewPlaybackStatus"')],
  ["YouTube podcast playlist", files.page.includes('id="podcast"') && files.page.includes("youtube-nocookie.com/embed/videoseries?list=PLcW5JzViKrdI")],
  ["authenticated submissions", files.submissions.includes("getUser") && files.submissions.includes("verifyRequestOrigin")],
  ["live submission upload progress", files.page.includes('/upload-progress.js') && files.client.includes("uploadHelper.uploadChunkedFile") && files.client.includes("submissionUploadUi")],
  ["artist-card radio submissions", files.submissions.includes("Only the artist room owner can send this release to radio") && files.submissions.includes("artist_slug") && files.artistSubmissionMigration.includes("ADD COLUMN IF NOT EXISTS artist_slug")],
  ["release-card audio versions", files.submissions.includes("submitReleaseVersion") && files.submissions.includes("audio_version_id") && files.releaseAudioMigration.includes("halo_release_audio_versions") && files.releaseAudioMigration.includes("current_release_id")],
  ["track vault preservation", files.submissions.includes("release audio remains in the Track Vault") && files.submissions.includes("if (!deleted[0].audio_version_id) await cleanupTrackAudio")],
  ["strongly consistent blob audio storage", files.submissions.includes('name: "halo-radio-submissions"') && files.submissions.includes('consistency: "strong"')],
  ["browser audio type normalization", files.submissions.includes("normalizeAudioType") && files.client.includes("audioContentType")],
  ["preview audio route", files.audio.includes('path: "/api/radio/audio"') && files.audio.includes('"Content-Length"') && files.audio.includes('"HEAD"') && files.audio.includes('"Accept-Ranges"') && files.audio.includes('"Access-Control-Allow-Origin"') && files.audio.includes('"Access-Control-Expose-Headers"') && files.audio.includes("status: 206")],
  ["preview playback preflight", files.client.includes('method: "HEAD"') && files.client.includes("reportAudioHealth") && files.client.includes("Audio check passed")],
  ["owner-only Gemma operator", files.gemma.includes("isOwner(user)") && files.gemma.includes("verifyRequestOrigin(request)")],
  ["approved Gemma updates", files.gemma.includes('payload?.approved !== true') && files.gemma.includes('path: "/api/radio/gemma"')],
  ["visible Gemma station desk", files.page.includes('id="gemmaOperator"') && files.client.includes("runGemmaAction")],
  ["owner-only radio manager council", files.managerCouncil.includes("isOwner(user)") && files.managerCouncil.includes("verifyRequestOrigin(request)") && files.managerCouncil.includes('path: "/api/radio/manager-council"')],
  ["five-role evidence council", ["programme", "audience", "artist", "systems", "growth"].every(value => files.managerCouncilLibrary.includes(`key: "${value}"`)) && files.managerCouncilLibrary.includes("gatherStationSignals")],
  ["human-approved manager queue", files.managerCouncilMigration.includes("halo_radio_manager_actions") && files.managerCouncilMigration.includes("'proposed', 'approved', 'rejected', 'completed'") && files.page.includes('id="managerCouncil"') && files.client.includes("decideManagerAction")],
  ["scoped Watchtower relay", files.gemmaRelay.includes('payload.action !== "watchtower_update"') && files.gemmaRelay.includes('payload.scope !== "azuracast"') && !files.gemmaRelay.includes("docker.sock")],
  ["radio database schema", files.migration.includes("halo_radio_tracks") && files.migration.includes("halo_radio_votes")],
  ["track intelligence schema", ["ai_metadata", "analysis_status", "moods", "energy", "source_filename"].every(value => files.intelligenceMigration.includes(value))],
  ["human rotation review", files.submissions.includes('payload.action === "review"') && files.page.includes('id="rotationReview"') && files.client.includes("data-review-decision") && ["reviewed_by_member_id", "review_note", "spotlight_month"].every(value => files.reviewMigration.includes(value))],
  ["artist review updates", files.submissions.includes("acknowledgeArtistUpdate") && files.submissions.includes("artist_message") && files.client.includes("data-artist-message") && files.artistReviewMigration.includes("artist_viewed_at")],
  ["artist development review ledger", files.developmentMigration.includes("halo_radio_development_reviews") && files.developmentMigration.includes("development_stage") && files.submissions.includes("draftDevelopmentCoaching") && files.submissions.includes("scorecard")],
  ["artist development interface", files.page.includes('id="developmentBoard"') && files.client.includes("renderDevelopmentBoard") && files.client.includes("data-coaching-draft") && files.styles.includes(".development-guidance")],
  ["artist owner update acknowledgement", files.submissions.includes("page.slug = track.artist_slug") && files.submissions.includes("page.owner_member_id = ${membership.member_id}")],
  ["station share entry point", files.page.includes('id="stationShareButton"') && files.page.includes('id="stationShareStatus"') && files.page.includes('id="stationShareDialog"') && files.page.includes('id="stationShareCopy"')],
  ["station share fallback flow", files.client.includes("shareStation") && files.client.includes("navigator.share") && files.client.includes('new URL("/radio/", location.origin)') && files.client.includes("copyShareLink") && files.client.includes("openDialog(stationShareDialog)") && files.client.includes("manual_fallback")],
  ["station share analytics hook", files.client.includes('window.haloStats?.track("share_halo_radio_station"') && files.client.includes('target: "station_landing"')]
];

const failures = checks.filter(([, passed]) => !passed);
if (failures.length) {
  for (const [name] of failures) console.error(`FAIL Halo Radio: ${name}`);
  process.exit(1);
}

console.log(`HALO Radio contracts: ${checks.length}/${checks.length} checks passed.`);
