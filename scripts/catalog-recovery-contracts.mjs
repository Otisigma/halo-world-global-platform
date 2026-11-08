import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { File } from "node:buffer";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { recoveryFromCatalog, validateRecovery, fingerprintRecoveryFile, nextRecoveryAction,
  recoveryAssetPath, printableRecovery, offlineRecoveryHtml, MAX_RECOVERY_FILE_BYTES } from "../lib/catalog-recovery.js";
import { recoveryZip } from "../lib/recovery-zip.js";
import { verifyRecoveryDirectory } from "./verify-recovery.mjs";
import { masterProvenanceStatusDetail } from "../song-catalog/master-provenance-panel.js";

const songId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const catalog = () => recoveryFromCatalog([{ id: songId, title: "Quiet Heart", artistName: "Artist",
  versions: [{ id: versionId, versionType: "sale_master", label: "Sale master", audioFilename: "master.wav",
    audioByteSize: 4, persistedAudio: true }] }]);
const bytes = Uint8Array.of(1, 2, 3, 4);

test("catalog recovery preserves metadata but never treats a registered file as a checked backup or stamp", () => {
  const record = catalog(), version = record.songs[0].versions[0];
  assert.equal(version.catalogStorage, "reported_saved");
  assert.equal(version.file, null);
  assert.equal(version.backup, null);
  assert.equal(version.observation, null);
  assert.match(nextRecoveryAction(version), /Choose your local file/);
  const many = recoveryFromCatalog(Array.from({ length: 50 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`, title: `Song ${index}`, artistName: "",
    versions: [{ id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`, label: "Master", versionType: "sale_master" }],
  })));
  assert.equal(many.songs.length, 50);
});

test("local originals and copies hash exact bytes with bounds and malformed import rejection", async () => {
  const file = new File([bytes], "master.wav");
  const digest = await fingerprintRecoveryFile(file);
  assert.equal(digest.sha256, createHash("sha256").update(bytes).digest("hex"));
  const same = await fingerprintRecoveryFile(new File([bytes], "renamed.wav"));
  assert.equal(same.sha256, digest.sha256);
  const different = await fingerprintRecoveryFile(new File([Uint8Array.of(1,2,3,5)], "master.wav"));
  assert.notEqual(different.sha256, digest.sha256);
  await assert.rejects(fingerprintRecoveryFile({ size: MAX_RECOVERY_FILE_BYTES + 1, arrayBuffer() {} }), /200 MiB/);
  await assert.rejects(fingerprintRecoveryFile({ size: 2, arrayBuffer: async () => new ArrayBuffer(1) }), /completely/);
  await assert.rejects(fingerprintRecoveryFile(file, {}), /unavailable/);
  const record = catalog(), version = record.songs[0].versions[0];
  version.file = digest;
  assert.match(nextRecoveryAction(version), /separate storage/);
  version.backup = { ...same, location: "Safe USB" };
  const imported = validateRecovery(JSON.parse(JSON.stringify(record)));
  assert.equal(imported.songs[0].versions[0].backup.location, "Safe USB");
  version.backup.sha256 = different.sha256;
  assert.throws(() => validateRecovery(record), /Backup must match/);
  version.backup = null;
  record.songs.push(record.songs[0]);
  assert.throws(() => validateRecovery(record), /unique/);
  assert.throws(() => validateRecovery({ schema: "future", songs: [] }), /valid HALO/);
  const invalidDate = catalog();
  invalidDate.createdAt = "bad date";
  assert.throws(() => validateRecovery(invalidDate), /invalid date/);
  const invalidDigest = catalog();
  invalidDigest.songs[0].versions[0].file = { ...digest, sha256: "not a digest" };
  assert.throws(() => validateRecovery(invalidDigest), /fingerprint/);
  const oversized = catalog();
  oversized.songs[0].versions = Array.from({ length: 101 }, () => ({ ...oversized.songs[0].versions[0] }));
  assert.throws(() => validateRecovery(oversized), /versions/);
  const names = catalog();
  names.songs[0].versions[0].file = { ...digest, name: "CON.wav" };
  assert.match(recoveryAssetPath(names.songs[0], names.songs[0].versions[0]), /asset-CON.wav$/);
});

test("printable register and standalone HTML escape user content and do not claim signed recovery", () => {
  const record = catalog();
  record.songs[0].title = "</script><img src=x onerror=alert(1)>";
  const printed = printableRecovery(record), offline = offlineRecoveryHtml(record);
  assert.match(printed, /&lt;\/script&gt;/);
  assert.doesNotMatch(printed, /<img/);
  assert.match(printed, /No HALO stamp confirmed/);
  assert.match(offline, /connect-src 'none'/);
  assert.doesNotMatch(offline, /fetch\(|src="https|type="module"/);
  assert.match(offline, /\\u003c\/script\\u003e/);
  assert.match(offline, /break-before:page/);
  assert.match(offline, /No local file checked/);
});

test("ZIP packs restore actual unchanged files and offline verifier catches missing, changed and out-of-pack assets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "halo-recovery-"));
  try {
    const record = catalog(), version = record.songs[0].versions[0];
    const file = new File([bytes], "../../danger master.wav");
    version.file = await fingerprintRecoveryFile(file);
    const relative = recoveryAssetPath(record.songs[0], version);
    assert.doesNotMatch(relative, /\.\.\//);
    const source = await readFile(new URL("../lib/catalog-recovery.js", import.meta.url), "utf8");
    const script = await readFile(new URL("./verify-recovery.mjs", import.meta.url), "utf8");
    const archive = await recoveryZip([
      { name: relative, blob: file },
      { name: "manifest.json", blob: new Blob([JSON.stringify(record)]) },
      { name: "register.html", blob: new Blob([offlineRecoveryHtml(record)]) },
      { name: "recovery-core.mjs", blob: new Blob([source]) },
      { name: "verify-recovery.mjs", blob: new Blob([script]) },
    ]);
    const zipPath = path.join(root, "pack.zip"), restored = path.join(root, "restored");
    await writeFile(zipPath, Buffer.from(await archive.arrayBuffer()));
    const extract = spawnSync("python3", ["-c",
      "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])", zipPath, restored], { encoding: "utf8" });
    assert.equal(extract.status, 0, extract.stderr);
    assert.deepEqual(new Uint8Array(await readFile(path.join(restored, relative))), bytes);
    assert.equal((await verifyRecoveryDirectory(restored)).results[0].state, "matched");
    const offline = spawnSync(process.execPath, [path.join(restored, "verify-recovery.mjs"), restored], { encoding: "utf8" });
    assert.equal(offline.status, 0, offline.stderr);
    await writeFile(path.join(restored, relative), Uint8Array.of(9));
    assert.equal((await verifyRecoveryDirectory(restored)).results[0].state, "different");
    assert.equal(spawnSync(process.execPath, [path.join(restored, "verify-recovery.mjs"), restored]).status, 1);
    await rm(path.join(restored, relative));
    assert.equal((await verifyRecoveryDirectory(restored)).results[0].state, "missing");
    const outside = path.join(root, "outside.wav");
    await writeFile(outside, bytes);
    await symlink(outside, path.join(restored, relative));
    await assert.rejects(verifyRecoveryDirectory(restored), /outside the pack/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ZIP paths reject traversal, duplicates and unsupported archive sizes", async () => {
  await assert.rejects(recoveryZip([{ name: "../secret", blob: new Blob(["x"]) }]), /path/);
  await assert.rejects(recoveryZip([{ name: "/absolute", blob: new Blob(["x"]) }]), /path/);
  await assert.rejects(recoveryZip([{ name: "a", blob: new Blob(["x"]) }, { name: "a", blob: new Blob(["x"]) }]), /duplicate/);
  await assert.rejects(recoveryZip([]), /entry count/);
  const oversized = new Blob([]);
  Object.defineProperty(oversized, "size", { value: 2 * 1024 * 1024 * 1024 });
  await assert.rejects(recoveryZip([{ name: "oversized.wav", blob: oversized }]), /2 GiB/);
});

test("satellite wires private catalog reads, local-only files, clear unsaved state and explicit recovery limits", async () => {
  const ui = await readFile(new URL("../catalog-recovery/recovery.js", import.meta.url), "utf8");
  const markup = await readFile(new URL("../catalog-recovery/index.html", import.meta.url), "utf8");
  const catalogHtml = await readFile(new URL("../song-catalog/index.html", import.meta.url), "utf8");
  assert.match(ui, /credentials: "same-origin"/);
  assert.doesNotMatch(ui, /method: "POST"|localStorage|indexedDB|formData\.append/);
  assert.match(ui, /beforeunload/);
  assert.match(ui, /historical assertion, not authenticated this visit/);
  assert.doesNotMatch(ui, /selectedRecord === record\) changed = false/);
  assert.match(ui, /fingerprintRecoveryFile\(file\)/);
  assert.match(ui, /version\.backup = null/);
  assert.match(markup, /ZIP downloads are not encrypted/);
  assert.match(markup, /Nothing is autosaved/);
  assert.match(markup, /Add a device-only song/);
  assert.match(markup, /webkitdirectory/);
  assert.match(catalogHtml, /href="\/catalog-recovery\/"/);
  assert.match(ui, /masterProvenanceStatusDetail\(error.result\)/);
  assert.match(masterProvenanceStatusDetail("keys_missing"), /No verified stamp/);
  assert.doesNotMatch(masterProvenanceStatusDetail("keys_missing"), /HALO_PROVENANCE|migration|keys_missing/);
  assert.match(masterProvenanceStatusDetail("unauthenticated"), /Sign in/);
});
