import { createSignalEmotionHandler } from "../lib/signal-emotion.mjs";

export default async function signalEmotion(request, context) {
  const [{ getDatabase }, { getUser, verifyRequestOrigin }] = await Promise.all([
    import("@netlify/database"), import("@netlify/identity")
  ]);
  return createSignalEmotionHandler({ getDatabase, getUser, verifyRequestOrigin })(request, context);
}

export const config = { path: "/api/signal/emotion" };
