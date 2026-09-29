/**
 * Royalty payout service.
 *
 * Distributes Stripe Connect transfers across all registered split partners
 * for a track once a license purchase (or direct-to-fan sale) completes.
 *
 * Idempotency: the service atomically flips `payoutStatus` from `pending`
 * to `completed` (via `findOneAndUpdate`) *before* creating any transfers.
 * If two callers race (e.g. a webhook retry), only one will win the update
 * and proceed to create transfers; the other observes `payoutStatus`
 * already `completed`/non-`pending` and exits early without double-paying.
 * If transfer creation subsequently fails, the status is reverted to
 * `failed` so the payout can be retried safely.
 */
import Stripe from "stripe";
import TrackSplit from "../models/TrackSplit.js";
import LicenseRecord from "../models/LicenseRecord.js";

let stripeClient;

/**
 * Lazily instantiate the Stripe client so this module can be imported (and
 * unit tested) without requiring `STRIPE_SECRET_KEY` to be configured.
 * @returns {import('stripe').Stripe}
 */
function getStripeClient() {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

/**
 * Split a distributable amount (in minor currency units) across recipients
 * by percentage, ensuring every whole unit is allocated (the final
 * recipient absorbs any rounding remainder instead of it being lost).
 * @param {{percentage: number}[]} recipients
 * @param {number} distributableAmountMinorUnits
 * @returns {number[]} amount per recipient, in the same order as `recipients`
 */
export function allocateProportionalAmounts(recipients, distributableAmountMinorUnits) {
  const amounts = [];
  let allocated = 0;

  recipients.forEach((recipient, index) => {
    const isLast = index === recipients.length - 1;
    const amount = isLast
      ? distributableAmountMinorUnits - allocated
      : Math.floor(distributableAmountMinorUnits * (Number(recipient.percentage || 0) / 100));
    allocated += amount;
    amounts.push(amount);
  });

  return amounts;
}

/**
 * Distributes payouts dynamically across all registered split partners upon
 * a successful sale.
 * @param {string} licenseRecordId Mongo ObjectId of the `LicenseRecord`.
 * @param {{stripe?: import('stripe').Stripe}} [options] Optional Stripe client override (useful for tests).
 * @returns {Promise<{success: boolean, skipped?: boolean, platformFeeCollected?: number, transferIds?: string[], skippedRecipients?: object[]}>}
 */
export async function processRoyaltySplits(licenseRecordId, options = {}) {
  const stripe = options.stripe || getStripeClient();

  const license = await LicenseRecord.findById(licenseRecordId).populate("track");
  if (!license) throw new Error(`License record not found: ${licenseRecordId}`);
  if (!license.track) throw new Error(`License track not populated for license: ${license.licenseId}`);

  // Atomically claim the payout so concurrent/duplicate invocations
  // (e.g. webhook retries) cannot trigger duplicate Stripe transfers.
  const claimed = await LicenseRecord.findOneAndUpdate(
    { _id: license._id, payoutStatus: "pending" },
    { $set: { payoutStatus: "completed" } },
    { new: true }
  );

  if (!claimed) {
    return { success: true, skipped: true };
  }

  const splitConfig = await TrackSplit.findOne({ track: license.track._id }).populate("recipients.artist");
  if (!splitConfig) {
    // Roll back the claim so the payout can be retried once splits exist.
    await LicenseRecord.updateOne({ _id: license._id }, { $set: { payoutStatus: "failed" } });
    throw new Error(`No split configuration found for track: ${license.track._id}`);
  }

  try {
    const totalAmountMinorUnits = Math.round(license.purchaseAmount * 100);
    const platformFeeMinorUnits = Math.round(
      totalAmountMinorUnits * (splitConfig.platformFeePercentage / 100)
    );
    const distributableAmountMinorUnits = totalAmountMinorUnits - platformFeeMinorUnits;

    const amounts = allocateProportionalAmounts(splitConfig.recipients, distributableAmountMinorUnits);
    const skippedRecipients = [];

    const outcomes = await Promise.allSettled(
      splitConfig.recipients.map((recipient, index) => {
        const amount = amounts[index];
        const artistId = recipient.artist?._id?.toString();

        if (amount <= 0 || !recipient.artist?.stripeAccountId) {
          skippedRecipients.push({
            artistId,
            amount,
            reason: amount <= 0 ? "zero_or_negative_amount" : "missing_stripe_account"
          });
          console.warn(
            `[processRoyaltySplits] Skipping recipient ${artistId || "unknown"} for license ${license.licenseId}: ` +
              (amount <= 0 ? "zero or negative allocated amount" : "missing Stripe account")
          );
          return null;
        }

        return stripe.transfers.create(
          {
            amount,
            currency: license.currency,
            destination: recipient.artist.stripeAccountId,
            description: `Royalty payment for ${license.track.title} [License #${license.licenseId}]`,
            metadata: {
              licenseId: license.licenseId,
              trackId: license.track._id.toString(),
              artistId
            }
          },
          { idempotencyKey: `${license.licenseId}-${artistId}` }
        );
      })
    );

    const failedTransfers = outcomes.filter((outcome) => outcome.status === "rejected");
    if (failedTransfers.length > 0) {
      // At least one transfer failed after being attempted; mark the payout
      // as failed so it can be reconciled/retried. Transfers that already
      // succeeded are safe to retry thanks to the per-recipient idempotency
      // key above, so a retry will not double-pay those recipients.
      await LicenseRecord.updateOne({ _id: license._id }, { $set: { payoutStatus: "failed" } });
      throw new Error(
        `${failedTransfers.length} of ${outcomes.length} royalty transfers failed for license ${license.licenseId}: ` +
          failedTransfers.map((outcome) => outcome.reason?.message || String(outcome.reason)).join("; ")
      );
    }

    const transferIds = outcomes
      .filter((outcome) => outcome.status === "fulfilled" && outcome.value)
      .map((outcome) => outcome.value.id);

    return {
      success: true,
      platformFeeCollected: platformFeeMinorUnits / 100,
      transferIds,
      skippedRecipients
    };
  } catch (error) {
    // Revert the claim on failure so a subsequent call can retry the payout.
    await LicenseRecord.updateOne({ _id: license._id }, { $set: { payoutStatus: "failed" } });
    throw error;
  }
}

export default { processRoyaltySplits, allocateProportionalAmounts };
