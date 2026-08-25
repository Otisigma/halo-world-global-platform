import { getDatabase } from "@netlify/database";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { isOwner } from "../lib/halo-x.mjs";
import { createAgentCommand, loadControlCenter } from "../lib/control-center.mjs";

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export default async function haloControlCenterHandler(request) {
  if (!['HEAD', 'GET', 'POST'].includes(request.method)) {
    return json({ message: "Method not allowed" }, 405, { Allow: "HEAD, GET, POST" });
  }

  try {
    const user = await getUser();
    if (!user?.id) return json({ message: "Sign in to open the HALO Control Center" }, 401);
    if (!isOwner(user)) return json({ message: "The HALO Control Center is limited to the owner team" }, 403);
    if (request.method === "HEAD") return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });

    const db = getDatabase();
    if (request.method === "GET") return json(await loadControlCenter(db));
    if (!(await verifyRequestOrigin(request))) return json({ message: "Request origin could not be verified" }, 403);

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 8_000) return json({ message: "Command is too large" }, 413);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ message: "Command must be valid JSON" }, 400);
    }
    const command = await createAgentCommand(db, user, body);
    if (!command) return json({ message: "Write a command before sending it to the team" }, 422);
    return json({ command, controlCenter: await loadControlCenter(db) }, 201);
  } catch (error) {
    console.error("HALO Control Center request failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The HALO Control Center is temporarily unavailable" }, 503);
  }
}

export const config = {
  path: "/api/halo-control-center"
};
