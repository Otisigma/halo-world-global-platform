import { timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 4_096;
const DEFAULT_DESTINATIONS = ["YouTube", "TikTok"];

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function getDestinations() {
  const configured = String(process.env.HALO_BROADCAST_DESTINATIONS || "")
    .split(",")
    .map(destination => destination.trim())
    .filter(Boolean)
    .slice(0, 20);
  return configured.length ? configured : DEFAULT_DESTINATIONS;
}

function secureMatch(provided, expected) {
  const providedBuffer = Buffer.from(String(provided || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function getRelayUrl(action) {
  const environmentName = action === "start" ? "HALO_BROADCAST_START_URL" : "HALO_BROADCAST_STOP_URL";
  const value = String(process.env[environmentName] || "").trim();
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${environmentName} must use HTTPS`);
  return url;
}

async function commandRelay(action, destinations) {
  const relayUrl = getRelayUrl(action);
  if (!relayUrl) {
    return { ok: false, status: 503, message: action === "start" ? "Broadcast relay is not connected yet." : "This relay does not support remote stop yet." };
  }

  const token = String(process.env.HALO_BROADCAST_TOKEN || "").trim();
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(relayUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, destinations, source: "halo-live", requestedAt: new Date().toISOString() }),
    signal: AbortSignal.timeout(12_000)
  });

  if (!response.ok) {
    console.error("Broadcast relay rejected command", { action, status: response.status });
    return { ok: false, status: 502, message: "The broadcast relay did not accept the command." };
  }
  return { ok: true };
}

export default async function broadcastControl(request) {
  const destinations = getDestinations();
  const startConfigured = Boolean(String(process.env.HALO_BROADCAST_START_URL || "").trim());
  const controlConfigured = Boolean(String(process.env.HALO_BROADCAST_CONTROL_CODE || "").trim());

  if (request.method === "GET") {
    return jsonResponse({
      configured: startConfigured && controlConfigured,
      destinations,
      stopSupported: Boolean(String(process.env.HALO_BROADCAST_STOP_URL || "").trim())
    });
  }

  if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) return jsonResponse({ message: "Cross-origin broadcast commands are not accepted." }, 403);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return jsonResponse({ message: "Broadcast command is too large." }, 413);
  if (!startConfigured || !controlConfigured) return jsonResponse({ message: "Broadcast relay setup is incomplete." }, 503);
  if (!secureMatch(request.headers.get("x-halo-control-code"), process.env.HALO_BROADCAST_CONTROL_CODE)) {
    return jsonResponse({ message: "Broadcast control code is incorrect." }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ message: "Broadcast command must be valid JSON." }, 400);
  }

  const action = payload?.action;
  if (action !== "start" && action !== "stop") return jsonResponse({ message: "Broadcast action must be start or stop." }, 422);

  try {
    const relayResult = await commandRelay(action, destinations);
    if (!relayResult.ok) return jsonResponse({ message: relayResult.message }, relayResult.status);
    return jsonResponse({ accepted: true, action, state: action === "start" ? "live" : "offline", destinations }, 202);
  } catch (error) {
    console.error("Broadcast relay command failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ message: "The broadcast relay could not be reached." }, 502);
  }
}

export const config = { path: "/api/broadcast-control" };
