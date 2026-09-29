/**
 * Mongoose model for issued sync-license purchase records.
 *
 * Each `LicenseRecord` represents a single completed (or in-flight) purchase
 * of a licensing tier for a track, along with the generated PDF contract and
 * its digital verification hash. `payoutStatus` tracks whether the royalty
 * split for this purchase has been distributed via
 * `services/processRoyaltySplits.js`; it is intentionally kept on this model
 * (rather than derived) so the payout service can perform an idempotent,
 * atomic check-and-set before triggering any Stripe transfers.
 */
import mongoose from "mongoose";

const { Schema } = mongoose;

export const LICENSE_TIERS = ["personalUse", "syncStandard", "syncBroadcast", "exclusive"];
export const PAYOUT_STATUSES = ["pending", "completed", "failed"];

const licenseRecordSchema = new Schema(
  {
    licenseId: { type: String, required: true, unique: true, trim: true },
    track: { type: Schema.Types.ObjectId, ref: "Track", required: true },
    buyerName: { type: String, required: true, trim: true },
    buyerEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "buyerEmail must be a valid email address"]
    },
    companyName: { type: String, trim: true },
    licenseTier: { type: String, enum: LICENSE_TIERS, required: true },
    purchaseAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "gbp", lowercase: true, trim: true },
    pdfUrl: { type: String, required: true },
    digitalSignatureHash: { type: String, required: true },
    payoutStatus: { type: String, enum: PAYOUT_STATUSES, default: "pending" }
  },
  { timestamps: true }
);

licenseRecordSchema.methods.isPayoutComplete = function isPayoutComplete() {
  return this.payoutStatus === "completed";
};

export default mongoose.models.LicenseRecord || mongoose.model("LicenseRecord", licenseRecordSchema);
