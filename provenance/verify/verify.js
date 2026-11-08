import { verifySnapshotInBrowser, compareSnapshotFile } from "../../lib/retained-record.js";

const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
let envelope = null, keys = null, epoch = 0, busy = false;
const say = text => { $("#status").textContent = text; };
async function request(action, { recordId = "", method = "GET", body, songId, versionId } = {}) {
  const query = new URLSearchParams({ action });
  if (recordId) query.set("recordId", recordId);
  if (songId) query.set("songId", songId);
  if (versionId) query.set("versionId", versionId);
  const response = await fetch(`/api/master-snapshots?${query}`, { method, credentials: "same-origin", cache: "no-store",
    signal: AbortSignal.timeout(90000),
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message || `Snapshot request failed (${response.status})`), { status: response.status });
  return data;
}

async function run(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach(button => { button.disabled = true; });
  $("#localFile").disabled = true;
  try { await fn(); } catch (error) { say(error.message || "Operation failed. No verification was confirmed."); }
  finally {
    busy = false;
    document.querySelectorAll("button").forEach(button => { button.disabled = false; });
    $("#localFile").disabled = false;
  }
}

async function loadRecord(id) {
  const requestEpoch = ++epoch;
  envelope = null;
  $("#stamp").hidden = true;
  let data;
  try { data = await request("public", { recordId: id }); }
  catch (error) {
    if (error.status !== 404) throw error;
    data = await request("manifest", { recordId: id });
  }
  const published = await request("keys");
  const record = await verifySnapshotInBrowser(data, published);
  if (requestEpoch !== epoch) return;
  if (record.recordId !== id) throw new Error("The signed record ID does not match your selection.");
  envelope = { record, signature: data.signature };
  keys = published;
  $("#facts").replaceChildren();
  for (const [label, value] of Object.entries({ "Record ID": record.recordId, "Song ID": record.songId,
    "Master version": record.versionId, "SHA-256": record.sha256, "Bytes": record.byteSize,
    "Server recorded time": record.createdAt, "Retention until": record.retainUntil,
    "Source consistency": record.sourceConsistency, "Parent snapshot": record.parentRecordId || "None",
    "Creator-declared relationship": record.relationship, "Verification key": record.keyId })) {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = label; dd.textContent = String(value); $("#facts").append(dt, dd);
  }
  $("#recordId").value = record.recordId;
  $("#stamp").hidden = false;
  $("#publicLink").hidden = true;
  say(Date.parse(record.retainUntil) <= Date.now()
    ? "Signature verified, but recorded retention has expired. No current storage guarantee is confirmed."
    : "Signature verified. Retention has not been rechecked; use the owner storage check to confirm it.");
}

async function history() {
  const data = await request("history", { songId: $("#songId").value.trim(), versionId: $("#versionId").value.trim() });
  $("#history").replaceChildren();
  for (const item of data.records) {
    const li = document.createElement("li");
    li.textContent = `${item.recordId} · ${item.state}${item.shared ? " · shared" : ""} `;
    if (item.state === "ready") {
      const button = document.createElement("button"); button.textContent = "Inspect record";
      button.addEventListener("click", () => run(() => loadRecord(item.recordId))); li.append(button);
    }
    $("#history").append(li);
  }
  if (!data.records.length) say("No retained snapshots exist for this master. Existing byte observations are separate.");
}

$("#ownerWorkspace").hidden = !params.get("song");
$("#songId").value = params.get("song") || "";
$("#versionId").value = params.get("version") || "";
$("#recordId").value = params.get("record") || "";
$("#loadHistory").addEventListener("click", () => run(history));
$("#captureForm").addEventListener("submit", event => {
  event.preventDefault();
  run(async () => {
    const form = new FormData(event.currentTarget);
    const data = await request("capture", { method: "POST", body: Object.fromEntries(form) });
    say(data.state === "ready" ? "Retained snapshot captured. Inspect its signed record." : data.message || "Capture is pending.");
    await history();
  });
});
$("#recordForm").addEventListener("submit", event => { event.preventDefault(); run(() => loadRecord($("#recordId").value.trim())); });
$("#compareFile").addEventListener("click", () => run(async () => {
  if (!envelope) throw new Error("Load and authenticate a record first.");
  const record = await verifySnapshotInBrowser(envelope, keys);
  const match = await compareSnapshotFile($("#localFile").files?.[0], record);
  say(match ? "Exact local bytes match the signed snapshot. The file was not uploaded."
    : "Local bytes differ from the signed snapshot. This does not establish whether the audio is related.");
}));
$("#verifyStored").addEventListener("click", () => run(async () => {
  if (!envelope) throw new Error("Load a signed record first.");
  const result = await request("verify", { recordId: envelope.record.recordId, method: "POST" });
  say(result.result === "retained_bytes_match" ? "Pinned retained bytes match; provider COMPLIANCE retention was confirmed at this check."
    : "Retained bytes differ. No storage match was confirmed.");
}));
for (const [button, action] of [["#shareRecord", "share"], ["#unshareRecord", "unshare"]]) {
  $(button).addEventListener("click", () => run(async () => {
    if (!envelope) throw new Error("Load a signed record first.");
    const result = await request(action, { recordId: envelope.record.recordId, method: "POST" });
    $("#publicLink").hidden = !result.shared;
    $("#publicLink").href = `/provenance/verify/?record=${encodeURIComponent(result.recordId)}`;
    say(result.shared ? "This signed record is publicly shared; private media remains private." : "Public sharing stopped. Previously downloaded records remain outside HALO.");
  }));
}
$("#downloadRecord").addEventListener("click", () => {
  if (!envelope) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...envelope, verificationKeys: keys }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `halo-snapshot-${envelope.record.recordId}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener("pagehide", () => { epoch++; envelope = null; });
if (params.get("record")) run(() => loadRecord(params.get("record")));
else if (params.get("song") && params.get("version")) run(history);
