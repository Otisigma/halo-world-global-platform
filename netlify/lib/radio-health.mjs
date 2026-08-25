const expectedRooms = new Set(["club", "chill", "lounge"]);

function elapsedMs(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function validTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function probeStream(streamUrl) {
  const startedAt = performance.now();
  const headers = { Accept: "audio/*,*/*;q=0.2", "User-Agent": "HALO-Radio-Signal-Agent/1.0" };
  try {
    let response = await fetch(streamUrl, {
      method: "HEAD",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(5_000)
    });
    if ([400, 403, 405, 501].includes(response.status)) {
      response = await fetch(streamUrl, {
        headers: { ...headers, Range: "bytes=0-1" },
        redirect: "follow",
        signal: AbortSignal.timeout(5_000)
      });
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const reachable = response.ok || response.status === 206;
    await response.body?.cancel().catch(() => {});
    return {
      reachable,
      latencyMs: elapsedMs(startedAt),
      statusCode: response.status,
      contentType: contentType.slice(0, 80),
      message: reachable ? "Audio endpoint answered" : `Audio endpoint returned HTTP ${response.status}`
    };
  } catch (error) {
    return {
      reachable: false,
      latencyMs: elapsedMs(startedAt),
      statusCode: 0,
      contentType: "",
      message: error instanceof Error && error.name === "TimeoutError" ? "Audio endpoint timed out" : "Audio endpoint could not be reached"
    };
  }
}

function validateStationData(data) {
  const errors = [];
  if (!data || typeof data !== "object") return ["Station response was not an object"];
  if (!Array.isArray(data.rooms)) return ["Station response did not include rooms"];
  const roomIds = new Set();
  for (const room of data.rooms) {
    if (!expectedRooms.has(room?.id)) errors.push("Station response included an unknown room");
    if (roomIds.has(room?.id)) errors.push(`Station response duplicated ${room.id}`);
    roomIds.add(room?.id);
    if (!room?.name || !room?.nowPlaying || !room?.next) errors.push(`${room?.id || "Unknown room"} metadata was incomplete`);
    if (room?.ready && !room?.streamUrl) errors.push(`${room.id} was marked ready without a stream URL`);
  }
  for (const roomId of expectedRooms) {
    if (!roomIds.has(roomId)) errors.push(`Station response was missing ${roomId}`);
  }
  return [...new Set(errors)];
}

function agentStatus(overallStatus, timingHealthy, dataHealthy, configuredRooms) {
  return [
    {
      key: "signal",
      name: "Signal Agent",
      role: "Stream reachability",
      status: overallStatus === "live" ? "verified" : overallStatus === "degraded" || overallStatus === "offline" ? "attention" : "waiting"
    },
    {
      key: "clock",
      name: "Clock Agent",
      role: "Time and freshness",
      status: timingHealthy ? "verified" : "attention"
    },
    {
      key: "data",
      name: "Data Agent",
      role: "Station metadata",
      status: dataHealthy ? "verified" : "attention"
    },
    {
      key: "recovery",
      name: "Recovery Agent",
      role: "Maintenance escalation",
      status: overallStatus === "degraded" || overallStatus === "offline" ? "attention" : configuredRooms ? "watching" : "waiting"
    }
  ];
}

export async function inspectRadioHealth(baseUrl) {
  const checkedAt = new Date();
  const stationUrl = new URL("/api/radio/stations", baseUrl);
  let response;
  let data;

  try {
    response = await fetch(stationUrl, {
      headers: { Accept: "application/json", "User-Agent": "HALO-Radio-Data-Agent/1.0" },
      signal: AbortSignal.timeout(7_000)
    });
    if (!response.ok) throw new Error(`Station API returned HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Station API could not be reached";
    return {
      status: "offline",
      score: 0,
      checkedAt: checkedAt.toISOString(),
      serverTime: checkedAt.toISOString(),
      stationUpdatedAt: null,
      dataAgeMs: null,
      service: "unknown",
      summary: message,
      timing: { healthy: false, message: "Station time could not be verified" },
      data: { healthy: false, errors: [message] },
      rooms: [],
      agents: agentStatus("offline", false, false, 0)
    };
  }

  const dataErrors = validateStationData(data);
  const stationTimestamp = validTimestamp(data.updatedAt);
  const dataAgeMs = stationTimestamp === null ? null : Math.abs(checkedAt.getTime() - stationTimestamp);
  const timingErrors = [];
  if (dataAgeMs === null || dataAgeMs > 60_000) timingErrors.push("Station API timestamp was stale or invalid");
  if (data.service === "azuracast") {
    for (const room of data.rooms || []) {
      if (!room.ready) continue;
      const startedAt = validTimestamp(room.nowPlaying?.startedAt);
      const elapsed = Number(room.nowPlaying?.elapsed);
      if (startedAt === null || !Number.isFinite(elapsed)) {
        timingErrors.push(`${room.name} did not provide valid source timing`);
        continue;
      }
      const sourcePosition = startedAt + Math.max(0, elapsed) * 1000;
      if (Math.abs(checkedAt.getTime() - sourcePosition) > 120_000) timingErrors.push(`${room.name} source timing was out of sync`);
    }
  }
  const timingHealthy = timingErrors.length === 0;
  const rooms = await Promise.all((data.rooms || []).map(async room => {
    if (!room.streamUrl) {
      return {
        id: room.id,
        name: room.name,
        configured: false,
        reachable: false,
        isLive: false,
        listeners: Number(room.listeners || 0),
        latencyMs: null,
        statusCode: 0,
        status: "standby",
        message: "Waiting for a broadcast stream"
      };
    }
    const probe = await probeStream(room.streamUrl);
    return {
      id: room.id,
      name: room.name,
      configured: true,
      reachable: probe.reachable,
      isLive: Boolean(room.isLive),
      listeners: Number(room.listeners || 0),
      latencyMs: probe.latencyMs,
      statusCode: probe.statusCode,
      status: probe.reachable ? "live" : "degraded",
      message: probe.message
    };
  }));

  const configuredRooms = rooms.filter(room => room.configured).length;
  const reachableRooms = rooms.filter(room => room.reachable).length;
  const dataHealthy = dataErrors.length === 0;
  const status = reachableRooms > 0 ? "live" : configuredRooms > 0 ? "degraded" : "standby";
  const score = Math.round((dataHealthy ? 25 : 0) + (timingHealthy ? 25 : 0) + (configuredRooms ? reachableRooms / configuredRooms * 50 : 0));
  const summary = status === "live"
    ? `${reachableRooms} of ${configuredRooms} configured rooms answered the signal check`
    : status === "degraded"
      ? "Streams are configured, but none answered the signal check"
      : "Station systems are healthy and waiting for a stream connection";

  return {
    status,
    score,
    checkedAt: checkedAt.toISOString(),
    serverTime: checkedAt.toISOString(),
    stationUpdatedAt: stationTimestamp === null ? null : new Date(stationTimestamp).toISOString(),
    dataAgeMs,
    service: data.service || "preview",
    summary,
    timing: {
      healthy: timingHealthy,
      message: timingHealthy ? "Station and source time are synchronized" : timingErrors.join("; "),
      errors: timingErrors
    },
    data: { healthy: dataHealthy, errors: dataErrors },
    rooms,
    agents: agentStatus(status, timingHealthy, dataHealthy, configuredRooms)
  };
}
