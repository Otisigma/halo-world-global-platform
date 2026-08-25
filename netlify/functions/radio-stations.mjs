import { getDatabase } from "@netlify/database";

const roomDefinitions = [
  {
    id: "club",
    name: "Club Room",
    frequency: "01",
    strapline: "Peak-hour pressure",
    description: "High-energy house, club edits and creator-led takeover sets.",
    fallbackArtist: "HALO Radio",
    fallbackTitle: "Club transmission standing by",
    demo: {
      title: "Pressure Test 01",
      artist: "HALO Club System",
      nextTitle: "Midnight Architecture",
      nextArtist: "House Crew",
      bpm: 128,
      key: "8A"
    }
  },
  {
    id: "chill",
    name: "Chill Room",
    frequency: "02",
    strapline: "Deep motion",
    description: "Chill house, warm electronics and low-light morning movement.",
    fallbackArtist: "HALO Radio",
    fallbackTitle: "Chill transmission standing by",
    demo: {
      title: "Last Light Drift",
      artist: "HALO Shoreline System",
      nextTitle: "Lanterns at Low Tide",
      nextArtist: "Sunset Crew",
      bpm: 108,
      key: "5A"
    }
  },
  {
    id: "lounge",
    name: "Lounge Room",
    frequency: "03",
    strapline: "After-hours atmosphere",
    description: "Smooth selections, atmospheric cuts and elegant late-night drift.",
    fallbackArtist: "HALO Radio",
    fallbackTitle: "Lounge transmission standing by",
    demo: {
      title: "Velvet Frequency",
      artist: "HALO After Hours",
      nextTitle: "Closing Toast",
      nextArtist: "Salon Residents",
      bpm: 96,
      key: "3A"
    }
  }
];

function env(name) {
  return String(globalThis.Netlify?.env?.get(name) || process.env[name] || "").trim();
}

function safeHttpsUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href.replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

export function normalizeAzuraCastNowPlaying(payload, slug = "") {
  const stations = Array.isArray(payload) ? payload : [payload];
  const normalizedSlug = String(slug || "").trim().toLowerCase();
  const matchingStation = normalizedSlug
    ? stations.find(entry => {
      const station = entry?.station || {};
      return [station.shortcode, station.id, station.name]
        .some(value => String(value || "").trim().toLowerCase() === normalizedSlug);
    })
    : null;
  return matchingStation || (stations.length === 1 ? stations[0] : null);
}

export function azuraCastStreamUrl(data) {
  const station = data?.station || {};
  const defaultMount = Array.isArray(station.mounts) ? station.mounts.find(mount => mount?.is_default) : null;
  const mountUrls = Array.isArray(station.mounts) ? station.mounts.map(mount => mount?.url) : [];
  const remoteUrls = Array.isArray(station.remotes) ? station.remotes.map(remote => remote?.url) : [];
  const hlsUrl = station.hls_enabled ? station.hls_url : "";
  const candidates = station.hls_is_default
    ? [hlsUrl, station.listen_url, defaultMount?.url, ...mountUrls, ...remoteUrls]
    : [station.listen_url, defaultMount?.url, ...mountUrls, ...remoteUrls, hlsUrl];
  return candidates.map(safeHttpsUrl).find(Boolean) || "";
}

function nowPlayingUrls(baseUrl, slug) {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/$/, "");
  if (path === "/api/nowplaying") {
    return [`${baseUrl}/${encodeURIComponent(slug)}`, baseUrl];
  }
  if (path.startsWith("/api/nowplaying/")) return [baseUrl];
  return [`${baseUrl}/api/nowplaying/${encodeURIComponent(slug)}`, `${baseUrl}/api/nowplaying`];
}

async function loadNowPlaying(baseUrl, slug) {
  if (!baseUrl || !/^[a-z0-9_-]{1,80}$/i.test(slug)) return null;
  for (const url of nowPlayingUrls(baseUrl, slug)) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4_000)
      });
      if (!response.ok) continue;
      const data = normalizeAzuraCastNowPlaying(await response.json(), slug);
      if (!data) continue;
      return {
        streamUrl: azuraCastStreamUrl(data),
        listeners: Math.max(0, Number(data.listeners?.current || 0)),
        isLive: Boolean(data.live?.is_live),
        liveName: String(data.live?.streamer_name || "").slice(0, 80),
        title: String(data.now_playing?.song?.title || "").slice(0, 140),
        artist: String(data.now_playing?.song?.artist || "").slice(0, 140),
        artwork: safeHttpsUrl(data.now_playing?.song?.art),
        startedAt: Number(data.now_playing?.played_at || 0) > 0 ? new Date(Number(data.now_playing.played_at) * 1000).toISOString() : null,
        elapsed: Math.max(0, Number(data.now_playing?.elapsed || 0)),
        duration: Math.max(0, Number(data.now_playing?.duration || 0)),
        nextTitle: String(data.playing_next?.song?.title || "").slice(0, 140),
        nextArtist: String(data.playing_next?.song?.artist || "").slice(0, 140)
      };
    } catch {
      continue;
    }
  }
  return null;
}

export default async function radioStationsHandler(request) {
  if (request.method !== "GET") return Response.json({ message: "Method not allowed" }, { status: 405 });
  const baseUrl = safeHttpsUrl(env("HALO_RADIO_AZURACAST_URL"));
  const slugs = {
    club: env("HALO_RADIO_CLUB_STATION") || "halo-club",
    chill: env("HALO_RADIO_CHILL_STATION") || "halo-chill",
    lounge: env("HALO_RADIO_LOUNGE_STATION") || "halo-lounge"
  };
  const directStreams = {
    club: safeHttpsUrl(env("HALO_RADIO_CLUB_STREAM_URL")),
    chill: safeHttpsUrl(env("HALO_RADIO_CHILL_STREAM_URL")),
    lounge: safeHttpsUrl(env("HALO_RADIO_LOUNGE_STREAM_URL"))
  };

  let counts = {};
  let rotations = {};
  try {
    const db = await getDatabase();
    const [countRows, rotationRows] = await Promise.all([
      db.sql`
        SELECT room, COUNT(*) FILTER (WHERE status = 'rotation')::int AS rotation_count,
          COUNT(*) FILTER (WHERE status = 'preview')::int AS preview_count
        FROM halo_radio_tracks
        GROUP BY room
      `,
      db.sql`
        SELECT id, room, title, artist_name, bpm, musical_key, duration_seconds, artwork_key
        FROM halo_radio_tracks
        WHERE status = 'rotation'
        ORDER BY room, created_at DESC, (votes_up - votes_down) DESC, play_count ASC
        LIMIT 72
      `
    ]);
    counts = Object.fromEntries(countRows.map(row => [row.room, {
      rotation: Number(row.rotation_count || 0),
      preview: Number(row.preview_count || 0)
    }]));
    rotations = rotationRows.reduce((queues, row) => {
      const queue = queues[row.room] || [];
      queue.push({
        id: row.id,
        title: row.title,
        artist: row.artist_name,
        bpm: row.bpm ? Number(row.bpm) : null,
        key: row.musical_key || "",
        duration: Number(row.duration_seconds || 0),
        audioUrl: `/api/radio/audio?id=${encodeURIComponent(row.id)}`,
        artwork: row.artwork_key ? `/api/radio/artwork?id=${encodeURIComponent(row.id)}` : ""
      });
      queues[row.room] = queue;
      return queues;
    }, {});
  } catch {
    counts = {};
    rotations = {};
  }

  const nowPlaying = await Promise.all(roomDefinitions.map(room => loadNowPlaying(baseUrl, slugs[room.id])));
  const rooms = roomDefinitions.map((room, index) => {
    const live = nowPlaying[index];
    const streamUrl = directStreams[room.id] || live?.streamUrl || "";
    const rotation = rotations[room.id] || [];
    const rotationNow = rotation[0];
    const rotationNext = rotation[1] || rotation[0];
    const demo = !streamUrl;
    return {
      id: room.id,
      name: room.name,
      frequency: room.frequency,
      strapline: room.strapline,
      description: room.description,
      ready: Boolean(streamUrl),
      fallbackReady: rotation.length > 0,
      demo,
      streamUrl,
      rotation,
      listeners: live?.listeners || 0,
      isLive: live?.isLive || false,
      liveName: live?.liveName || "",
      nowPlaying: {
        title: live?.title || rotationNow?.title || (demo ? room.demo.title : room.fallbackTitle),
        artist: live?.artist || rotationNow?.artist || (demo ? room.demo.artist : room.fallbackArtist),
        artwork: live?.artwork || rotationNow?.artwork || "",
        startedAt: live?.startedAt || null,
        elapsed: live?.elapsed || 0,
        duration: live?.duration || rotationNow?.duration || 0,
        bpm: rotationNow?.bpm || (demo ? room.demo.bpm : null),
        key: rotationNow?.key || (demo ? room.demo.key : "")
      },
      next: {
        title: live?.nextTitle || rotationNext?.title || (demo ? room.demo.nextTitle : "Creator rotation"),
        artist: live?.nextArtist || rotationNext?.artist || (demo ? room.demo.nextArtist : "Community selected")
      },
      library: counts[room.id] || { rotation: 0, preview: 0 }
    };
  });

  return Response.json({
    service: baseUrl ? "azuracast" : directStreams.club || directStreams.chill || directStreams.lounge ? "direct" : Object.keys(rotations).length ? "rotation" : "demo",
    updatedAt: new Date().toISOString(),
    rooms
  }, { headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=20" } });
}

export const config = {
  path: "/api/radio/stations"
};
