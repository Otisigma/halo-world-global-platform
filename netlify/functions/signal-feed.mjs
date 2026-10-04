import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createSignalFeedHandler } from "../lib/signal-feed.mjs";

export default createSignalFeedHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin });
export const config = { path: "/api/signal-feed" };
