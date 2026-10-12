import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { validMixId } from "../dj-vault/vault-card.js";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const textOrNull = value => value === null || typeof value === "string";

export async function verifyFeaturedPush({ origin, expectedId, timeoutMs = 10000, fetchImpl = fetch }) {
  let site;
  try { site = new URL(origin); } catch { throw new Error("Provide a canonical HTTPS origin."); }
  if (site.protocol !== "https:" || site.username || site.password || site.pathname !== "/" || site.search || site.hash) {
    throw new Error("Provide a canonical HTTPS origin without credentials, path, query, or fragment.");
  }
  if (expectedId !== undefined && expectedId !== null && !validMixId(expectedId)) {
    throw new Error("Expected ID must be a mix UUID, or use none for an empty slot.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new Error("Timeout must be an integer from 1 to 60000 milliseconds.");
  }
  const endpoint = new URL("/api/dj-vault/featured-push", site).href;
  const signal = AbortSignal.timeout(timeoutMs);
  let data;
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET", credentials: "omit", redirect: "error", cache: "no-store",
      headers: { Accept: "application/json" }, signal
    });
    if (response.status !== 200) throw new Error(`Featured endpoint returned HTTP ${response.status}.`);
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) {
      throw new Error("Featured endpoint did not return JSON.");
    }
    try { data = await response.json(); }
    catch {
      if (signal.aborted) throw signal.reason;
      throw new Error("Featured endpoint returned invalid JSON.");
    }
  } catch (error) {
    if (signal.aborted) throw new Error("Featured endpoint timed out.");
    if (error instanceof TypeError) throw new Error("Featured endpoint request failed (network or redirect).");
    throw error;
  }
  if (!onlyKeys(data, ["success", "edition"]) || data.success !== true || !Object.hasOwn(data, "edition")) {
    throw new Error("Featured endpoint returned an invalid response schema.");
  }
  const edition = data.edition;
  if (edition !== null && (
    !onlyKeys(edition, ["id", "title", "description", "creator", "pushPriority", "salesStatus", "commerce"])
    || !validMixId(edition.id) || typeof edition.title !== "string" || !edition.title.trim()
    || !textOrNull(edition.description)
    || !onlyKeys(edition.creator, ["name"]) || !textOrNull(edition.creator.name)
    || !["featured", "white_label", "test_press"].includes(edition.pushPriority)
    || typeof edition.salesStatus !== "string" || !edition.salesStatus.trim()
    || !onlyKeys(edition.commerce, ["priceMinor", "currency", "clientSaleEnabled"])
    || !Number.isSafeInteger(edition.commerce.priceMinor) || edition.commerce.priceMinor < 0
    || typeof edition.commerce.currency !== "string" || !/^[A-Z]{3}$/.test(edition.commerce.currency)
    || typeof edition.commerce.clientSaleEnabled !== "boolean"
  )) throw new Error("Featured endpoint returned invalid or unexpected public edition fields.");
  const id = edition?.id.toLowerCase() ?? null;
  if (expectedId !== undefined && id !== (expectedId?.toLowerCase() ?? null)) {
    throw new Error("Featured slot does not match the expected mix ID or empty state.");
  }
  return {
    ok: true, checkedAt: new Date().toISOString(), endpoint,
    state: edition === null ? "empty" : "featured", mixId: id, pushPriority: edition?.pushPriority ?? null
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: {
      origin: { type: "string" }, "expected-id": { type: "string" },
      "timeout-ms": { type: "string" }, help: { type: "boolean" }
    } });
    if (values.help) {
      console.log("Usage: node scripts/dj-featured-smoke.mjs --origin https://your-site.example [--expected-id UUID|none] [--timeout-ms 10000]");
    } else {
      const result = await verifyFeaturedPush({
        origin: values.origin,
        expectedId: values["expected-id"] === "none" ? null : values["expected-id"],
        timeoutMs: values["timeout-ms"] === undefined ? 10000 : Number(values["timeout-ms"])
      });
      console.log(JSON.stringify(result));
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, checkedAt: new Date().toISOString(), error: error.message }));
    process.exitCode = 1;
  }
}
