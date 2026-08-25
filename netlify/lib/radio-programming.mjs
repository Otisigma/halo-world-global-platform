const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function nextShowStart(dayOfWeek, startTime, now = new Date()) {
  const [hours, minutes] = String(startTime || "00:00").split(":").map(Number);
  const candidate = new Date(now);
  candidate.setUTCHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  const offset = (Number(dayOfWeek) - now.getUTCDay() + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + offset);
  if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 7);
  return candidate;
}

export function serializeShow(row, now = new Date()) {
  const startTime = String(row.start_time_utc || "00:00").slice(0, 5);
  const startsAt = nextShowStart(row.day_of_week, startTime, now);
  const endsAt = new Date(startsAt.getTime() + Number(row.duration_minutes || 60) * 60_000);
  return {
    id: row.id,
    room: row.room,
    title: row.title,
    description: row.description || "",
    hostName: row.host_name || "",
    producerName: row.producer_name || "",
    showType: row.show_type,
    dayOfWeek: Number(row.day_of_week),
    dayName: dayNames[Number(row.day_of_week)] || "",
    startTimeUtc: startTime,
    durationMinutes: Number(row.duration_minutes || 60),
    artistSlug: row.artist_slug || "",
    artworkUrl: row.artwork_url || "",
    status: row.status,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    subscribed: Boolean(row.subscribed),
    subscriberCount: Number(row.subscriber_count || 0)
  };
}

export function cleanShowId(value) {
  const id = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 96);
  return id.length >= 2 ? id : "";
}

