import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [page, client, styles, api, lib, schema, migration, docs] = await Promise.all([
  read("music/index.html"),
  read("music/music.js"),
  read("music/music.css"),
  read("netlify/functions/halo-merch.mjs"),
  read("netlify/lib/halo-merch.mjs"),
  read("db/schema.ts"),
  read("netlify/database/migrations/20260914073000_create-halo-merch-printful.sql"),
  read("HALO_MERCH_PRINTFUL.md")
]);

assert.match(page, /HALO merch/i, "music storefront must expose a HALO merch panel");
assert.match(page, /Printful-backed fulfilment routing/i, "music storefront must describe provider-backed merch routing");
assert.match(page, /id="merchGrid"/, "music storefront must provide a merch grid mount");
assert.match(page, /id="merchDisclosure"/, "music storefront must provide a merch disclosure mount");

assert.match(client, /\/api\/halo-merch/, "music client must load the merch API");
assert.match(client, /purchasePath/, "music client must use HALO-routed merch checkout paths");
assert.match(client, /associatedReleaseId/, "music client must connect merch products back to related releases");
assert.match(client, /open_payment/, "music client must track merch checkout opens with the existing payment telemetry event");

assert.match(styles, /\.merch-grid/, "music styles must define the merch grid");
assert.match(styles, /\.merch-disclosure/, "music styles must define the merch disclosure panel");
assert.match(styles, /\.merch-variant/, "music styles must define merch variant chips");

assert.match(api, /intent === "checkout"/, "merch API must support same-origin checkout routing");
assert.match(api, /"Cache-Control": "no-store"/, "merch API must mark checkout redirects as non-cacheable");
assert.match(api, /Location: location/, "merch API must redirect checkout requests to the provider destination");
assert.match(api, /loadHaloMerchCatalog/, "merch API must load the merch integration layer");

assert.match(lib, /providerSku/, "merch integration layer must store provider SKUs server-side");
assert.match(lib, /affiliateCheckoutUrl/, "merch integration layer must store affiliate destinations server-side");
assert.match(lib, /serializePublicMerchProduct/, "merch integration layer must define a HALO-facing serialization boundary");
assert.match(lib, /providerLabel: "Printful fulfilment"/, "merch integration layer must include a public fulfilment disclosure label");

assert.match(schema, /halo_merch_products/, "schema must define HALO merch products");
assert.match(schema, /halo_merch_variants/, "schema must define HALO merch variants");
assert.match(schema, /providerSku/, "schema must persist provider SKU mappings");
assert.match(schema, /affiliateCheckoutUrl/, "schema must persist hidden affiliate checkout destinations");

assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_merch_products/, "migration must create the HALO merch products table");
assert.match(migration, /CREATE TABLE IF NOT EXISTS halo_merch_variants/, "migration must create the HALO merch variants table");
assert.match(migration, /provider_sku TEXT NOT NULL UNIQUE/, "migration must keep provider SKU uniqueness explicit");
assert.match(migration, /Printful/, "migration seed data must record the Printful-backed flow");

assert.match(docs, /HALO as the customer-facing brand and Printful as the fulfilment backend/i, "documentation must describe the HALO-first branding boundary");
assert.match(docs, /provider SKUs, product IDs, affiliate destinations, and redirect routing stay behind the API/i, "documentation must describe the server-side provider abstraction");

console.log("HALO merch contracts passed.");
