import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import https from "node:https";
import { EventEmitter } from "node:events";
import ReleaseGuardAgent, { CONFIG, pingUrl, isPublicAddress } from "../release-guard-agent.js";

const root = resolve(import.meta.dirname, "..");
const fixture = await mkdtemp(resolve(tmpdir(), "halo-release-guard-"));
const good = {
  id: "published & ready", title: "Approved song", releaseStatus: "PUBLISHED",
  artworkUrl: "https://art.example/cover.jpg", metadata: { credits: ["HALO"], custom: true }
};
const checks = [];
const options = {
  catalogRoot: fixture,
  checkUrl: async (url) => {
    checks.push(url);
    return { ok: url !== "https://art.example/missing.jpg", statusCode: 404 };
  }
};
const audit = (tracks) => ReleaseGuardAgent.auditAndGuard(tracks, options);
const cli = () => spawnSync(process.execPath, [resolve(fixture, "release-guard-agent.js")], {
  cwd: tmpdir(), encoding: "utf8"
});
const catalogPath = resolve(fixture, "shared-catalog.json");
const recovery = resolve(fixture, ".netlify/release-guard");
const readCatalog = async () => JSON.parse(await readFile(catalogPath, "utf8"));

try {
  const original = structuredClone(good);
  const approved = await audit([good]);
  assert.equal(approved.report.passed, true);
  assert.equal(approved.report.approvedCount, 1);
  assert.equal(approved.sanitizedCatalog[0].price, "US$1.29");
  assert.equal(approved.sanitizedCatalog[0].checkoutUrl, `${CONFIG.DEFAULT_CHECKOUT_BASE}published%20%26%20ready`);
  assert.equal(approved.sanitizedCatalog[0].isLiveVisible, true);
  assert.equal(approved.sanitizedCatalog[0].quarantineReason, null);
  assert.deepEqual(approved.sanitizedCatalog[0].metadata, good.metadata);
  assert.deepEqual(good, original, "auditing must not mutate source tracks");
  assert.deepEqual(await audit([good]), approved, "auditing is deterministic");
  assert.deepEqual(checks, [good.artworkUrl, good.artworkUrl]);

  for (const status of ["READY", "STANDBY", "PENDING", "published", "", null, 123]) {
    assert.equal((await audit([{ ...good, releaseStatus: status }])).report.passed, false);
  }
  assert.equal((await audit([{ ...good, status: "STANDBY" }])).report.passed, false, "conflicting statuses fail closed");
  assert.equal((await audit([{ ...good, releaseStatus: undefined, status: "PUBLISHED" }])).report.passed, true);
  assert.equal((await audit([{ ...good, releaseStatus: undefined }])).report.passed, false);
  for (const artworkUrl of [
    undefined, "", "  ", 42, {}, "https://art.example/PLACEHOLDER.jpg",
    "https://art.example/%2570laceholder.jpg", "data:image/svg+xml,<svg/>",
    "javascript:alert(1)", "ftp://art.example/a.jpg", "//art.example/a.jpg",
    "******art.example/a.jpg", "https://art.example/missing.jpg"
  ]) {
    const result = await audit([{ ...good, artworkUrl }]);
    assert.equal(result.report.quarantinedCount, 1, `reject artwork ${JSON.stringify(artworkUrl)}`);
    assert.equal(result.sanitizedCatalog.length, 0);
    assert.equal(result.quarantinedCatalog[0].isLiveVisible, false);
    assert.ok(result.quarantinedCatalog[0].quarantineReason.length);
  }
  for (const price of [undefined, null, "", " ", "—"]) {
    assert.equal((await audit([{ ...good, price }])).sanitizedCatalog[0].price, CONFIG.DEFAULT_PRICE);
  }
  for (const price of [1.29, "US$1.29", "$2.00", "2.50"]) {
    assert.equal((await audit([{ ...good, price }])).sanitizedCatalog[0].price, price);
  }
  for (const price of [0, -1, NaN, Infinity, {}, true, "free", "US$0.00"]) {
    assert.equal((await audit([{ ...good, price }])).report.passed, false);
  }
  for (const checkoutUrl of [undefined, null, "", " ", "—"]) {
    assert.ok((await audit([{ ...good, checkoutUrl }])).sanitizedCatalog[0].checkoutUrl.startsWith(CONFIG.DEFAULT_CHECKOUT_BASE));
  }
  for (const checkoutUrl of ["javascript:alert(1)", {}, 42, "/buy", "******shop.example"]) {
    assert.equal((await audit([{ ...good, checkoutUrl }])).report.passed, false);
  }
  const priced = { ...good, price: "US$2.49", checkoutUrl: "https://shop.example/buy" };
  assert.equal((await audit([priced])).sanitizedCatalog[0].checkoutUrl, priced.checkoutUrl);
  assert.equal((await audit([{ ...good, id: undefined, title: "My Song!" }])).sanitizedCatalog[0].checkoutUrl, `${CONFIG.DEFAULT_CHECKOUT_BASE}my-song`);
  assert.equal((await audit([{ ...good, id: 0 }])).sanitizedCatalog[0].checkoutUrl, `${CONFIG.DEFAULT_CHECKOUT_BASE}0`);
  assert.equal((await audit([{ ...good, id: undefined, title: "!!!" }])).report.passed, false);
  for (const raw of [null, 12, "track", []]) {
    assert.equal((await audit([raw])).report.passed, false);
  }
  await assert.rejects(audit({ songs: [] }), /must be an array/);

  await mkdir(resolve(fixture, "assets"));
  await writeFile(resolve(fixture, "assets/cover.svg"), '<svg><title>Original artwork</title></svg>');
  await writeFile(resolve(fixture, "assets/disguised.svg"), '<svg><text>HALO PLACEHOLDER COVER</text></svg>');
  const local = { ...good, artworkUrl: "/assets/cover.svg" };
  assert.equal((await audit([local])).report.passed, true);
  for (const artworkUrl of ["/assets/missing.jpg", "/assets", "/assets/disguised.svg", "/../outside.jpg"]) {
    assert.equal((await audit([{ ...good, artworkUrl }])).report.passed, false);
  }
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.16.0.1", "192.168.1.1",
    "100.64.0.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "not-an-ip"]) {
    assert.equal(isPublicAddress(address), false, `block ${address}`);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  for (const url of ["https://127.0.0.1/image.jpg", "http://[::1]/image.jpg", "http://localhost/image.jpg", "http://169.254.169.254/latest/meta-data/", "broken"]) {
    assert.equal((await pingUrl(url)).ok, false);
  }
  // Exercise the actual HTTP client without external traffic or weakening address checks.
  const originalRequest = https.request;
  try {
    for (const statusCode of [200, 204, 301, 404, 500]) {
      let resumed = false;
      https.request = (url, requestOptions, callback) => {
        assert.equal(requestOptions.method, "HEAD");
        const request = new EventEmitter();
        request.end = () => {
          callback({ statusCode, resume: () => { resumed = true; } });
        };
        return request;
      };
      assert.equal((await pingUrl(good.artworkUrl)).ok, statusCode < 300);
      assert.equal(resumed, true);
    }
    https.request = (url, requestOptions) => {
      const request = new EventEmitter();
      request.end = () => requestOptions.lookup("localhost", { all: true }, (error) => {
        assert.ok(error, "DNS lookup must reject private results before connection");
        request.emit("error", error);
      });
      return request;
    };
    assert.equal((await pingUrl(good.artworkUrl)).ok, false);
    https.request = () => {
      const request = new EventEmitter();
      request.end = () => {};
      request.destroy = (error) => request.emit("error", error);
      return request;
    };
    const timeout = await pingUrl(good.artworkUrl);
    assert.equal(timeout.ok, false);
    assert.match(timeout.reason, /timed out/);
  } finally {
    https.request = originalRequest;
  }

  await copyFile(resolve(root, "release-guard-agent.js"), resolve(fixture, "release-guard-agent.js"));
  await writeFile(resolve(fixture, "package.json"), '{"type":"module"}');
  const missing = cli();
  assert.equal(missing.status, 0, "missing optional static catalog does not block builds");
  assert.match(missing.stderr, /shared-catalog\.json not found.*skipping the static catalog audit/);
  await assert.rejects(access(catalogPath), { code: "ENOENT" });
  await assert.rejects(access(recovery), { code: "ENOENT" });
  assert.deepEqual(await ReleaseGuardAgent.run({ catalogPath, recoveryDirectory: recovery }), {
    passed: true, skipped: true, reason: "Catalog file not found."
  });
  await mkdir(catalogPath);
  assert.equal(cli().status, 1, "non-missing read errors still block builds");
  await rm(catalogPath, { recursive: true });
  await mkdir(recovery, { recursive: true });
  await writeFile(resolve(recovery, "shared-catalog.original.json"), "unresolved source");
  const unresolved = cli();
  assert.equal(unresolved.status, 1, "missing catalog cannot bypass unresolved quarantine");
  assert.match(unresolved.stderr, /Unresolved quarantine/);
  await rm(recovery, { recursive: true });
  for (const source of ["not json", "{}", '{"songs":{}}', "null"]) {
    await writeFile(catalogPath, source);
    assert.equal(cli().status, 1);
    assert.equal(await readFile(catalogPath, "utf8"), source, "invalid catalog must stay untouched");
  }
  await writeFile(catalogPath, JSON.stringify([local]));
  const staleTemporary = `${catalogPath}.release-guard.tmp`;
  await writeFile(staleTemporary, "retain unrelated file");
  assert.equal(cli().status, 1, "an existing temporary file must not be overwritten");
  assert.equal(await readFile(staleTemporary, "utf8"), "retain unrelated file");
  await rm(staleTemporary);
  assert.equal(cli().status, 0);
  assert.ok(Array.isArray(await readCatalog()));
  assert.deepEqual((await readCatalog())[0].metadata, good.metadata);
  assert.equal(cli().status, 0, "clean reruns succeed");
  const unsafe = { ...local, releaseStatus: "READY", privateNotes: "retain source metadata" };
  const source = `${JSON.stringify({ version: 7, extra: { owner: "HALO" }, songs: [local, unsafe] }, null, 2)}\n`;
  await writeFile(catalogPath, source);
  const failed = cli();
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /1 approved, 1 quarantined/);
  assert.deepEqual((await readCatalog()).extra, { owner: "HALO" });
  assert.equal((await readCatalog()).version, 7);
  assert.equal((await readCatalog()).songs.length, 1);
  assert.equal(await readFile(resolve(recovery, "shared-catalog.original.json"), "utf8"), source);
  const quarantine = JSON.parse(await readFile(resolve(recovery, "quarantine.json"), "utf8"));
  assert.equal(quarantine.tracks[0].privateNotes, unsafe.privateNotes);
  assert.equal(quarantine.tracks[0].isLiveVisible, false);
  const sanitized = await readFile(catalogPath, "utf8");
  assert.equal(cli().status, 1, "rerun cannot silently approve after dropping quarantine");
  assert.equal(await readFile(catalogPath, "utf8"), sanitized);
  await writeFile(catalogPath, source);
  await rm(recovery, { recursive: true });
  await writeFile(catalogPath, JSON.stringify({ version: 7, songs: [local, { ...unsafe, releaseStatus: "PUBLISHED" }] }));
  assert.equal(cli().status, 0, "restored and repaired source can pass");
  await assert.rejects(access(resolve(recovery, "shared-catalog.original.json")));

  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["release-guard"], "node release-guard-agent.js");
  assert.equal(pkg.scripts.prebuild, "npm run release-guard");
  assert.equal(pkg.scripts.build, "node scripts/music-chart-contracts.mjs");
  assert.match(await readFile(resolve(root, "netlify.toml"), "utf8"), /command = "npm run build"/);
  console.log("Release guard contracts passed.");
} finally {
  await rm(fixture, { recursive: true, force: true });
}
