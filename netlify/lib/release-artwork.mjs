export const DEFAULT_RELEASE_ARTWORK = "/assets/halo-app-icon-512.png";

function cleanArtworkValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveReleaseArtworkFields({
  artworkUrl = "",
  importedArtworkUrl = "",
  artworkOverrideUrl = "",
  fallbackArtwork = DEFAULT_RELEASE_ARTWORK
} = {}) {
  const artworkOverride = cleanArtworkValue(artworkOverrideUrl);
  const importedArtwork = cleanArtworkValue(importedArtworkUrl);
  const legacyArtwork = cleanArtworkValue(artworkUrl);
  const artwork = artworkOverride || importedArtwork || legacyArtwork || fallbackArtwork;
  const artworkSource = artworkOverride
    ? "manual"
    : importedArtwork
      ? "imported"
      : legacyArtwork
        ? "legacy"
        : "fallback";

  return {
    artwork,
    artworkOverride,
    importedArtwork,
    artworkSource,
    fallbackArtwork
  };
}
