import assert from "node:assert/strict";
import mongoose from "mongoose";
import TrackSplit, { computeSplitTotal } from "../models/TrackSplit.js";
import LicenseRecord from "../models/LicenseRecord.js";
import { allocateProportionalAmounts, processRoyaltySplits } from "../services/processRoyaltySplits.js";
import { generateSyncLicensePDF, computeDigitalHash } from "../services/generateSyncLicensePDF.js";
import { orchestrator, AGENT_EVENTS, registerDefaultAgents } from "../agents/orchestrator.js";

let checks = 0;

const trackId = new mongoose.Types.ObjectId();
const artistId = new mongoose.Types.ObjectId();

// --- TrackSplit validation -------------------------------------------------

const validSplit = new TrackSplit({
  track: trackId,
  recipients: [
    { artist: artistId, role: "Primary Artist", percentage: 80 },
    { artist: artistId, role: "Producer", percentage: 10 }
  ],
  platformFeePercentage: 10
});
await validSplit.validate();
assert.equal(computeSplitTotal(validSplit), 100);
checks += 1;

const invalidSplit = new TrackSplit({
  track: trackId,
  recipients: [{ artist: artistId, role: "Primary Artist", percentage: 85 }],
  platformFeePercentage: 10
});
await assert.rejects(() => invalidSplit.validate(), /must total 100%/);
checks += 1;

validSplit.isLocked = true;
validSplit.isNew = false;
await assert.rejects(() => validSplit.validate(), /Cannot modify a locked track split/);
checks += 1;

// --- LicenseRecord validation ------------------------------------------------

const license = new LicenseRecord({
  licenseId: "LIC-CONTRACT-1",
  track: trackId,
  buyerName: "Buyer",
  buyerEmail: "buyer@example.com",
  licenseTier: "syncStandard",
  purchaseAmount: 100,
  pdfUrl: "https://example.com/license.pdf",
  digitalSignatureHash: "abc123"
});
await license.validate();
assert.equal(license.payoutStatus, "pending");
checks += 1;

const badEmailLicense = new LicenseRecord({
  licenseId: "LIC-CONTRACT-2",
  track: trackId,
  buyerName: "Buyer",
  buyerEmail: "not-an-email",
  licenseTier: "syncStandard",
  purchaseAmount: 100,
  pdfUrl: "https://example.com/license.pdf",
  digitalSignatureHash: "abc123"
});
await assert.rejects(() => badEmailLicense.validate(), /valid email address/);
checks += 1;

// --- Sync license PDF generation ---------------------------------------------

const pdfParams = {
  licenseId: "LIC-PDF-1",
  track: { title: "Test Track", artist: { artistName: "DJ Test" }, isrc: "GBX123456789" },
  buyer: { name: "Buyer Co", email: "buyer@example.com", company: "Buyer Co" },
  tier: "syncStandard",
  amount: 199.99,
  issueDate: "2026-01-01"
};
const { pdfBuffer, digitalHash } = await generateSyncLicensePDF(pdfParams);
assert.ok(Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 0);
assert.equal(digitalHash, computeDigitalHash(pdfParams));
checks += 1;

await assert.rejects(() => generateSyncLicensePDF({ ...pdfParams, licenseId: undefined }), /licenseId is required/);
checks += 1;

// --- Royalty payout allocation & idempotency ---------------------------------

const amounts = allocateProportionalAmounts(
  [{ percentage: 33.33 }, { percentage: 33.33 }, { percentage: 33.34 }],
  1000
);
assert.deepEqual(amounts, [333, 333, 334]);
assert.equal(amounts.reduce((sum, value) => sum + value, 0), 1000);
checks += 1;

const fakeLicense = {
  _id: "license-1",
  licenseId: "LIC-PAYOUT-1",
  purchaseAmount: 100,
  currency: "gbp",
  payoutStatus: "pending",
  track: { _id: trackId, title: "Test Track" }
};
LicenseRecord.findById = () => ({ populate: async () => fakeLicense });
LicenseRecord.findOneAndUpdate = async (filter, update) => {
  if (filter.payoutStatus !== fakeLicense.payoutStatus) return null;
  fakeLicense.payoutStatus = update.$set.payoutStatus;
  return fakeLicense;
};
LicenseRecord.updateOne = async (_filter, update) => {
  fakeLicense.payoutStatus = update.$set.payoutStatus;
};
TrackSplit.findOne = () => ({
  populate: async () => ({
    platformFeePercentage: 10,
    recipients: [
      { percentage: 60, artist: { _id: artistId, stripeAccountId: "acct_123" } },
      { percentage: 40, artist: { _id: new mongoose.Types.ObjectId(), stripeAccountId: null } }
    ]
  })
});

const fakeStripe = {
  transfers: {
    create: async () => ({ id: "tr_fake" })
  }
};

const firstPayout = await processRoyaltySplits("license-1", { stripe: fakeStripe });
assert.equal(firstPayout.success, true);
assert.equal(firstPayout.platformFeeCollected, 10);
assert.equal(firstPayout.skippedRecipients.length, 1);
assert.equal(firstPayout.skippedRecipients[0].reason, "missing_stripe_account");
assert.deepEqual(firstPayout.transferIds, ["tr_fake"]);
checks += 1;

const secondPayout = await processRoyaltySplits("license-1", { stripe: fakeStripe });
assert.deepEqual(secondPayout, { success: true, skipped: true });
checks += 1;

// --- Agent orchestrator wiring -----------------------------------------------

fakeLicense.payoutStatus = "pending";
let royaltyCompletedPayload;
orchestrator.on(AGENT_EVENTS.ROYALTY_PAYOUT_COMPLETED, (payload) => {
  royaltyCompletedPayload = payload;
});
const unregister = registerDefaultAgents({ stripe: fakeStripe });
await orchestrator.emitEvent(AGENT_EVENTS.ROYALTY_PAYOUT_REQUESTED, { licenseRecordId: "license-1" });
assert.ok(royaltyCompletedPayload && royaltyCompletedPayload.result.success);
checks += 1;

// Drives the full checkout -> PDF generation -> royalty payout chain end to
// end, exercising the CHECKOUT_COMPLETED payload contract (licenseId for the
// PDF vs. licenseRecordId used to look up and pay out the LicenseRecord).
fakeLicense.payoutStatus = "pending";
royaltyCompletedPayload = undefined;
await orchestrator.emitEvent(AGENT_EVENTS.CHECKOUT_COMPLETED, {
  licenseId: "LIC-PAYOUT-1",
  licenseRecordId: "license-1",
  track: { title: "Test Track", isrc: "GBX1" },
  buyer: { name: "Buyer", email: "buyer@example.com" },
  tier: "syncStandard",
  amount: 100,
  issueDate: "2026-01-01"
});
assert.ok(royaltyCompletedPayload && royaltyCompletedPayload.licenseRecordId === "license-1");
assert.ok(royaltyCompletedPayload.result.success);
unregister();
checks += 1;

const health = { status: "custom-ok" };
const unregisterCustom = registerDefaultAgents({ onHealthCheck: () => health });
await assert.doesNotReject(() => orchestrator.emitEvent(AGENT_EVENTS.HEALTH_CHECK, {}));
unregisterCustom();
checks += 1;

console.log(`Valuation accelerator engine contracts: ${checks}/${checks} checks passed.`);
