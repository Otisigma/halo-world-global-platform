import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createUploadMixHandler, sniffAudioType, validateMixMetadata, DEFAULT_BPM, DEFAULT_GENRE } from "../netlify/functions/upload-mix.mjs";
import { createMixUploadView, validateMixUpload, audioContentType, MIX_CHUNK_BYTES } from "../dj-vault/upload-mix.js";
import { createVaultView } from "../dj-vault/dj-vault.js";
import { createDjVaultHandler } from "../netlify/functions/dj-vault.mjs";
import { verifyFeaturedPush } from "./dj-featured-smoke.mjs";

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
  { title: "Read The Room", bpm: DEFAULT_BPM, genre: DEFAULT_GENRE, durationSeconds: 0, isShopPush: false, pushPriority: "featured" }, "presets default to 122 BPM Deep / Afro House");
for (const isShopPush of ["true", "false", 1, null]) {
  assert.match(validateMixMetadata({ title: "Mix", rightsAttested: true, isShopPush }).error, /boolean/);
}
assert.match(validateMixMetadata({ title: "Mix", rightsAttested: true, pushPriority: "<script>" }).error, /tag/);

// --- Handler fixture ----------------------------------------------------------------------------
function fixture({ role = "admin", user = { id: "member-1", email: "dj@halo.example" }, failDb = false } = {}) {
  const state = { blobs: new Map(), meta: new Map(), mixes: new Map(), plans: [], writes: [], featured: null };
  const db = { async sql(strings, ...values) {
    const query = strings.join("?");
    if (failDb) throw new Error("relation halo_mixes does not exist");
    if (query.includes("FROM halo_dj_vault_roles")) return role ? [{ role }] : [];
    if (query.includes("SELECT id, member_id, title FROM halo_mixes")) return state.mixes.has(values[0]) ? [state.mixes.get(values[0])] : [];
    if (query.includes("FROM halo_dj_shop_featured")) {
      assert.match(query, /m\.visibility = 'room'/, "private mixes cannot appear in the public banner");
      const mix = state.mixes.get(state.featured?.id);
      return mix?.visibility === "room" ? [{ ...mix, push_priority: state.featured.priority }] : [];
    }
    if (query.includes("INSERT INTO halo_mixes")) {
      state.writes.push({ query, values });
      assert.ok(query.includes("WITH mix AS") && query.includes("INSERT INTO halo_mix_release_plans"), "mix + catalog plan are one atomic statement");
      assert.ok(query.includes("ON CONFLICT DO NOTHING"), "duplicate publishes never raise raw conflict errors");
      assert.match(query, /INSERT INTO halo_dj_shop_featured[\s\S]*FROM mix[\s\S]*ON CONFLICT \(slot\) DO UPDATE/,
        "the singleton slot is replaced atomically, only for newly inserted mixes");
      if (state.failPublish) throw new Error("publish failed");
      assert.ok(query.includes("'room'") && query.includes("'free_stream'") && query.includes("'approved'"), "published straight to the room listing");
      const [id, memberId, , title, description, blobKey, chunkCount, contentType, byteSize, duration] = values;
      if (state.mixes.has(id)) return [];
      const metadata = JSON.parse(values.find(value => typeof value === "string" && value.startsWith("{\"bpm\"")));
      state.mixes.set(id, { id, member_id: memberId, title, description, blob_key: blobKey, chunk_count: chunkCount,
        content_type: contentType, byte_size: byteSize, duration_seconds: duration, visibility: "room",
        remixer_name: "DJ HALO X", price_minor: 0, currency: "USD", sales_status: "stream_only", client_sale_enabled: false });
      state.plans.push({ mix_id: id, metadata });
      if (values.at(-1) === true) state.featured = { id, priority: values.at(-2) };
      return [{ id, title }];
    }
    return [];
  } };
  const store = {
    async set(key, value, options) { state.blobs.set(key, new Uint8Array(await value.arrayBuffer())); state.meta.set(key, options?.metadata); },
    async getMetadata(key) { return state.blobs.has(key) ? { metadata: state.meta.get(key) } : null; },
    async delete(key) { state.blobs.delete(key); state.meta.delete(key); },
    async list({ prefix }) { return { blobs: [...state.blobs.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
    async get(key) { const value = state.blobs.get(key); return value ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : null; }
  };
  const handler = createUploadMixHandler({ getDatabase: async () => db, getUser: async () => user,
    membershipFor: async (_db, member) => ({ member_id: member.id, actor_id: `actor-${member.id}`, display_name: "DJ HALO X" }), store });
  const featuredHandler = createDjVaultHandler({ getDatabase: async () => db, getUser: async () => null });
  return { handler, featuredHandler, state };
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

// Later chunks cannot be parked without a verified first chunk.
let response = await f.handler(chunkRequest(new Uint8Array(16).fill(7), { index: 1 }));
assert.equal(response.status, 409);
assert.equal(f.state.blobs.size, 0);

// Mismatched sizes or stale parts are rejected and cleared so the retry re-uploads cleanly.
assert.equal((await f.handler(chunkRequest(mp3, { index: 0 }))).status, 200);
assert.equal((await f.handler(chunkRequest(new Uint8Array(16).fill(7), { index: 1 }))).status, 200);
assert.equal((await f.handler(publishRequest({ ...publishBody, byteSize: 31 }))).status, 409, "declared size must match stored parts");
assert.equal(f.state.blobs.size, 0, "mismatched parts are cleared");
assert.equal((await f.handler(chunkRequest(mp3, { index: 0, count: 3 }))).status, 200);
assert.equal((await f.handler(chunkRequest(new Uint8Array(4), { index: 1, count: 2 }))).status, 409, "chunks must match the first chunk's declared count");
assert.equal((await f.handler(chunkRequest(new Uint8Array(4), { index: 2, count: 3 }))).status, 200);
assert.equal((await f.handler(publishRequest({ ...publishBody, byteSize: 20 }))).status, 409, "parts must be exactly 000..N-1");
assert.equal(f.state.blobs.size, 2, "missing parts are not cleared, so in-flight uploads can finish");
assert.equal((await f.handler(publishRequest({ ...publishBody, chunkCount: 3, byteSize: 20 }))).status, 409);
assert.equal((await f.handler(chunkRequest(new Uint8Array(16).fill(1), { index: 1, count: 3 }))).status, 200);
assert.equal((await f.handler(publishRequest({ ...publishBody, byteSize: 36 }))).status, 409, "publish chunk count must match stored parts");
assert.equal(f.state.blobs.size, 0, "mismatched parts are cleared");
assert.equal(f.state.writes.length, 0);

// Successful chunked upload + publish creates the catalog entry.
response = await f.handler(chunkRequest(mp3, { index: 0 }));
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
assert.equal(f.state.featured, null, "ordinary uploads do not populate the banner");
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

// Featured pushes replace one slot; retries and failed/ordinary publishes leave it alone.
const featuredRequest = () => new Request(`${origin}/api/dj-vault/featured-push`);
assert.deepEqual(await (await f.featuredHandler(featuredRequest())).json(), { success: true, edition: null });
assert.equal((await f.featuredHandler(new Request(`${origin}/api/dj-vault/featured-push`, { method: "POST" }))).status, 405);
async function publishNext(id, extra = {}) {
  await f.handler(chunkRequest(mp3, { id, count: 1 }));
  return f.handler(publishRequest({ ...publishBody, uploadId: id, chunkCount: 1, byteSize: mp3.length, ...extra }));
}
const firstFeatured = "55555555-5555-4555-8555-555555555555";
const nextFeatured = "66666666-6666-4666-8666-666666666666";
assert.equal((await publishNext(firstFeatured, { isShopPush: true, pushPriority: "white_label" })).status, 201);
assert.deepEqual(f.state.featured, { id: firstFeatured, priority: "white_label" });
assert.equal((await publishNext(nextFeatured, { isShopPush: true, pushPriority: "test_press" })).status, 201);
assert.deepEqual(f.state.featured, { id: nextFeatured, priority: "test_press" });
assert.equal(f.state.mixes.has(firstFeatured), true, "replaced mixes remain in the catalog");
await publishNext(firstFeatured, { isShopPush: true });
assert.equal(f.state.featured.id, nextFeatured, "a delayed retry never reclaims the featured slot");
assert.equal((await publishNext("77777777-7777-4777-8777-777777777777")).status, 201);
assert.equal(f.state.featured.id, nextFeatured, "ordinary uploads preserve the current feature");
f.state.failPublish = true;
console.error = () => {};
assert.equal((await publishNext("88888888-8888-4888-8888-888888888888", { isShopPush: true })).status, 503);
console.error = quiet;
f.state.failPublish = false;
assert.equal(f.state.featured.id, nextFeatured, "failed publishes do not clear the prior feature");
const featuredResponse = await f.featuredHandler(featuredRequest());
assert.equal(featuredResponse.status, 200, "anonymous visitors can fetch the public feature");
assert.equal(featuredResponse.headers.get("Cache-Control"), "private, no-store");
const featured = (await featuredResponse.json()).edition;
assert.equal(featured.id, nextFeatured);
assert.equal(featured.pushPriority, "test_press");
assert.deepEqual(featured.commerce, { priceMinor: 0, currency: "USD", clientSaleEnabled: false });
assert.doesNotMatch(JSON.stringify(featured), /blob_key|member_id/, "public payload excludes private storage and owner fields");
f.state.mixes.get(nextFeatured).visibility = "private";
assert.equal((await (await f.featuredHandler(featuredRequest())).json()).edition, null, "private feature is hidden");
f.state.mixes.get(nextFeatured).visibility = "room";

// --- Admin UI -----------------------------------------------------------------------------------
const file = (name, type, size = 1024) => ({ name, type, size, lastModified: 1, slice: () => new Blob(["a"]) });
assert.equal(audioContentType(file("set.MP3", "")), "audio/mpeg");
assert.match(validateMixUpload({ title: "", file: file("a.mp3", "audio/mpeg"), rightsAttested: true }).error, /title/);
assert.match(validateMixUpload({ title: "Mix", file: file("a.pdf", "application/pdf"), rightsAttested: true }).error, /MP3/);
assert.match(validateMixUpload({ title: "Mix", file: file("a.mp3", "audio/mpeg", 129 * 1024 * 1024), rightsAttested: true }).error, /128 MB/);
assert.match(validateMixUpload({ title: "Mix", file: null, rightsAttested: true }).error, /audio file/);
assert.deepEqual(validateMixUpload({ title: "Mix", bpm: "", genre: "", file: file("a.wav", "audio/wav"), rightsAttested: true }),
  { title: "Mix", bpm: 122, genre: "Deep / Afro House", isShopPush: false, pushPriority: "featured" });
assert.match(validateMixUpload({ title: "Mix", file: file("a.mp3", "audio/mpeg"), rightsAttested: true, pushPriority: "bad" }).error, /tag/);

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
  const ids = ["mix-upload-form", "mix-title", "mix-bpm", "mix-genre", "mix-file", "mix-rights", "mix-submit", "mix-upload-status", "mix-upload-progress", "mix-upload-result", "mix-upload-gate", "mix-shop-push", "mix-push-priority"];
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
  bpm: 124, genre: "Afro House", rightsAttested: true, durationSeconds: 3600, isShopPush: false, pushPriority: "featured" });
assert.equal(ui.nodes["mix-upload-status"].dataset.state, "success");
assert.equal(ui.nodes["mix-upload-status"].textContent, "\"<b>Mix</b>\" is published and live in the DJ Vault.", "server text is rendered as text");
assert.deepEqual(ui.nodes["mix-upload-result"].children.map(link => link.href), [`/dj-vault/?mix=${firstAttempt}`, `/mixes/?mix=${firstAttempt}`]);
assert.equal(ui.nodes["mix-upload-progress"].value, 100);
ui.nodes["mix-file"].files = [file("featured.mp3", "audio/mpeg")];
ui.nodes["mix-shop-push"].checked = true;
ui.nodes["mix-push-priority"].value = "white_label";
await ui.view.upload();
assert.equal(ui.state.publishes.at(-1).isShopPush, true, "toggle reaches the publish endpoint");
assert.equal(ui.state.publishes.at(-1).pushPriority, "white_label");

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

const vaultIds = ["vault-grid", "vault-status", "vault-retry", "vault-more", "vault-sort", "vault-rarity", "vault-bpm", "vault-key", "vault-login", "vault-auth", "vault-email", "vault-password", "vault-confirm", "vault-mixes", "vault-mix-status", "vault-upload-link", "vault-shop-push-container", "vault-shop-push"];
const vaultNodes = Object.fromEntries(vaultIds.map(name => [name, new Node("div")]));
for (const name of ["vault-rarity", "vault-bpm", "vault-key"]) vaultNodes[name].value = "all";
vaultNodes["vault-sort"].value = "newest";
vaultNodes["vault-upload-link"].hidden = true;
const listed = { id: uploadId, title: mix.title, description: mix.description, creator: { name: "DJ HALO X" } };
let banner = { ...featured, title: "<img src=x onerror=alert(1)>", creator: { name: "<script>artist</script>" } };
let failBanner = false;
let pendingFeature = null, nextOffset = null;
const vault = createVaultView({
  document: { getElementById: name => vaultNodes[name], createElement: tag => new Node(tag) },
  location: { search: `?mix=${uploadId}`, assign() {} }, identity: {}, history: { replaceState() {} },
  fetch: async url => url.endsWith("/featured-push") ? pendingFeature || (failBanner ? new Response("", { status: 503 }) : Response.json({ success: true, edition: banner }))
    : url.startsWith("/api/mixes") ? Response.json({ mixes: [listed] })
    : url.endsWith("/session") ? Response.json({ authenticated: true, authorized: true, canRoute: true })
      : Response.json({ success: true, tracks: [], nextOffset })
});
await vault.load();
const shopCard = vaultNodes["vault-mixes"].children[0];
assert.equal(shopCard.id, `vault-mix-${uploadId}`, "uploaded mix appears in the DJ Vault shop front");
assert.equal(shopCard.attributes["aria-current"], "true");
assert.equal(shopCard.querySelector("h2").textContent, "Read The Room (DJ Mix)");
assert.ok(shopCard.querySelectorAll("p").some(node => node.textContent === "Deep / Afro House · 122 BPM DJ mix"), "BPM and genre are visible on the card");
assert.equal(vaultNodes["vault-upload-link"].hidden, false, "selectors see the upload entry point");
let bannerCard = vaultNodes["vault-shop-push"].children[0];
assert.equal(vaultNodes["vault-shop-push-container"].hidden, false);
assert.equal(bannerCard.querySelector("h2").textContent, banner.title, "untrusted title remains text");
assert.equal(bannerCard.querySelector("p").textContent, "Test press");
assert.ok(bannerCard.querySelectorAll("p").some(node => node.textContent === "Free stream"));
assert.equal(bannerCard.querySelector("a").href, `/mixes/?mix=${nextFeatured}`, "uses the existing player/editions path");
banner = { ...banner, salesStatus: "ready", commerce: { priceMinor: 1299, currency: "GBP", clientSaleEnabled: true } };
await vault.load();
bannerCard = vaultNodes["vault-shop-push"].children[0];
assert.ok(bannerCard.querySelectorAll("p").some(node => node.textContent === "£12.99"), "price comes from catalog metadata");
banner = null;
await vault.load();
assert.equal(vaultNodes["vault-shop-push-container"].hidden, true, "empty feature leaves no banner");
failBanner = true;
await vault.load();
assert.equal(vaultNodes["vault-shop-push-container"].hidden, true, "feature failure does not leave stale content");
assert.equal(vaultNodes["vault-mixes"].children.length, 1, "feature failure does not block normal mix listing");
failBanner = false;
nextOffset = 25;
let finishFeature;
pendingFeature = new Promise(resolve => { finishFeature = resolve; });
const initialLoad = vault.load();
await new Promise(resolve => setImmediate(resolve));
assert.equal(vaultNodes["vault-more"].hidden, false, "pagination is usable while the feature is still loading");
await vault.load(true);
finishFeature(Response.json({ success: true, edition: featured }));
await initialLoad;
assert.equal(vaultNodes["vault-shop-push-container"].hidden, false, "pagination does not suppress a pending feature");
pendingFeature = new Promise(resolve => { finishFeature = resolve; });
const staleLoad = vault.load();
await new Promise(resolve => setImmediate(resolve));
pendingFeature = null;
banner = { ...featured, title: "Newer feature" };
await vault.load();
finishFeature(Response.json({ success: true, edition: featured }));
await staleLoad;
assert.equal(vaultNodes["vault-shop-push"].children[0].querySelector("h2").textContent, "Newer feature",
  "a superseded featured request cannot overwrite the newer banner");

// --- Read-only deployment probe -----------------------------------------------------------------
const probe = (payload, options = {}) => verifyFeaturedPush({
  origin, fetchImpl: async () => Response.json(payload), ...options
});
const publicFeature = { success: true, edition: featured };
const featureRecord = await probe(publicFeature, { expectedId: featured.id.toUpperCase() });
assert.equal(featureRecord.state, "featured");
assert.equal(featureRecord.mixId, featured.id);
assert.equal(featureRecord.pushPriority, "test_press");
assert.ok(Number.isFinite(Date.parse(featureRecord.checkedAt)));
assert.equal((await probe({ success: true, edition: null })).state, "empty");
assert.equal((await probe({ success: true, edition: null }, { expectedId: null })).mixId, null);
await assert.rejects(probe({ success: true, edition: null }, { expectedId: featured.id }), /expected/);
await assert.rejects(probe(publicFeature, { expectedId: uploadId }), /expected/);
await assert.rejects(probe(publicFeature, { expectedId: null }), /expected/);
await probe(publicFeature, { fetchImpl: async (url, options) => {
  assert.equal(url, `${origin}/api/dj-vault/featured-push`);
  assert.equal(options.method, "GET");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.equal(options.cache, "no-store");
  assert.deepEqual(options.headers, { Accept: "application/json" });
  assert.equal(options.body, undefined);
  return Response.json(publicFeature);
} });
for (const payload of [
  {}, { success: true }, { success: false, edition: null }, [],
  { ...publicFeature, private: "unexpected" },
  { success: true, edition: {} },
  { success: true, edition: { ...featured, id: "invalid" } },
  { success: true, edition: { ...featured, blob_key: "private" } },
  { success: true, edition: { ...featured, creator: { name: "DJ", member_id: "private" } } },
  { success: true, edition: { ...featured, pushPriority: "unknown" } },
  { success: true, edition: { ...featured, commerce: { ...featured.commerce, priceMinor: -1 } } },
  { success: true, edition: { ...featured, commerce: { ...featured.commerce, currency: ["USD"] } } },
  { success: true, edition: { ...featured, commerce: { ...featured.commerce, clientSaleEnabled: "false" } } }
]) await assert.rejects(probe(payload), /schema|fields/);
await assert.rejects(probe(null, { fetchImpl: async () => new Response("", { status: 503 }) }), /HTTP 503/);
await assert.rejects(probe(null, { fetchImpl: async () => new Response("<html>fallback</html>") }), /not return JSON/);
await assert.rejects(probe(null, { fetchImpl: async () => new Response("{", { headers: { "Content-Type": "application/json" } }) }), /invalid JSON/);
await assert.rejects(probe(null, { fetchImpl: async () => { throw new TypeError("network"); } }), /network or redirect/);
for (const invalidOrigin of ["http://halo.example", "https://operator@halo.example", `${origin}/dj-vault/`, `${origin}?token=private`, `${origin}#fragment`]) {
  await assert.rejects(probe(publicFeature, { origin: invalidOrigin }), /HTTPS origin/);
}
for (const timeoutMs of [0, -1, 1.5, NaN, 60001]) await assert.rejects(probe(publicFeature, { timeoutMs }), /Timeout/);
await assert.rejects(probe(publicFeature, { expectedId: "invalid" }), /UUID/);
// Keep the event loop alive while exercising AbortSignal.timeout's unreferenced timer.
const keepAlive = setInterval(() => {}, 1000);
try {
  const stalled = signal => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  await assert.rejects(probe(null, { timeoutMs: 10, fetchImpl: async (url, { signal }) => stalled(signal) }), /timed out/);
  await assert.rejects(probe(null, { timeoutMs: 10, fetchImpl: async (url, { signal }) => ({
    status: 200, headers: new Headers({ "Content-Type": "application/json" }), json: () => stalled(signal)
  }) }), /timed out/);
} finally { clearInterval(keepAlive); }
const runProbeCli = args => promisify(execFile)(process.execPath, [
  fileURLToPath(new URL("./dj-featured-smoke.mjs", import.meta.url)), ...args
]);
assert.match((await runProbeCli(["--help"])).stdout, /Usage:/);
for (const args of [[], ["--origin", origin, "--expected-id", "invalid"], ["--origin", origin, "--timeout-ms", "0"], ["--unknown"]]) {
  await assert.rejects(runProbeCli(args), error => {
    assert.equal(error.code, 1);
    assert.equal(JSON.parse(error.stderr).ok, false);
    return true;
  });
}

// --- Static wiring ------------------------------------------------------------------------------
const page = await readFile(new URL("../dj-vault/upload/index.html", import.meta.url), "utf8");
for (const id of ["mix-title", "mix-bpm", "mix-genre", "mix-file", "mix-rights", "mix-shop-push", "mix-push-priority"]) assert.match(page, new RegExp(`<label[^>]*for="${id}"`), `${id} is labelled`);
assert.match(page, /Push to DJ Shop Featured Banner/);
assert.match(page, /type="file" accept="audio\/\*/);
assert.match(page, /<script src="\/upload-progress\.js"><\/script>/);
assert.match(page, /id="mix-upload-status" role="status" aria-live="polite"/);
assert.match(page, /name="robots" content="noindex, nofollow"/);
const vaultHtml = await readFile(new URL("../dj-vault/index.html", import.meta.url), "utf8");
assert.match(vaultHtml, /<a id="vault-upload-link" href="\/dj-vault\/upload\/" hidden>/);
assert.match(vaultHtml, /id="vault-shop-push-container"[^>]*aria-labelledby="shop-push-title" hidden/);
assert.ok(vaultHtml.indexOf('id="vault-shop-push-container"') < vaultHtml.indexOf('id="vault-grid"'), "banner is above the crates");
const migration = await readFile(new URL("../netlify/database/migrations/20261012040000_dj_shop_featured.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_dj_shop_featured/);
assert.match(migration, /PRIMARY KEY[^]*CHECK \(slot = 'featured'\)/, "database enforces one banner slot");
assert.match(migration, /REFERENCES halo_mixes\(id\) ON DELETE CASCADE/, "deleted mixes cannot leave dangling features");
assert.match(migration, /CHECK \(push_priority IN \('featured', 'white_label', 'test_press'\)\)/);
const netlifyToml = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
assert.match(netlifyToml, /from = "\/dj-vault\/upload\/"\n {2}to = "\/dj-vault\/upload\/index.html"/);

console.log("DJ mix upload, catalog publish, idempotent retry, and shop front listing contracts passed");
