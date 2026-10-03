import { lookup } from "node:dns";
import { readFile, writeFile, rename, rm, mkdir, access, realpath, stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
export const CONFIG = Object.freeze({
  CATALOG_INPUT_PATH: resolve(root, "shared-catalog.json"),
  DEFAULT_PRICE: "US$1.29",
  DEFAULT_CHECKOUT_BASE: "https://halo-world-global-platform.netlify.app/music-upload?song=",
  TIMEOUT_MS: 3500,
  PLACEHOLDER_SUBSTRINGS: ["placeholder", "HALO PLACEHOLDER COVER", "data:image/svg+xml"]
});

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]
]) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");

export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

function parseWebUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.port && url.port !== "80" && url.port !== "443")) {
    throw new Error("Expected an HTTP(S) URL without credentials on a standard web port.");
  }
  return url;
}

export function pingUrl(value) {
  return new Promise((resolveResult) => {
    let url;
    try {
      url = parseWebUrl(value);
      const address = url.hostname.replace(/^\[|\]$/g, "");
      if (isIP(address) && !isPublicAddress(address)) throw new Error("Non-public artwork host.");
    } catch (error) {
      resolveResult({ ok: false, statusCode: 0, reason: error.message });
      return;
    }
    let timer;
    const finish = (result) => {
      clearTimeout(timer);
      resolveResult(result);
    };
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: "HEAD",
      agent: false,
      // Validate and pin DNS results on the actual connection, preventing DNS rebinding.
      lookup(hostname, options, callback) {
        lookup(hostname, { all: true }, (error, addresses) => {
          if (error) return callback(error);
          if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
            return callback(new Error("Non-public artwork host."));
          }
          const candidates = options.family
            ? addresses.filter(({ family }) => family === options.family) : addresses;
          if (!candidates.length) return callback(new Error("No supported artwork address."));
          if (options.all) callback(null, candidates);
          else callback(null, candidates[0].address, candidates[0].family);
        });
      }
    }, (response) => {
      response.resume();
      // Redirect targets have not been audited; require the final artwork URL.
      finish({ ok: response.statusCode >= 200 && response.statusCode < 300, statusCode: response.statusCode });
    });
    request.on("error", (error) => finish({ ok: false, statusCode: 0, reason: error.message }));
    timer = setTimeout(() => request.destroy(new Error("Artwork HEAD request timed out.")), CONFIG.TIMEOUT_MS);
    request.end();
  });
}

function isPlaceholder(value) {
  let decoded = value;
  // Decode nested URL escapes conservatively so encoded placeholders cannot bypass the gate.
  for (let i = 0; i < 3; i++) {
    try { decoded = decodeURIComponent(decoded); } catch { break; }
  }
  return CONFIG.PLACEHOLDER_SUBSTRINGS.some((marker) => decoded.toLowerCase().includes(marker.toLowerCase()));
}

async function checkArtwork(value, catalogRoot, checkUrl) {
  if (typeof value !== "string" || !value.trim()) return "Missing artwork URL.";
  const artwork = value.trim();
  if (isPlaceholder(artwork)) return "Placeholder artwork detected.";
  if (artwork.startsWith("/") && !artwork.startsWith("//")) {
    try {
      const base = await realpath(catalogRoot);
      const file = await realpath(resolve(base, decodeURIComponent(artwork.split(/[?#]/)[0]).slice(1)));
      const location = relative(base, file);
      if (location.startsWith("..") || isAbsolute(location) || !(await stat(file)).isFile()) {
        return "Artwork must be a file within the catalog root.";
      }
      if (file.toLowerCase().endsWith(".svg") && isPlaceholder(await readFile(file, "utf8"))) {
        return "Placeholder artwork detected.";
      }
      return null;
    } catch {
      return "Local artwork file is missing or invalid.";
    }
  }
  try {
    parseWebUrl(artwork);
    const result = await checkUrl(artwork);
    return result.ok ? null : `Artwork URL failed HEAD validation (${result.statusCode || result.reason || "unreachable"}).`;
  } catch {
    return "Invalid artwork URL; use HTTP(S) or an existing root-relative asset.";
  }
}

const isMissing = (value) => value == null || (typeof value === "string" && ["", "—"].includes(value.trim()));

export class ReleaseGuardAgent {
  static async auditAndGuard(catalogItems, { catalogRoot = root, checkUrl = pingUrl } = {}) {
    if (!Array.isArray(catalogItems)) throw new Error("Catalog songs must be an array.");
    const sanitizedCatalog = [];
    const quarantinedCatalog = [];
    const report = {
      agent: "ReleaseGuardAgent", passed: true, totalProcessed: catalogItems.length,
      approvedCount: 0, quarantinedCount: 0, approvedTracks: [], quarantinedTracks: [], issues: []
    };
    for (const [index, rawTrack] of catalogItems.entries()) {
      const validRecord = rawTrack !== null && typeof rawTrack === "object" && !Array.isArray(rawTrack);
      const track = validRecord ? { ...rawTrack } : {};
      const failures = [];
      const warnings = [];
      if (!validRecord) failures.push("Track must be an object.");
      const statuses = [track.releaseStatus, track.status].filter((value) => value !== undefined);
      if (!statuses.length || statuses.some((value) => value !== "PUBLISHED")) {
        failures.push("Every supplied release status must be PUBLISHED.");
      }
      const artworkFailure = await checkArtwork(track.artworkUrl, catalogRoot, checkUrl);
      if (artworkFailure) failures.push(artworkFailure);
      if (isMissing(track.price)) {
        track.price = CONFIG.DEFAULT_PRICE;
        warnings.push(`Missing price defaulted to ${CONFIG.DEFAULT_PRICE}.`);
      } else if (!((typeof track.price === "number" && Number.isFinite(track.price) && track.price > 0) ||
                   (typeof track.price === "string" && /^(?:US\$|\$)?\s*\d+(?:\.\d{1,2})?$/.test(track.price.trim()) &&
                    Number(track.price.trim().replace(/^(?:US\$|\$)\s*/, "")) > 0))) {
        failures.push("Invalid price; expected a positive USD amount.");
      }
      if (isMissing(track.checkoutUrl)) {
        const id = typeof track.id === "string" ? track.id.trim()
          : typeof track.id === "number" && Number.isFinite(track.id) ? String(track.id) : "";
        const slug = id || (typeof track.title === "string"
          ? track.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : "");
        if (!slug) failures.push("Cannot generate checkout URL without a track id or title slug.");
        else {
          track.checkoutUrl = `${CONFIG.DEFAULT_CHECKOUT_BASE}${encodeURIComponent(slug)}`;
          warnings.push("Missing checkout URL replaced with the HALO purchase route.");
        }
      } else {
        try {
          if (typeof track.checkoutUrl !== "string") throw new Error("Invalid checkout URL.");
          parseWebUrl(track.checkoutUrl);
        } catch { failures.push("Invalid checkout URL; expected HTTP(S)."); }
      }
      const identity = track.id ?? track.title ?? `track-${index + 1}`;
      track.isLiveVisible = failures.length === 0;
      track.quarantineReason = failures.length ? failures : null;
      if (failures.length) {
        quarantinedCatalog.push(validRecord ? track : { original: rawTrack, ...track });
        report.quarantinedTracks.push({ id: identity, title: track.title, reasons: failures });
      } else {
        sanitizedCatalog.push(track);
        report.approvedTracks.push(identity);
      }
      if (failures.length || warnings.length) {
        report.issues.push({ track: identity, level: failures.length ? "QUARANTINED" : "WARNING", reasons: failures, warnings });
      }
    }
    report.approvedCount = sanitizedCatalog.length;
    report.quarantinedCount = quarantinedCatalog.length;
    report.passed = report.quarantinedCount === 0;
    return { sanitizedCatalog, quarantinedCatalog, report };
  }

  static async run({ catalogPath = CONFIG.CATALOG_INPUT_PATH, recoveryDirectory = resolve(dirname(catalogPath), ".netlify/release-guard") } = {}) {
    const backupPath = resolve(recoveryDirectory, "shared-catalog.original.json");
    // A failed run must not become a successful build merely because it removed unsafe tracks.
    try {
      await access(backupPath);
      throw new Error(`Unresolved quarantine. Restore ${backupPath} to ${catalogPath}, repair the tracks, then remove the recovery directory and rerun.`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    let source;
    try {
      source = await readFile(catalogPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      throw new Error(`Required release catalog is missing: ${catalogPath}. Add the real shared-catalog.json to the repository root or generate it before npm run release-guard. Expected a JSON array of tracks or an object with a songs array. The release guard remains mandatory; no catalog was generated or skipped.`, { cause: error });
    }
    const catalog = JSON.parse(source);
    const songs = Array.isArray(catalog) ? catalog : catalog?.songs;
    if (!Array.isArray(songs)) throw new Error("Catalog must be an array or an object with a songs array.");
    const { sanitizedCatalog, quarantinedCatalog, report } = await this.auditAndGuard(songs, { catalogRoot: dirname(catalogPath) });
    const output = Array.isArray(catalog) ? sanitizedCatalog : { ...catalog, songs: sanitizedCatalog };
    if (await readFile(catalogPath, "utf8") !== source) {
      throw new Error("Catalog changed during inspection; rerun against the updated source.");
    }
    if (!report.passed) {
      await mkdir(recoveryDirectory, { recursive: true });
      // Preserve the exact source before replacing it; never overwrite an unresolved backup.
      await writeFile(backupPath, source, { flag: "wx", mode: 0o600 });
      await writeFile(resolve(recoveryDirectory, "quarantine.json"), JSON.stringify({ report, tracks: quarantinedCatalog }, null, 2), { flag: "wx", mode: 0o600 });
    }
    const temporaryPath = `${catalogPath}.release-guard.tmp`;
    let temporaryCreated = false;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, { flag: "wx" });
      temporaryCreated = true;
      await rename(temporaryPath, catalogPath);
    } finally {
      if (temporaryCreated) await rm(temporaryPath, { force: true });
    }
    console.log(JSON.stringify(report, null, 2));
    console.log(`HALO RELEASE GUARD: ${report.approvedCount} approved, ${report.quarantinedCount} quarantined.`);
    if (!report.passed) console.error(`Build blocked. Original catalog and quarantine details saved in ${recoveryDirectory}.`);
    return report;
  }
}

export default ReleaseGuardAgent;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  ReleaseGuardAgent.run().then((report) => {
    process.exitCode = report.passed ? 0 : 1;
  }).catch((error) => {
    console.error(`HALO RELEASE GUARD: ${error.message}`);
    process.exitCode = 1;
  });
}
