import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createSmartSplitsHandler } from "../lib/dreamweaver-smart-splits.mjs";

export default createSmartSplitsHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin });
export const config = { path: "/api/dreamweaver-smart-splits" };
