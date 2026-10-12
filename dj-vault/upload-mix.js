// DJ Mix ingest portal: title + BPM + genre + one audio file -> /api/upload-mix -> DJ Vault listing.
// All server-provided text is rendered with textContent only.
// Mirrors netlify/functions/upload-mix.mjs limits; chunks must stay below its 4 MB MAX_CHUNK_BYTES.
export const MIX_CHUNK_BYTES = 3.5 * 1024 * 1024;
export const MAX_MIX_BYTES = 128 * 1024 * 1024;
export const DEFAULT_BPM = 122;
export const DEFAULT_GENRE = "Deep / Afro House";
const audioExtension = /\.(?:mp3|wav|m4a|mp4|aac|ogg|webm)$/i;
const audioTypes = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "audio/mp4",
  "audio/x-m4a", "audio/m4a", "audio/aac", "audio/ogg", "application/ogg", "audio/webm", "video/mp4"]);
const mixId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function audioContentType(file) {
  const type = String(file?.type || "").split(";")[0].toLowerCase();
  if (audioTypes.has(type)) return type;
  const name = String(file?.name || "");
  return /\.wav$/i.test(name) ? "audio/wav" : /\.(?:m4a|mp4)$/i.test(name) ? "audio/mp4" : /\.aac$/i.test(name) ? "audio/aac"
    : /\.ogg$/i.test(name) ? "audio/ogg" : /\.webm$/i.test(name) ? "audio/webm" : /\.mp3$/i.test(name) ? "audio/mpeg" : "";
}

export function validateMixUpload({ title, bpm, genre, file, rightsAttested }) {
  const cleanTitle = String(title || "").trim().replace(/\s+/g, " ");
  if (cleanTitle.length < 2 || cleanTitle.length > 100) return { error: "Add a mix title between 2 and 100 characters." };
  const bpmValue = String(bpm ?? "").trim() === "" ? DEFAULT_BPM : Number(bpm);
  if (!Number.isInteger(bpmValue) || bpmValue < 60 || bpmValue > 200) return { error: "BPM must be a whole number from 60 to 200." };
  const cleanGenre = String(genre || "").trim().replace(/\s+/g, " ") || DEFAULT_GENRE;
  if (cleanGenre.length > 60) return { error: "Keep the genre under 60 characters." };
  if (!file || !file.size) return { error: "Choose the mix audio file to upload." };
  if (!audioContentType(file) || (!audioExtension.test(String(file.name || "")) && !String(file.type || "").startsWith("audio/"))) {
    return { error: "Upload an MP3, WAV, M4A, AAC, OGG, or WebM audio file." };
  }
  if (file.size > MAX_MIX_BYTES) return { error: "Keep the mix file under 128 MB." };
  if (rightsAttested !== true) return { error: "Confirm you hold the rights to publish this mix." };
  return { title: cleanTitle, bpm: bpmValue, genre: cleanGenre };
}

const fingerprint = file => `${file.name}:${file.size}:${file.lastModified || 0}`;

export function createMixUploadView({ document, fetch, uploadChunks, randomId, readDuration = async () => 0 }) {
  const $ = id => document.getElementById(id);
  const form = $("mix-upload-form"), title = $("mix-title"), bpm = $("mix-bpm"), genre = $("mix-genre");
  const file = $("mix-file"), rights = $("mix-rights"), submit = $("mix-submit");
  const status = $("mix-upload-status"), progress = $("mix-upload-progress"), result = $("mix-upload-result"), gate = $("mix-upload-gate");
  // A failed attempt keeps its upload ID so retrying the same file resumes the same catalog record.
  let pending = null, busy = false, allowed = false;
  const setStatus = (message, state) => { status.textContent = message; status.dataset.state = state; };
  const link = (text, href) => { const a = document.createElement("a"); a.textContent = text; a.href = href; return a; };

  async function init() {
    try {
      const response = await fetch("/api/dj-vault/session", { credentials: "same-origin" });
      const session = response.ok ? await response.json() : {};
      allowed = session.canRoute === true;
      gate.hidden = allowed;
      gate.textContent = allowed ? "" : session.authenticated
        ? "Selector or admin DJ Vault access is required to publish mixes."
        : "Sign in on the DJ Vault page with selector or admin access to publish mixes.";
    } catch {
      allowed = false;
      gate.hidden = false;
      gate.textContent = "DJ Vault access could not be checked. Reload to try again.";
    }
    submit.disabled = !allowed;
    return allowed;
  }

  async function upload(event) {
    event?.preventDefault?.();
    if (busy || !allowed) return null;
    const audio = file.files?.[0];
    const values = validateMixUpload({ title: title.value, bpm: bpm.value, genre: genre.value, file: audio, rightsAttested: rights.checked === true });
    result.replaceChildren();
    if (values.error) { setStatus(values.error, "error"); return null; }
    busy = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    progress.hidden = false;
    progress.value = 0;
    if (!pending || pending.fingerprint !== fingerprint(audio)) pending = { fingerprint: fingerprint(audio), uploadId: randomId() };
    const { uploadId } = pending;
    const contentType = audioContentType(audio);
    setStatus("Uploading mix 0%…", "uploading");
    try {
      const { chunkCount } = await uploadChunks({
        url: "/api/upload-mix", file: audio, chunkSize: MIX_CHUNK_BYTES,
        buildBody({ chunkIndex, chunkCount: total, start, end }) {
          const body = new FormData();
          body.append("chunk", audio.slice(start, end, contentType), audio.name);
          body.append("uploadId", uploadId);
          body.append("chunkIndex", String(chunkIndex));
          body.append("chunkCount", String(total));
          body.append("contentType", contentType);
          return body;
        },
        onProgress(percent) {
          progress.value = Math.round(percent * 0.9);
          setStatus(`Uploading mix ${Math.round(percent)}%…`, "uploading");
        }
      });
      setStatus("Publishing to the DJ Vault catalog…", "uploading");
      const response = await fetch("/api/upload-mix", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, chunkCount, byteSize: audio.size, contentType, title: values.title, bpm: values.bpm,
          genre: values.genre, rightsAttested: true, durationSeconds: await readDuration(audio).catch(() => 0) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.message === "string" ? data.message : "The mix could not be published. Try again.");
      const id = mixId.test(data.id) ? data.id : uploadId;
      pending = null;
      progress.value = 100;
      setStatus(typeof data.message === "string" ? data.message : "Mix published.", "success");
      result.replaceChildren(link("View in DJ Vault", `/dj-vault/?mix=${encodeURIComponent(id)}`),
        link("Open mix player", `/mixes/?mix=${encodeURIComponent(id)}`));
      file.value = "";
      return data;
    } catch (error) {
      setStatus(`${error?.message || "The upload stopped."} Submit again to retry — finished chunks are safe to resend.`, "error");
      return null;
    } finally {
      busy = false;
      submit.disabled = !allowed;
      form.setAttribute("aria-busy", "false");
    }
  }

  form.addEventListener("submit", upload);
  return { init, upload };
}

function readAudioDuration(file) {
  return new Promise(resolve => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const done = value => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(Number.isFinite(value) ? Math.round(value) : 0); };
    const timer = setTimeout(() => done(0), 8000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}

if (typeof window !== "undefined" && window.document?.getElementById("mix-upload-form")) {
  const view = createMixUploadView({
    document: window.document, fetch: window.fetch.bind(window),
    uploadChunks: options => window.HaloUploadProgress.uploadChunkedFile({ ...options, retryDelays: [800, 2000] }),
    randomId: () => window.crypto.randomUUID(), readDuration: readAudioDuration
  });
  view.init();
}
