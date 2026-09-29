/**
 * Valuation Accelerator agent orchestrator skeleton.
 *
 * Provides a lightweight, in-process event bus that autonomous agents can
 * subscribe to for checkout, royalty payout, audio processing, and
 * health-monitoring events. This is intentionally framework-agnostic (plain
 * Node `EventEmitter`) so it can be wired into either the Express server or
 * Netlify functions without introducing a hard dependency on either.
 *
 * Usage:
 *   import { orchestrator, AGENT_EVENTS } from "../agents/orchestrator.js";
 *   orchestrator.on(AGENT_EVENTS.CHECKOUT_COMPLETED, async (payload) => { ... });
 *   await orchestrator.emitEvent(AGENT_EVENTS.CHECKOUT_COMPLETED, {
 *     licenseId,          // human-readable license identifier, embedded in the PDF
 *     licenseRecordId,    // the LicenseRecord Mongo _id, used to trigger the payout
 *     track, buyer, tier, amount, issueDate, currency
 *   });
 */
import { EventEmitter } from "node:events";
import { generateSyncLicensePDF } from "../services/generateSyncLicensePDF.js";
import { processRoyaltySplits } from "../services/processRoyaltySplits.js";

export const AGENT_EVENTS = Object.freeze({
  CHECKOUT_COMPLETED: "checkout.completed",
  ROYALTY_PAYOUT_REQUESTED: "royalty.payout_requested",
  ROYALTY_PAYOUT_COMPLETED: "royalty.payout_completed",
  ROYALTY_PAYOUT_FAILED: "royalty.payout_failed",
  AUDIO_PROCESSING_REQUESTED: "audio.processing_requested",
  AUDIO_PROCESSING_COMPLETED: "audio.processing_completed",
  HEALTH_CHECK: "health.check"
});

/**
 * Thin wrapper around `EventEmitter` that logs unhandled agent errors instead
 * of letting them crash the process, and exposes an `emitEvent` helper that
 * awaits any async listeners so callers can observe failures.
 */
class AgentOrchestrator extends EventEmitter {
  /**
   * @param {string} eventName one of `AGENT_EVENTS`
   * @param {object} payload
   * @returns {Promise<void>}
   */
  async emitEvent(eventName, payload = {}) {
    const listeners = this.listeners(eventName);
    await Promise.all(
      listeners.map((listener) =>
        Promise.resolve()
          .then(() => listener(payload))
          .catch((error) => {
            console.error(`[agent-orchestrator] handler for "${eventName}" failed:`, error?.message || error);
            throw error;
          })
      )
    );
  }
}

export const orchestrator = new AgentOrchestrator();

/**
 * Registers the default agent handlers that wire checkout completion through
 * to sync-license PDF generation and royalty payout distribution. Returns an
 * unsubscribe function so tests/consumers can tear the wiring down.
 * @param {{onHealthCheck?: () => Promise<object>|object, stripe?: import('stripe').Stripe}} [options]
 * @returns {() => void}
 */
export function registerDefaultAgents(options = {}) {
  const checkoutHandler = async ({ licenseId, licenseRecordId, track, buyer, tier, amount, issueDate, currency }) => {
    const { pdfBuffer, digitalHash } = await generateSyncLicensePDF({
      licenseId,
      track,
      buyer,
      tier,
      amount,
      issueDate,
      currency
    });
    await orchestrator.emitEvent(AGENT_EVENTS.ROYALTY_PAYOUT_REQUESTED, { licenseId, licenseRecordId, pdfBuffer, digitalHash });
  };

  const royaltyHandler = async ({ licenseRecordId }) => {
    try {
      const result = await processRoyaltySplits(licenseRecordId, options.stripe ? { stripe: options.stripe } : undefined);
      await orchestrator.emitEvent(AGENT_EVENTS.ROYALTY_PAYOUT_COMPLETED, { licenseRecordId, result });
    } catch (error) {
      await orchestrator.emitEvent(AGENT_EVENTS.ROYALTY_PAYOUT_FAILED, {
        licenseRecordId,
        error: error?.message || String(error)
      });
      throw error;
    }
  };

  const healthHandler = async () => {
    if (typeof options.onHealthCheck === "function") {
      return options.onHealthCheck();
    }
    return { status: "ok", checkedAt: new Date().toISOString() };
  };

  orchestrator.on(AGENT_EVENTS.CHECKOUT_COMPLETED, checkoutHandler);
  orchestrator.on(AGENT_EVENTS.ROYALTY_PAYOUT_REQUESTED, royaltyHandler);
  orchestrator.on(AGENT_EVENTS.HEALTH_CHECK, healthHandler);

  return function unregisterDefaultAgents() {
    orchestrator.off(AGENT_EVENTS.CHECKOUT_COMPLETED, checkoutHandler);
    orchestrator.off(AGENT_EVENTS.ROYALTY_PAYOUT_REQUESTED, royaltyHandler);
    orchestrator.off(AGENT_EVENTS.HEALTH_CHECK, healthHandler);
  };
}

export default { orchestrator, AGENT_EVENTS, registerDefaultAgents };
