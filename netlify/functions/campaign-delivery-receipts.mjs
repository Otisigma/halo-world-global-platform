import { getDatabase } from "@netlify/database";
import { createCampaignReceiptHandler } from "../lib/master-campaigns.mjs";

export default createCampaignReceiptHandler({ getDatabase });
export const config = { path: "/api/campaign-delivery-receipts" };
