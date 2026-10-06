import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DNA_TERMS, DNA_AUDIENCES, emptyDNA, validateDNA, projectDNA, suggestDNA,
  dnaFilters, readDNACursor, nextDNACursor } from "../lib/creative-dna.js";
import { createCreativeDNAHandler } from "../netlify/lib/creative-dna.mjs";
import { mountCreativeDNAEditor } from "../lib/creative-dna-ui.js";

const item = (termId = "sound.house", audience = "public") => ({ termId, audience, relationship: "" });
const dna = validateDNA({ ...emptyDNA(), enabled: true, audience: "public", discovery: true, items: [item()] });
assert.equal(emptyDNA().audience, "private");
assert.equal(emptyDNA().discovery, false);
assert.equal(new Set(DNA_TERMS.map(t => t.id)).size, DNA_TERMS.length);
assert.ok(DNA_TERMS.every(t => t.active === true && t.normalizedKey === t.label.toLowerCase()));
for (const section of DNA_AUDIENCES) for (const audience of DNA_AUDIENCES) {
  const current = validateDNA({ ...dna, audience: section, items: [item("sound.house", audience)] });
  for (const viewer of ["public", "members"]) {
    const threshold = viewer === "public" ? 2 : 1;
    assert.equal(projectDNA(current, { viewer }).length,
      DNA_AUDIENCES.indexOf(section) >= threshold && DNA_AUDIENCES.indexOf(audience) >= threshold ? 1 : 0);
  }
  for (const destination of ["public-network", "artist", "home"]) for (const viewer of ["public", "members", "owner"]) {
    assert.equal(projectDNA(current, { viewer, destination }).length,
      section === "public" && audience === "public" ? 1 : 0, `${destination} always caps signed-in viewers at public`);
  }
}
for (const options of [{ blocked: true }, { destinationVisible: false }]) assert.deepEqual(projectDNA(dna, options), []);
assert.deepEqual(projectDNA({ ...dna, enabled: false }), []);
assert.equal(projectDNA({ ...dna, discovery: false }).length, 1, "Display is separate from matching");
assert.deepEqual(projectDNA({ ...dna, discovery: false }, { discovery: true }), []);
const custom = { termId: null, category: "beyond", label: "Ceramics", audience: "public" };
assert.equal(projectDNA(validateDNA({ ...dna, items: [custom] })).length, 1);
assert.deepEqual(projectDNA(validateDNA({ ...dna, items: [custom] }), { discovery: true }), []);
for (const invalid of [
  { audience: "everyone" }, { revision: -1 }, { revision: "0" }, { discovery: "true" }, { memberId: "other" },
  { items: [item("unknown")] }, { items: [item(), item()] },
  { items: [{ ...item(), category: "beyond" }] }, { items: [{ ...item(), relationship: "expert" }] },
  { items: [{ ...item(), label: "Changed label" }] },
  { items: [{ ...custom, label: "House", category: "sound" }] },
  { items: [{ ...custom, label: "a".repeat(49) }] },
  { items: [{ ...custom, label: "\u0000" }] },
  { items: [custom, { ...custom, label: "  CERAMICS  " }] },
  { items: Array.from({ length: 5 }, (_, i) => ({ ...custom, label: `Custom ${i}` })) },
  { items: [...DNA_TERMS.filter(t => t.category === "sound").map(t => item(t.id)), { ...custom, category: "sound" }] },
  { items: DNA_TERMS.slice(0, 25).map(t => item(t.id)) }
]) assert.throws(() => validateDNA({ ...dna, ...invalid }));
const maximum = validateDNA({ ...dna, items: DNA_TERMS.slice(0, 24).map(t => item(t.id)) });
assert.equal(maximum.items.length, 24);
assert.deepEqual(suggestDNA("I choose hip hop, Ableton and field recordings").map(t => t.termId),
  ["sound.hip-hop", "tools.field-recording", "tools.ableton"]);
assert.deepEqual(suggestDNA("Private background, family and personality"), [], "Never infer sensitive traits");
assert.throws(() => suggestDNA("x".repeat(3001)));
const moderatedVocabulary = DNA_TERMS.map(t => ({ ...t, active: t.id !== "sound.house" }));
assert.throws(() => validateDNA(dna, moderatedVocabulary));
assert.deepEqual(projectDNA(dna, { vocabulary: moderatedVocabulary }), []);
assert.deepEqual(suggestDNA("house", moderatedVocabulary), []);
assert.throws(() => dnaFilters(new URL("https://halo.test/?interests=sound.house"), moderatedVocabulary));
assert.throws(() => validateDNA({ ...dna, items: [{ ...custom, category: "sound", label: "house music" }] }, moderatedVocabulary),
  "Retired aliases cannot bypass moderation as custom labels");
assert.deepEqual(dnaFilters(new URL("https://halo.test/?interests=sound.house,sound.jazz&interestMode=all")).ids,
  ["sound.house", "sound.jazz"]);
for (const query of ["interests=sound.house,sound.house", "interests=invalid", "interestCategory=invalid", "interestMode=score"]) {
  assert.throws(() => dnaFilters(new URL(`https://halo.test/?${query}`)));
}
const cursor = nextDNACursor([{ cursor_key: "a".repeat(32), updated_at: "2026-01-01", cursor_time: "2026-01-01T00:00:00.123456Z", premium_verified: true }], 1);
assert.equal(readDNACursor(new URL(`https://halo.test/?cursor=${encodeURIComponent(cursor)}`)).time, "2026-01-01T00:00:00.123456Z",
  "Cursor keeps database microseconds, never truncating timestamps or exposing member identity");
assert.throws(() => readDNACursor(new URL("https://halo.test/?cursor=broken")));

let current = emptyDNA(), calls = [], writes = 0, vocabulary = DNA_TERMS;
const db = { async sql(parts, ...values) {
  const query = parts.join("?");
  calls.push({ query, values });
  if (query.includes('normalized_key AS "normalizedKey"')) return vocabulary;
  if (query.includes("halo_save_creative_dna")) {
    assert.equal(values[0], "server-member");
    const [,, revision, enabled, audience, discovery, raw] = values;
    if (revision !== current.revision) return [{ revision: null }];
    current = { revision: revision + 1, enabled, audience, discovery, items: JSON.parse(raw) };
    writes++;
    return [{ revision: current.revision }];
  }
  return [{ creative_dna_enabled: current.enabled, creative_dna_audience: current.audience,
    creative_dna_discovery: current.discovery, creative_dna_revision: current.revision, items: current.items }];
} };
const handler = (user = { id: "identity" }, origin = true) => createCreativeDNAHandler({
  getDatabase: async () => db, getUser: async () => user,
  ensureMembership: async () => ({ member_id: "server-member", display_name: "Creator" }),
  verifyRequestOrigin: async () => typeof origin === "function" ? origin() : origin
});
const request = (body, origin = "https://halo.test", extraHeaders = {}) => new Request("https://halo.test/api/creative-dna", {
  method: "POST", headers: { "Content-Type": "application/json", ...(origin === null ? {} : { Origin: origin }), ...extraHeaders },
  body: typeof body === "string" ? body : JSON.stringify(body)
});
assert.equal((await handler(null)(request({ action: "save", dna }))).status, 401);
assert.equal((await handler(undefined, false)(request({ action: "save", dna }))).status, 403);
for (const result of [() => undefined, () => true, () => { throw new Error("Origin rejected"); }]) {
  for (const origin of [null, "null", "https://evil.test", "https://halo.test.evil.test"]) {
    for (const body of [{ action: "save", dna }, { action: "suggest", consent: true, selectedText: "house" }]) {
      assert.equal((await handler(undefined, result)(request(body, origin))).status, 403);
    }
  }
}
assert.equal((await handler(undefined, () => undefined)(request({ action: "save", dna }, "https://halo.test", { "Sec-Fetch-Site": "cross-site" }))).status, 403);
assert.equal(calls.length, 0);
assert.equal((await handler()(request("{"))).status, 400);
assert.equal((await handler()(request("x".repeat(16001)))).status, 413);
assert.equal((await handler()(request({ action: "suggest", selectedText: "house" }))).status, 400);
const beforeSuggestions = writes;
const suggestionCalls = calls.length;
const selectedText = "I explicitly selected house for suggestions";
const suggestions = await (await handler(undefined, () => undefined)(request({ action: "suggest", consent: true, selectedText }))).json();
assert.equal(suggestions.suggestions[0].termId, "sound.house");
assert.equal(writes, beforeSuggestions, "Suggestions never write profiles or store selected text");
assert.ok(calls.slice(suggestionCalls).every(call => !call.values.some(value => String(value).includes(selectedText))),
  "Selected text is never passed to a database query");
vocabulary = moderatedVocabulary;
assert.equal((await handler()(request({ action: "save", dna }))).status, 400);
assert.deepEqual((await (await handler()(request({ action: "suggest", consent: true, selectedText: "house" }))).json()).suggestions, []);
assert.equal(writes, beforeSuggestions);
vocabulary = DNA_TERMS;
const saves = await Promise.all([handler()(request({ action: "save", dna })), handler()(request({ action: "save", dna }))]);
assert.deepEqual(saves.map(response => response.status).sort(), [200, 409]);
assert.equal(current.revision, 1);
assert.equal(writes, 1);
assert.equal((await handler()(request({ action: "save", dna: { ...dna, memberId: "victim" } }))).status, 400);
const revoke = { ...current, enabled: false, discovery: false, audience: "private" };
assert.equal((await handler()(request({ action: "save", dna: revoke }))).status, 200);
assert.deepEqual(projectDNA(current), []);

class Element {
  constructor(tag, doc) {
    this.tagName = tag; this.ownerDocument = doc; this.children = []; this.listeners = new Map();
    this.attributes = {}; this.value = ""; this.textContent = ""; this.hidden = false; this.checked = false;
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  focus() { this.ownerDocument.activeElement = this; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  async emit(name) { await this.listeners.get(name)?.({ preventDefault() {} }); }
}
const doc = { createElement: tag => new Element(tag, doc) }, container = new Element("div", doc);
const descendants = element => element.children.flatMap(child => [child, ...descendants(child)]);
const find = text => descendants(container).find(element => element.textContent === text);
let submitted, conflict = false, offline = false;
const editor = mountCreativeDNAEditor(container, { fetcher: async (_url, options) => {
  if (options.method === "GET") return { ok: true, json: async () => ({ dna: emptyDNA() }) };
  const body = JSON.parse(options.body);
  if (body.action === "suggest") {
    if (offline) throw new Error("Offline");
    return { ok: true, json: async () => ({ suggestions: suggestDNA(body.selectedText), method: "Local alias matching" }) };
  }
  submitted = body.dna;
  return { ok: !conflict, status: conflict ? 409 : 200,
    json: async () => conflict ? { message: "Conflict" } : { dna: { ...body.dna, revision: body.dna.revision + 1 } } };
} });
await editor.load();
const textarea = descendants(container).find(element => element.tagName === "textarea");
const consent = descendants(container).find(element => element.parent?.textContent.startsWith("I choose"));
textarea.value = "House, Jazz"; consent.checked = true;
await find("Suggest interests").emit("click");
await find("Reject Jazz").emit("click");
assert.equal(find("Accept Jazz"), undefined);
assert.ok(find("0/24 assigned interests"));
await find("Accept House").emit("click");
assert.ok(find("1/24 assigned interests"));
assert.ok(find("Remove House"));
await find("Cancel changes").emit("click");
assert.ok(find("0/24 assigned interests"));
textarea.value = "House"; consent.checked = true; offline = true;
await find("Suggest interests").emit("click");
assert.ok(find("Offline fallback: identical local curated alias matching. No AI call."));
await find("Accept House").emit("click");
conflict = true;
await descendants(container).find(element => element.tagName === "form").emit("submit");
assert.equal(submitted.items.length, 1);
assert.equal(submitted.items[0].audience, "private", "Accepting suggestions adds only a private draft");
assert.equal(find("Discard draft and reload latest").hidden, false);
assert.ok(find("1/24 assigned interests"), "Conflict preserves the unsaved draft");
await find("Remove House").emit("click");
assert.ok(find("0/24 assigned interests"));
editor.clear();
assert.equal(container.children[0].hidden, true);
assert.equal(textarea.value, "", "Account changes erase selected text and suggestions");
const moderatedContainer = new Element("div", doc);
let moderatedSave;
const moderatedEditor = mountCreativeDNAEditor(moderatedContainer, { fetcher: async (_url, options) => {
  if (options.method === "GET") return { ok: true, json: async () => ({ dna, vocabulary: moderatedVocabulary }) };
  const body = JSON.parse(options.body);
  if (body.action === "suggest") throw new Error("Offline");
  moderatedSave = body;
  return { ok: true, json: async () => ({ dna: { ...body.dna, revision: 1 } }) };
} });
await moderatedEditor.load();
const moderatedFind = text => descendants(moderatedContainer).find(element => element.textContent === text);
assert.ok(moderatedFind("Remove House"), "Private editor keeps retired assignments available for removal");
assert.ok(!descendants(moderatedContainer).some(element => element.tagName === "option" && element.value === "sound.house"),
  "Live inactive terms disappear from the curated picker");
const moderatedText = descendants(moderatedContainer).find(element => element.tagName === "textarea");
moderatedText.value = "House and jazz";
descendants(moderatedContainer).find(element => element.parent?.textContent.startsWith("I choose")).checked = true;
await moderatedFind("Suggest interests").emit("click");
assert.equal(moderatedFind("Accept House"), undefined, "Offline fallback respects the loaded active vocabulary");
assert.ok(moderatedFind("Accept Jazz"));
await moderatedFind("Remove House").emit("click");
await moderatedFind("Accept Jazz").emit("click");
await descendants(moderatedContainer).find(element => element.tagName === "form").emit("submit");
assert.equal(moderatedSave.dna.items[0].termId, "sound.jazz");
assert.equal(JSON.stringify(moderatedSave).includes("House and jazz"), false, "Selected text never enters saved DNA payloads");
moderatedEditor.clear();
const migration = await readFile(new URL("../netlify/database/migrations/20261006050000_create_creative_dna.sql", import.meta.url), "utf8");
for (const term of DNA_TERMS) assert.ok(migration.includes(`('${term.id}', '${term.category}', '${term.label}'`), `SQL catalog includes ${term.id}`);
assert.match(migration, /FOR UPDATE/);
assert.match(migration, /current_revision IS DISTINCT FROM expected/);
assert.match(migration, /a.owner_member_id = target/);
assert.match(migration, /b.member_id = target AND b.target_member_id = viewer/);
assert.match(migration, /b.member_id = viewer AND b.target_member_id = target/);
console.log("Creative DNA contracts passed: privacy matrix, validation, opt-in, revocation, cursors, bounded API, conflicts, suggestions and editor.");
