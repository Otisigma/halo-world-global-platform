import { recoveryFromCatalog, validateRecovery, fingerprintRecoveryFile, nextRecoveryAction,
  recoveryAssetPath, printableRecovery, offlineRecoveryHtml, MAX_RECOVERY_PACK_BYTES, RECOVERY_FILE_ROLES } from "../lib/catalog-recovery.js";
import { recoveryZip } from "../lib/recovery-zip.js";
import { createCatalogMasterProvenanceApi, masterProvenanceStatusDetail } from "../song-catalog/master-provenance-panel.js";

const $ = selector => document.querySelector(selector);
const sourceFiles = new Map(), authenticatedThisVisit = new Set(), backupLocations = new Map(), reopenDrafts = new Map();
let record = null, busy = false, changed = false;
const provenance = createCatalogMasterProvenanceApi();
const say = message => { $("#status").textContent = message; };
const element = (tag, value, className = "") => {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  if (className) node.className = className;
  return node;
};

async function run(operation) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("main button,main input,main textarea,main select,#localSongDialog button,#localSongDialog input").forEach(node => { node.disabled = true; });
  try { await operation(); }
  catch (error) { say(`Not completed: ${error.result ? masterProvenanceStatusDetail(error.result) : error.message}`); }
  finally { busy = false; render(); }
}

function log(version, action) {
  version.log.push({ at: new Date().toISOString(), action });
  if (version.log.length > 100) version.log.shift();
  changed = true;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob), link = element("a");
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function field(label, value, onChange, multiline = false, limit = multiline ? 1000 : 160) {
  const wrapper = element("label", label);
  const input = element(multiline ? "textarea" : "input");
  input.value = value; input.maxLength = limit;
  input.addEventListener("input", () => { onChange(input.value); changed = true; });
  wrapper.append(input);
  return wrapper;
}

function choice(label, value, options, onChange) {
  const wrapper = element("label", label), select = element("select");
  for (const [key, name] of Object.entries(options)) {
    const option = element("option", name);
    option.value = key; select.append(option);
  }
  select.value = value;
  select.addEventListener("change", () => { onChange(select.value); changed = true; });
  wrapper.append(select);
  return wrapper;
}

function projectFields(song) {
  const details = element("details"), project = song.project;
  details.append(element("summary", "Project handover: DAW, dependencies and session test"));
  details.append(element("p", "These are your declarations, not automatically detected metadata. Keep external media paths relative where possible; do not enter signed URLs, secrets or private licence keys. Files use per-version pack paths: HALO does not rebuild DAW folders, relink media or reopen a session."));
  for (const [key, label, multiline] of [
    ["daw", "DAW name", false], ["dawVersion", "DAW version", false],
    ["plugins", "Plugins — names and exact versions (one per line)", true],
    ["libraries", "Sample libraries — names and exact versions (one per line)", true],
    ["routingAutomation", "Routing and automation notes", true],
    ["externalMedia", "External-media locations / relative paths (references only)", true],
    ["availabilityNotes", "Availability and missing dependencies", true],
    ["licenceNotes", "Licence / transfer restrictions (no keys)", true],
    ["versionNotes", "Version notes and reference-render comparison instructions", true]
  ]) details.append(field(label, project[key], value => { project[key] = value; record.packInventory = null; }, multiline));
  for (const [key, label, maximum, step] of [["sampleRateHz", "Sample rate (Hz)", 768000, "1"], ["tempoBpm", "Tempo (BPM)", 1000, "any"]]) {
    const wrapper = field(label, project[key] ?? "", value => {
      project[key] = value === "" ? null : Number(value); record.packInventory = null;
    });
    const input = wrapper.querySelector("input");
    input.type = "number"; input.min = "1"; input.max = String(maximum); input.step = step;
    details.append(wrapper);
  }
  details.append(element("p", project.reopenTest
    ? `Historical human test declaration: ${project.reopenTest.result} · recorded ${project.reopenTest.recordedAt}. Not independently verified, not a test of this exported pack. ${project.reopenTest.details}`
    : "Session reopening: not tested / no result recorded. Exporting or matching files cannot change this status."));
  const draft = reopenDrafts.get(song.id) || { result: "", details: "" };
  reopenDrafts.set(song.id, draft);
  details.append(choice("Declare a test you performed outside HALO", draft.result,
    { "": "Choose the outcome of your actual test", passed: "I tested reopening successfully", failed: "I tested reopening and it failed" },
    value => { draft.result = value; }));
  details.append(field("Test details — device / OS, DAW version, missing dependencies and reference comparison", draft.details, value => { draft.details = value; }, true));
  const save = element("button", "Record my session test declaration");
  save.type = "button";
  save.addEventListener("click", () => {
    if (busy) return;
    if (!["passed", "failed"].includes(draft.result) || !draft.details.trim()) {
      say("Not recorded: choose a result and describe the test you actually performed, including the target environment and reference comparison."); return;
    }
    project.reopenTest = { result: draft.result, details: draft.details.trim(), recordedAt: new Date().toISOString() };
    changed = true; record.packInventory = null;
    say("Historical session test declaration recorded. HALO did not reopen or verify the session."); render();
  });
  details.append(save);
  if (project.reopenTest) {
    const clear = element("button", "Clear my session test declaration");
    clear.type = "button";
    clear.addEventListener("click", () => {
      if (busy) return;
      project.reopenTest = null; reopenDrafts.delete(song.id); record.packInventory = null;
      changed = true; say("Session test declaration cleared. Reopening is now not tested / no result recorded."); render();
    });
    details.append(clear);
  }
  return details;
}

function picker(label, handler) {
  const wrapper = element("label", label), input = element("input");
  input.type = "file";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void run(() => handler(file));
  });
  wrapper.append(input);
  return wrapper;
}

async function checkObservation(song, version) {
  authenticatedThisVisit.delete(version.id);
  const history = await provenance.getHistory({ songId: song.id, versionId: version.id });
  const selected = history.observations.find(item => item.matchesCurrentSource);
  if (!selected) throw new Error("No current HALO observation is available. Local recovery does not require a HALO stamp.");
  const manifest = await provenance.getManifest({ songId: song.id, versionId: version.id, observationId: selected.observationId });
  if (manifest.observationId !== selected.observationId || manifest.sha256 !== selected.sha256
    || manifest.byteSize !== selected.byteSize || manifest.createdAt !== selected.createdAt) throw new Error("HALO observation did not match its authenticated manifest.");
  version.observation = { id: manifest.observationId, sha256: manifest.sha256, bytes: manifest.byteSize,
    recordedAt: manifest.createdAt, checkedAt: new Date().toISOString() };
  authenticatedThisVisit.add(version.id);
  log(version, "HALO observation authenticated by the server");
  say("HALO observation authenticated for this visit. This does not prove ownership or retained storage.");
}

function render() {
  document.querySelectorAll("main button,main input,main textarea,main select,#localSongDialog button,#localSongDialog input").forEach(node => { node.disabled = busy; });
  $("#loadCatalog").disabled = busy;
  $("#importManifest").disabled = busy;
  for (const name of ["saveManifest", "exportPack", "printRegister", "clearWorkspace"]) $("#"+name).disabled = !record || busy;
  $("#bulkFiles").disabled = !record || busy;
  $("#bulkFolder").disabled = !record || busy;
  $("#songs").replaceChildren();
  if (!record) { $("#summary").textContent = ""; $("#printedRegister").replaceChildren(); return; }
  const versions = record.songs.flatMap(song => song.versions);
  $("#summary").textContent = `${record.songs.length} songs · ${versions.length} versions · ${sourceFiles.size} local files selected · ${versions.filter(v => v.backup).length} historical matching-copy checks. Device separation is not confirmed.`;
  for (const song of record.songs) {
    const section = element("section", "", "song");
    section.append(element("h2", song.title), element("p", `${song.artist} · SID ${song.id}`, "identifier"));
    section.append(field("Declared rights status (not legally verified)", song.rightsDeclaration,
      value => { song.rightsDeclaration = value; }, false, 120));
    section.append(field("Agreement references / declared collaborator shares (no secrets)", song.agreements, value => { song.agreements = value; }, true),
      field("Recovery and solicitor instructions (no passwords or private keys)", song.accessPlan, value => { song.accessPlan = value; }, true));
    section.append(projectFields(song));
    for (const version of song.versions) {
      const article = element("article", "", "version");
      article.append(element("h3", `${version.label} · ${version.type}`));
      article.append(choice("File role in this project", version.role, RECOVERY_FILE_ROLES, value => {
        version.role = value; record.packInventory = null;
      }));
      article.append(choice("Related session / version in this song", version.relatedVersionId,
        { "": "Not linked", ...Object.fromEntries(song.versions.filter(item => item.id !== version.id).map(item => [item.id, `${item.label} (${item.role})`])) },
        value => { version.relatedVersionId = value; record.packInventory = null; }));
      article.append(element("p", `Catalog: ${version.catalogStorage} (not checked here). ${version.catalogFilename || "No filename reported"}`, "hint"));
      article.append(element("p", version.file
        ? `Local fingerprint: ${version.file.name} · ${version.file.bytes} bytes · ${sourceFiles.has(version.id) ? "file selected this visit" : "historical record only; reselect file to export it"}`
        : "No local file selected or checked."));
      if (version.file) article.append(element("code", version.file.sha256));
      article.append(element("p", version.backup
        ? `Copy matched at ${version.backup.checkedAt}: ${version.backup.location}. Historical check; continuing availability is not guaranteed.`
        : "Backup not checked."));
      article.append(element("p", version.observation
        ? `HALO observation ${version.observation.id}: ${authenticatedThisVisit.has(version.id) ? "authenticated by server this visit" : "imported / historical assertion, not authenticated this visit"}`
        : "No authenticated HALO stamp here. A local fingerprint is not a HALO signature."));
      const actions = element("div", "", "version-actions");
      actions.append(picker("Choose the local file for this version", async file => {
        const fingerprint = await fingerprintRecoveryFile(file);
        if (version.file && (version.file.sha256 !== fingerprint.sha256 || version.file.bytes !== fingerprint.bytes)) version.backup = null;
        version.file = fingerprint; sourceFiles.set(version.id, file);
        record.packInventory = null;
        log(version, "Selected local file fingerprint checked");
        say("Local file checked. No audio uploaded and no signed HALO stamp issued.");
      }));
      let location = backupLocations.get(version.id) ?? version.backup?.location ?? "";
      actions.append(field("Name the backup location (e.g. safe USB; no passwords)", location, value => {
        location = value; backupLocations.set(version.id, value);
      }));
      actions.append(picker("Choose the copy from that backup location", async file => {
        if (!version.file) throw new Error("Choose and check the original version file first.");
        if (!location.trim()) throw new Error("Give this backup location a name first.");
        const fingerprint = await fingerprintRecoveryFile(file);
        if (fingerprint.sha256 !== version.file.sha256 || fingerprint.bytes !== version.file.bytes) {
          version.backup = null; log(version, "Selected backup bytes differed");
          throw new Error("The selected backup differs. No matching-copy check is confirmed.");
        }
        version.backup = { ...fingerprint, location: location.trim() };
        log(version, "Selected backup bytes matched; physical separation declared, not verified");
        say("Selected copy matches the fingerprint. We cannot confirm it is on a separate physical device.");
      }));
      if (version.type === "sale_master" && song.releaseStatus !== "device_only_not_published") {
        const check = element("button", "Check existing HALO observation");
        check.type = "button"; check.addEventListener("click", () => void run(() => checkObservation(song, version)));
        actions.append(check);
      }
      article.append(actions, element("p", nextRecoveryAction(version), "next"));
      if (["supporting_document", "project_file"].includes(version.type)) {
        const remove = element("button", "Remove this attached project file from the register");
        remove.type = "button";
        remove.addEventListener("click", () => {
          if (busy || !window.confirm("Remove this attached file from the local register and future exports? The original device file is not deleted.")) return;
          song.versions = song.versions.filter(item => item.id !== version.id);
          for (const item of song.versions) if (item.relatedVersionId === version.id) item.relatedVersionId = "";
          record.packInventory = null;
          sourceFiles.delete(version.id); backupLocations.delete(version.id); authenticatedThisVisit.delete(version.id);
          changed = true; say("Attached project file and its links removed from this register. No device file deleted."); render();
        });
        article.append(remove);
      }
      section.append(article);
    }
    let attachmentRole = "supporting_document";
    section.append(choice("Role for the next attached file", attachmentRole, RECOVERY_FILE_ROLES, value => { attachmentRole = value; }));
    section.append(picker("Add a session, stem, reference render or supporting file (local only)", async file => {
      if (song.versions.length >= 100 || record.songs.reduce((total, item) => total + item.versions.length, 0) >= 5000) {
        throw new Error("This register has reached its version limit. Use a separate register for additional documents.");
      }
      const fingerprint = await fingerprintRecoveryFile(file);
      song.versions.push({ id: crypto.randomUUID(), label: file.name.slice(0, 160), type: "project_file",
        role: attachmentRole, relatedVersionId: "",
        catalogFilename: "", catalogBytes: 0, catalogStorage: "not_confirmed",
        file: fingerprint, backup: null, observation: null, log: [{ at: fingerprint.checkedAt, action: "Local project file selected and fingerprinted; role declared, not inspected" }] });
      sourceFiles.set(song.versions.at(-1).id, file); changed = true; record.packInventory = null;
      say("Project file selected locally. Its role is declared, not inspected. No session portability or legal ownership established.");
    }));
    const exportSong = element("button", "Download this song's recovery pack");
    exportSong.type = "button";
    exportSong.addEventListener("click", () => void run(() => exportRecoveryPack({ ...record, songs: [song] })));
    section.append(exportSong);
    $("#songs").append(section);
  }
  document.querySelectorAll("#songs button,#songs input,#songs textarea,#songs select").forEach(node => { node.disabled = busy; });
}

$("#loadCatalog").addEventListener("click", () => void run(async () => {
  if (record) throw new Error("Save your current draft, then clear the workspace before loading another catalog.");
  let response = await fetch("/api/song-catalog", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Catalog unavailable. You can still reopen a saved recovery manifest.");
  let data = await response.json();
  if (!data.authenticated) {
    if (!window.haloIdentity?.login) throw new Error("Sign-in is loading. Open My catalog to sign in, then return here.");
    await window.haloIdentity.login();
    response = await fetch("/api/song-catalog", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("Catalog could not be loaded after sign-in.");
    data = await response.json();
  }
  if (!data.authenticated) throw new Error("Sign in as the catalog owner before loading private records.");
  record = recoveryFromCatalog(data.songs);
  changed = true;
  say("Catalog loaded. No audio copied yet. Choose your local files; only those files enter the recovery pack.");
}));

$("#addLocalSong").addEventListener("click", () => { if (!busy) $("#localSongDialog").showModal(); });
$("#cancelLocalSong").addEventListener("click", () => $("#localSongDialog").close());
$("#localSongForm").addEventListener("submit", event => {
  event.preventDefault();
  if (busy) return;
  try {
    if (record?.songs.length >= 500) throw new Error("Recovery registers are limited to 500 songs.");
    const form = new FormData(event.currentTarget), id = crypto.randomUUID(), versionId = crypto.randomUUID();
    const local = recoveryFromCatalog([{ id, title: String(form.get("title")).trim(), artistName: String(form.get("artist") || "").trim(),
      pipelineStatus: "device_only_not_published",
      versions: [{ id: versionId, label: "Sale master", versionType: "sale_master" }] }]);
    if (!local.songs[0].title) throw new Error("Enter a song title, not just spaces.");
    if (record) record = validateRecovery({ ...record, songs: [...record.songs, local.songs[0]] });
    else record = local;
    changed = true; event.currentTarget.reset(); $("#localSongDialog").close();
    say("Device-only song added to this local register. Choose its file next. Nothing uploaded, published or signed."); render();
  } catch (error) { say(`Not completed: ${error.message}`); }
});

for (const id of ["bulkFiles", "bulkFolder"]) {
  $("#"+id).addEventListener("change", event => {
    const files = Array.from(event.target.files || []);
    if (!files.length || !record) return;
    void run(async () => {
      if (files.length > 5000) throw new Error("Select no more than 5000 files at once.");
      const versions = record.songs.flatMap(song => song.versions);
      let assigned = 0;
      const skipped = [];
      for (const file of files) {
        say(`Checking selected originals locally: ${assigned} assigned. Reading ${file.name}…`);
        const candidates = versions.filter(v => v.file
          ? v.file.bytes === file.size
          : v.catalogFilename === file.name && v.catalogBytes === file.size);
        if (!candidates.length) { skipped.push(file.name); continue; }
        const fingerprint = await fingerprintRecoveryFile(file);
        let matches = candidates.filter(v => v.file?.sha256 === fingerprint.sha256);
        if (!matches.length) matches = candidates.filter(v => !v.file && v.catalogFilename === file.name);
        if (matches.length !== 1) { skipped.push(file.name); continue; }
        const version = matches[0];
        version.file = fingerprint; sourceFiles.set(version.id, file); log(version, "Bulk selected file fingerprint checked");
        assigned++;
      }
      say(`${assigned} files assigned by fingerprint or unique filename and size. ${skipped.length} unmatched or ambiguous: ${skipped.slice(0, 15).join(", ") || "none"}. Assign those files individually; matching a filename is not a HALO stamp.`);
    });
  });
}

$("#importManifest").addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) return;
  void run(async () => {
    if (record) throw new Error("Save and clear your current workspace before importing another register.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Manifest is limited to 10 MiB.");
    const imported = validateRecovery(JSON.parse(await file.text()));
    record = imported; record.packInventory = null;
    sourceFiles.clear(); authenticatedThisVisit.clear(); backupLocations.clear(); reopenDrafts.clear(); changed = false;
    say("Historical register imported, not authenticated. No audio imported. Reselect local files to include them in a new pack.");
  });
});

$("#saveManifest").addEventListener("click", () => void run(async () => {
  const safe = validateRecovery({ ...record, packInventory: null });
  download(new Blob([JSON.stringify(safe, null, 2)], { type: "application/json" }), "halo-recovery-manifest.json");
  say("Draft download requested. It contains records, not audio. Confirm the file was saved before closing.");
}));

$("#printRegister").addEventListener("click", () => {
  if (!record || busy) return;
  void run(async () => {
    $("#printedRegister").innerHTML = printableRecovery(record);
    window.print();
  });
});

async function exportRecoveryPack(selectedRecord) {
  const safe = validateRecovery({ ...selectedRecord, packInventory: null }), entries = [], includedIds = [];
  let total = 0;
  say("Building the recovery pack locally. Keep this tab open.");
  for (const song of safe.songs) {
    for (const version of song.versions) {
      const file = sourceFiles.get(version.id);
      if (!file) continue;
      const actual = await fingerprintRecoveryFile(file);
      if (actual.sha256 !== version.file?.sha256 || actual.bytes !== version.file.bytes) throw new Error("A selected source changed. Select and check it again.");
      total += file.size;
      if (total > MAX_RECOVERY_PACK_BYTES) throw new Error("Selected files exceed 2 GiB. Use smaller catalogs or a separate archival workflow.");
      entries.push({ name: recoveryAssetPath(song, version), blob: file });
      includedIds.push(version.id);
    }
  }
  const included = entries.length;
  if (!included) throw new Error("Select at least one actual local file. A register-only download is not a recovery pack.");
  const missing = safe.songs.flatMap(s => s.versions).filter(v => !sourceFiles.has(v.id)).length;
  const manifest = { ...safe, createdAt: new Date().toISOString(), packInventory: includedIds };
  entries.push({ name: "manifest.json", blob: new Blob([JSON.stringify(manifest, null, 2)]) },
    { name: "register.html", blob: new Blob([offlineRecoveryHtml(manifest)], { type: "text/html" }) },
    { name: "README.txt", blob: new Blob([`HALO recovery pack\n${included} actual files included; ${missing} catalog versions have no file in this pack.\nExtract the ZIP, open register.html, and select recovered files to check them.\nFor a strict full inventory check: node verify-recovery.mjs /path/to/extracted-pack\nProject context and file roles are declarations. External-media references do not include those files. Plugin and library licences may prevent transfer.\nSession reopening is NOT performed by HALO. Any recorded result is a historical human declaration, not a test of this exported pack. Open the session on the target device and compare with the reference render and stems yourself.\nNo private keys included. This ZIP is NOT encrypted. Protect it on encrypted storage.\nThe manifest is unsigned. Checks are against its fingerprints, not proof of ownership.\nKeep independent copies and legal/access instructions with your solicitor.\n`]) });
  for (const [name, url] of [["verify-recovery.mjs", "/scripts/verify-recovery.mjs"], ["recovery-core.mjs", "/lib/catalog-recovery.js"]]) {
    const response = await fetch(url, { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error("Offline recovery tools could not be loaded. No complete pack was exported.");
    entries.push({ name, blob: new Blob([await response.text()], { type: "text/javascript" }) });
  }
  const archive = await recoveryZip(entries);
  download(archive, "halo-catalog-recovery.zip");
  say(`Pack download requested: ${included} actual files; ${missing} versions missing. Confirm it saved, copy it to separate storage, extract and verify. No backup has been created merely by requesting this download.`);
}
$("#exportPack").addEventListener("click", () => void run(() => exportRecoveryPack(record)));

$("#clearWorkspace").addEventListener("click", () => {
  if (busy || !window.confirm("Clear local records and file selections? Save your draft first. This does not delete catalog songs or files.")) return;
  record = null; sourceFiles.clear(); authenticatedThisVisit.clear(); backupLocations.clear(); reopenDrafts.clear(); changed = false; $("#importManifest").value = "";
  say("Workspace cleared. No catalog songs or device files deleted."); render();
});
window.addEventListener("beforeunload", event => {
  if (!changed && !busy) return;
  event.preventDefault(); event.returnValue = "";
});
render();
