export const RECOVERY_SCHEMA = "halo-catalog-recovery-v1";
export const MAX_RECOVERY_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_RECOVERY_PACK_BYTES = 2 * 1024 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{64}$/;

function text(value, limit = 1000) {
  if (typeof value !== "string" || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new Error("The recovery record contains invalid or oversized text.");
  }
  return value;
}

function date(value) {
  text(value, 40);
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error("The recovery record contains an invalid date.");
  return value;
}

export function recoveryFromCatalog(songs, now = new Date()) {
  if (!Array.isArray(songs) || !songs.length || songs.length > 500) throw new Error("Load a catalog containing 1 to 500 songs.");
  const record = {
    schema: RECOVERY_SCHEMA, createdAt: now.toISOString(),
    songs: songs.map(song => ({
      id: song.id, title: song.title, artist: song.artistName || "", isrc: song.isrc || "",
      rightsDeclaration: song.rightsStatus || "", releaseStatus: song.pipelineStatus || "",
      agreements: "", accessPlan: "",
      versions: (song.versions || []).map(version => ({
        id: version.id, label: version.label || version.versionType || "Version", type: version.versionType || "",
        catalogFilename: version.audioFilename || "", catalogBytes: Number(version.audioByteSize) || 0,
        catalogStorage: version.persistedAudio === true ? "reported_saved" : "not_confirmed",
        file: null, backup: null, observation: null, log: [],
      })),
    })),
  };
  return validateRecovery(record);
}

export function validateRecovery(value) {
  if (!value || value.schema !== RECOVERY_SCHEMA || !Array.isArray(value.songs)
    || !value.songs.length || value.songs.length > 500) throw new Error("Choose a valid HALO recovery manifest (1 to 500 songs).");
  const ids = new Set();
  let totalVersions = 0;
  const songs = value.songs.map(song => {
    if (!song || !UUID.test(song.id || "") || ids.has(song.id.toLowerCase())) throw new Error("Song IDs must be valid and unique.");
    ids.add(song.id.toLowerCase());
    if (!Array.isArray(song.versions) || song.versions.length > 100) throw new Error("Invalid song versions.");
    totalVersions += song.versions.length;
    if (totalVersions > 5000) throw new Error("The recovery catalog is too large.");
    return {
      id: song.id.toLowerCase(), title: text(song.title, 160), artist: text(song.artist, 120), isrc: text(song.isrc, 40),
      rightsDeclaration: text(song.rightsDeclaration, 120), releaseStatus: text(song.releaseStatus, 120),
      agreements: text(song.agreements), accessPlan: text(song.accessPlan),
      versions: song.versions.map(version => {
        if (!version || !UUID.test(version.id || "") || ids.has(version.id.toLowerCase())) throw new Error("Version IDs must be valid and unique.");
        ids.add(version.id.toLowerCase());
        if (!Number.isSafeInteger(version.catalogBytes) || version.catalogBytes < 0) throw new Error("Invalid catalog byte count.");
        if (!["reported_saved", "not_confirmed"].includes(version.catalogStorage)) throw new Error("Invalid catalog storage status.");
        let file = null, backup = null, observation = null;
        if (version.file !== null) {
          if (!version.file || !HEX.test(version.file.sha256 || "") || !Number.isSafeInteger(version.file.bytes)
            || version.file.bytes < 1 || version.file.bytes > MAX_RECOVERY_FILE_BYTES) throw new Error("Invalid file fingerprint.");
          file = { name: text(version.file.name, 255), bytes: version.file.bytes,
            sha256: version.file.sha256, checkedAt: date(version.file.checkedAt) };
        }
        if (version.backup !== null) {
          if (!file || !version.backup || version.backup.sha256 !== file.sha256
            || version.backup.bytes !== file.bytes) throw new Error("Backup must match the selected file fingerprint.");
          backup = { location: text(version.backup.location, 160), name: text(version.backup.name, 255),
            bytes: file.bytes, sha256: file.sha256, checkedAt: date(version.backup.checkedAt) };
        }
        if (version.observation !== null) {
          const o = version.observation;
          if (!o || !UUID.test(o.id || "") || !HEX.test(o.sha256 || "") || !Number.isSafeInteger(o.bytes)
            || o.bytes < 1) throw new Error("Invalid observation reference.");
          observation = { id: o.id, sha256: o.sha256, bytes: o.bytes, recordedAt: date(o.recordedAt), checkedAt: date(o.checkedAt) };
        }
        if (!Array.isArray(version.log) || version.log.length > 100) throw new Error("Invalid recovery log.");
        const log = version.log.map(event => ({ at: date(event.at), action: text(event.action, 120) }));
        return { id: version.id.toLowerCase(), label: text(version.label, 160), type: text(version.type, 80),
          catalogFilename: text(version.catalogFilename, 255), catalogBytes: version.catalogBytes,
          catalogStorage: version.catalogStorage, file, backup, observation, log };
      }),
    };
  });
  return { schema: RECOVERY_SCHEMA, createdAt: date(value.createdAt), songs };
}

export async function fingerprintRecoveryFile(file, cryptoProvider = globalThis.crypto) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_RECOVERY_FILE_BYTES
    || typeof file.arrayBuffer !== "function") throw new Error("Choose a non-empty file up to 200 MiB. Larger files need a separate archival workflow.");
  if (!cryptoProvider?.subtle) throw new Error("Secure file checking is unavailable. Use a current browser on HTTPS or the offline verifier.");
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size) throw new Error("The file could not be read completely.");
  const hash = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return { name: file.name, bytes: file.size,
    sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join(""),
    checkedAt: new Date().toISOString() };
}

export function nextRecoveryAction(version) {
  if (!version.file) return "Choose your local file. A catalog entry or link is not a portable audio backup.";
  if (version.observation && (version.observation.sha256 !== version.file.sha256 || version.observation.bytes !== version.file.bytes)) {
    return "Your selected file differs from the recorded HALO observation. Confirm which version you intend to preserve.";
  }
  if (!version.backup) return "Copy the file to separate storage, then select that copy to check its bytes.";
  return "Export your recovery pack, test restoring it, and arrange secure access with your solicitor. Keep another copy in a separate location.";
}

export function recoveryAssetPath(song, version) {
  if (!version.file) throw new Error("No local file has been checked.");
  let filename = version.file.name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 160).replace(/\.+$/, "_") || "asset.bin";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(filename)) filename = `asset-${filename}`;
  return `assets/${song.id}/${version.id}/${filename}`;
}

export function printableRecovery(record) {
  const safe = validateRecovery(record);
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  return `<h1>HALO music asset register</h1><p>Prepared ${escape(safe.createdAt)} · ${safe.songs.length} songs</p>
    <p>This register is a recovery map, not an audio backup, ownership certificate or valuation. Recorded checks and expected pack paths do not prove that files are included or that copies still exist. Imported manifests are not authenticated.</p>
    ${safe.songs.map(song => `<section class="song-page"><h2>${escape(song.title)}</h2>
      <p>${escape(song.artist)} · SID ${escape(song.id)} · ISRC ${escape(song.isrc || "Not recorded")}</p>
      <p>Rights declaration: ${escape(song.rightsDeclaration || "Missing")} — not legally verified. Release status: ${escape(song.releaseStatus || "Unknown")} — catalog report, not independent distribution verification.</p>
      <p>Agreement references / declared shares: ${escape(song.agreements || "Not supplied. Ask your solicitor to review credits, collaborator shares, samples and licences.")}</p>
      <p>Access plan: ${escape(song.accessPlan || "Not supplied. Arrange authorized access and inheritance instructions with your solicitor; store secrets separately.")}</p>
      ${song.versions.map(v => `<article><h3>${escape(v.label)} · ${escape(v.type)}</h3>
        <p>Version ID: ${escape(v.id)} · Catalog storage: ${escape(v.catalogStorage)} (not independently checked)</p>
        <p>File: ${escape(v.file ? `${v.file.name} · ${v.file.bytes} bytes · checked ${v.file.checkedAt}` : "No local file checked")}</p>
        ${v.file ? `<p>SHA-256: <code>${escape(v.file.sha256)}</code><br>Pack path: <code>${escape(recoveryAssetPath(song, v))}</code></p>` : ""}
        <p>Backup: ${escape(v.backup ? `${v.backup.location} · ${v.backup.name} · matched at ${v.backup.checkedAt}. Device separation and continuing availability are not confirmed.` : "No matching backup check recorded")}</p>
        <p>HALO observation: ${escape(v.observation ? `${v.observation.id} · recorded assertion of server authentication at ${v.observation.checkedAt}. This unsigned register does not authenticate that assertion or provide independent offline verification.` : "Not authenticated here. No HALO stamp confirmed.")}</p>
        <p>Next: ${escape(nextRecoveryAction(v))}</p>
        <ul>${v.log.map(e => `<li>${escape(e.at)} — ${escape(e.action)}</li>`).join("")}</ul></article>`).join("")}</section>`).join("")}`;
}

// A self-contained file:// reader: no imports, network requests, or private keys.
export function offlineRecoveryHtml(record) {
  const safe = validateRecovery(record);
  const embedded = JSON.stringify(safe).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'">
    <title>HALO recovery register</title><style>body{font:16px/1.6 system-ui;margin:24px;max-width:1100px}code{overflow-wrap:anywhere}article{border-top:1px solid #aaa;padding:12px 0}button,input{min-height:44px}section{margin:32px 0} @media print{.tools{display:none}.song-page{break-before:page}article{break-inside:avoid}}</style>
    <div class="tools"><h2>Recover and check your files</h2><p>Keep the assets folder with this register. Select recovered files to compare with the recorded fingerprints. This checks bytes, not authorship or legal ownership. A modified register is not authenticated.</p>
    <input id="files" type="file" multiple aria-label="Recovered files"><button onclick="window.print()">Print register</button><p id="check" role="status" aria-live="polite"></p></div>
    ${printableRecovery(safe)}<script>
    const manifest=${embedded};
    document.getElementById('files').addEventListener('change',async event=>{
      const status=document.getElementById('check');const assets=manifest.songs.flatMap(s=>s.versions.filter(v=>v.file).map(v=>({song:s.title,version:v.label,...v.file})));
      const seen=new Set();const messages=[];status.textContent='Checking locally…';
      try {if(!crypto.subtle)throw new Error('Browser cryptography unavailable. Use the included verify-recovery.mjs with Node.js.');
        for(const f of event.target.files){if(!f.size||f.size>${MAX_RECOVERY_FILE_BYTES})throw new Error('Select files up to 200 MiB.');
          const bytes=await f.arrayBuffer();if(bytes.byteLength!==f.size)throw new Error('Incomplete file read.');
          const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
          const matches=assets.filter(a=>a.bytes===f.size&&a.sha256===digest);
          for(const a of matches)seen.add(a);messages.push(f.name+': '+(matches.length?'bytes match '+matches.map(a=>a.song+' / '+a.version).join(', '):'NO MATCH'));}
        const unrecorded=manifest.songs.flatMap(s=>s.versions).filter(v=>!v.file).length;
        messages.push((assets.length-seen.size)+' recorded assets not matched in this selection. '+unrecorded+' versions without a fingerprint cannot be checked.');
        status.textContent=messages.join('\\n');
      }catch(error){status.textContent='Check incomplete: '+error.message;}
    });</script></html>`;
}
