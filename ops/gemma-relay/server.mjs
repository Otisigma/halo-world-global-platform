import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const port = Number.parseInt(process.env.PORT || "8787", 10);
const maxBodyBytes = 4_096;

function json(response, body, status = 200) {
  response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function secureMatch(provided, expected) {
  const providedBuffer = Buffer.from(String(provided || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function bearerToken(request) {
  const header = String(request.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function watchtowerUrl() {
  const url = new URL(String(process.env.WATCHTOWER_URL || "http://updater:8080/v1/update"));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("WATCHTOWER_URL is invalid");
  return url;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function requestWatchtowerUpdate() {
  const token = String(process.env.WATCHTOWER_TOKEN || "").trim();
  if (!token) throw new Error("WATCHTOWER_TOKEN is not configured");
  const response = await fetch(watchtowerUrl(), {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Watchtower returned ${response.status}`);
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") return json(response, { ok: true, service: "gemma-relay" });
  if (request.method !== "POST" || request.url !== "/v1/commands") return json(response, { message: "Not found" }, 404);

  const operatorToken = String(process.env.GEMMA_OPERATOR_TOKEN || "").trim();
  if (!operatorToken || !secureMatch(bearerToken(request), operatorToken)) return json(response, { message: "Unauthorized" }, 401);

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    return json(response, { message: error instanceof Error && error.message === "too_large" ? "Command is too large" : "Command must be valid JSON" }, error instanceof Error && error.message === "too_large" ? 413 : 400);
  }
  if (payload.action !== "watchtower_update" || payload.scope !== "azuracast") return json(response, { message: "Command is not allowed" }, 422);

  try {
    await requestWatchtowerUpdate();
    console.info("Gemma requested an AzuraCast update check");
    return json(response, { accepted: true, action: payload.action }, 202);
  } catch (error) {
    console.error("Gemma update request failed", error instanceof Error ? error.message : "unknown error");
    return json(response, { message: "Watchtower did not accept the update request" }, 502);
  }
});

server.listen(port, "0.0.0.0", () => console.info(`Gemma relay listening on port ${port}`));
