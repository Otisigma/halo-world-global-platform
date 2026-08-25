CREATE TABLE IF NOT EXISTS halo_agent_knowledge (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  knowledge_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  domain TEXT NOT NULL,
  summary TEXT NOT NULL,
  symptoms JSONB NOT NULL DEFAULT '[]'::jsonb,
  diagnosis JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolution JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification JSONB NOT NULL DEFAULT '[]'::jsonb,
  related_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(knowledge_key) BETWEEN 3 AND 120),
  CHECK (char_length(title) BETWEEN 3 AND 180),
  CHECK (char_length(domain) BETWEEN 2 AND 80),
  CHECK (char_length(summary) BETWEEN 10 AND 1600),
  CHECK (status IN ('active', 'superseded'))
);

CREATE INDEX IF NOT EXISTS halo_agent_knowledge_domain_idx
  ON halo_agent_knowledge(domain, status, updated_at DESC);

INSERT INTO halo_agent_knowledge (
  knowledge_key, title, domain, summary, symptoms, diagnosis, resolution, verification, related_paths
)
VALUES (
  'radio-video-recovery-2026-08-11',
  'Halo Radio audio and visible video recovery path',
  'radio-playback',
  'Use this runbook when Halo Radio is silent, squeals, stalls while loading, reports a stream that browsers cannot reach, or needs the visible listening-party video fallback. The verified design keeps browser audio, YouTube recovery playback, approved track rotation, and AzuraCast stream selection as separate paths so only one audio source plays at a time.',
  '["The radio play button produces silence or a high-pitched squeal.","The Long Play library remains in a loading state or its progress bar does not advance.","AzuraCast now-playing data exists but the browser receives an internal localhost mount URL.","The station stream fails and listeners need a visible video-backed recovery experience."]'::jsonb,
  '["Check whether the selected room has a verified public HTTPS stream before changing player code.","Inspect AzuraCast responses for either a station object or station-list array and reject internal or insecure mount URLs.","Confirm that synthetic oscillators are not being used as music fallbacks.","Confirm that station audio is paused before the YouTube player starts, and that the YouTube player is paused before station audio resumes.","Check the Long Play catalog response, audio headers, duration metadata, queue state, and ended-event advancement."]'::jsonb,
  '["Normalize AzuraCast station-list and station-object responses.","Prefer the default public HTTPS HLS URL when AzuraCast marks HLS as the station default.","Use approved creator tracks for room rotation and full-length mixes for Long Play rather than generated tones.","Use the YouTube IFrame API for the station-wide recovery mix, show the video while it plays, and keep playback state synchronized.","Keep the HTML audio element and YouTube player mutually exclusive to prevent overlapping or corrupted sound."]'::jsonb,
  '["Run the radio contract checks.","Open /api/radio/stations and verify that each configured room exposes a public HTTPS stream URL.","Open /api/radio/health and verify the station, timing, data, and room checks.","Test play, pause, room switching, recovery video playback, Long Play progress, and automatic queue advancement on desktop and mobile.","Confirm that the visible recovery video disappears or pauses when a verified station or Long Play source resumes."]'::jsonb,
  '["HALO_RADIO_VIDEO_PLAYBACK_RUNBOOK.md","HALO_RADIO.md","radio/radio.js","radio/index.html","radio/radio.css","netlify/functions/radio-stations.mjs","netlify/lib/radio-health.mjs","scripts/radio-contracts.mjs"]'::jsonb
)
ON CONFLICT (knowledge_key) DO UPDATE SET
  title = EXCLUDED.title,
  domain = EXCLUDED.domain,
  summary = EXCLUDED.summary,
  symptoms = EXCLUDED.symptoms,
  diagnosis = EXCLUDED.diagnosis,
  resolution = EXCLUDED.resolution,
  verification = EXCLUDED.verification,
  related_paths = EXCLUDED.related_paths,
  status = 'active',
  updated_at = NOW();
