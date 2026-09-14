# HALO Merch × Printful

HALO merch now sits inside the public `/music/` storefront with HALO as the customer-facing brand and Printful as the fulfilment backend. The storefront language stays HALO-first while provider SKUs, product IDs, affiliate destinations, and redirect routing stay behind the API.

## Public boundary

- Public shoppers see HALO product names, pricing, release tie-ins, variant summaries, and fulfilment notes.
- Printful is named only where fulfilment and affiliate disclosure are required.
- Provider SKU mappings and affiliate checkout URLs are never embedded directly in the storefront client.

## Main files

- `music/index.html` adds the merch studio panel inside the existing HALO shop flow.
- `music/music.js` loads `/api/halo-merch`, renders HALO-facing merch cards, and keeps related-song navigation inside the shop.
- `music/music.css` styles the merch panel, cards, facts, and disclosure block.
- `netlify/functions/halo-merch.mjs` serves public HALO merch data and routes checkout requests through a same-origin redirect layer.
- `netlify/lib/halo-merch.mjs` defines the Printful-backed integration layer, fallback catalog, and public serialization boundary.
- `db/schema.ts` and `netlify/database/migrations/20260914073000_create-halo-merch-printful.sql` add product and variant tables for provider metadata, pricing, fulfilment regions, disclosure copy, and provider SKUs.
- `scripts/halo-merch-contracts.mjs` verifies the storefront, API, schema, migration, and documentation contract for this flow.

## Data model choices

- `halo_merch_products` stores the HALO-facing product record plus the hidden Printful mapping and affiliate route.
- `halo_merch_variants` stores per-variant provider SKU mappings, sizes/colours, pricing, availability, dispatch timing, and structured metadata.
- The API exposes only HALO-safe product data plus disclosure copy and a HALO-routed checkout path.

## Operational note

The seeded catalogue uses Printful-backed routing previews so the HALO storefront can ship immediately with the integration layer in place. When the live Printful store is finalised, replace the seeded `affiliate_checkout_url` and provider IDs with the production mappings rather than changing the public storefront contract.
