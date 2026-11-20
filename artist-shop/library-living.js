// Attaches the HALO Living Player card to the Always-On Library's audio element.
import { mountLivingPlayer } from "/halo-living-player/living-player.js";

const mount = document.getElementById("library-living");
const audio = document.getElementById("library-audio");
if (mount && audio) {
  try {
    const card = mountLivingPlayer({ mount, audio, label: "Always-On Library living player" });
    window.addEventListener("halo:library-track", event => { void card.setTrack(event.detail); });
  } catch (error) {
    console.warn("HALO living player could not start", error);
    mount.hidden = true;
  }
}
