import assert from "node:assert/strict";
import { conditionReleaseWav, MAX_PREFLIGHT_BYTES } from "../netlify/lib/release-audio.mjs";
import { createReleaseAudioPreparer } from "../netlify/lib/release-conveyor-audio.mjs";
import { RELEASE_STAGES, runReleaseConveyor } from "../netlify/lib/release-conveyor.mjs";

const stores = {
  source: { get: async () => null },
  output: { set: async () => {} },
};
const prepareReleaseAudio = createReleaseAudioPreparer({
  sourceStore: () => stores.source,
  packageStore: () => stores.output,
});

function wav({ rate = 48000, seconds = 4, bits = 24, channels = 1,
  signal = time => 0.1 * Math.sin(2 * Math.PI * 1000 * time) } = {}) {
  const frames = Math.round(rate * seconds);
  const stride = bits / 8;
  const bytes = Buffer.alloc(44 + frames * channels * stride);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * stride, 28);
  bytes.writeUInt16LE(channels * stride, 32); bytes.writeUInt16LE(bits, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = signal(frame / rate, channel, frame);
      bytes.writeIntLE(Math.round(value * (2 ** (bits - 1) - 1)),
        44 + (frame * channels + channel) * stride, stride);
    }
  }
  return bytes;
}

function sample(bytes, frame, channel = 0) {
  const bits = bytes.readUInt16LE(34);
  const channels = bytes.readUInt16LE(22);
  return bytes.readIntLE(44 + (frame * channels + channel) * bits / 8, bits / 8) / 2 ** (bits - 1);
}

function close(actual, expected, tolerance, label) {
  assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
}

// Independent reference response using the published BS.1770 48 kHz coefficient tables.
function referenceToneLufs(hz, amplitude, channels = 1) {
  const angle = 2 * Math.PI * hz / 48000;
  const power = (b, a) => {
    const magnitude = coefficients => {
      let real = 0, imaginary = 0;
      coefficients.forEach((value, index) => {
        real += value * Math.cos(index * angle);
        imaginary -= value * Math.sin(index * angle);
      });
      return real * real + imaginary * imaginary;
    };
    return magnitude(b) / magnitude(a);
  };
  const weightedPower = amplitude * amplitude / 2 * channels
    * power([1.53512485958697, -2.69169618940638, 1.19839281085285],
      [1, -1.69065929318241, 0.73248077421585])
    * power([1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
  return -0.691 + 10 * Math.log10(weightedPower);
}

for (const bits of [16, 24, 32]) {
  for (const channels of [1, 2]) {
    const original = wav({ bits, channels, signal: () => 0.1, seconds: 0.6 });
    const saved = Buffer.from(original);
    const result = conditionReleaseWav(original);
    assert.deepEqual(original, saved);
    assert.notEqual(result.bytes, original);
    assert.deepEqual(result.bytes.subarray(0, 44), saved.subarray(0, 44));
    assert.equal(result.report.originalPreserved, true);
    assert.equal(result.report.humHz, 0);
    assert.equal(result.report.fadeMilliseconds, 350);
    assert.equal(result.report.fadeCurve, "logarithmic");
    assert.equal(sample(result.bytes, 0), 0);
    const gain = sample(result.bytes, 24000) / sample(original, 24000);
    for (const time of [0.005, 0.05, 0.175, 0.349, 0.35]) {
      const frame = Math.round(time * 48000);
      const expected = frame < 16800 ? Math.log1p(9 * frame / 16799) / Math.log(10) : 1;
      close(sample(result.bytes, frame) / (sample(original, frame) * gain), expected, 0.0005,
        `${bits}-bit ${channels}-channel logarithmic fade at ${time}s`);
    }
    assert(result.report.samplePeakDbfs <= -1.49);
    assert.equal(result.report.masteringApproved, false);
    assert.equal(result.report.rightsApproved, false);
    assert.equal(result.report.truePeakCertified, false);
    assert.match(result.report.truePeakNote, /no true-peak measurement or certification/);
  }
}

for (const hz of [100, 1000, 10000]) {
  for (const channels of [1, 2]) {
    const result = conditionReleaseWav(wav({ channels,
      signal: time => 0.25 * Math.sin(2 * Math.PI * hz * time) }));
    close(result.report.inputIntegratedLufs, referenceToneLufs(hz, 0.25, channels), 0.025,
      `BS.1770 reference ${hz} Hz, ${channels} channels`);
    assert.equal(result.report.targetIntegratedLufs, -14);
    const remeasured = conditionReleaseWav(result.bytes).report.inputIntegratedLufs;
    close(result.report.achievedIntegratedLufs, remeasured, 1e-9, "actual encoded output measurement");
    close(result.report.achievedIntegratedLufs - result.report.conditionedIntegratedLufs,
      result.report.gainDb, 0.006, "measured gain before/after");
  }
}

const target = conditionReleaseWav(wav({ signal: time => 0.22 * Math.sin(2 * Math.PI * 1000 * time) }));
close(target.report.achievedIntegratedLufs, -14, 0.002, "reachable LUFS target");
assert.equal(target.report.peakLimited, false);
assert.equal(target.report.gainCapLimited, false);
const quiet = conditionReleaseWav(wav());
assert.equal(quiet.report.gainCapLimited, true);
close(quiet.report.gainDb, 3, 0.001, "conservative gain cap");
assert(quiet.report.achievedIntegratedLufs < -14);

const crest = wav({ signal: (time, channel, frame) => frame === 48000 ? 0.999
  : 0.05 * Math.sin(2 * Math.PI * 1000 * time) });
const limited = conditionReleaseWav(crest);
assert.equal(limited.report.peakLimited, true);
assert(limited.report.achievedIntegratedLufs < -14);
assert(limited.report.samplePeakDbfs <= -1.49);
let measuredPeak = 0;
for (let frame = 0; frame < 4 * 48000; frame++) measuredPeak = Math.max(measuredPeak, Math.abs(sample(limited.bytes, frame)));
close(20 * Math.log10(measuredPeak), limited.report.samplePeakDbfs, 1e-9, "encoded sample peak");

// Quiet material and digital silence must not dilute the gated loud section.
const gated = conditionReleaseWav(wav({ seconds: 12, signal: time => {
  const amplitude = time < 4 ? 0 : time < 8 ? 0.00001 : 0.1;
  return amplitude * Math.sin(2 * Math.PI * 1000 * time);
} }));
close(gated.report.inputIntegratedLufs, referenceToneLufs(1000, 0.1), 0.25, "absolute/relative gates");
const belowGate = conditionReleaseWav(wav({ signal: time => 0.00001 * Math.sin(2 * Math.PI * 1000 * time) }));
assert.equal(belowGate.report.conditionedIntegratedLufs, null);
assert.match(belowGate.report.loudnessFallbackReason, /-70 LUFS/);

for (const humHz of [0, 50, 60, "both"]) {
  const original = wav({ seconds: 5,
    signal: time => 0.1 * Math.sin(2 * Math.PI * 50 * time) + 0.1 * Math.sin(2 * Math.PI * 60 * time) });
  const result = conditionReleaseWav(original, { humHz });
  assert.equal(result.report.humHz, humHz);
  if (!humHz) continue;
  const gain = 10 ** (result.report.gainDb / 20);
  const amplitude = hz => {
    let sin = 0, cos = 0;
    for (let frame = 3 * 48000; frame < 5 * 48000; frame++) {
      const angle = 2 * Math.PI * hz * frame / 48000;
      sin += sample(result.bytes, frame) * Math.sin(angle);
      cos += sample(result.bytes, frame) * Math.cos(angle);
    }
    return 2 * Math.hypot(sin, cos) / (2 * 48000) / gain;
  };
  for (const hz of humHz === "both" ? [50, 60] : [humHz]) {
    assert(amplitude(hz) < 0.002, `${humHz} notch must suppress ${hz} Hz`);
  }
  if (humHz !== "both") assert(amplitude(humHz === 50 ? 60 : 50) > 0.09, "single notch preserves other hum");
}

for (const rate of [8000, 44100, 96000, 192000]) {
  const result = conditionReleaseWav(wav({ rate, seconds: 1 }));
  assert(Number.isFinite(result.report.inputIntegratedLufs));
  assert(Number.isFinite(result.report.achievedIntegratedLufs));
  assert(result.report.samplePeakDbfs <= -1.49);
}
const short = conditionReleaseWav(wav({ seconds: 0.2 }));
assert.equal(short.report.inputIntegratedLufs, null);
assert.equal(short.report.achievedIntegratedLufs, null);
assert.match(short.report.loudnessMethod, /RMS fallback/);
assert.match(short.report.loudnessFallbackReason, /400 ms/);
assert.equal(short.report.fadeMilliseconds, 350);
assert.equal(short.report.targetIntegratedLufs, -14);
assert.equal(short.report.fallbackRmsTargetDbfs, -18);
close(short.report.rmsDbfs - short.report.conditionedRmsDbfs,
  short.report.gainDb, 0.006, "RMS fallback measured before/after");
assert.throws(() => conditionReleaseWav(wav({ signal: () => 0 })), /silent/);
for (const invalid of [null, {}, Buffer.from("not audio")]) {
  assert.throws(() => conditionReleaseWav(invalid), /PCM WAV/);
}
assert.throws(() => conditionReleaseWav(wav(), { humHz: 70 }), /Hum filtering/);
assert.throws(() => conditionReleaseWav(wav().subarray(0, 100)), /incomplete/);
const invalidFormat = wav();
invalidFormat.writeUInt16LE(3, 20);
assert.throws(() => conditionReleaseWav(invalidFormat), /16, 24 or 32-bit PCM/);
assert.equal(MAX_PREFLIGHT_BYTES, 128 * 1024 * 1024);

const song = { id: "song", owner_member_id: "owner", title: "Signal", artist_name: "Artist",
  genre: "Soul", isrc: "GBAAA2600001", rights_status: "cleared", artwork_url: "/cover.jpg", metadata_issues: [] };
const external = [{ id: "master", song_id: song.id, version_type: "sale_master", audio_url: "/master.wav",
  duration_seconds: 180, mastering_status: "approved" }];
const approved = await prepareReleaseAudio(song, external, "revision");
assert.equal(approved.conditioning, "external_master");
assert.deepEqual(approved.issues, []);
assert.equal(approved.originalPreserved, true);
const pending = await prepareReleaseAudio(song,
  external.map(master => ({ ...master, mastering_status: "review" })), "revision");
assert(pending.issues.some(issue => /Conditioning alone is not mastering approval/.test(issue.message)));
const externalHum = await prepareReleaseAudio(song, external, "revision", { humHz: "both" });
assert(externalHum.issues.some(issue => /requires a stored PCM WAV/.test(issue.message)));

const sourceWav = wav({ seconds: 0.6 });
const storedMaster = [{ ...external[0], audio_content_type: "audio/wav", audio_byte_size: sourceWav.length,
  audio_blob_prefix: "owner/master/upload/parts/", audio_chunk_count: 1, mastering_status: "review" }];
let outputBytes;
stores.source.get = async () => sourceWav.buffer.slice(sourceWav.byteOffset, sourceWav.byteOffset + sourceWav.byteLength);
stores.output.set = async (key, bytes) => { outputBytes = Buffer.from(bytes); };
const storedReport = await prepareReleaseAudio(song, storedMaster, "revision");
assert.equal(storedReport.conditioning.humHz, 0, "worker default must keep hum filtering opt-in");
assert.deepEqual(storedReport.issues.map(issue => issue.field), ["mastering"], "conditioning never grants approval");
assert(outputBytes);
assert.match(storedReport.repairs.join(" "), /350 ms logarithmic/);
assert.match(storedReport.repairs.join(" "), /measured output/);
const bothReport = await prepareReleaseAudio(song, storedMaster, "revision", { humHz: "both" });
assert.equal(bothReport.conditioning.humHz, "both");
assert.match(bothReport.repairs.join(" "), /50 and 60 Hz/);

// A persisted approved floating-point WAV is playable, but outside the automatic PCM conditioner.
const floatWav = wav({ bits: 32, seconds: 1 });
for (let offset = 44; offset < floatWav.length; offset += 4) {
  floatWav.writeFloatLE(floatWav.readInt32LE(offset) / 2 ** 31, offset);
}
floatWav.writeUInt16LE(3, 20);
const mastered = [{ ...storedMaster[0], mastering_status: "approved", audio_byte_size: floatWav.length }];
stores.source.get = async () => floatWav;
stores.output.set = async () => assert.fail("Routine processing must not recondition an approved master");
const savedMaster = structuredClone(mastered);
const radio = { ...external[0], id: "radio", version_type: "radio_edit", audio_url: "/radio.wav" };
const ports = { prepareAudio: prepareReleaseAudio, checkpoint: async () => {}, finish: async () => {},
  assertCurrent: async () => {}, handoff: async () => ({ status: "ready_for_publication", externalDistribution: "not_submitted" }) };
const run = changes => runReleaseConveyor({ song, versions: [...mastered, radio], ports, ...changes });
const masteredReady = await run();
assert.equal(masteredReady.status, "ready");
assert.deepEqual(masteredReady.receipt.passed, RELEASE_STAGES);
assert.equal(masteredReady.package.audio.conditioning, "approved_master");
assert.equal(masteredReady.package.audio.downloadUrl, undefined);
assert.match(masteredReady.package.audio.summary, /Saved Sale-master mastering approval recognized/);
assert.equal(masteredReady.package.handoff.externalDistribution, "not_submitted");
assert.deepEqual(mastered, savedMaster, "routine processing cannot mutate approval or the source");
const filterRequested = await run({ options: { humHz: 50 } });
assert.equal(filterRequested.status, "escalated", "an explicit unsupported conditioning request still needs review");
assert(filterRequested.receipt.blocked.some(issue => /PCM WAV/.test(issue.message)));
const reviewVersions = [...mastered.map(master => ({ ...master, mastering_status: "review" })), radio];
const reviewBlocked = await run({ versions: reviewVersions });
assert.equal(reviewBlocked.status, "escalated");
assert(reviewBlocked.receipt.blocked.some(issue => issue.field === "mastering"));
const approvalSaved = await run({ previous: reviewBlocked, automatic: true });
assert.equal(approvalSaved.status, "ready", "saving approval changes the fingerprint and automatically re-evaluates council and downstream stages");
const oldPipeline = { ...masteredReady, pipelineVersion: 4, inputHash: "pre-fix-revision", status: "escalated" };
assert.equal((await run({ previous: oldPipeline, automatic: true })).status, "ready", "old false escalations are invalidated by the pipeline revision");
for (const [change, field] of [
  [{ audio_url: "", drive_url: "https://drive.google.com/file/d/archive/view" }, "sale_master_audio"],
  [{ audio_url: "blob:https://halo.invalid/local-preview" }, "sale_master_audio"],
  [{ audio_url: "https://drive.google.com/file/d/archive/view" }, "sale_master_audio"],
  [{ audio_url: "/api/song-catalog/audio?versionId=another-version" }, "sale_master_audio"],
  [{ audio_url: "javascript:alert(1)" }, "sale_master_audio"],
  [{ duration_seconds: 0 }, "sale_master_duration"],
  [{ duration_seconds: null }, "sale_master_duration"],
  [{ duration_seconds: Infinity }, "sale_master_duration"],
  [{ duration_seconds: "NaN" }, "sale_master_duration"],
  [{ song_id: "foreign" }, "catalog"],
  [{ status: "archived" }, "catalog"],
  [{ audio_blob_prefix: "other/master/upload/parts/" }, "sale_master_storage"],
  [{ audio_storage_key: "masters/other/song/master/upload/master.wav" }, "sale_master_storage"],
]) {
  const blocked = await run({ versions: [{ ...mastered[0], ...change }, radio] });
  assert.notEqual(blocked.status, "ready", JSON.stringify(change));
  assert(blocked.receipt.blocked.some(issue => issue.field === field), JSON.stringify(change));
  assert.equal(blocked.package.handoff, undefined);
}
for (const status of ["not_started", "queued", "in_progress", "review", "unknown"]) {
  const blocked = await run({ versions: [{ ...mastered[0], mastering_status: status, audio_filename: "APPROVED_MASTER.wav" }, radio] });
  assert(blocked.receipt.blocked.some(issue => issue.field === "mastering"), "filename and audio presence never grant approval");
}
const duplicate = await run({ versions: [...mastered, { ...mastered[0], id: "duplicate" }, radio] });
assert.equal(duplicate.status, "blocked");
assert(duplicate.receipt.blocked.some(issue => issue.field === "catalog"));
for (const changes of [
  { song: { ...song, rights_status: "disputed" } },
  { song: { ...song, rights_status: "needs_review" } },
  { song: { ...song, metadata_issues: [{ field: "operator_review", level: "required", message: "Operator review required." }] } },
  { versions: mastered },
  { versions: [...mastered, { ...radio, mastering_status: "review" }] },
  { versions: [...mastered, { ...radio, duration_seconds: Infinity }] },
]) {
  const gated = await run(changes);
  assert.equal(gated.stages.find(stage => stage.name === "audio_preflight").status, "passed");
  assert.equal(gated.stages.find(stage => stage.name === "council").status, "blocked");
  assert.match(gated.stages.find(stage => stage.name === "council").summary, /Resolve:/);
  assert.equal(gated.package.handoff, undefined, "a saved master cannot bypass independent council gates");
}
stores.source.get = async () => { throw new TypeError("private storage outage"); };
const unavailable = await run({ ports: { ...ports, sleep: async () => {} }, automatic: true });
assert.equal(unavailable.status, "retryable");
assert.match(unavailable.receipt.nextSteps.join(" "), /storage is unavailable or incomplete/);
assert.doesNotMatch(JSON.stringify(unavailable), /private storage outage/);
stores.source.get = async () => floatWav;
const storageRecovered = await run({ previous: { ...unavailable, nextRetryAt: "2026-01-01T00:00:00Z" }, automatic: true });
assert.equal(storageRecovered.status, "ready", "same catalog data retries safely after storage recovers");

stores.source.get = async () => null;
await assert.rejects(() => prepareReleaseAudio(song, storedMaster, "revision"),
  error => error.retryable === true && /chunk is missing/.test(error.message));
stores.source.get = async () => { throw new TypeError("fetch failed"); };
await assert.rejects(() => prepareReleaseAudio(song, storedMaster, "revision"),
  error => error.retryable === true && /storage read failed/.test(error.message));
stores.source.get = async () => new ArrayBuffer(10);
await assert.rejects(() => prepareReleaseAudio(song, storedMaster, "revision"),
  error => error.retryable === true && /incomplete/.test(error.message));
stores.source.get = async () => new ArrayBuffer(sourceWav.length + 1);
const oversizedStored = await prepareReleaseAudio(song, storedMaster, "revision");
assert(oversizedStored.issues.some(issue => /size changed/.test(issue.message)));
const malformedOwnership = await prepareReleaseAudio(song,
  [{ ...storedMaster[0], audio_blob_prefix: "other/master/upload/parts/" }], "revision");
assert(malformedOwnership.issues.some(issue => issue.outcome === "escalate"));
stores.source.get = async () => new ArrayBuffer(sourceWav.length);
const malformedPcm = await prepareReleaseAudio(song, storedMaster, "revision");
assert(malformedPcm.issues.some(issue => /PCM WAV/.test(issue.message)));
stores.source.get = async () => sourceWav.buffer.slice(sourceWav.byteOffset, sourceWav.byteOffset + sourceWav.byteLength);
stores.output.set = async () => { throw new TypeError("fetch failed"); };
await assert.rejects(() => prepareReleaseAudio(song, storedMaster, "revision"),
  error => error.retryable === true && /storage write failed/.test(error.message));

const savedFetch = globalThis.fetch;
const envValues = {
  HALO_MASTER_STORAGE_BUCKET: "contract-bucket",
  HALO_MASTER_STORAGE_ACCESS_KEY_ID: "contract-placeholder",
  HALO_MASTER_STORAGE_SECRET_ACCESS_KEY: "contract-placeholder",
  HALO_MASTER_STORAGE_ENDPOINT: "https://storage.invalid",
};
const savedEnv = Object.fromEntries(Object.keys(envValues).map(key => [key, process.env[key]]));
Object.assign(process.env, envValues);
const objectMaster = [{ ...storedMaster[0], audio_storage_key: "masters/owner/song/master/upload/master.wav" }];
try {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    globalThis.fetch = async () => new Response(null, { status });
    await assert.rejects(() => prepareReleaseAudio(song, objectMaster, "revision"),
      error => error.status === status && error.retryable === true, `HTTP ${status} must reach retry classification`);
  }
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(() => prepareReleaseAudio(song, objectMaster, "revision"),
    error => error.retryable === true);
  globalThis.fetch = async () => new Response(null, { status: 403 });
  const forbidden = await prepareReleaseAudio(song, objectMaster, "revision");
  assert(forbidden.issues.some(issue => issue.outcome === "escalate" && /storage read failed/.test(issue.message)));
  globalThis.fetch = async () => new Response(sourceWav.subarray(0, 10));
  await assert.rejects(() => prepareReleaseAudio(song, objectMaster, "revision"),
    error => error.retryable === true && /incomplete/.test(error.message));
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError("network interrupted")); },
  }));
  await assert.rejects(() => prepareReleaseAudio(song, objectMaster, "revision"),
    error => error.retryable === true && /network read failed/.test(error.message));
  globalThis.fetch = async () => new Response(Buffer.alloc(sourceWav.length + 1));
  const oversizedObject = await prepareReleaseAudio(song, objectMaster, "revision");
  assert(oversizedObject.issues.some(issue => /size changed/.test(issue.message)));
} finally {
  globalThis.fetch = savedFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
console.log("Release audio contracts passed: preservation, fade, hum, BS.1770 gates/measurements, gain/peak bounds, fallback, approval boundaries and storage retry classification.");
