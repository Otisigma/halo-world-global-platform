import { validSignalWord, validSignalTrack } from "../lib/signal-emotion.js";

export function createSignalMapController({ fetcher = fetch, render, status }) {
  let track = null;
  let revision = 0;
  let refreshSequence = 0;
  let pending = false;
  async function refresh() {
    if (!track) return;
    const current = revision;
    const sequence = ++refreshSequence;
    try {
      const response = await fetcher(`/api/signal/emotion?releaseId=${encodeURIComponent(track.id)}`, { cache: "no-store" });
      const data = await response.json();
      if (current !== revision || sequence !== refreshSequence) return;
      if (!response.ok) throw new Error();
      render((Array.isArray(data.words) ? data.words : []).filter(item => validSignalWord(item.word)).slice(0, 24));
    } catch {
      if (current === revision && sequence === refreshSequence) status("The map is resting. Your music can keep playing.");
    }
  }
  return {
    async setTrack(next) {
      const eligible = validSignalTrack(next?.id) ? next : null;
      if (track?.id === eligible?.id) return;
      track = eligible;
      revision++;
      pending = false;
      render([]);
      status("");
      if (track) await refresh();
    },
    refresh,
    async submit(word, playbackSeconds) {
      if (!track || pending) return false;
      if (!validSignalWord(word)) {
        status("Leave exactly one word, letters only, up to 20 characters.");
        return false;
      }
      const current = revision;
      pending = true;
      status("Transmitting quietly…");
      try {
        const body = { releaseId: track.id, word };
        if (Number.isFinite(playbackSeconds)) body.playbackSeconds = Math.min(86400, Math.max(0, playbackSeconds));
        const response = await fetcher("/api/signal/emotion", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        const data = await response.json();
        if (current !== revision) return false;
        if (!response.ok) {
          status(data.message || "The map is resting. Please try later.");
          return false;
        }
        await refresh();
        if (current !== revision) return false;
        status("Your word is part of the map.");
        return true;
      } catch {
        if (current === revision) status("The map is resting. Please try later.");
        return false;
      } finally {
        if (current === revision) pending = false;
      }
    }
  };
}

export function mountSignalMap(document, window) {
  const anchor = document.querySelector("#featuredRelease") || document.querySelector("footer .player");
  if (!anchor) return;
  const map = document.createElement("section");
  map.className = "signal-emotional-map";
  map.hidden = true;
  map.setAttribute("aria-label", "Signal emotional map");
  map.innerHTML = `<p class="signal-map-kicker">Signal · One-Word Map</p>
    <h2>Emotional Map <span data-signal-track></span></h2>
    <p id="signalMapPrompt">Not a review. Not a rating. Leave one word for how this frequency made you feel.</p>
    <form><label for="signalMapWord">Your one word</label>
      <div class="signal-map-input"><input id="signalMapWord" type="text" maxlength="20" required autocomplete="off" spellcheck="false" aria-describedby="signalMapPrompt signalMapStatus">
      <button type="submit">Transmit Word</button></div>
    </form>
    <p id="signalMapStatus" role="status"></p>
    <ul class="signal-map-words" aria-label="Recent emotional words"></ul>
    <p class="signal-map-note">Every word here is a pulse.</p>`;
  if (anchor.closest("footer")) document.querySelector("main").append(map);
  else anchor.after(map);
  const input = map.querySelector("input");
  const button = map.querySelector("button");
  const words = map.querySelector("ul");
  let selection = 0;
  const controller = createSignalMapController({
    fetcher: window.fetch.bind(window),
    render(items) {
      words.replaceChildren();
      if (!items.length) {
        const empty = document.createElement("li");
        empty.className = "signal-map-empty";
        empty.textContent = "A quiet space for the next word.";
        words.append(empty);
      }
      for (const [index, item] of items.entries()) {
        const node = document.createElement("li");
        node.textContent = item.word;
        node.style.setProperty("--signal-delay", `${-(index % 8)}s`);
        words.append(node);
      }
    },
    status(message) { map.querySelector("[role=status]").textContent = message; }
  });
  input.addEventListener("input", () => {
    input.setCustomValidity(!input.value || validSignalWord(input.value) ? "" : "One word, letters only, up to 20 characters. No spaces.");
  });
  map.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const current = selection;
    button.disabled = true;
    const value = input.value;
    const accepted = await controller.submit(value, window.HaloPlayer?.audio?.currentTime ?? document.querySelector("#musicWorldAudio")?.currentTime);
    if (current === selection) {
      if (accepted && input.value === value) { input.value = ""; input.setCustomValidity(""); }
      button.disabled = false;
    }
  });
  function selectTrack(track) {
    selection++;
    const eligible = validSignalTrack(track?.id);
    map.hidden = !eligible;
    map.querySelector("[data-signal-track]").textContent = eligible ? `· ${track.title || "Current track"}` : "";
    input.value = "";
    input.setCustomValidity("");
    button.disabled = false;
    controller.setTrack(eligible ? track : null);
  }
  window.addEventListener("halo:trackchange", event => selectTrack(event.detail));
  selectTrack(window.HaloPlayer?.track || window.haloSignalTrack || null);
  window.setInterval(() => {
    if (!document.hidden && !map.hidden) controller.refresh();
  }, 15000);
  return { controller, map, selectTrack };
}

if (typeof document !== "undefined") mountSignalMap(document, window);
