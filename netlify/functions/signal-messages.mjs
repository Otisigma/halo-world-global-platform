import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createSignalMessagesHandler } from "../lib/signal-messages.mjs";

export default createSignalMessagesHandler({ getDatabase, getUser, ensureMembership, verifyRequestOrigin });

export const config = { path: "/api/signal/messages" };
