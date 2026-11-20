// Attaches the HALO Living Player card to the music page's shared player (window.HaloPlayer).
import { mountLivingPlayer } from "/halo-living-player/living-player.js";

const mount = document.getElementById("musicLiving");
const player = window.HaloPlayer;
if (mount && player?.audio) {
  try {
    const card = mountLivingPlayer({ mount, audio: player.audio, label: "HALO living player" });
    let currentId = "";
    const sync = () => {
      const track = player.track;
      const id = track?.id || "";
      if (id === currentId) return;
      currentId = id;
      void card.setTrack(track ? { releaseId: id, title: track.title, artist: track.artist, artwork: track.cover } : null);
    };
    window.addEventListener("halo:trackchange", sync);
    player.audio.addEventListener("loadstart", sync);
    player.audio.addEventListener("play", sync);
    sync();
  } catch (error) {
    console.warn("HALO living player could not start", error);
    mount.hidden = true;
  }
} else if (mount) {
  mount.hidden = true;
}
