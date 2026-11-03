import { getDatabase } from "@netlify/database";
import { acceptPublicIssueReport } from "../lib/maintenance.mjs";
import { createSentinelEventsHandler } from "../lib/sentinel-events.mjs";

export default createSentinelEventsHandler({ getDatabase, acceptReport: acceptPublicIssueReport });
export const config = { path: "/api/sentinel/events" };
