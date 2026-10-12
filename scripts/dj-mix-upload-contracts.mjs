import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createUploadMixHandler, sniffAudioType, validateMixMetadata, DEFAULT_BPM, DEFAULT_GENRE } from "../netlify/functions/upload-mix.mjs";
import { createMixUploadView, validateMixUpload, audioContentType, MIX_CHUNK_BYTES } from "../dj-vault/upload-mix.js";
import { createVaultView } from "../dj-vault/dj-vault.js";

const origin = "https://halo.example";
const uploadId = "33333333-3333-4333-8333-333333333333";
const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6]);
const textFile = new TextEncoder().encode("<html>not audio</html>");

// --- Signature sniffing -------------------------------------------------------------------------
const ascii = text => new TextEncoder().encode(text);
assert.equal(sniffAudioType(mp3), "audio/mpeg");
assert.equal(sniffAudioType(new Uint8Array([0xff, 0xfb, 0x90, 0x64])), "audio/mpeg", "MPEG frame sync");
assert.equal(sniffAudioType(new Uint8Array([0xff, 0xf1, 0x50, 0x80])), "audio/aac", "ADTS AAC");
assert.equal(sniffAudioType(ascii("RIFF\0\0\0\0WAVEfmt ")), "audio/wav");
assert.equal(sniffAudioType(ascii("OggS\0\x02")), "audio/ogg");
assert.equal(sniffAudioType(ascii("\0\0\0\x20ftypM4A ")), "audio/mp4");
assert.equal(sniffAudioType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])), "audio/webm");
assert.equal(sniffAudioType(textFile), "", "non-audio content is rejected");
assert.equal(sniffAudioType(new Uint8Array()), "");

// --- Metadata validation ------------------------------------------------------------------------
assert.match(validateMixMetadata({ title: " ", rightsAttested: true }).error, /title/);
assert.match(validateMixMetadata({ title: "Ok mix", bpm: 300, rightsAttested: true }).error, /BPM/);
assert.match(validateMixMetadata({ title: "Ok mix", bpm: 12.5, rightsAttested: true }).error, /BPM/);
assert.match(validateMixMetadata({ title: "Ok mix" }).error, /rights/);
assert.deepEqual(validateMixMetadata({ title: "  Read   The Room ", rightsAttested: true }),
  { title: "Read The Room", bpm: DEFAULT_BPM, genre: DEFAULT_GENRE, durationSeconds: 0 }, "presets default to 122 BPM Deep / Afro House");

// --- Handler fixture ----------------------------------------------------------------------------
function fixture({ role = "admin", user = { id: "member-1", email: "dj@halo.example" }, failDb = false } = {}) {
  const state = { blobs: new Map(), mixes: new Map(), plans: [], writes: [] };
  const db = { async sql(strings, ...values) {
    const query = strings.join("?");
    if (failDb) throw new Error("relation halo_mixes does not exist");
    if (query.includes("FROM halo_dj_vault_roles")) return role ? [{ role }] : [];
    if (query.includes("SELECT id, member_id, title FROM halo_mixes")) return state.mixes.has(values[0]) ? [state.mixes.get(values[0])] : [];
    if (query.includes("INSERT INTO halo_mixes")) {
      state.writes.push({ query, values });
      assert.ok(query.includes("WITH mix AS") && query.includes("INSERT INTO halo_mix_release_plans"), "mix + catalog plan are one atomic statement");
      assert.ok(query.includes("ON CONFLICT DO NOTHING"), "duplicate publishes never raise raw conflict errors");
      assert.ok(query.includes("'room'") && query.includes("'free_stream'") && query.includes("'approved'"), "published straight to the room listing");
      const [id, memberId, , title, description, blobKey, chunkCount, contentType, byteSize, duration] = values;
      if (state.mixes.has(id)) return [];
      const metadata = JSON.parse(values.find(value => typeof value === "string" && value.startsWith("{\"bpm\"")));
      state.mixes.set(id, { id, member_id: memberId, title, description, blob_key: blobKey, chunk_count: chunkCount,
        content_type: contentType, byte_size: byteSize, duration_seconds: duration, visibility: "room" });
      state.plans.push({ mix_id: id, metadata });
      return [{ id, title }];
    }
    return [];
  } };
  const store = {
    async set(key, value) { state.blobs.set(key, new Uint8Array(await value.arrayBuffer())); },
    async list({ prefix }) { return { blobs: [...state.blobs.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
    async get(key) { const value = state.blobs.get(key); return value ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : null; }
  };
  const handler = createUploadMixHandler({ getDatabase: async () => db, getUser: async () => user,
    membershipFor: async (_db, member) => ({ member_id: member.id, actor_id: `actor-${member.id}`, display_name: "DJ HALO X" }), store });
  return { handler, state };
}
const chunkRequest = (bytes, { index = 0, count = 2, id = uploadId, type = "audio/mpeg", name = "mix.mp3", headers = {} } = {}) => {
  const form = new FormData();
  form.append("chunk", new Blob([bytes], { type }), name);
  form.append("uploadId", id);
  form.append("chunkIndex", String(index));
  form.append("chunkCount", String(count));
  form.append("contentType", type);
  return new Request(`${origin}/api/upload-mix`, { method: "POST", headers: { Origin: origin, ...headers }, body: form });
};
const publishRequest = (body, headers = {}) => new Request(`${origin}/api/upload-mix`, {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body)
});
const publishBody = { uploadId, chunkCount: 2, byteSize: 32, contentType: "audio/mpeg", title: "Read The Room (DJ Mix)",
  bpm: 122, genre: "Deep / Afro House", rightsAttested: true, durationSeconds: 3540 };

let f = fixture();
assert.equal((await f.handler(new Request(`${origin}/api/upload-mix`))).status, 405);
assert.equal((await f.handler(publishRequest(publishBody, { Origin: "https://evil.example" }))).status, 403, "cross-origin rejected");
assert.equal((await fixture({ user: null }).handler(publishRequest(publishBody))).status, 401, "anonymous rejected");
assert.equal((await fixture({ role: "dj" }).handler(publishRequest(publishBody))).status, 403, "DJ role cannot publish catalog mixes");
assert.equal((await fixture({ role: null }).handler(chunkRequest(mp3))).status, 403);
assert.equal((await f.handler(new Request(`${origin}/api/upload-mix`, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: "x" }))).status, 415);

// Invalid files never reach storage.
assert.equal((await f.handler(chunkRequest(textFile, { type: "text/html", name: "evil.html" }))).status, 415, "non-audio type rejected");
assert.equal((await f.handler(chunkRequest(textFile, { type: "audio/mpeg", name: "fake.mp3" }))).status, 415, "spoofed audio rejected by signature");
assert.equal((await f.handler(chunkRequest(mp3, { id: "../../etc" }))).status, 400, "upload IDs cannot traverse blob keys");
assert.equal((await f.handler(chunkRequest(mp3, { index: 2, count: 2 }))).status, 400);
assert.equal((await f.handler(chunkRequest(mp3, { count: 65 }))).status, 400);
assert.equal(f.state.blobs.size, 0);

// Missing title / incomplete upload are rejected without catalog writes.
assert.equal((await f.handler(publishRequest({ ...publishBody, title: "" }))).status, 400, "missing title rejected");
assert.equal((await f.handler(publishRequest({ ...publishBody, rightsAttested: false }))).status, 400);
assert.equal((await f.handler(publishRequest({ ...publishBody, byteSize: 200 * 1024 * 1024 }))).status, 400);
assert.equal((await f.handler(publishRequest(publishBody))).status, 409, "publishing before chunks arrive is refused");
assert.equal(f.state.writes.length, 0);

// Successful chunked upload + publish creates the catalog entry.
let response = await f.handler(chunkRequest(mp3, { index: 0 }));
assert.equal(response.status, 200);
response = await f.handler(chunkRequest(new Uint8Array(16).fill(7), { index: 1 }));
assert.equal(response.status, 200, "later chunks are raw audio continuation bytes");
assert.ok(f.state.blobs.has(`member-1/${uploadId}/master/parts/000`) && f.state.blobs.has(`member-1/${uploadId}/master/parts/001`),
  "chunks use the shared halo-mixes key layout read by /api/mixes/audio");
response = await f.handler(publishRequest({ ...publishBody, contentType: "audio/wav" }));
let data = await response.json();
assert.equal(response.status, 201);
assert.equal(data.status, "published");
assert.equal(data.id, uploadId);
assert.equal(data.vaultUrl, `/dj-vault/?mix=${uploadId}`);
assert.equal(data.salesPageUrl, `/mixes/?mix=${uploadId}#editions`);
const mix = f.state.mixes.get(uploadId);
assert.equal(mix.title, "Read The Room (DJ Mix)");
assert.equal(mix.content_type, "audio/mpeg", "stored type comes from the file signature, not the declared type");
assert.equal(mix.description, "Deep / Afro House · 122 BPM DJ mix");
assert.equal(mix.blob_key, `member-1/${uploadId}/master/parts/`);
assert.equal(mix.duration_seconds, 3540);
assert.equal(mix.visibility, "room");
assert.deepEqual(f.state.plans[0].metadata, { bpm: 122, genre: "Deep / Afro House", publicationStatus: "published", uploadSource: "dj_mix_ingest",
  salesPageUrl: `/mixes/?mix=${uploadId}#editions`, vaultUrl: `/dj-vault/?mix=${uploadId}`, rightsAttested: true, clientSaleEnabled: false });

// Retries are idempotent: no duplicate records, no overwritten published audio.
response = await f.handler(publishRequest(publishBody));
data = await response.json();
assert.equal(response.status, 200);
assert.equal(data.alreadyPublished, true);
assert.equal(f.state.writes.length, 1, "retrying publish does not insert twice");
const before = f.state.blobs.get(`member-1/${uploadId}/master/parts/000`);
response = await f.handler(chunkRequest(new Uint8Array([0xff, 0xfb, 1, 2]), { index: 0 }));
assert.equal(response.status, 200);
assert.equal((await response.json()).alreadyPublished, true);
assert.equal(f.state.blobs.get(`member-1/${uploadId}/master/parts/000`), before, "published audio is immutable");
const other = createUploadMixHandler({ getDatabase: async () => ({ sql: async (s, ...v) => s.join("?").includes("halo_dj_vault_roles") ? [{ role: "admin" }] : s.join("?").includes("SELECT id, member_id") ? [{ id: v[0], member_id: "someone-else", title: "x" }] : [] }),
  getUser: async () => ({ id: "member-2" }), membershipFor: async () => ({}), store: {} });
assert.equal((await other(publishRequest(publishBody))).status, 409, "another account cannot claim an existing mix");

// Database failures surface a safe retry message, never raw errors.
const quiet = console.error;
console.error = () => {};
response = await fixture({ failDb: true }).handler(publishRequest(publishBody));
console.error = quiet;
assert.equal(response.status, 503);
assert.doesNotMatch(JSON.stringify(await response.json()), /relation|halo_mixes/);

// --- Admin UI -----------------------------------------------------------------------------------
const file = (name, type, size = 1024) => ({ name, type, size, lastModified: 1, slice: () => new Blob(["a"]) });
assert.equal(audioContentType(file("set.MP3", "")), "audio/mpeg");
assert.match(validateMixUpload({ title: "", file: file("a.mp3", "audio/mpeg"), rightsAttested: true }).error, /title/);
assert.match(validateMixUpload({ title: "Mix", file: file("a.pdf", "application/pdf"), rightsAttested: true }).error, /MP3/);
assert.match(validateMixUpload({ title: "Mix", file: file("a.mp3", "audio/mpeg", 129 * 1024 * 1024), rightsAttested: true }).error, /128 MB/);
assert.match(validateMixUpload({ title: "Mix", file: null, rightsAttested: true }).error, /audio file/);
assert.deepEqual(validateMixUpload({ title: "Mix", bpm: "", genre: "", file: file("a.wav", "audio/wav"), rightsAttested: true }),
  { title: "Mix", bpm: 122, genre: "Deep / Afro House" });

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.hidden = false; this.value = ""; this.textContent = ""; }
  set innerHTML(_) { throw new Error("Unsafe HTML injection"); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  focus() {}
  scrollIntoView() {}
  querySelector(tag) { return this.querySelectorAll(tag)[0]; }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
}
function uploadUi({ session = { authenticated: true, authorized: true, canRoute: true }, publish } = {}) {
  const ids = ["mix-upload-form", "mix-title", "mix-bpm", "mix-genre", "mix-file", "mix-rights", "mix-submit", "mix-upload-status", "mix-upload-progress", "mix-upload-result", "mix-upload-gate"];
  const nodes = Object.fromEntries(ids.map(name => [name, new Node("div")]));
  const state = { nodes, chunks: [], publishes: [], ids: 0 };
  const view = createMixUploadView({
    document: { getElementById: name => nodes[name], createElement: tag => new Node(tag) },
    randomId: () => `44444444-4444-4444-8444-44444444444${state.ids++}`,
    readDuration: async () => 3600,
    uploadChunks: async options => {
      state.chunks.push(options);
      assert.equal(options.url, "/api/upload-mix");
      assert.equal(options.chunkSize, MIX_CHUNK_BYTES);
      options.onProgress(50);
      if (state.failChunks) throw new Error("The upload connection stopped.");
      return { chunkCount: 1 };
    },
    fetch: async (url, options) => {
      if (url === "/api/dj-vault/session") return Response.json(session);
      const body = JSON.parse(options.body);
      state.publishes.push(body);
      return publish ? publish(body) : Response.json({ message: "\"<b>Mix</b>\" is published and live in the DJ Vault.", id: body.uploadId, status: "published" }, { status: 201 });
    }
  });
  return { view, state, nodes };
}
let ui = uploadUi({ session: { authenticated: false, authorized: false, canRoute: false } });
assert.equal(await ui.view.init(), false);
assert.equal(ui.nodes["mix-submit"].disabled, true, "non-selectors cannot submit");
assert.equal(ui.nodes["mix-upload-gate"].hidden, false);
assert.equal(await ui.view.upload({ preventDefault() {} }), null);

ui = uploadUi();
assert.equal(await ui.view.init(), true);
assert.equal(ui.nodes["mix-submit"].disabled, false);
ui.nodes["mix-title"].value = "";
ui.nodes["mix-file"].files = [file("set.mp3", "audio/mpeg")];
ui.nodes["mix-rights"].checked = true;
assert.equal(await ui.view.upload({ preventDefault() {} }), null);
assert.equal(ui.nodes["mix-upload-status"].dataset.state, "error");
assert.equal(ui.state.chunks.length, 0, "invalid forms never upload");

ui.nodes["mix-title"].value = "Read The Room";
ui.nodes["mix-bpm"].value = "124";
ui.nodes["mix-genre"].value = "Afro House";
ui.state.failChunks = true;
await ui.view.upload({ preventDefault() {} });
assert.match(ui.nodes["mix-upload-status"].textContent, /retry/);
assert.equal(ui.nodes["mix-submit"].disabled, false, "loading state clears after failure");
ui.state.failChunks = false;
const uploading = ui.view.upload({ preventDefault() {} });
assert.equal(ui.nodes["mix-submit"].disabled, true, "submit is disabled while uploading");
assert.equal(ui.nodes["mix-upload-form"].attributes["aria-busy"], "true");
data = await uploading;
assert.equal(data.status, "published");
const [firstAttempt, retryAttempt] = ui.state.chunks.map(options => options.buildBody({ chunkIndex: 0, chunkCount: 1, start: 0, end: 1 }).get("uploadId"));
assert.equal(firstAttempt, retryAttempt, "retrying the same file resumes the same upload ID");
assert.deepEqual(ui.state.publishes[0], { uploadId: firstAttempt, chunkCount: 1, byteSize: 1024, contentType: "audio/mpeg", title: "Read The Room",
  bpm: 124, genre: "Afro House", rightsAttested: true, durationSeconds: 3600 });
assert.equal(ui.nodes["mix-upload-status"].dataset.state, "success");
assert.equal(ui.nodes["mix-upload-status"].textContent, "\"<b>Mix</b>\" is published and live in the DJ Vault.", "server text is rendered as text");
assert.deepEqual(ui.nodes["mix-upload-result"].children.map(link => link.href), [`/dj-vault/?mix=${firstAttempt}`, `/mixes/?mix=${firstAttempt}`]);
assert.equal(ui.nodes["mix-upload-progress"].value, 100);

ui = uploadUi({ publish: () => Response.json({ message: "Add a mix title between 2 and 100 characters." }, { status: 400 }) });
await ui.view.init();
Object.assign(ui.nodes["mix-title"], { value: "Mix" });
ui.nodes["mix-file"].files = [file("set.mp3", "audio/mpeg")];
ui.nodes["mix-rights"].checked = true;
assert.equal(await ui.view.upload({ preventDefault() {} }), null);
assert.match(ui.nodes["mix-upload-status"].textContent, /^Add a mix title/);

// --- Shop front listing -------------------------------------------------------------------------
// The published row is a visibility='room' halo_mixes record, which /api/mixes lists and DJ Vault renders.
const mixesSource = await readFile(new URL("../netlify/functions/mixes.mjs", import.meta.url), "utf8");
assert.match(mixesSource, /WHERE m\.visibility = 'room'\s+ORDER BY m\.created_at DESC/, "public mix listing reads room mixes");
assert.match(mixesSource, /getStore\(\{ name: "halo-mixes"/);
const uploadSource = await readFile(new URL("../netlify/functions/upload-mix.mjs", import.meta.url), "utf8");
assert.match(uploadSource, /getStore\(\{ name: "halo-mixes"/, "ingest writes to the same blob store the mix player streams from");
assert.match(uploadSource, /path: "\/api\/upload-mix"/);

const vaultIds = ["vault-grid", "vault-status", "vault-retry", "vault-more", "vault-sort", "vault-rarity", "vault-bpm", "vault-key", "vault-login", "vault-auth", "vault-email", "vault-password", "vault-confirm", "vault-mixes", "vault-mix-status", "vault-upload-link"];
const vaultNodes = Object.fromEntries(vaultIds.map(name => [name, new Node("div")]));
for (const name of ["vault-rarity", "vault-bpm", "vault-key"]) vaultNodes[name].value = "all";
vaultNodes["vault-sort"].value = "newest";
vaultNodes["vault-upload-link"].hidden = true;
const listed = { id: uploadId, title: mix.title, description: mix.description, creator: { name: "DJ HALO X" } };
const vault = createVaultView({
  document: { getElementById: name => vaultNodes[name], createElement: tag => new Node(tag) },
  location: { search: `?mix=${uploadId}`, assign() {} }, identity: {}, history: { replaceState() {} },
  fetch: async url => url.startsWith("/api/mixes") ? Response.json({ mixes: [listed] })
    : url.endsWith("/session") ? Response.json({ authenticated: true, authorized: true, canRoute: true })
      : Response.json({ success: true, tracks: [], nextOffset: null })
});
await vault.load();
const shopCard = vaultNodes["vault-mixes"].children[0];
assert.equal(shopCard.id, `vault-mix-${uploadId}`, "uploaded mix appears in the DJ Vault shop front");
assert.equal(shopCard.attributes["aria-current"], "true");
assert.equal(shopCard.querySelector("h2").textContent, "Read The Room (DJ Mix)");
assert.ok(shopCard.querySelectorAll("p").some(node => node.textContent === "Deep / Afro House · 122 BPM DJ mix"), "BPM and genre are visible on the card");
assert.equal(vaultNodes["vault-upload-link"].hidden, false, "selectors see the upload entry point");

// --- Static wiring ------------------------------------------------------------------------------
const page = await readFile(new URL("../dj-vault/upload/index.html", import.meta.url), "utf8");
for (const id of ["mix-title", "mix-bpm", "mix-genre", "mix-file", "mix-rights"]) assert.match(page, new RegExp(`<label[^>]*for="${id}"`), `${id} is labelled`);
assert.match(page, /type="file" accept="audio\/\*/);
assert.match(page, /<script src="\/upload-progress\.js"><\/script>/);
assert.match(page, /id="mix-upload-status" role="status" aria-live="polite"/);
assert.match(page, /name="robots" content="noindex, nofollow"/);
const vaultHtml = await readFile(new URL("../dj-vault/index.html", import.meta.url), "utf8");
assert.match(vaultHtml, /<a id="vault-upload-link" href="\/dj-vault\/upload\/" hidden>/);
const netlifyToml = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
assert.match(netlifyToml, /from = "\/dj-vault\/upload\/"\n {2}to = "\/dj-vault\/upload\/index.html"/);

console.log("DJ mix upload, catalog publish, idempotent retry, and shop front listing contracts passed");
