import { constellationPreviewUrl } from "../lib/constellation-media.js";

const releaseId = value => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 96;
export function showcaseReleases(data) {
  if (!Array.isArray(data?.releases) || data.releases.length > 500) throw new Error("Invalid public catalog response");
  return data.releases.filter(row => row.status === "published" && row.isLiveVisible !== false)
    .map(row => {
      if (!releaseId(row.id) || typeof row.title !== "string" || !row.title.trim() || typeof row.artist !== "string") {
        throw new Error("Invalid public release");
      }
      return {
        id: row.id, title: row.title, artist: row.artist,
        pitch: typeof row.pitch === "string" ? row.pitch.slice(0, 400) : "",
        artwork: safeArtwork(row.artwork), audio: constellationPreviewUrl(row.streamUrl)
      };
    });
}
function safeArtwork(value) {
  if (typeof value !== "string" || value.length > 1200 || /[\u0000-\u001f\\]/.test(value)) return "";
  try {
    const url = new URL(value, "https://halo.invalid");
    if (url.search || url.hash || url.username || url.password) return "";
    if (value.startsWith("/") && !value.startsWith("//")) return url.pathname.startsWith("/assets/") ? url.pathname : "";
    return url.protocol === "https:" && url.hostname.includes(".") && !/^[\d.]+$/.test(url.hostname)
      && !/(^|\.)(localhost|local|internal|drive\.google\.com|docs\.google\.com)$/.test(url.hostname) ? url.href : "";
  } catch { return ""; }
}

export function createConciergeShowcase(root, {
  document = globalThis.document, fetch = globalThis.fetch, sentinel = globalThis.window?.HaloSentinel
} = {}) {
  const selector = root.querySelector("[data-showcase-selector]");
  const releases = root.querySelector("[data-showcase-releases]");
  const status = root.querySelector("[data-showcase-status]");
  const concepts = root.querySelector("[data-showcase-concepts]");
  const conceptStatus = root.querySelector("[data-showcase-concept-status]");
  const playerStatus = root.querySelector("[data-showcase-player-status]");
  const audio = root.querySelector("[data-showcase-audio]");
  let catalog = [], catalogRevision = 0, conceptRevision = 0, playbackRevision = 0;
  let expectedAudio = "";
  let catalogRequest, conceptRequest;
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  };
  function stop() {
    expectedAudio = "";
    playbackRevision++;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    playerStatus.textContent = "Preview stopped. No listening analytics or rewards recorded.";
  }
  async function play(row) {
    stop();
    const current = playbackRevision;
    if (!row.audio) { playerStatus.textContent = "In-page preview unavailable. Open the song in the public shop."; return; }
    playerStatus.textContent = `Loading ${row.title} by ${row.artist}...`;
    try {
      expectedAudio = row.audio;
      audio.src = row.audio;
      const inspection = sentinel?.preflight(audio, row.audio, { recover: false });
      // Start inside the click task; waiting for the probe would lose the user gesture.
      await audio.play();
      await inspection;
      if (current !== playbackRevision) return;
      playerStatus.textContent = `Playing ${row.title} by ${row.artist}.`;
    } catch (error) {
      if (current !== playbackRevision) return;
      stop();
      playerStatus.textContent = error.name === "NotAllowedError" ? "Tap Preview again to allow playback."
        : "Preview could not be played. Open the song in the public shop.";
      if (error.name === "NotAllowedError") sentinel?.blocked(audio);
    }
  }
  sentinel?.bind({
    audio, target: "showcase", expectedSource: () => expectedAudio,
    onUnavailable: () => {
      stop();
      playerStatus.textContent = "Sentinel could not verify this preview. Retry Preview or open the public release; no replacement recording was selected.";
    },
    onBlocked: () => { playerStatus.textContent = "Tap Preview again to play with sound."; }
  });
  function renderReleases() {
    const chosen = selector.value;
    const displayed = chosen ? catalog.filter(row => row.id === chosen) : catalog.slice(0, 4);
    releases.replaceChildren(...displayed.map(row => {
      const article = element("article");
      const placeholder = element("div", "Artwork not available");
      placeholder.className = "ac-showcase-artwork-placeholder";
      placeholder.hidden = Boolean(row.artwork);
      article.append(placeholder);
      if (row.artwork) {
        const image = element("img");
        image.src = row.artwork; image.alt = `Artwork for ${row.title} by ${row.artist}`;
        image.loading = "lazy"; image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => { image.hidden = true; placeholder.hidden = false; });
        article.append(image);
      }
      article.append(element("small", "Published release"), element("h3", row.title), element("p", row.artist));
      if (row.pitch) article.append(element("p", row.pitch));
      const actions = element("div"); actions.className = "ac-showcase-actions";
      const preview = element("button", row.audio ? "Preview track" : "Preview unavailable");
      preview.type = "button"; preview.disabled = !row.audio;
      preview.setAttribute("aria-label", `Preview ${row.title} by ${row.artist}`);
      preview.addEventListener("click", () => play(row));
      const shop = element("a", "View release & artwork");
      shop.href = `/music/?song=${encodeURIComponent(row.id)}`;
      actions.append(preview, shop); article.append(actions); return article;
    }));
  }
  async function refreshCatalog() {
    const current = ++catalogRevision;
    catalogRequest?.abort();
    catalogRequest = new AbortController();
    stop(); catalog = []; releases.replaceChildren(); selector.disabled = true;
    selector.replaceChildren(element("option", "Loading catalog..."));
    status.textContent = "Loading the public release catalog...";
    try {
      const response = await fetch("/api/release-catalog", {
        headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store",
        signal: AbortSignal.any([catalogRequest.signal, AbortSignal.timeout(12000)])
      });
      if (!response.ok) throw new Error("Catalog unavailable");
      const rows = showcaseReleases(await response.json());
      if (current !== catalogRevision) return;
      catalog = rows;
      const all = element("option", "Showcase: first four public releases"); all.value = "";
      selector.replaceChildren(all, ...catalog.map(row => {
        const option = element("option", `${row.title} - ${row.artist}`); option.value = row.id; return option;
      }));
      selector.value = ""; selector.disabled = !catalog.length;
      renderReleases();
      status.textContent = catalog.length ? `${catalog.length} published releases loaded. Showing up to four; choose any release above. This is a catalog snapshot, not a live chart.`
        : "No public releases are available yet. Start an album concept below or visit the Music shop.";
    } catch {
      if (current !== catalogRevision) return;
      status.textContent = "Could not load the release catalog. Use Refresh workspace to retry; no online or ranking status is assumed.";
      selector.replaceChildren(element("option", "Catalog unavailable"));
    }
  }
  function resetConcepts() {
    conceptRevision++;
    conceptRequest?.abort();
    concepts.replaceChildren();
    conceptStatus.textContent = "Sign in to view your own saved album concepts.";
    stop();
  }
  async function refreshConcepts() {
    resetConcepts();
    const current = conceptRevision;
    conceptRequest = new AbortController();
    conceptStatus.textContent = "Loading your private concept vault...";
    try {
      const response = await fetch("/api/album-concierge", {
        credentials: "same-origin", cache: "no-store",
        signal: AbortSignal.any([conceptRequest.signal, AbortSignal.timeout(12000)])
      });
      if (current !== conceptRevision) return;
      if (response.status === 401) { conceptStatus.textContent = "Sign in to view your own saved album concepts."; return; }
      if (!response.ok) throw new Error("Concepts unavailable");
      const data = await response.json();
      if (!Array.isArray(data?.sessions) || data.sessions.length > 20) throw new Error("Invalid concept response");
      if (current !== conceptRevision) return;
      const sessions = data.sessions.slice(0, 4);
      concepts.replaceChildren(...sessions.map(session => {
        if (typeof session.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.id)) throw new Error("Invalid concept");
        const article = element("article");
        const title = typeof session.generatedTitles?.[0] === "string" ? session.generatedTitles[0] : "Untitled album concept";
        article.append(element("small", `Private concept / ${typeof session.status === "string" ? session.status : "saved"}`),
          element("h3", title), element("p", typeof session.generatedTheme === "string" ? session.generatedTheme.slice(0, 300) : "Your personal creative session."));
        if (session.status === "ready") {
          const open = element("a", "Open saved concept");
          open.href = `/album-concierge/?session=${encodeURIComponent(session.id)}`;
          const actions = element("div"); actions.className = "ac-showcase-actions"; actions.append(open); article.append(actions);
        } else article.append(element("p", "This concept is not ready to open as a generated result. Start a new idea below."));
        return article;
      }));
      conceptStatus.textContent = sessions.length ? `Your latest ${sessions.length} saved concepts. Ideas only - not catalog recordings or purchased albums.`
        : "Your concept vault is empty. Start with your story below to create your first idea.";
    } catch {
      if (current !== conceptRevision) return;
      concepts.replaceChildren();
      conceptStatus.textContent = "Could not load your concept vault. Refresh to retry; saved concepts have not been deleted.";
    }
  }
  selector.addEventListener("change", () => { stop(); renderReleases(); });
  root.querySelector("[data-showcase-stop]").addEventListener("click", stop);
  root.querySelector("[data-showcase-refresh]").addEventListener("click", () => Promise.all([refreshCatalog(), refreshConcepts()]));
  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src")) return;
    stop(); playerStatus.textContent = "Audio unavailable. Use View release & artwork for other listening options.";
  });
  audio.addEventListener("ended", () => { if (audio.getAttribute("src")) playerStatus.textContent = "Preview finished. No points or verified streams recorded."; });
  audio.addEventListener("pause", () => { if (audio.getAttribute("src") && !audio.ended) playerStatus.textContent = "Preview paused."; });
  audio.addEventListener("playing", () => { if (audio.getAttribute("src")) playerStatus.textContent = "Public preview playing. Artist credits appear on the release card."; });
  return { refreshCatalog, refreshConcepts, resetConcepts, stop };
}

if (typeof document !== "undefined") {
  const root = document.querySelector("[data-concierge-showcase]");
  if (root) {
    const desk = createConciergeShowcase(root);
    desk.refreshCatalog();
    let connected = false;
    const connect = identity => {
      if (!identity || connected) return;
      connected = true;
      desk.refreshConcepts();
      identity.onAuthChange(() => { desk.resetConcepts(); desk.refreshConcepts(); });
    };
    window.addEventListener("halo-identity-ready", event => connect(event.detail));
    connect(window.haloIdentity);
    window.addEventListener("pagehide", () => { desk.resetConcepts(); desk.stop(); });
  }
}
