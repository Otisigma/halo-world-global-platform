import { createEmpathJourneyHandler } from "../lib/empath-journey.mjs";

export default async function empathJourney(request, context) {
  const [{ getDatabase }, { getUser, verifyRequestOrigin }] = await Promise.all([
    import("@netlify/database"), import("@netlify/identity")
  ]);
  return createEmpathJourneyHandler({ getDatabase, getUser, verifyRequestOrigin })(request, context);
}

export const config = { path: "/api/empath-journey" };
