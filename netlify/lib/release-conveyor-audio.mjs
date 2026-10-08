import { getStore } from "@netlify/blobs";
import { conditionReleaseWav, MAX_PREFLIGHT_BYTES } from "./release-audio.mjs";
import { directUploadConfig, isOwnedMasterObjectKey, presignObjectUrl } from "./direct-upload-storage.mjs";

const sourceStore = () => getStore({ name: "halo-song-catalog-audio", consistency: "strong" });
const packageStore = () => getStore({ name: "halo-release-packages", consistency: "strong" });
const CHUNK_BYTES = 4 * 1024 * 1024;
const audioIssue = message => ({ field: "sale_master_audio", message, outcome: "escalate" });
const transientAudioError = message => Object.assign(new Error(message), { retryable: true });

async function storageIO(work, message) {
  try {
    return await work();
  } catch (cause) {
    const error = new Error(message);
    if (Number.isInteger(Number(cause?.status)) && Number(cause?.status) > 0) error.status = Number(cause.status);
    error.retryable = !error.status || [408, 429].includes(error.status) || error.status >= 500;
    throw error;
  }
}

async function readSource(song, master, readStore) {
  const expectedSize = Number(master.audio_byte_size);
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_PREFLIGHT_BYTES) return null;
  if (master.audio_storage_key) {
    const config = directUploadConfig();
    if (!config) throw transientAudioError("Master storage is unavailable");
    if (!isOwnedMasterObjectKey(master.audio_storage_key, {
      ownerMemberId: song.owner_member_id, songId: song.id, versionId: master.id,
    })) return null;
    const url = presignObjectUrl({ config, method: "GET", key: master.audio_storage_key, expiresIn: 60 });
    const response = await storageIO(
      () => fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) }), "Master storage network read failed");
    if (!response.ok) {
      const error = new Error("Master storage read failed");
      error.status = response.status;
      error.retryable = [408, 429].includes(response.status) || response.status >= 500;
      throw error;
    }
    if (!response.body) throw transientAudioError("Master storage is incomplete");
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > expectedSize || size > MAX_PREFLIGHT_BYTES) {
          throw Object.assign(new Error("Master storage size changed"), { retryable: false });
        }
        chunks.push(Buffer.from(chunk));
      }
    } catch (error) {
      if (error.retryable === false) throw error;
      throw transientAudioError("Master storage network read failed");
    }
    if (size !== expectedSize) throw transientAudioError("Master storage is incomplete");
    return Buffer.concat(chunks);
  }
  const prefix = String(master.audio_blob_prefix || "");
  const count = Number(master.audio_chunk_count);
  if (!prefix.startsWith(`${song.owner_member_id}/${master.id}/`) || !prefix.endsWith("/parts/")
    || !Number.isInteger(count) || count < 1 || count > MAX_PREFLIGHT_BYTES / CHUNK_BYTES) return null;
  const chunks = [];
  let size = 0;
  for (let index = 0; index < count; index++) {
    const bytes = await storageIO(
      () => readStore().get(`${prefix}${String(index).padStart(3, "0")}`, { type: "arrayBuffer" }),
      "Master upload storage read failed");
    if (!bytes) throw transientAudioError("Master upload chunk is missing");
    size += bytes.byteLength;
    if (bytes.byteLength > CHUNK_BYTES || size > expectedSize) throw new Error("Master upload size changed");
    chunks.push(Buffer.from(bytes));
  }
  if (size !== expectedSize) throw transientAudioError("Master upload is incomplete");
  return Buffer.concat(chunks);
}

export function createReleaseAudioPreparer({
  sourceStore: readStore = sourceStore, packageStore: writeStore = packageStore,
} = {}) {
  return (song, versions, inputHash, options = { humHz: 0 }) =>
    prepareAudio(song, versions, inputHash, options, readStore, writeStore);
}

export const prepareReleaseAudio = createReleaseAudioPreparer();

async function prepareAudio(song, versions, inputHash, options, readStore, writeStore) {
  const master = versions.find(version => version.version_type === "sale_master");
  const report = { originalPreserved: true, sourceVersionId: master?.id || "",
    sourceAudioUrl: master?.audio_url || "", summary: "Audio needs attention.", issues: [], repairs: [] };
  if (!master?.audio_url || !(Number(master.duration_seconds) > 0)) {
    report.issues.push(audioIssue("Upload the canonical sale master and add a valid duration."));
    return report;
  }
  const approved = master.mastering_status === "approved";
  if (!approved) report.issues.push(audioIssue("Review and approve sale-master mastering in Song Catalog. Conditioning alone is not mastering approval."));
  if (!["audio/wav", "audio/x-wav"].includes(master.audio_content_type)) {
    report.summary = approved ? "Approved external master preserved; no automatic decoding or loudness claim." : "Mastering review required.";
    report.conditioning = "external_master";
    if (options.humHz) report.issues.push(audioIssue("Notch filtering requires a stored PCM WAV; export a compatible WAV."));
    return report;
  }
  if (approved && !options.humHz && (
    Number(master.audio_byte_size) > MAX_PREFLIGHT_BYTES
    || (!master.audio_storage_key && !master.audio_blob_prefix)
  )) {
    report.summary = "Approved external WAV master preserved; automatic conditioning is unavailable for this source.";
    report.conditioning = "external_master";
    return report;
  }
  let source;
  try {
    source = await readSource(song, master, readStore);
  } catch (error) {
    if (error.retryable === true || [408, 429].includes(error.status) || error.status >= 500) throw error;
    report.issues.push(audioIssue(error.message));
    return report;
  }
  if (!source) {
    report.issues.push(audioIssue("Automatic conditioning requires an owned PCM WAV upload within 128 MB; link-only or larger masters need an external mastering review."));
    return report;
  }
  let conditioned;
  try {
    conditioned = conditionReleaseWav(source, options);
  } catch (error) {
    report.issues.push(audioIssue(error.message));
    return report;
  }
  const prefix = `${song.owner_member_id}/${song.id}/${inputHash}/audio/`;
  const count = Math.ceil(conditioned.bytes.length / CHUNK_BYTES);
  for (let index = 0; index < count; index++) {
    await storageIO(
      () => writeStore().set(`${prefix}${index}`, conditioned.bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)),
      "Conditioned audio storage write failed");
  }
  report.conditioning = conditioned.report;
  report.artifact = { prefix, chunkCount: count, byteSize: conditioned.bytes.length };
  report.downloadUrl = `/api/release-conveyor?songId=${encodeURIComponent(song.id)}&artifact=audio`;
  report.summary = "Separate conditioned WAV prepared; original and canonical master unchanged. Mastering approval remains required.";
  report.repairs = ["350 ms logarithmic fade-in applied to a separate WAV copy.",
    conditioned.report.conditionedIntegratedLufs === null
      ? "Integrated LUFS unavailable; conservative RMS fallback applied. No true-peak certification."
      : `Target -14 LUFS; measured output ${conditioned.report.achievedIntegratedLufs?.toFixed(2) ?? "unavailable"} LUFS, subject to +3 dB gain cap and -1.5 dBFS sample-peak ceiling. No true-peak certification.`];
  if (conditioned.report.peakLimited) report.repairs.push("Sample-peak ceiling limited the requested loudness gain; target loudness is not guaranteed.");
  if (options.humHz) report.repairs.push(`${options.humHz === "both" ? "50 and 60" : options.humHz} Hz notch applied to the separate copy at the creator's request.`);
  return report;
}

export async function downloadReleaseAudio(state, request) {
  const artifact = state.package?.audio?.artifact;
  const expectedPrefix = `${state.ownerMemberId}/${state.releaseId}/${state.inputHash}/audio/`;
  if (!artifact || artifact.prefix !== expectedPrefix) return Response.json({ message: "No conditioned copy is available." }, { status: 404 });
  const size = artifact.byteSize;
  const match = request.headers.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
  let start = 0, end = size - 1;
  if (request.headers.has("range")) {
    start = Number(match?.[1]);
    end = match?.[2] ? Math.min(Number(match[2]), end) : end;
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
  }
  let index = Math.floor(start / CHUNK_BYTES);
  const last = Math.floor(end / CHUNK_BYTES);
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        if (index > last) { controller.close(); return; }
        const chunk = await packageStore().get(`${artifact.prefix}${index}`, { type: "arrayBuffer" });
        if (!chunk) throw new Error("Conditioned audio chunk missing");
        const lower = index === Math.floor(start / CHUNK_BYTES) ? start % CHUNK_BYTES : 0;
        const upper = index === last ? end % CHUNK_BYTES + 1 : chunk.byteLength;
        controller.enqueue(new Uint8Array(chunk).subarray(lower, upper));
        index++;
      } catch (error) { controller.error(error); }
    },
  });
  return new Response(stream, { status: match ? 206 : 200, headers: {
    "Content-Type": "audio/wav", "Content-Length": String(end - start + 1),
    "Content-Disposition": `attachment; filename="HALO-${state.releaseId}-conditioned.wav"`,
    "Cache-Control": "private, no-store", "Accept-Ranges": "bytes",
    ...(match ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
  } });
}
