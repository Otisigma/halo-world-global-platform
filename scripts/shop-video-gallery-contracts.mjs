// Contracts for the editable Artist Shop video gallery.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normaliseSettings, resolveGallery, youtubePackage } from "../netlify/lib/shop-video-gallery.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");
const results = [];
const check = (name, fn) => {
  try { fn(); results.push([true, name]); } catch (error) { results.push([false, `${name} — ${error.message}`]); }
};

const slug = "anna-jayne";
const video = (id, extra = {}) => ({ id, title: id, artistSlug: slug, origin: "manual", createdAt: `2026-11-${String(10 + id.length).padStart(2, "0")}T00:00:00Z`, ...extra });
const dw1 = video("dw-1", { origin: "dreamweaver", createdAt: "2026-11-01T00:00:00Z" });
const dw2 = video("dw-2", { origin: "dreamweaver", createdAt: "2026-11-05T00:00:00Z" });
const manualLoose = video("manual-1", { artistSlug: "" });
const otherRoom = video("other-room", { artistSlug: "dj-halo-x" });
const all = [dw1, dw2, manualLoose, otherRoom];

check("defaults to dreamweaver_only when the artist has no settings yet", () => {
  assert.equal(normaliseSettings(undefined).mode, "dreamweaver_only");
  assert.equal(normaliseSettings({ mode: "bogus" }).mode, "dreamweaver_only");
});

check("dreamweaver_only auto-attaches only this artist's Dreamweaver videos", () => {
  const entries = resolveGallery({ artistSlug: slug, settings: normaliseSettings({}), videos: all, items: [] });
  assert.deepEqual(entries.map(e => e.id), ["dw-2", "dw-1"]);
  assert.ok(entries.every(e => e.placement === "dreamweaver_auto"));
});

check("empty mode starts clean", () => {
  const entries = resolveGallery({ artistSlug: slug, settings: normaliseSettings({ mode: "empty" }), videos: all, items: [] });
  assert.equal(entries.length, 0);
});

check("manual additions appear in both modes", () => {
  const items = [{ video_id: "manual-1", added_manually: true, hidden: false, position: 0 }];
  for (const mode of ["empty", "dreamweaver_only"]) {
    const entries = resolveGallery({ artistSlug: slug, settings: normaliseSettings({ mode }), videos: all, items });
    assert.ok(entries.some(e => e.id === "manual-1" && e.placement === "manual"), mode);
  }
});

check("never injects a video attached to another artist room", () => {
  const items = [{ video_id: "other-room", added_manually: true, hidden: false, position: 0 }];
  const entries = resolveGallery({ artistSlug: slug, settings: normaliseSettings({}), videos: all, items });
  assert.ok(!entries.some(e => e.id === "other-room"));
});

check("pinned video leads, then explicit order, then newest", () => {
  const items = [
    { video_id: "manual-1", added_manually: true, hidden: false, position: 1 },
    { video_id: "dw-1", added_manually: false, hidden: false, position: 0 }
  ];
  const entries = resolveGallery({ artistSlug: slug, settings: normaliseSettings({ pinned_video_id: "manual-1" }), videos: all, items });
  assert.deepEqual(entries.map(e => e.id), ["manual-1", "dw-1", "dw-2"]);
  assert.equal(entries[0].pinned, true);
});

check("hidden videos are invisible to visitors but kept for the artist's editor", () => {
  const items = [{ video_id: "dw-2", added_manually: false, hidden: true, position: 0 }];
  const settings = normaliseSettings({});
  assert.ok(!resolveGallery({ artistSlug: slug, settings, videos: all, items }).some(e => e.id === "dw-2"));
  assert.ok(resolveGallery({ artistSlug: slug, settings, videos: all, items, includeHidden: true }).some(e => e.id === "dw-2" && e.hidden));
});

check("YouTube package drafts title, credits and shop link", () => {
  const pack = youtubePackage({
    video: { origin: "dreamweaver", title: "Here We Go Again" },
    song: { title: "Here We Go Again", artistName: "Anna Jayne", isrc: "GBXXX2600001" },
    version: { label: "Club Edit" }, artistName: "Anna Jayne", shopUrl: "https://example.test/artist-shop/?artist=anna-jayne"
  });
  assert.equal(pack.title, "Anna Jayne — Here We Go Again (Club Edit) | Dreamweaver Visual");
  assert.match(pack.description, /Version: Club Edit/);
  assert.match(pack.description, /ISRC: GBXXX2600001/);
  assert.match(pack.description, /artist-shop\/\?artist=anna-jayne/);
});

const [api, videosApi, migration, page, script, shop] = await Promise.all([
  read("netlify/functions/shop-video-gallery.mjs"),
  read("netlify/functions/videos.mjs"),
  read("netlify/database/migrations/20261120030000_editable_shop_video_gallery.sql"),
  read("artist-shop/index.html"),
  read("artist-shop/shop-video-gallery.js"),
  read("artist-shop/shop-experience.js")
]);

check("API only edits shops the signed-in member owns, with origin checks", () => {
  assert.ok(api.includes("verifyRequestOrigin(request)"));
  assert.ok(api.includes("You can only edit your own shop gallery"));
  assert.ok(api.includes("video.owner_member_id = ${page.owner_member_id}"));
});

check("global HALO feed excludes shop-only videos", () => {
  assert.ok(videosApi.includes("<> 'shop_only'"));
  assert.ok(migration.includes("publish_scope") && migration.includes("origin") && migration.includes("song_version_id"));
  assert.ok(migration.includes("halo_shop_video_galleries") && migration.includes("halo_shop_video_gallery_items"));
});

check("shop page no longer falls back to the shared catalog or starter visuals", () => {
  assert.ok(!shop.includes("STARTER_VIDEOS") && !shop.includes('fetch("/api/videos"'));
  assert.ok(script.includes("/api/shop-video-gallery") && !script.includes('"/api/videos"'));
  assert.ok(page.includes("/artist-shop/shop-video-gallery.js") && page.includes('id="gallery-editor"'));
});

check("videos and tracks cue each other", () => {
  assert.ok(script.includes("halo:cue-song") && shop.includes('addEventListener("halo:cue-song"'));
  assert.ok(script.includes("halo:library-track") && shop.includes("songId: track.songId"));
});

const failures = results.filter(([ok]) => !ok);
for (const [ok, name] of results) console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
if (failures.length) process.exitCode = 1;
else console.log(`Shop video gallery contracts: ${results.length}/${results.length} checks passed.`);
