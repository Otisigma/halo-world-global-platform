import { pathToFileURL } from "node:url";
import { inspectAudioStream } from "../lib/audio-stream-diagnostics.js";

export async function diagnoseDreamweaverSong({ origin, songId, fetcher = fetch, log = console.log }) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Provide an HTTPS origin without a path or credentials.");
  }
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(songId || "")) {
    throw new Error("Provide a valid public catalog song UUID.");
  }
  async function getJson(path) {
    const response = await fetcher(new URL(path, base), { signal: AbortSignal.timeout(15000), redirect: "error" });
    log(`${path.split("?")[0]}: HTTP ${response.status} · ${response.headers.get("content-type") || "(missing Content-Type)"}`);
    if (!response.ok) throw new Error(`Public catalog lookup failed with HTTP ${response.status}.`);
    return response.json();
  }
  const releases = await getJson(`/api/release-catalog?songId=${encodeURIComponent(songId)}`);
  const release = releases.releases?.find(item => item.catalog?.songId === songId);
  let source = release?.catalog?.masterCopy?.audioSource;
  if (!source) {
    log("No exact-song public canonical master route was returned. Checking the access-controlled asset binding.");
    const assets = await getJson(`/api/dreamweaver-assets?songId=${encodeURIComponent(songId)}`);
    if (assets.binding?.songId === songId) source = assets.binding.audioSource;
  }
  if (!source) throw new Error("Neither public API supplied an audio source for this exact song.");
  const url = new URL(source, base);
  if (url.origin !== base.origin || url.pathname !== "/api/song-catalog/audio"
    || url.searchParams.get("songId") !== songId || url.searchParams.get("dreamweaver") !== "1") {
    throw new Error("The returned source is not this song's canonical public audio route; no arbitrary URL was probed.");
  }
  const detail = await inspectAudioStream(url.href, { origin: base.origin, fetcher, timeoutMs: 15000 });
  log(detail);
  if (!/HTTP (?:200|206) · audio\//i.test(detail)) throw new Error("The public audio route did not return an audio response.");
  log("Public audio HTTP delivery responded. Browser decoding and audible playback are not verified by this check.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await diagnoseDreamweaverSong({
      origin: process.env.HALO_AUDIO_PROBE_ORIGIN || "https://halo-world-global-platform.netlify.app",
      songId: process.env.HALO_AUDIO_PROBE_SONG_ID,
    });
  } catch (error) {
    console.error(`Dreamweaver live diagnostic failed: ${error.message}`);
    process.exitCode = 1;
  }
}
