import { inspectRadioHealth } from "../lib/radio-health.mjs";

export default async function radioHealthHandler(request) {
  if (request.method !== "GET") return Response.json({ message: "Method not allowed" }, { status: 405 });
  const health = await inspectRadioHealth(new URL(request.url).origin);
  return Response.json(health, {
    status: health.status === "offline" ? 503 : 200,
    headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=20" }
  });
}

export const config = {
  path: "/api/radio/health"
};
