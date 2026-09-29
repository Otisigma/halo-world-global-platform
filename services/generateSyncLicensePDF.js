/**
 * Sync license PDF generator.
 *
 * Produces a legally-styled Sync License Agreement PDF for a completed
 * checkout using `pdf-lib`, plus a deterministic SHA-256 digital signature
 * hash derived from the contract's stable fields. The hash is deterministic
 * (same inputs always produce the same hash) so it can be independently
 * recomputed and verified later without re-rendering the PDF.
 */
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import crypto from "node:crypto";

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89; // A4

/**
 * Resolve a human-readable artist name whether `track.artist` is a plain
 * string or a populated document/object.
 * @param {*} artist
 * @returns {string}
 */
function resolveArtistName(artist) {
  if (typeof artist === "string" && artist.trim()) return artist;
  if (artist && typeof artist === "object") {
    return artist.name || artist.artistName || "N/A";
  }
  return "N/A";
}

/**
 * Compute the deterministic digital verification hash for a license
 * contract. Exposed separately so callers can re-verify a previously
 * generated PDF without re-rendering it.
 * @param {{licenseId: string, track: {isrc?: string}, buyer: {email: string}, tier: string, amount: number, issueDate: string|Date}} params
 * @returns {string}
 */
export function computeDigitalHash({ licenseId, track, buyer, tier, amount, issueDate }) {
  const formattedIssueDate = new Date(issueDate).toLocaleDateString("en-GB");
  const signatureData = [
    licenseId,
    track?.isrc || "",
    buyer?.email || "",
    String(amount || 0),
    tier || "",
    formattedIssueDate
  ].join("-");

  return crypto.createHash("sha256").update(signatureData).digest("hex").toUpperCase();
}

/**
 * Generates a legally binding Sync License Agreement PDF.
 * @param {{
 *  licenseId: string,
 *  track: {title?: string, artist?: string|object, isrc?: string, upc?: string},
 *  buyer: {name: string, email: string, company?: string},
 *  tier: string,
 *  amount: number,
 *  issueDate: string|Date,
 *  currency?: string
 * }} params
 * @returns {Promise<{pdfBuffer: Buffer, digitalHash: string}>}
 */
export async function generateSyncLicensePDF({ licenseId, track, buyer, tier, amount, issueDate, currency = "GBP" }) {
  if (!licenseId) throw new Error("licenseId is required");
  if (!track) throw new Error("track is required");
  if (!buyer?.name) throw new Error("buyer.name is required");
  if (!buyer?.email) throw new Error("buyer.email is required");
  if (!tier) throw new Error("tier is required");
  if (amount === undefined || amount === null || Number.isNaN(Number(amount))) {
    throw new Error("amount is required and must be a number");
  }
  if (!issueDate || Number.isNaN(new Date(issueDate).getTime())) {
    throw new Error("issueDate is required and must be a valid date");
  }

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const trackArtist = resolveArtistName(track.artist);
  const formattedIssueDate = new Date(issueDate).toLocaleDateString("en-GB");
  const formattedFee = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: String(currency || "GBP").toUpperCase()
  }).format(Number(amount));

  // Background aesthetics & header.
  page.drawRectangle({ x: 0, y: 780, width: PAGE_WIDTH, height: 61.89, color: rgb(0.07, 0.07, 0.07) });
  page.drawText("HALO MUSIC WORLD - MASTER SYNC LICENSE", {
    x: 40,
    y: 802,
    size: 16,
    font: fontBold,
    color: rgb(0.91, 1.0, 0.0)
  });

  // Certificate metadata.
  const yStart = 730;
  page.drawText(`LICENSE IDENTIFIER: ${licenseId}`, {
    x: 40,
    y: yStart,
    size: 10,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.2)
  });
  page.drawText(`ISSUED DATE: ${formattedIssueDate}`, { x: 40, y: yStart - 15, size: 10, font: fontRegular });

  // Track & grant details.
  page.drawText("1. TRACK & METADATA DETAILS", { x: 40, y: yStart - 50, size: 12, font: fontBold });
  page.drawText(`Title: ${track.title || "N/A"}`, { x: 50, y: yStart - 70, size: 10, font: fontRegular });
  page.drawText(`Artist: ${trackArtist}`, { x: 50, y: yStart - 85, size: 10, font: fontRegular });
  page.drawText(`ISRC: ${track.isrc || "N/A"}`, { x: 50, y: yStart - 100, size: 10, font: fontRegular });
  page.drawText(`UPC: ${track.upc || "N/A"}`, { x: 50, y: yStart - 115, size: 10, font: fontRegular });

  // Licensee information.
  page.drawText("2. LICENSEE AUTHORIZATION", { x: 40, y: yStart - 150, size: 12, font: fontBold });
  page.drawText(`Licensed To: ${buyer.name} (${buyer.company || "Individual"})`, {
    x: 50,
    y: yStart - 170,
    size: 10,
    font: fontRegular
  });
  page.drawText(`Contact Email: ${buyer.email}`, { x: 50, y: yStart - 185, size: 10, font: fontRegular });
  page.drawText(`License Tier: ${String(tier).toUpperCase()}`, {
    x: 50,
    y: yStart - 200,
    size: 10,
    font: fontBold
  });
  page.drawText(`Fee Paid: ${formattedFee} ${String(currency || "GBP").toUpperCase()}`, {
    x: 50,
    y: yStart - 215,
    size: 10,
    font: fontRegular
  });

  // Digital hash & verification signature.
  const digitalHash = computeDigitalHash({ licenseId, track, buyer, tier, amount, issueDate });

  page.drawRectangle({ x: 40, y: 100, width: 515.28, height: 50, color: rgb(0.95, 0.95, 0.95) });
  page.drawText("DIGITAL VERIFICATION SIGNATURE HASH:", {
    x: 50,
    y: 135,
    size: 8,
    font: fontBold,
    color: rgb(0.3, 0.3, 0.3)
  });
  page.drawText(digitalHash, { x: 50, y: 115, size: 8, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });

  // Footer legal note.
  page.drawText(
    "This document forms a legally binding master synchronization agreement issued by HALO Music World.",
    { x: 40, y: 40, size: 8, font: fontRegular, color: rgb(0.5, 0.5, 0.5) }
  );

  const pdfBytes = await pdfDoc.save();
  return { pdfBuffer: Buffer.from(pdfBytes), digitalHash };
}

export default { generateSyncLicensePDF, computeDigitalHash };
