#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const RANGE_BYTES = 64;
const REQUEST_TIMEOUT_MS = 15_000;

const PROBES = [
  {
    name: "Drive catalog",
    path: "/api/drive-catalog/audio",
    query: ({ driveTrackId }) => ({ track: driveTrackId })
  },
  {
    name: "Song catalog",
    path: "/api/song-catalog/audio",
    query: ({ songId, songVersionId }) => ({
      dreamweaver: "1",
      songId,
      versionId: songVersionId
    })
  },
  {
    name: "Radio",
    path: "/api/radio/audio",
    query: ({ radioTrackId }) => ({ id: radioTrackId })
  },
  {
    name: "Mix",
    path: "/api/mixes/audio",
    query: ({ mixId }) => ({ id: mixId })
  },
  {
    name: "Stem vault",
    path: "/api/stem-vault/audio",
    query: ({ stemPackId, stemType }) => ({ pack: stemPackId, stem: stemType })
  }
];

function required(value, name) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`Missing required audio probe configuration: ${name}`);
  return result;
}

function sameOrigin(value) {
  const url = new URL(value);
  const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("Audio probe origin must use HTTPS (HTTP is allowed only for localhost)");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Audio probe origin must contain only a scheme and host");
  }
  return url.origin;
}

export function buildAudioProbeUrls({ origin, ...ids }) {
  const base = sameOrigin(required(origin, "HALO_AUDIO_PROBE_ORIGIN"));
  const requiredIds = {
    driveTrackId: "HALO_AUDIO_PROBE_DRIVE_TRACK_ID",
    songId: "HALO_AUDIO_PROBE_SONG_ID",
    songVersionId: "HALO_AUDIO_PROBE_SONG_VERSION_ID",
    radioTrackId: "HALO_AUDIO_PROBE_RADIO_TRACK_ID",
    mixId: "HALO_AUDIO_PROBE_MIX_ID",
    stemPackId: "HALO_AUDIO_PROBE_STEM_PACK_ID",
    stemType: "HALO_AUDIO_PROBE_STEM_TYPE"
  };
  const cleanIds = Object.fromEntries(
    Object.entries(requiredIds).map(([key, name]) => [key, required(ids[key], name)])
  );
  const stemTypes = new Set(["full", "drums", "bass", "music", "vocals", "fx"]);
  if (!stemTypes.has(cleanIds.stemType.toLowerCase())) {
    throw new Error("HALO_AUDIO_PROBE_STEM_TYPE must be one of: full, drums, bass, music, vocals, fx");
  }
  cleanIds.stemType = cleanIds.stemType.toLowerCase();

  return PROBES.map(probe => {
    const url = new URL(probe.path, base);
    for (const [key, value] of Object.entries(probe.query(cleanIds))) {
      url.searchParams.set(key, value);
    }
    return { name: probe.name, url };
  });
}

function assertAudioRange(response, bytes, name, origin) {
  if (response.status !== 206) throw new Error(`${name}: expected HTTP 206, received ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!/^audio\/[a-z0-9.+-]+(?:\s*;|$)/i.test(contentType)) {
    throw new Error(`${name}: expected an audio Content-Type, received ${contentType || "(missing)"}`);
  }
  if (response.headers.get("accept-ranges")?.toLowerCase() !== "bytes") {
    throw new Error(`${name}: missing Accept-Ranges: bytes`);
  }
  if (response.headers.get("access-control-allow-origin") !== "*"
    && response.headers.get("access-control-allow-origin") !== origin) {
    throw new Error(`${name}: missing compatible Access-Control-Allow-Origin`);
  }

  const range = /^bytes 0-(\d+)\/(\d+)$/i.exec(response.headers.get("content-range") || "");
  if (!range) throw new Error(`${name}: invalid or missing Content-Range`);
  const end = Number(range[1]);
  const total = Number(range[2]);
  if (!Number.isSafeInteger(end) || !Number.isSafeInteger(total) || total < 1
    || end >= RANGE_BYTES || end >= total || end + 1 !== bytes.byteLength) {
    throw new Error(`${name}: response body does not match its byte range`);
  }
  if (bytes.byteLength === 0) throw new Error(`${name}: empty audio response`);

  const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 64))).trimStart();
  if (/^(?:<!doctype\s+html|<html\b|<\?xml\b|\{\s*"error"\s*:)/i.test(prefix)) {
    throw new Error(`${name}: response body is an error document, not audio`);
  }
  return { contentType, bytes: bytes.byteLength, total };
}

async function readBoundedBody(response) {
  if (!response.body) throw new Error("Audio response has no body");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RANGE_BYTES) throw new Error("Audio response exceeded the requested byte-range limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function runAudioEndpointSmoke({ origin, ids, authorization = "", fetchImpl = fetch, log = console.log }) {
  const base = sameOrigin(required(origin, "HALO_AUDIO_PROBE_ORIGIN"));
  const targets = buildAudioProbeUrls({ origin: base, ...ids });
  const results = [];

  for (const target of targets) {
    const headers = { Range: `bytes=0-${RANGE_BYTES - 1}` };
    if (authorization && target.name === "Stem vault") headers.Authorization = authorization;
    const response = await fetchImpl(target.url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const bytes = await readBoundedBody(response);
    const result = assertAudioRange(response, bytes, target.name, base);
    results.push({ name: target.name, ...result });
    log(`PASS ${target.name}: HTTP 206, ${result.contentType}, ${result.bytes}/${result.total} bytes`);
  }

  return results;
}

function environmentConfig(env) {
  return {
    origin: env.HALO_AUDIO_PROBE_ORIGIN,
    authorization: env.HALO_AUDIO_PROBE_AUTHORIZATION || "",
    ids: {
      driveTrackId: env.HALO_AUDIO_PROBE_DRIVE_TRACK_ID,
      songId: env.HALO_AUDIO_PROBE_SONG_ID,
      songVersionId: env.HALO_AUDIO_PROBE_SONG_VERSION_ID,
      radioTrackId: env.HALO_AUDIO_PROBE_RADIO_TRACK_ID,
      mixId: env.HALO_AUDIO_PROBE_MIX_ID,
      stemPackId: env.HALO_AUDIO_PROBE_STEM_PACK_ID,
      stemType: env.HALO_AUDIO_PROBE_STEM_TYPE
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { origin, authorization, ids } = environmentConfig(process.env);
    const results = await runAudioEndpointSmoke({ origin, ids, authorization });
    console.log(`Audio endpoint smoke passed: ${results.length}/${PROBES.length} streams returned byte ranges.`);
    console.log("This verifies HTTP transport only; it does not prove that a browser decoded or played sound.");
  } catch (error) {
    console.error(`Audio endpoint smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
