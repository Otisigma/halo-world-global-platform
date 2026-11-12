import { readPlaylists, albumInspiration } from "../lib/personal-playlists.js";

export function mountPlaylistInspiration({ document, window, fetcher }) {
  const id = new URL(window.location.href).searchParams.get("playlist");
  const root = document.getElementById("playlistInspiration");
  if (!id || !root) return;
  root.hidden = false;
  const button = root.querySelector("[data-import-playlist]");
  const status = root.querySelector('[role="status"]');
  const story = document.getElementById("storyInput");
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Checking the current public songs in your playlist...";
    try {
      const playlist = readPlaylists(window.localStorage).find(item => item.id === id);
      if (!playlist) throw new Error("This playlist is not saved in this browser. Return to the song catalog to choose another.");
      const response = await fetcher("/api/release-catalog", { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.releases)) throw new Error("The public catalog could not be checked. Try again.");
      const brief = albumInspiration(playlist, data.releases);
      const combined = story.value.trim() ? `${story.value}\n\n${brief}` : brief;
      if (combined.length > 4000) throw new Error("Your story and playlist exceed 4,000 characters. Shorten one before importing.");
      story.value = combined;
      story.dispatchEvent(new window.Event("input", { bubbles: true }));
      status.textContent = `Added "${playlist.name}" as inspiration. Review the story before building. No songs or rights are imported; generation still requires your signed-in, explicit request.`;
    } catch (error) {
      console.error("Playlist inspiration unavailable", error);
      status.textContent = error.message || "Playlist inspiration could not be loaded.";
      button.disabled = false;
    }
  });
}

if (typeof document !== "undefined") mountPlaylistInspiration({ document, window, fetcher: fetch });
