import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { ensureMembership } from "../lib/halo-x.mjs";
import { createListeningEventsHandler } from "../lib/listening-events.mjs";

export default createListeningEventsHandler({ getDatabase, getUser, verifyRequestOrigin, ensureMembership });
export const config = { path: "/api/listening-events" };
