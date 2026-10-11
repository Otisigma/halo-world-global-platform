import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDjVaultHandler } from "../netlify/functions/dj-vault.mjs";
import { createVaultView } from "../dj-vault/dj-vault.js";

const id = "11111111-1111-4111-8111-111111111111";
const pack = "22222222-2222-4222-8222-222222222222";
const track = { id, title: '<img src=x onerror="alert(1)">', artist: "<script>evil</script>",
  bpm: 140, musical_key: "8A", price_pence: 499, delivery_format: "wav", preview_type: "clip",
  preview_pack_id: pack, preview_stem: "drums", delivery_pack_id: pack, delivery_stem: "full" };
function fixture({ user = { id: "member", user_metadata: { role: "admin" } }, role, entitled = false,
  paid = true, amount = 499, unavailable = false, allowed = true, hidden = false } = {}) {
  const state = { writes: [], blobReads: [], paymentCalls: [], orders: [], granted: entitled, visibility: hidden ? "hidden" : "public",
    assets: {
      preview: { status: "private", rightsAttested: true, exists: true, blobKey: "preview/", chunkCount: 2, byteSize: 6 },
      delivery: { status: "private", rightsAttested: true, exists: true, blobKey: "delivery/", chunkCount: 2, byteSize: 6 }
    } };
  const db = { async sql(strings, ...values) {
    const query = strings.join("?");
    if (unavailable) throw new Error("DB offline");
    if (query.includes("halo_dj_vault_roles WHERE")) return role ? [{ role }] : [];
    if (query.includes("halo_dj_vault_rate_limit")) return [{ allowed }];
    if (query.includes("SELECT t.*")) {
      assert.ok(query.includes("t.visibility = 'public'") && query.includes("t.visibility = 'members'"));
      for (const name of ["preview", "delivery"]) {
        assert.ok(query.includes(`JOIN halo_stem_files ${name}`) && query.includes(`JOIN halo_stem_packs ${name}_pack`));
        assert.ok(query.includes(`${name}_pack.status = 'private'`) && query.includes(`${name}_pack.rights_attested = TRUE`));
        assert.ok(query.includes(`${name}.blob_key <> ''`) && query.includes(`${name}.chunk_count > 0`) && query.includes(`${name}.byte_size > 0`));
      }
      if (Object.values(state.assets).some(a => a.status !== "private" || !a.rightsAttested || !a.exists || !a.blobKey || a.chunkCount <= 0 || a.byteSize <= 0)) return [];
      return state.visibility === "hidden" || (state.visibility === "members" && !values[1]) ? [] : [{ ...track, entitled: state.granted }];
    }
    if (query.includes("SELECT * FROM halo_dj_vault_tracks")) {
      assert.equal(values[0], id);
      return state.visibility === "hidden" || (state.visibility === "members" && !values[1]) ? [] : [track];
    }
    if (query.includes("SELECT track_id FROM halo_dj_vault_entitlements")) {
      assert.equal(values[0], user.id, "entitlements must use authenticated identity, never body memberId");
      return state.granted ? [{ track_id: id }] : [];
    }
    if (query.includes("SELECT revoked_at")) return [];
    if (query.includes("SELECT p.id")) return [
      { id: pack, stem_type: "drums", content_type: "audio/mpeg", duration_seconds: 30, blob_key: "preview/" },
      { id: pack, stem_type: "full", content_type: "audio/wav", duration_seconds: 180, blob_key: "delivery/" }
    ];
    if (query.includes("SELECT f.*")) {
      assert.ok(query.includes("p.status = 'private'") && query.includes("p.status = 'archived'") && query.includes("p.rights_attested = TRUE"));
      const asset = state.assets[values[1] === "drums" ? "preview" : "delivery"];
      if (!asset.exists || !asset.rightsAttested || !(asset.status === "private" || (values[2] && asset.status === "archived"))) return [];
      return [{ blob_key: asset.blobKey, chunk_count: asset.chunkCount, content_type: "audio/wav", byte_size: asset.byteSize }];
    }
    if (query.includes("SELECT * FROM halo_dj_vault_orders")) return state.orders.filter(o => o.stripe_session_id === values[0] && o.member_id === values[1] && o.track_id === values[2]);
    state.writes.push({ query, values });
    if (query.includes("INSERT INTO halo_dj_vault_orders")) state.orders.push({ id: values[0], member_id: values[1], track_id: values[2], price_pence: values[3] });
    if (query.includes("UPDATE halo_dj_vault_orders SET stripe_session_id")) state.orders.find(o => o.id === values[1]).stripe_session_id = values[0];
    if (query.includes("WITH paid")) state.granted = true;
    if (query.includes("WITH routed")) return [{ track_id: id }];
    if (query.includes("WITH granted")) { state.granted = true; return [{ track_id: id }]; }
    return [];
  } };
  const handler = createDjVaultHandler({
    getDatabase: async () => db, getUser: async () => user,
    membershipFor: async () => ({ member_id: user.id }), siteOrigin: "https://halo.example",
    store: { async get(key) { state.blobReads.push(key); return new Uint8Array(key.endsWith("000") ? [1, 2, 3] : [4, 5, 6]).buffer; } },
    stripeRequest: async (path, body) => {
      state.paymentCalls.push(path);
      if (body) {
        assert.equal(body.get("line_items[0][price_data][unit_amount]"), "499");
        return { id: "cs_test_vault", url: "https://checkout.stripe.com/c/pay" };
      }
      const order = state.orders[0];
      return { payment_status: paid ? "paid" : "unpaid", status: "complete", mode: "payment",
        currency: "gbp", amount_total: amount, client_reference_id: order.id, metadata: { order_id: order.id } };
    }
  });
  return { handler, state };
}
function request(action, body, options = {}) {
  const mutation = body !== undefined;
  return new Request(`https://halo.example/api/dj-vault/${action}`, {
    method: mutation ? (action === "routing" ? "PATCH" : "POST") : "GET",
    headers: { ...(mutation ? { Origin: "https://halo.example", "Content-Type": "application/json" } : {}), ...options.headers },
    ...(mutation ? { body: JSON.stringify(body) } : {}), ...options
  });
}
const routeBody = { trackId: id, title: "Extended mix", artist: "Artist", accessTier: "dj_vault",
  visibility: "members", bpm: 140, musicalKey: "8A", pricePence: 499, deliveryFormat: "wav",
  previewType: "clip", previewPackId: pack, previewStem: "drums", deliveryPackId: pack, deliveryStem: "full" };

let f = fixture({ user: null });
assert.equal((await f.handler(request("tracks"))).status, 200);
assert.equal((await f.handler(request("checkout", { trackId: id }))).status, 401);
assert.equal((await f.handler(request("download?trackId=" + id))).status, 401);
assert.equal(f.state.writes.length, 0);
f = fixture();
assert.equal((await f.handler(request("routing", routeBody))).status, 403, "user metadata cannot self-assign privileges");
assert.equal((await f.handler(request("checkout", { trackId: id, role: "admin" }))).status, 403);
assert.equal(f.state.writes.length, 0);
f = fixture({ role: "dj" });
assert.equal((await f.handler(request("routing", routeBody))).status, 403);
assert.equal((await f.handler(request("entitlements", { trackId: id, memberId: "member" }))).status, 403);
assert.equal((await f.handler(request("download?trackId=" + id))).status, 403);
assert.equal(f.state.blobReads.length, 0);
assert.equal((await f.handler(request("checkout", { trackId: id }, { headers: { Origin: "https://evil.example", "Content-Type": "application/json" } }))).status, 403);
assert.equal((await f.handler(request("checkout", { trackId: id }, { headers: { "Content-Type": "application/json" } }))).status, 403);
assert.equal((await f.handler(request("checkout", { trackId: "bad" }))).status, 400);
assert.equal((await f.handler(request("checkout", { trackId: id, padding: "x".repeat(9000) }))).status, 413);
const checkout = await f.handler(request("checkout", { trackId: id, memberId: "victim", pricePence: 1 }));
assert.equal(checkout.status, 200);
assert.equal(f.state.orders[0].member_id, "member");
assert.equal(f.state.orders[0].price_pence, 499);
assert.equal(f.state.granted, false, "checkout creation must not grant access");
assert.equal((await f.handler(request("confirm", { trackId: id, sessionId: "cs_other_account" }))).status, 404);
assert.equal((await f.handler(request("confirm", { trackId: id, sessionId: "cs_test_vault" }))).status, 200);
assert.equal(f.state.granted, true);
const download = await f.handler(request("download?trackId=" + id));
assert.equal(download.headers.get("cache-control"), "private, no-store");
assert.match(download.headers.get("content-disposition"), /^attachment/);
assert.deepEqual([...new Uint8Array(await download.arrayBuffer())], [1, 2, 3, 4, 5, 6]);
assert.ok(f.state.blobReads.every(key => key.startsWith("delivery/")));
for (const invalid of [{ paid: false }, { amount: 1 }]) {
  f = fixture({ role: "dj", ...invalid });
  await f.handler(request("checkout", { trackId: id }));
  assert.equal((await f.handler(request("confirm", { trackId: id, sessionId: "cs_test_vault", paid: true }))).status, 409);
  assert.equal(f.state.granted, false);
}
for (const source of ["preview", "delivery"]) {
  for (const invalid of [{ status: "archived" }, { status: "public" }, { exists: false },
    { rightsAttested: false }, { blobKey: "" }, { chunkCount: 0 }, { byteSize: 0 }]) {
    f = fixture({ role: "dj" });
    Object.assign(f.state.assets[source], invalid);
    assert.deepEqual((await (await f.handler(request("tracks"))).json()).tracks, [], `${source} must not be sold when ${JSON.stringify(invalid)}`);
    const rejected = await f.handler(request("checkout", { trackId: id }));
    assert.equal(rejected.status, 409);
    assert.match((await rejected.json()).message, /source assets are unavailable/);
    assert.equal(f.state.orders.length, 0, "invalid assets must not create an order");
    assert.equal(f.state.paymentCalls.length, 0, "invalid assets must not create a Stripe session");

    f = fixture({ role: "dj" });
    assert.equal((await f.handler(request("checkout", { trackId: id }))).status, 200);
    Object.assign(f.state.assets[source], invalid);
    assert.equal((await f.handler(request("confirm", { trackId: id, sessionId: "cs_test_vault" }))).status, 409);
    assert.equal(f.state.granted, false, "assets invalidated after checkout must not grant entitlement");
    assert.ok(!f.state.writes.some(w => w.query.includes("WITH paid")), "failed confirmation must not mark the order paid");
  }
}
f = fixture({ role: "dj", entitled: true });
f.state.assets.preview.status = "archived";
f.state.assets.delivery.status = "archived";
const archivedDownload = await f.handler(request("download?trackId=" + id));
assert.equal(archivedDownload.status, 200, "existing entitlements retain archived private delivery");
assert.deepEqual([...new Uint8Array(await archivedDownload.arrayBuffer())], [1, 2, 3, 4, 5, 6]);
assert.equal((await f.handler(request("preview?trackId=" + id))).status, 404);
assert.equal((await f.handler(request("checkout", { trackId: id }))).status, 200, "existing entitlement must not create a new purchase");
assert.equal(f.state.orders.length, 0);
assert.equal(f.state.paymentCalls.length, 0);
for (const invalid of [{ status: "public" }, { exists: false }, { rightsAttested: false }]) {
  f = fixture({ role: "dj", entitled: true });
  Object.assign(f.state.assets.delivery, invalid);
  assert.equal((await f.handler(request("download?trackId=" + id))).status, 404);
  assert.equal(f.state.blobReads.length, 0, "entitlements must not bypass private delivery or rights attestation");
}
f = fixture({ role: "selector" });
assert.equal((await f.handler(request("routing", routeBody))).status, 200);
assert.equal((await f.handler(request("routing", { ...routeBody, previewStem: "full" }))).status, 400);
assert.equal((await f.handler(request("entitlements", { trackId: id, memberId: "member" }))).status, 403);
f = fixture({ role: "admin" });
assert.equal((await f.handler(request("entitlements", { trackId: id, memberId: "member" }))).status, 200);
f = fixture({ role: "dj", allowed: false });
assert.equal((await f.handler(request("checkout", { trackId: id }))).status, 429);
assert.equal(f.state.paymentCalls.length, 0);
f = fixture({ hidden: true });
assert.deepEqual((await (await f.handler(request("tracks"))).json()).tracks, []);
assert.equal((await f.handler(request("preview?trackId=" + id))).status, 404);
f = fixture({ user: null });
const catalog = await (await f.handler(request("tracks"))).json();
assert.equal(catalog.tracks[0].title, track.title);
assert.ok(!JSON.stringify(catalog).includes("delivery_pack_id") && !JSON.stringify(catalog).includes("blob_key"));
f.state.visibility = "members";
assert.deepEqual((await (await f.handler(request("tracks"))).json()).tracks, []);
assert.equal((await f.handler(request("preview?trackId=" + id))).status, 404);
f.state.visibility = "public";
const preview = await f.handler(request("preview?trackId=" + id, undefined, { headers: { Range: "bytes=2-4" } }));
assert.equal(preview.status, 206);
assert.equal(preview.headers.get("content-range"), "bytes 2-4/6");
assert.deepEqual([...new Uint8Array(await preview.arrayBuffer())], [3, 4, 5]);
assert.ok(f.state.blobReads.every(key => key.startsWith("preview/")));
for (const range of ["bytes=9-", "bytes=-0", "bytes=4-2", "bytes=1-2,4-5", "bytes=-"]) {
  assert.equal((await f.handler(request("preview?trackId=" + id, undefined, { headers: { Range: range } }))).status, 416);
}
f = fixture({ unavailable: true });
assert.equal((await f.handler(request("tracks"))).status, 503);
assert.equal((await f.handler(request("no-such-route"))).status, 404);
assert.equal((await f.handler(request("tracks", {}))).status, 405);

// Lightweight DOM fixture matches the repository's dependency-free UI contracts.
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.hidden = false; this.value = "newest"; this.textContent = ""; }
  set innerHTML(_) { throw new Error("Unsafe HTML injection"); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  focus() { this.focused = true; }
  querySelector(tag) { return this.querySelectorAll(tag)[0]; }
  querySelectorAll(tag) { return this.children.flatMap(child => [ ...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag) ]); }
}
function uiFixture({ mode = "tracks", authorized = false, failure = false } = {}) {
  const nodes = Object.fromEntries(["vault-grid", "vault-status", "vault-retry", "vault-more", "vault-sort", "vault-login", "vault-auth", "vault-email", "vault-password", "vault-confirm"].map(name => [name, new Node("div")]));
  nodes["vault-auth"].append(new Node("button"));
  const state = { nodes, requests: [], destinations: [], mode, authorized, failure };
  const view = createVaultView({
    document: { getElementById: name => nodes[name], createElement: tag => new Node(tag) },
    location: { get search() { return state.search || ""; }, assign: url => state.destinations.push(url) },
    identity: { login: async (...args) => { state.credentials = args; state.authorized = true; } },
    fetch: async (url, options) => {
      state.requests.push({ url, options });
      if (state.failure) return Response.json({}, { status: 500 });
      if (url.endsWith("/session")) return Response.json({ authenticated: state.authorized, authorized: state.authorized });
      if (url.endsWith("/checkout")) return Response.json({ checkoutUrl: "javascript:alert(1)" });
      if (url.endsWith("/confirm")) return Response.json({}, { status: 404 });
      return Response.json(state.mode === "malformed" ? { success: false, tracks: [] }
        : { success: true, tracks: state.mode === "empty" ? [] : catalog.tracks, nextOffset: null });
    }
  });
  return { view, state };
}
let ui = uiFixture();
const loading = ui.view.load();
assert.equal(ui.state.nodes["vault-status"].textContent, "Loading vault…");
assert.equal(ui.state.nodes["vault-grid"].attributes["aria-busy"], "true");
await loading;
const grid = ui.state.nodes["vault-grid"];
assert.equal(grid.attributes["aria-busy"], "false");
assert.equal(grid.querySelectorAll("h2")[0].textContent, track.title, "metadata must render as text");
assert.equal(grid.querySelectorAll("button")[0].disabled, true, "anonymous acquisition is disabled");
assert.equal(grid.querySelectorAll("audio")[0].preload, "none");
assert.equal(grid.querySelectorAll("span").find(n => n.className === "vault-price").textContent, "£4.99");
await ui.state.nodes["vault-login"].listeners.click();
assert.equal(ui.state.nodes["vault-auth"].hidden, false);
assert.equal(ui.state.nodes["vault-email"].focused, true);
ui.state.nodes["vault-email"].value = "dj@example.test";
ui.state.nodes["vault-password"].value = "test-only-password";
await ui.state.nodes["vault-auth"].listeners.submit({ preventDefault() {} });
assert.deepEqual(ui.state.credentials, ["dj@example.test", "test-only-password"]);
assert.equal(ui.state.nodes["vault-password"].value, "");
for (const [options, pattern] of [[{ mode: "empty" }, /No DJ Vault/], [{ failure: true }, /unavailable/], [{ mode: "malformed" }, /Invalid vault response/]]) {
  ui = uiFixture(options);
  await ui.view.load();
  assert.match(ui.state.nodes["vault-status"].textContent, pattern);
  assert.equal(ui.state.nodes["vault-grid"].children.length, 0);
  assert.equal(ui.state.nodes["vault-retry"].hidden, options.mode === "empty");
}
ui = uiFixture({ authorized: true });
await ui.view.load();
const acquire = ui.state.nodes["vault-grid"].querySelectorAll("button")[0];
assert.equal(acquire.disabled, false);
await acquire.listeners.click();
assert.equal(ui.state.destinations.length, 0, "unsafe checkout destinations must not navigate");
ui.state.authorized = false;
await ui.view.load();
assert.equal(ui.state.nodes["vault-grid"].querySelectorAll("button")[0].disabled, true, "session loss disables acquisition");
ui = uiFixture({ authorized: true });
ui.state.search = `?session_id=cs_invalid&trackId=${id}`;
await ui.view.load();
assert.equal(ui.state.nodes["vault-grid"].children.length, 1, "failed confirmation must not block browsing");
assert.match(ui.state.nodes["vault-status"].textContent, /Payment confirmation needs attention/);
assert.equal(ui.state.nodes["vault-confirm"].hidden, false);
await ui.state.nodes["vault-confirm"].listeners.click();
assert.equal(ui.state.nodes["vault-grid"].children.length, 1);

const migration = await readFile(new URL("../netlify/database/migrations/20261011040000_dj_vault.sql", import.meta.url), "utf8");
assert.match(migration, /PRIMARY KEY \(member_id, track_id\)/);
assert.match(migration, /stripe_session_id TEXT UNIQUE/);
assert.match(migration, /FOREIGN KEY \(delivery_pack_id, delivery_stem\) REFERENCES halo_stem_files/);
assert.match(migration, /CHECK \(preview_pack_id <> delivery_pack_id OR preview_stem <> delivery_stem\)/);
assert.match(migration, /halo_dj_vault_rate_limit/);
const html = await readFile(new URL("../dj-vault/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../dj-vault/dj-vault.css", import.meta.url), "utf8");
assert.match(html, /aria-live="polite"/);
assert.match(html, /name="viewport"/);
assert.doesNotMatch(html, /onclick=/);
assert.match(css, /prefers-reduced-motion/);
console.log("DJ Vault permission, payment, private delivery, and UI contracts passed");
