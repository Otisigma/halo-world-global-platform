import {
  buildDreamweaverStorefrontPath,
  cleanDreamweaverSongId,
  DREAMWEAVER_STOREFRONT_MIX_ID,
  sanitizeDreamweaverAssignedRoute,
} from "./dreamweaver-storefront.js";

export function pendingDreamweaverUploadShow(song) {
  const songId = cleanDreamweaverSongId(song?.songId || song?.id);
  return {
    ready: false,
    route: "",
    message: !songId
      ? "Not ready: a valid song ID is required."
      : song.pipelineStatus !== "published"
        ? "Processing / not ready. Complete the assets, rights and review steps in Song Catalog, then publish when you choose."
        : "Not ready: checking the public release and canonical master. Use Publication health to resolve any outstanding issues, then check again.",
  };
}

export async function loadDreamweaverUploadShow(song, { fetchImpl = fetch, mixId = "" } = {}) {
  const pending = pendingDreamweaverUploadShow(song);
  const songId = cleanDreamweaverSongId(song?.songId || song?.id);
  if (!songId || song.pipelineStatus !== "published" || song.rightsStatus !== "cleared") return pending;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    // Anonymous checks must not mistake an owner's private binding for public availability.
    const options = { credentials: "omit", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } };
    const releasesResponse = await fetchImpl(`/api/release-catalog?${new URLSearchParams({ songId })}`, options);
    if (!releasesResponse.ok) return pending;
    const { releases = [] } = await releasesResponse.json();
    const release = releases.find(entry => entry.catalog?.songId === songId
      && entry.status === "published" && entry.isLiveVisible === true);
    if (!release?.catalog?.masterCopy?.uploaded) return pending;
    const bindingResponse = await fetchImpl(`/api/dreamweaver-assets?songId=${encodeURIComponent(songId)}`, options);
    if (!bindingResponse.ok) return pending;
    const { binding } = await bindingResponse.json();
    if (binding?.songId !== songId || binding.status !== "ready" || !binding.audioSource
      || !cleanDreamweaverSongId(binding.masterVersionId)
      || binding.masterVersionId !== release.catalog.masterCopy.versionId
      || binding.visualActs?.length !== 4) return pending;
    const assignedRoute = sanitizeDreamweaverAssignedRoute(release.dreamweaverHubUrl);
    const assignedMixId = assignedRoute
      ? new URL(assignedRoute, "https://halo.world").searchParams.get("mix") : "";
    const uploadRoute = sanitizeDreamweaverAssignedRoute(song.dreamweaverSatellite?.route);
    const uploadParams = uploadRoute ? new URL(uploadRoute, "https://halo.world").searchParams : null;
    const uploadMixId = uploadParams?.get("song") === songId ? uploadParams.get("mix") : "";
    const intendedMixId = mixId || (uploadMixId !== DREAMWEAVER_STOREFRONT_MIX_ID && uploadMixId) || assignedMixId || uploadMixId;
    return {
      ready: true,
      route: buildDreamweaverStorefrontPath(songId, { mixId: intendedMixId, includeSatelliteFlag: true }),
      message: "Public release ready. Open this song’s artwork and canonical master in Dreamweaver.",
    };
  } catch {
    return { ...pending, message: "Not ready: public availability could not be verified. Check readiness again; no publication settings were changed." };
  } finally {
    clearTimeout(timeout);
  }
}
