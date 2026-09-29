/**
 * Mongoose model for immutable per-track royalty split contracts.
 *
 * A `TrackSplit` allocates 100% of a track's net (post-platform-fee) revenue
 * across one or more recipients (primary artist, featured artist, producer,
 * remixer, or label). The split is validated so that
 * `sum(recipients.percentage) + platformFeePercentage` always equals 100,
 * guarding against silent misconfiguration that would otherwise misroute
 * royalty payouts. Once a split has produced its first completed sale it is
 * locked (`isLocked: true`) and can no longer be mutated.
 */
import mongoose from "mongoose";

const { Schema } = mongoose;

/** Acceptable floating point drift when validating percentage totals. */
export const SPLIT_TOTAL_TOLERANCE = 0.01;

export const SPLIT_RECIPIENT_ROLES = [
  "Primary Artist",
  "Featured Artist",
  "Producer",
  "Remixer",
  "Label"
];

const splitRecipientSchema = new Schema(
  {
    artist: { type: Schema.Types.ObjectId, ref: "Artist", required: true },
    role: { type: String, enum: SPLIT_RECIPIENT_ROLES, required: true },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    stripeAccountId: { type: String, trim: true }
  },
  { _id: false }
);

const trackSplitSchema = new Schema(
  {
    track: { type: Schema.Types.ObjectId, ref: "Track", required: true, unique: true },
    recipients: {
      type: [splitRecipientSchema],
      required: true,
      validate: {
        validator: (recipients) => Array.isArray(recipients) && recipients.length > 0,
        message: "A track split must have at least one recipient"
      }
    },
    // 10% HALO Platform Fee by default.
    platformFeePercentage: { type: Number, default: 10.0, min: 0, max: 100 },
    // Locked once the first completed sale/payout occurs, preventing further edits.
    isLocked: { type: Boolean, default: false }
  },
  { timestamps: true }
);

/**
 * Sum of all recipient percentages plus the platform fee percentage.
 * @param {{recipients: {percentage: number}[], platformFeePercentage: number}} doc
 * @returns {number}
 */
export function computeSplitTotal(doc) {
  const recipientsTotal = (doc.recipients || []).reduce(
    (sum, recipient) => sum + Number(recipient?.percentage || 0),
    0
  );
  return recipientsTotal + Number(doc.platformFeePercentage || 0);
}

trackSplitSchema.pre("validate", function guardSplitTotal() {
  if (this.isLocked && !this.isNew) {
    throw new Error("Cannot modify a locked track split");
  }

  const total = computeSplitTotal(this);
  if (Math.abs(total - 100) > SPLIT_TOTAL_TOLERANCE) {
    throw new Error(
      `Track split recipients plus platform fee must total 100% (received ${total.toFixed(2)}%)`
    );
  }
});

trackSplitSchema.methods.lock = function lock() {
  this.isLocked = true;
  return this;
};

export default mongoose.models.TrackSplit || mongoose.model("TrackSplit", trackSplitSchema);
