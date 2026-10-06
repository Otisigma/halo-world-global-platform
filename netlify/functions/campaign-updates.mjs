import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createCampaignUpdatesHandler } from "../lib/campaign-updates.mjs";

export default createCampaignUpdatesHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin });
export const config = { path: "/api/campaign-updates" };
