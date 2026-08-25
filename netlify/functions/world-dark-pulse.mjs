import { createHash } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { verifyRequestOrigin } from "@netlify/identity";

const releaseId = "when-the-world-goes-dark";
const signals = new Set(["stay", "rise", "remember", "return"]);
const listenerPattern = /^[a-zA-Z0-9_-]{16,96}$/;

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers }
  });
}

function listenerHash(value) {
  return createHash("sha256").update(`${releaseId}:${value}`).digest("hex");
}

async function pulseState(db) {
  const [countRows, signalRows, recentRows] = await Promise.all([
    db.sql`
      SELECT COUNT(*)::int AS total
      FROM halo_world_dark_pulses
      WHERE release_id = ${releaseId}
    `,
    db.sql`
      SELECT signal, COUNT(*)::int AS total
      FROM halo_world_dark_pulses
      WHERE release_id = ${releaseId}
      GROUP BY signal
    `,
    db.sql`
      SELECT signal, created_at
      FROM halo_world_dark_pulses
      WHERE release_id = ${releaseId}
      ORDER BY created_at DESC
      LIMIT 18
    `
  ]);

  const distribution = { stay: 0, rise: 0, remember: 0, return: 0 };
  signalRows.forEach(row => {
    if (signals.has(row.signal)) distribution[row.signal] = Number(row.total || 0);
  });

  return {
    total: Number(countRows[0]?.total || 0),
    distribution,
    recent: recentRows.map(row => ({
      signal: row.signal,
      createdAt: new Date(row.created_at).toISOString()
    }))
  };
}

export default async function worldDarkPulseHandler(request) {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ message: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }

  try {
    const db = getDatabase();
    if (request.method === "GET") return json(await pulseState(db));

    try {
      verifyRequestOrigin(request);
    } catch {
      return json({ message: "Cross-origin pulses are not accepted" }, 403);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 2048) return json({ message: "Pulse payload is too large" }, 413);

    const payload = await request.json().catch(() => null);
    const signal = String(payload?.signal || "").trim().toLowerCase();
    const listenerKey = String(payload?.listenerKey || "").trim();
    if (!signals.has(signal) || !listenerPattern.test(listenerKey)) {
      return json({ message: "Choose a valid signal" }, 422);
    }

    const key = listenerHash(listenerKey);
    const inserted = await db.sql`
      INSERT INTO halo_world_dark_pulses (release_id, listener_key, signal)
      VALUES (${releaseId}, ${key}, ${signal})
      ON CONFLICT (release_id, listener_key) DO NOTHING
      RETURNING id
    `;

    if (!inserted.length) {
      const existing = await db.sql`
        SELECT signal
        FROM halo_world_dark_pulses
        WHERE release_id = ${releaseId} AND listener_key = ${key}
        LIMIT 1
      `;
      return json({
        ...(await pulseState(db)),
        accepted: false,
        signal: existing[0]?.signal || signal,
        message: "Your light is already in the network."
      });
    }

    return json({
      ...(await pulseState(db)),
      accepted: true,
      signal,
      message: "Your light is now part of the signal."
    }, 201);
  } catch (error) {
    console.error("World dark pulse failed", error instanceof Error ? error.message : "unknown error");
    return json({ message: "The network is quiet for a moment. Try again." }, 500);
  }
}

export const config = {
  path: "/api/when-the-world-goes-dark/pulse"
};
