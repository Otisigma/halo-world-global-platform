import OpenAI from "openai";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { isOwner } from "../lib/halo-x.mjs";
import { inspectRadioHealth } from "../lib/radio-health.mjs";

const MAX_BODY_BYTES = 8_192;
const OPERATOR_ACTIONS = new Set(["assess", "health_check", "watchtower_update"]);

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function operatorUrl() {
  const value = String(process.env.HALO_GEMMA_OPERATOR_URL || "").trim();
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("HALO_GEMMA_OPERATOR_URL must be a credential-free HTTPS URL");
  }
  return url;
}

function fallbackAssessment(health, relayConfigured) {
  const unhealthyRooms = (health.rooms || []).filter(room => room.status !== "live").map(room => room.name || room.id);
  const live = health.status === "live";
  return {
    state: live ? "stable" : health.status === "standby" ? "waiting" : "attention",
    headline: live ? "All connected radio signals are healthy" : "Gemma found radio operations that need attention",
    summary: live
      ? "Station data, network timing, and configured audio signals passed the latest verification."
      : health.summary || "One or more station checks did not pass.",
    priorities: unhealthyRooms.length
      ? unhealthyRooms.slice(0, 3).map(room => `Verify the ${room} room signal and station configuration.`)
      : [relayConfigured ? "Keep the current station watch active." : "Connect the protected operator relay before enabling remote updates."],
    recommendedAction: live ? "none" : "health_check",
    requiresApproval: false,
    confidence: live ? 0.94 : 0.78
  };
}

async function assessWithGemma(health, relayConfigured) {
  const fallback = fallbackAssessment(health, relayConfigured);
  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: String(process.env.HALO_GEMMA_MODEL || "gpt-5.4-mini").trim(),
      messages: [
        {
          role: "system",
          content: "You are Gemma, HALO Radio's careful operations lead. Assess only the supplied radio health evidence. Never claim an action happened. Prefer observation and health checks. Recommend a Watchtower update only when the evidence indicates an update is appropriate, and always mark that action as requiring owner approval. Return concise JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({ health, relayConfigured, allowedActions: ["none", "health_check", "watchtower_update"] })
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "gemma_radio_assessment",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              state: { type: "string", enum: ["stable", "waiting", "attention"] },
              headline: { type: "string" },
              summary: { type: "string" },
              priorities: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
              recommendedAction: { type: "string", enum: ["none", "health_check", "watchtower_update"] },
              requiresApproval: { type: "boolean" },
              confidence: { type: "number", minimum: 0, maximum: 1 }
            },
            required: ["state", "headline", "summary", "priorities", "recommendedAction", "requiresApproval", "confidence"]
          }
        }
      }
    });
    const assessment = JSON.parse(completion.choices[0]?.message?.content || "null");
    if (!assessment || typeof assessment !== "object") return fallback;
    if (assessment.recommendedAction === "watchtower_update") assessment.requiresApproval = true;
    return assessment;
  } catch (error) {
    console.error("Gemma radio assessment used fallback", error instanceof Error ? error.message : "unknown error");
    return fallback;
  }
}

async function triggerOperatorRelay(action) {
  const url = operatorUrl();
  if (!url) return { ok: false, status: 503, message: "Gemma's protected operator relay is not connected yet." };
  const token = String(process.env.HALO_GEMMA_OPERATOR_TOKEN || "").trim();
  if (!token) return { ok: false, status: 503, message: "Gemma's operator authorization is not configured yet." };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, scope: "azuracast", source: "gemma", requestedAt: new Date().toISOString() }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    console.error("Gemma operator relay rejected command", { action, status: response.status });
    return { ok: false, status: 502, message: "The protected operator relay did not accept Gemma's command." };
  }
  return { ok: true };
}

export default async function gemmaRadioOperator(request) {
  if (!["GET", "POST"].includes(request.method)) return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });

  let user;
  try {
    user = await getUser();
  } catch {
    return json({ message: "Gemma could not verify station desk access." }, 503);
  }
  if (!user?.id) return json({ message: "Sign in to open Gemma's operator desk." }, 401);
  if (!isOwner(user)) return json({ message: "Owner access is required for Gemma's operator desk." }, 403);

  const relayConfigured = Boolean(String(process.env.HALO_GEMMA_OPERATOR_URL || "").trim() && String(process.env.HALO_GEMMA_OPERATOR_TOKEN || "").trim());
  if (request.method === "GET") {
    const health = await inspectRadioHealth(new URL(request.url).origin);
    return json({ configured: relayConfigured, health, actions: ["assess", "health_check", "watchtower_update"] });
  }

  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ message: "Cross-origin Gemma commands are not accepted." }, 403);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ message: "Gemma command is too large." }, 413);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Request body must be valid JSON." }, 400);
  }
  const action = String(payload?.action || "");
  if (!OPERATOR_ACTIONS.has(action)) return json({ message: "Unknown Gemma operator action." }, 400);

  const health = await inspectRadioHealth(new URL(request.url).origin);
  if (action === "assess") {
    return json({ configured: relayConfigured, health, assessment: await assessWithGemma(health, relayConfigured) });
  }
  if (action === "health_check") {
    return json({ accepted: true, action, configured: relayConfigured, health, message: "Gemma completed a fresh station verification." });
  }
  if (payload?.approved !== true) {
    return json({ message: "Owner approval is required before Gemma can request an update." }, 409);
  }

  try {
    const relay = await triggerOperatorRelay(action);
    if (!relay.ok) return json({ message: relay.message }, relay.status);
    return json({ accepted: true, action, configured: relayConfigured, health, message: "Gemma securely requested an AzuraCast update check." }, 202);
  } catch (error) {
    console.error("Gemma operator command failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "Gemma could not reach the protected operator relay." }, 502);
  }
}

export const config = {
  path: "/api/radio/gemma"
};
