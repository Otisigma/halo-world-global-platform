const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

function validDeck(deck) {
  return deck && typeof deck === "object" && Number.isFinite(Number(deck.bpm));
}

export default async function telemetryHandler(request, context) {
  if (request.method !== "POST") {
    return Response.json(
      { status: "ERROR", message: "Method not allowed" },
      { status: 405, headers: { ...jsonHeaders, Allow: "POST" } }
    );
  }

  let telemetry;
  try {
    telemetry = await request.json();
  } catch {
    return Response.json(
      { status: "ERROR", message: "Telemetry must be valid JSON" },
      { status: 400, headers: jsonHeaders }
    );
  }

  if (!validDeck(telemetry.deckA) || !validDeck(telemetry.deckB)) {
    return Response.json(
      { status: "ERROR", message: "Deck A and Deck B BPM values are required" },
      { status: 422, headers: jsonHeaders }
    );
  }

  const deckABpm = Number(telemetry.deckA.bpm);
  const deckBBpm = Number(telemetry.deckB.bpm);
  const locked = Math.abs(deckABpm - deckBBpm) < 0.05;
  const crowdScore = Math.max(0, Math.min(100, Number(telemetry.crowd?.score) || 0));

  return Response.json(
    {
      status: "SUCCESS",
      agentName: "Netlify_Cloud_AI",
      agentMessage: locked
        ? `Telemetry synced! Deck A/B locked at ${deckABpm.toFixed(1)} BPM with crowd energy at ${crowdScore}%.`
        : `Telemetry synced! Deck A is ${deckABpm.toFixed(1)} BPM and Deck B is ${deckBBpm.toFixed(1)} BPM.`,
      session: {
        tempoLocked: locked,
        crowdScore,
        region: context.server?.region || "automatic",
        requestId: context.requestId
      }
    },
    { status: 200, headers: jsonHeaders }
  );
}

export const config = {
  path: "/api/telemetry"
};
