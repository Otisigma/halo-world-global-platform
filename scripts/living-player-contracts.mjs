// Contracts for the HALO Living Player card: badge only for browser-verified signed records,
// synced kinetic lyrics, SVG fallback without WebGL, and visualizer preference across tracks.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalSnapshotPayload } from "../lib/retained-record.js";
import { mountLivingPlayer, verifiedMasterRecord, lyricsFor } from "../halo-living-player/living-player.js";

const songId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const recordId = "33333333-3333-4333-8333-333333333333";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const keys = { keys: [{ id: "k1", spki: publicKey.export({ type: "spki", format: "der" }).toString("base64") }] };
const now = new Date();
const record = { schemaVersion: 1, recordId, songId, versionId, keyId: "k1", sha256: "ab".repeat(32), byteSize: 1024,
  createdAt: now.toISOString(), retainUntil: new Date(now.getTime() + 86400000).toISOString(), sourceConsistency: "mutable_read",
  storageCommitment: "cd".repeat(32), sourceType: "direct_upload", parentRecordId: null, relationship: null };
const signature = sign(null, Buffer.from(canonicalSnapshotPayload(record)), privateKey).toString("base64");

const release = { id: "rel-1", title: "Quiet Heart", artist: "HALO", catalog: { songId, masterCopy: { versionId } },
  dreamweaverPayload: { lyricsText: "[Verse]\n[00:05] The room goes quiet\n[00:10] And the signal starts\nUntimed line" } };

function fakeFetch({ shared = true, badSignature = false } = {}) {
  const calls = [];
  const fn = async url => {
    calls.push(url);
    const body = url.startsWith("/api/release-catalog") ? { releases: [release] }
      : url.includes("action=keys") ? keys
      : url.includes("action=public-latest") ? (shared ? { shared: true, record, limitation: "Signed snapshot only.",
        signature: badSignature ? Buffer.alloc(64).toString("base64") : signature } : null)
      : null;
    return { ok: Boolean(body), json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

// Lyrics: only timed lyric lines drive the kinetic display.
const lyrics = lyricsFor(release);
assert.equal(lyrics.hasTimed, true);
assert.deepEqual(lyrics.timed.map(line => line.text), ["The room goes quiet", "And the signal starts"]);
assert.equal(lyricsFor({}).hasTimed, false);

// Provenance: verified only with a valid signature for the same master.
assert.equal((await verifiedMasterRecord({ songId, versionId }, { fetchImpl: fakeFetch() })).record.recordId, recordId);
assert.equal(await verifiedMasterRecord({ songId, versionId }, { fetchImpl: fakeFetch({ badSignature: true }) }), null);
assert.equal(await verifiedMasterRecord({ songId, versionId }, { fetchImpl: fakeFetch({ shared: false }) }), null);
assert.equal(await verifiedMasterRecord({ songId: "x", versionId }, { fetchImpl: fakeFetch() }), null);
assert.equal(await verifiedMasterRecord({ songId: versionId, versionId }, { fetchImpl: fakeFetch() }), null, "record for another song is rejected");

// Minimal DOM.
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.events = {}; this.hidden = false; this.textContent = "";
    this.style = { values: {}, setProperty: (k, v) => { this.style.values[k] = v; } };
    const classes = new Set();
    this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) };
    this.offsetWidth = 1; this.clientWidth = 400; this.clientHeight = 200; }
  set className(value) { for (const c of String(value).split(/\s+/).filter(Boolean)) this.classList.add(c); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  removeAttribute(k) { delete this.attributes[k]; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  fire(type, event = {}) { for (const fn of this.events[type] || []) fn({ target: this, preventDefault() {}, ...event }); }
  getContext() { return null; }
  set href(v) { this.attributes.href = v; }
  get href() { return this.attributes.href; }
}
const document = { hidden: false, createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag), addEventListener() {} };
const motion = { matches: false, addEventListener() {} };
const frames = [];
const window = { matchMedia: () => motion, requestAnimationFrame: fn => frames.push(fn), cancelAnimationFrame() {},
  performance: { now: () => 0 }, devicePixelRatio: 1, addEventListener() {} };
const audio = new Node("audio");
audio.paused = true; audio.currentTime = 0;
const mount = new Node("div");

const fetchImpl = fakeFetch();
const card = mountLivingPlayer({ mount, audio, window, document, fetchImpl });
const root = mount.children[0];
const find = (node, cls) => node.classList?.contains(cls) ? node : node.children?.map(child => find(child, cls)).find(Boolean);
const line = find(root, "halo-living-line"), badge = find(root, "halo-living-badge"), toggle = find(root, "halo-living-toggle");
const status = find(root, "halo-living-status");

assert.equal(root.classList.contains("is-svg"), true, "falls back to SVG when WebGL is unavailable");
assert.equal(toggle.hidden, true, "visualizer toggle is hidden when capture analysis is unsupported");
assert.match(status.textContent, /isn't available/);
assert.match(line.textContent, /Press play/);
assert.equal(badge.hidden, true, "no provenance claim before a track");

await card.setTrack({ releaseId: "rel-1", title: "Quiet Heart", artist: "HALO" });
assert.equal(line.textContent, "Quiet Heart", "title blooms before the first synced line");
assert.equal(badge.hidden, false, "badge appears for a verified signed record");
assert.match(badge.textContent, /Signed master · SHA-256 abababab/);
assert.equal(badge.href, `/provenance/verify/?record=${recordId}`);

audio.currentTime = 6; audio.fire("timeupdate");
assert.equal(line.textContent, "The room goes quiet");
assert.equal(line.classList.contains("is-blooming"), true);
audio.currentTime = 11; audio.fire("timeupdate");
assert.equal(line.textContent, "And the signal starts");

await card.setTrack({ releaseId: "unknown", title: "Other", artist: "Someone" });
assert.equal(badge.hidden, true, "badge is cleared when the track changes");
assert.equal(line.textContent, "Other");

const unsigned = mountLivingPlayer({ mount: new Node("div"), audio: new Node("audio"), window, document, fetchImpl: fakeFetch({ badSignature: true }) });
await unsigned.setTrack({ releaseId: "rel-1", title: "Quiet Heart" });
assert.equal(find(unsigned.root, "halo-living-badge").hidden, true, "an invalid signature never shows a badge");

assert.equal(fetchImpl.calls.filter(url => url.startsWith("/api/release-catalog")).length, 1, "catalog is fetched once per page");
console.log("Living player contracts passed: verified-only provenance badge, synced kinetic lyrics, SVG fallback, unsupported analysis.");
