import { getDatabase } from "@netlify/database";
import { createStripeWebhookHandler } from "../lib/stripe-webhook.mjs";

export default createStripeWebhookHandler({ database: getDatabase });

export const config = {
  path: "/api/stripe-webhook"
};
