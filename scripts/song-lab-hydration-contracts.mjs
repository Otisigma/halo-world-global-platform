import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const client = (await readFile(new URL("../dreamweaver-lab/song-lab.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/, "")
  .replace(/\}\)\(\);\s*$/, "globalThis.lab = { loadHistory, pollProject, submit, state, get restoring() { return restoring; } }; })();");
const project = {
  id: "project-one", title: "Quiet Heart HD", artistName: "Artist", status: "ready",
  creativePackage: { sonicSummary: "Saved creative package" }, createdAt: new Date().toISOString(),
};
const evidence = { durationSeconds: 30, dynamicRangeDb: 5, spectralCentroidHz: 500, peak: 0.8, channels: 2, stereoWidth: 0.5 };
const saved = {
  session: {
    id: "upload-one", ownerId: "owner-one", projectId: project.id, fileName: "original.wav",
    contentType: "audio/wav", byteSize: 4, stage: "ready", evidence,
    draft: { title: project.title, artist: project.artistName, brief: "Private brief", lyrics: "Private lyrics" },
    autoResume: true, authorized: true, createdAt: 1,
  },
  file: new Blob(["wave"], { type: "audio/wav" }),
};

function fixture({ backup = saved, ownerId = "owner-one", projects = [project], tabId = "upload-one",
  preferences = new Map(), storageError = false, vaultError = false, requestError = null } = {}) {
  const nodes = new Map(), events = new Map(), requests = [], writes = [], removed = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", checked: false, hidden: true, disabled: false, textContent: "", innerHTML: "",
      style: {}, dataset: {}, classList: { add() {}, remove() {} },
      addEventListener() {}, scrollIntoView() {}, pause() {}, load() {}, removeAttribute() {}, getAttribute() { return ""; },
    });
    return nodes.get(id);
  };
  const tabs = new Map(tabId ? [["halo-song-lab-upload-session", tabId]] : []);
  const storage = map => ({
    getItem: key => { if (storageError) throw new Error("Storage blocked"); return map.get(key) || null; },
    setItem: (key, value) => { if (storageError) throw new Error("Storage blocked"); map.set(key, value); },
    removeItem: key => map.delete(key),
  });
  const context = {
    console, Blob, File, URL: class extends URL { static createObjectURL() { return "blob:private-preview"; } },
    URLSearchParams, setTimeout, clearTimeout, location: { origin: "https://halo.test", search: "" },
    localStorage: storage(preferences), sessionStorage: storage(tabs), navigator: { onLine: true },
    document: { getElementById: node, referrer: "" },
    window: { addEventListener: (name, fn) => events.set(name, fn), dispatchEvent() {}, confirm: () => true },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    createLocalUploadVault: () => ({
      listSessions: async () => { if (vaultError) throw new Error("IndexedDB blocked"); return backup ? [structuredClone(backup.session)] : []; },
      read: async () => { if (vaultError) throw new Error("IndexedDB blocked"); return backup ? structuredClone(backup) : null; },
      saveSession: async session => writes.push(structuredClone(session)),
      remove: async id => removed.push(id),
    }),
    readSongLabJson: async url => {
      requests.push(url);
      if (requestError) throw requestError;
      if (url.includes("?projectId=")) {
        const found = projects.find(item => item.id === decodeURIComponent(url.split("=")[1]));
        if (!found) throw Object.assign(new Error("Not found"), { status: 404 });
        return { project: structuredClone(found) };
      }
      return { projects: structuredClone(projects), uploadOwnerId: ownerId };
    },
  };
  context.window.parent = context.window;
  vm.runInNewContext(client, context);
  return { context, nodes, node, events, requests, writes, removed, preferences };
}
async function settled(test) {
  for (let attempt = 0; attempt < 50 && test.context.lab.restoring; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(test.context.lab.restoring, false, "restoration must settle without polling or uploading");
  return test;
}

for (const tabId of ["upload-one", ""]) {
  const test = await settled(fixture({ tabId }));
  assert.equal(test.context.lab.state.file.size, 4);
  assert.equal(test.context.lab.state.objectUrl, "blob:private-preview");
  assert.equal(test.node("audioPreview").src, "blob:private-preview");
  assert.equal(test.node("songTitle").value, project.title);
  assert.equal(test.node("creativeBrief").value, "Private brief");
  assert.equal(test.node("resultSummary").textContent, "Saved creative package");
  assert.equal(test.node("results").hidden, false);
  assert.equal(test.node("rightsAttested").checked, false);
  assert.equal(test.node("resumeUploadButton").hidden, true);
  assert.equal(test.node("analyzeButton").disabled, true, "ready projects cannot be accidentally resubmitted");
  assert.equal(test.node("autoResumeUpload").checked, false);
  assert.equal(test.writes[0].autoResume, false, "completed projects must not launch upload/job recovery");
  assert.equal(test.writes[0].authorized, false);
  assert.equal(test.preferences.get("halo-song-lab-active-project:owner-one"), project.id);
  assert.equal(test.removed.length, 0, "completion must retain the original cached Blob");
  assert.equal(test.requests.length, 1, "history and restoration share the same authenticated read");
  await test.context.lab.submit();
  assert.match(test.node("formStatus").textContent, /complete/);
}
{
  const test = await settled(fixture({ backup: null, tabId: "" }));
  assert.equal(test.context.lab.state.project.id, project.id, "latest private ready project is the no-cache fallback");
  assert.equal(test.node("results").hidden, false);
  assert.equal(test.context.lab.state.file, null, "server package restoration must not invent a cached audio buffer");
  assert.match(test.node("dropDetail").textContent, /preview is not cached/);
}
{
  const test = await settled(fixture({ ownerId: "different-owner", projects: [], tabId: "upload-one" }));
  assert.equal(test.context.lab.state.file, null);
  assert.equal(test.context.lab.state.project, null);
  assert.equal(test.node("creativeBrief").value, "");
  assert.match(test.node("uploadRecoveryStatus").textContent, /original account/);
}
{
  const draft = structuredClone(saved);
  delete draft.session.projectId;
  draft.session.stage = "uploading"; draft.session.autoResume = false;
  const test = await settled(fixture({ backup: draft }));
  assert.equal(test.context.lab.state.file.size, 4, "unfinished work takes priority over an older ready archive project");
  assert.equal(test.context.lab.state.project, null);
  assert.equal(test.node("resumeUploadButton").hidden, false);
}
{
  const other = { ...project, id: "project-two", title: "Other saved world" };
  const preferences = new Map([["halo-song-lab-active-project:owner-one", other.id]]);
  const test = await settled(fixture({ projects: [project, other], preferences }));
  assert.equal(test.context.lab.state.project.id, other.id, "active history selection wins over a different completed local buffer");
  assert.equal(test.context.lab.state.file, null);
}
for (const failure of [{ vaultError: true }, { storageError: true }]) {
  const test = await settled(fixture({ ...failure, tabId: "" }));
  assert.equal(test.context.lab.state.project.id, project.id, "private server packages remain available when local storage fails");
  assert.equal(test.node("uploadRecovery").hidden, false);
}
{
  const test = await settled(fixture({ requestError: Object.assign(new Error("Sign in"), { status: 401 }) }));
  assert.equal(test.context.lab.state.project, null);
  assert.equal(test.context.lab.state.file, null);
  assert.match(test.node("formStatus").textContent, /recovery unavailable/);
  assert.equal(typeof test.events.get("halo-identity-ready"), "function", "identity-ready retries initialization after sign in");
}
{
  const draft = structuredClone(saved);
  draft.session.ownerId = ""; delete draft.session.projectId;
  draft.session.stage = "uploading"; draft.session.autoResume = false;
  const test = await settled(fixture({ backup: draft, requestError: new Error("Offline") }));
  assert.equal(test.context.lab.state.file.size, 4, "unbound drafts remain recoverable in the original tab while offline");
  assert.equal(test.context.lab.state.project, null);
}
{
  const draft = structuredClone(saved);
  draft.session.stage = "building"; draft.session.autoResume = false;
  const test = await settled(fixture({ backup: draft, projects: [{ ...project, status: "queued" }] }));
  // The actual polling completion path must keep the original and disable upload continuation.
  test.context.readSongLabJson = async url => url.includes("?projectId=")
    ? { project: structuredClone(project) } : { projects: [structuredClone(project)], uploadOwnerId: "owner-one" };
  await test.context.lab.pollProject(project.id);
  assert.equal(test.writes.at(-1).stage, "ready");
  assert.equal(test.writes.at(-1).autoResume, false);
  assert.equal(test.removed.length, 0);
  assert.equal(test.node("results").hidden, false);
}
console.log("Song Lab session hydration contracts passed: completed Blob retention, reload/new-tab recovery, private archive fallback, owner isolation, active-project selection, storage/auth failures and completion without re-upload.");
