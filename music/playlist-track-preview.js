export function createPlaylistTrackPreview({ document, window, release, prefix = "", onSelect, disabled = false }) {
  const fallback = "/assets/releases/halo-premium-placeholder.svg";
  const safeArtwork = value => {
    if (typeof value !== "string" || !value.trim()) return fallback;
    try {
      const url = new URL(value, window.location.origin);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : fallback;
    } catch { return fallback; }
  };
  const resolved = window.HaloReleaseArtwork?.resolve({ ...release, artwork: release.artwork || release.coverUrl }, fallback);
  const row = document.createElement(onSelect ? "button" : "div");
  row.className = "playlist-track-item";
  if (onSelect) {
    row.type = "button";
    row.disabled = disabled;
    row.setAttribute("aria-label", `Play ${release.title || "Untitled"} by ${release.artist || "Artist"}`);
    row.addEventListener("click", onSelect);
  }
  const image = document.createElement("img");
  image.className = "playlist-track-thumb";
  image.src = safeArtwork(resolved?.src || release.coverUrl || release.artwork);
  const title = release.title || "Untitled";
  image.alt = `${title} cover art`;
  image.loading = "lazy";
  image.width = 48; image.height = 48;
  const showPlaceholder = () => { image.alt = `${title}: HALO placeholder cover`; };
  if (image.src === fallback || image.src === new URL(fallback, window.location.origin).href) showPlaceholder();
  image.addEventListener("error", () => { image.src = fallback; showPlaceholder(); }, { once: true });
  const info = document.createElement("span");
  info.className = "playlist-track-info";
  const name = document.createElement("span");
  name.className = "playlist-track-title";
  name.textContent = `${prefix}${title}`;
  const artist = document.createElement("span");
  artist.className = "playlist-track-artist";
  artist.textContent = release.artist || "Artist";
  info.append(name, artist); row.append(image, info);
  return row;
}
