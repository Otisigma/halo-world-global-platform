// Contracts for the swappable Artist Shop hero header.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { clampScrim, normaliseFocal, safeImageUrl, serialiseHeader } from "../netlify/lib/shop-header.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push([true, name]); } catch (error) { results.push([false, `${name} — ${error.message}`]); }
};

await check("no saved header falls back to the theme backdrop", () => {
  assert.deepEqual(serialiseHeader(null), { sourceType: "theme", imageUrl: "", songId: "", label: "Theme backdrop", focal: "center", scrim: 0.62 });
});
await check("only same-site paths and https images are accepted", () => {
  assert.equal(safeImageUrl("/api/shop-header?image=a/b.jpg"), "/api/shop-header?image=a/b.jpg");
  assert.equal(safeImageUrl("https://cdn.example.com/x.jpg"), "https://cdn.example.com/x.jpg");
  for (const bad of ["http://x.com/a.jpg", "javascript:alert(1)", "data:image/png;base64,AA", "//evil.com/a.jpg", "/\\evil.com"]) assert.equal(safeImageUrl(bad), "", bad);
  assert.equal(serialiseHeader({ source_type: "url", image_url: "javascript:alert(1)" }).sourceType, "theme");
});
await check("album cover headers keep their release id", () => {
  const header = serialiseHeader({ source_type: "album_cover", image_url: "https://img.example.com/morning-sun.jpg", song_id: "song-1", label: "Cover: Morning Sun", focal: "top", scrim: 0.5 });
  assert.equal(header.songId, "song-1");
  assert.equal(header.focal, "top");
  assert.equal(header.label, "Cover: Morning Sun");
});
await check("focal point and dim level are clamped to the supported range", () => {
  assert.equal(normaliseFocal("sideways"), "center");
  assert.equal(clampScrim(5), 0.92);
  assert.equal(clampScrim(0), 0.1);
  assert.equal(clampScrim("nope"), 0.62);
});
await check("the API is owner-only for edits, per artist page and checks uploads", async () => {
  const source = await read("netlify/functions/shop-header.mjs");
  assert.match(source, /owner_member_id !== membership\.member_id/);
  assert.match(source, /verifyRequestOrigin/);
  assert.match(source, /sniffImage/);
  assert.match(source, /artist_slug = \$\{slug\}/);
  const migration = await read("netlify/database/migrations/20261120050000_artist_shop_headers.sql");
  assert.match(migration, /artist_slug TEXT PRIMARY KEY REFERENCES halo_artist_pages/);
});
await check("the hero layers image, scrim and copy so the backdrop lettering doesn't double up", async () => {
  const html = await read("artist-shop/index.html");
  assert.match(html, /data-header-bg[\s\S]*data-header-scrim[\s\S]*halo-hero__content/);
  const css = await read("artist-shop/shop-experience.css");
  assert.match(css, /\[data-header-source="theme"\] \.signal-hero-bg[\s\S]*mask-image/);
  assert.doesNotMatch(css, /url\("\/assets\/enter-the-signal\.webp"\) center \/ cover/);
});

const failed = results.filter(([ok]) => !ok);
results.forEach(([ok, name]) => console.log(`${ok ? "✓" : "✗"} ${name}`));
if (failed.length) process.exit(1);
