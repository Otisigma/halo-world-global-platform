import { createHmac, timingSafeEqual } from "node:crypto";
import { notifyOwnerSafely } from "./owner-alerts.mjs";

const MAX_BODY_BYTES = 256 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const PURCHASE_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function readEnvironment(name) {
  return String(globalThis.Netlify?.env?.get(name) || process.env[name] || "").trim();
}

export function verifyStripeSignature(payload, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!payload || !header || !secret) return false;
  const parts = String(header).split(",").map(part => part.trim().split("="));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key, value]) => key === "v1" && /^[a-f0-9]{64}$/i.test(value || "")).map(([, value]) => value);
  if (!Number.isInteger(timestamp) || !signatures.length || Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex"), "hex");
  return signatures.some(signature => {
    const actual = Buffer.from(signature, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

function formatAmount(amountMinor, currency) {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try {
    const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: code });
    const decimals = formatter.resolvedOptions().maximumFractionDigits;
    return formatter.format(amountMinor / (10 ** decimals));
  } catch {
    return `${code} ${(amountMinor / 100).toFixed(2)}`;
  }
}

function validStripeId(value, prefix) {
  return typeof value === "string" && value.startsWith(prefix) && value.length <= 255
    && /^[A-Za-z0-9_]+$/.test(value);
}

export function createStripeWebhookHandler({ database, secret = () => readEnvironment("STRIPE_WEBHOOK_SECRET"), notify = notifyOwnerSafely, now } = {}) {
  return async function stripeWebhook(request) {
    if (request.method !== "POST") return Response.json({ message: "Method not allowed" }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
    const webhookSecret = secret();
    if (!webhookSecret) return json({ message: "Payment webhook is not configured" }, 503);
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ message: "Payload too large" }, 413);

    const payload = await request.text();
    if (Buffer.byteLength(payload) > MAX_BODY_BYTES) return json({ message: "Payload too large" }, 413);
    if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), webhookSecret, now?.())) {
      return json({ message: "Invalid signature" }, 400);
    }

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return json({ message: "Invalid payload" }, 400);
    }
    if (!PURCHASE_EVENTS.has(event?.type)) return json({ received: true, ignored: true });

    const session = event.data?.object;
    if (session?.object !== "checkout.session" || session.payment_status !== "paid") {
      return json({ received: true, ignored: true });
    }
    const amountMinor = Number(session.amount_total);
    const currency = String(session.currency || "").toUpperCase();
    if (!validStripeId(event.id, "evt_") || !validStripeId(session.id, "cs_")
      || !Number.isInteger(amountMinor) || amountMinor < 0 || !/^[A-Z]{3}$/.test(currency)) {
      return json({ message: "Invalid checkout session" }, 400);
    }
    const mixId = String(session.metadata?.mix_id || session.client_reference_id || "").slice(0, 100) || null;

    try {
      const db = await database();
      const mixes = mixId ? await db.sql`SELECT title, original_artist FROM halo_mixes WHERE id = ${mixId} LIMIT 1` : [];
      const item = mixes[0] ? `${mixes[0].title} — ${mixes[0].original_artist}`
        : String(session.metadata?.song_title || session.metadata?.product_name || "HALO purchase").slice(0, 200);
      const rows = await db.sql`
        INSERT INTO halo_stripe_purchase_events (
          stripe_event_id, checkout_session_id, mix_id, amount_minor, currency, livemode
        ) VALUES (
          ${event.id}, ${session.id}, ${mixId}, ${amountMinor}, ${currency}, ${event.livemode === true}
        )
        ON CONFLICT DO NOTHING
        RETURNING stripe_event_id
      `;
      if (!rows.length) return json({ received: true, duplicate: true });

      await notify({
        title: `${event.livemode === true ? "" : "[TEST] "}New HALO purchase`,
        lines: [`Item: ${item}`, `Amount: ${formatAmount(amountMinor, currency)}`]
      });
      return json({ received: true });
    } catch (error) {
      console.error("HALO Stripe webhook failed", error instanceof Error ? error.message : "unknown error");
      return json({ message: "Webhook could not be recorded" }, 500);
    }
  };
}
