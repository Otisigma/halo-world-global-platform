import { DISCOVERY_THEMES, publishedDiscoveryReleases, releasesForTheme, discoveryPlaylistPath,
  discoveryDreamweaverPath, nativeDiscoveryVideo } from "./lib/video-discovery.js";
import { DEFAULT_CINEMA_LOOP } from "./lib/dreamweaver-cinema.js";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const posterFallback = "/assets/releases/halo-premium-placeholder.svg";
function safePoster(value) {
  try {
    const url = new URL(value, location.origin);
    return typeof value === "string" && value.trim() && ["http:", "https:"].includes(url.protocol)
      && !url.username && !url.password ? url.href : posterFallback;
  } catch { return posterFallback; }
}
function track(event, metadata) {
  if (navigator.globalPrivacyControl || navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
  window.haloStats?.track(event, metadata);
}

class HaloVideoDiscovery extends HTMLElement {
  connectedCallback() {
    this.controller = new AbortController();
    this.motion = matchMedia("(prefers-reduced-motion: reduce)");
    this.queue = [];
    this.queueIndex = -1;
    this.queueActive = false;
    this.innerHTML = '<section class="video-discovery"><p role="status">Loading the video discovery loop...</p></section>';
    this.load();
  }

  disconnectedCallback() {
    this.controller.abort();
    this.renderController?.abort();
    this.stopPreview();
    this.stopQueue();
    this.player?.audio.removeEventListener("ended", this.onEnded);
    this.player = null;
    this.safeSpaceObserver?.disconnect();
  }

  async load() {
    const controller = this.controller;
    try {
      const response = await fetch("/api/release-catalog", { headers: { Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error("The published catalog is unavailable.");
      const data = await response.json();
      if (!Array.isArray(data.releases)) throw new Error("The published catalog response is invalid.");
      if (controller.signal.aborted) return;
      this.releases = publishedDiscoveryReleases(data.releases);
      this.render();
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("Video discovery could not load:", error.message);
      this.innerHTML = '<section class="video-discovery"><h2>Keep discovering</h2><p role="status">Video discovery is unavailable right now. Existing song playback is unchanged.</p><button type="button">Retry discovery</button><a href="/music/">Open the music catalog</a></section>';
      this.querySelector("button").addEventListener("click", () => this.load(), { signal: this.controller.signal });
    }
  }

  render() {
    this.renderController?.abort();
    this.renderController = new AbortController();
    const signal = this.renderController.signal;
    this.safeSpaceObserver?.disconnect();
    this.stopPreview();
    this.stopQueue();
    this.player?.audio.removeEventListener("ended", this.onEnded);
    this.player = null;
    const params = new URLSearchParams(location.search);
    this.themeId = DISCOVERY_THEMES.some(theme => theme.id === params.get("playlist")) ? params.get("playlist") : "";
    const requested = params.get("song") || (this.getAttribute("surface") === "dreamweaver" ? params.get("mix") || "" : "");
    let featuredId = "";
    const config = document.getElementById("haloFeaturedReleaseConfig");
    if (config) {
      try { featuredId = JSON.parse(config.textContent).id || ""; }
      catch { console.warn("Video discovery featured configuration is invalid."); }
    }
    const release = requested ? this.releases.find(item => item.id === requested
      || item.catalog?.songId === requested || item.dreamweaverPayload?.songId === requested)
      : this.releases.find(item => item.id === featuredId) || releasesForTheme(this.releases, this.themeId)[0];
    const theme = DISCOVERY_THEMES.find(item => item.id === this.themeId);
    this.queue = releasesForTheme(this.releases, this.themeId)
      .map(item => ({ ...item, audioUrl: window.HaloCatalogPlaybackSources?.trackStreamUrl(item) || "" }))
      .filter(item => window.HaloFeaturedPlayer?.isStreamableAudioUrl(item.audioUrl));
    if (requested) this.queue.sort((a, b) => Number(b.id === requested) - Number(a.id === requested));
    const matchingTheme = DISCOVERY_THEMES.find(item => releasesForTheme([release], item.id).length);
    const playlist = discoveryPlaylistPath(matchingTheme?.id || "", release?.id || "");
    const native = release && nativeDiscoveryVideo(release, location.origin);
    const video = native || DEFAULT_CINEMA_LOOP.url;
    const listening = this.getAttribute("surface") === "music";
    this.innerHTML = `<section class="video-discovery" aria-label="Video discovery loop">
      <header><p class="video-discovery__kicker">Watch a glimpse. Enter the song. Stay for the journey.</p>
        <h2>${escapeHtml(theme?.title || "One video. A whole world to discover.")}</h2>
        <p>Short silent visuals lead into Dreamweaver and themed listening. Your song's master stays untouched.</p></header>
      ${release ? `<div class="video-discovery__feature">
        <div class="video-discovery__visual">
          <video preload="none" muted playsinline poster="${escapeHtml(safePoster(release.artwork))}" data-source="${escapeHtml(video)}" aria-label="${escapeHtml(release.title)} silent visual preview"></video>
          <span class="video-discovery__caption">${escapeHtml(release.title)}<small>${native ? "Release footage" : "HALO visual backdrop · not an official music video"}</small></span>
        </div>
        <div><h3>${escapeHtml(release.title)}</h3><p>${escapeHtml(release.artist)}</p>
          <button type="button" data-preview ${this.motion.matches ? "disabled" : ""}>Preview 8 seconds · silent</button>
          <a href="${escapeHtml(discoveryDreamweaverPath(release))}" data-discovery="dreamweaver" data-track="${escapeHtml(release.id)}">Enter this song in Dreamweaver</a>
          <a href="${escapeHtml(playlist)}" data-discovery="playlist" data-track="${escapeHtml(release.id)}">Keep listening in a themed playlist</a>
          <p role="status" data-preview-status>${this.motion.matches ? "Reduced motion is on. Artwork remains available." : "Video loads only when you press Preview."}</p>
        </div></div>` : '<p role="status">No published release is available for this song. Open a playlist below to discover other releases.</p>'}
      <nav class="video-discovery__themes" aria-label="Themed listening playlists">
        ${DISCOVERY_THEMES.map(item => `<a href="${escapeHtml(discoveryPlaylistPath(item.id))}" data-discovery="playlist" data-theme="${item.id}" ${this.themeId === item.id ? 'aria-current="page"' : ""}><strong>${escapeHtml(item.title)}</strong><span>${releasesForTheme(this.releases, item.id).length} published releases</span></a>`).join("")}
      </nav>
      ${listening ? `<div class="video-discovery__sequence"><h3>${escapeHtml(theme?.title || "Published listening sequence")}</h3>
        <p>Press a track to start. The next available song follows in the shared player; the sequence stops at the end.</p>
        <ol>${this.queue.map((item, index) => `<li><button type="button" data-queue-index="${index}">Play ${escapeHtml(item.title)} · ${escapeHtml(item.artist)}</button><a href="${escapeHtml(discoveryDreamweaverPath(item))}" data-discovery="dreamweaver" data-track="${escapeHtml(item.id)}">Enter Dreamweaver</a></li>`).join("")}</ol>
        <p role="status" data-queue-status>${this.queue.length ? "No audio starts until you press Play." : "No playable releases match this theme yet. Choose another playlist."}</p>
        <button type="button" data-stop-queue ${this.queue.length ? "" : "disabled"}>Stop playlist continuation</button>
      </div>` : ""}
      <a href="/halo" data-discovery="hub">Return to the Hub</a>
    </section>`;
    this.video = this.querySelector("video");
    this.previewButton = this.querySelector("[data-preview]");
    this.previewButton?.addEventListener("click", () => this.preview(), { signal });
    this.video?.addEventListener("error", () => {
      this.stopPreview();
      this.querySelector("[data-preview-status]").textContent = "Video unavailable. The artwork and song links remain available.";
    }, { signal });
    this.video?.addEventListener("playing", () => {
      clearTimeout(this.previewTimer);
      this.previewTimer = setTimeout(() => this.stopPreview(), 8000);
    }, { signal });
    this.querySelector("video")?.addEventListener("ended", () => this.stopPreview(), { signal });
    const stopForMotion = () => {
      const blocked = this.motion.matches || document.documentElement.classList.contains("halo-safe-space-mode");
      if (blocked) this.stopPreview();
      if (this.previewButton) this.previewButton.disabled = blocked;
    };
    this.motion.addEventListener("change", stopForMotion, { signal });
    this.safeSpaceObserver = new MutationObserver(stopForMotion);
    this.safeSpaceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    stopForMotion();
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.stopPreview(); }, { signal });
    this.addEventListener("click", event => {
      const link = event.target.closest("[data-discovery]");
      if (link) {
        this.stopPreview();
        track("video_discovery_navigation", { destination: link.dataset.discovery, track: link.dataset.track || "", variant: link.dataset.theme || this.themeId, source_type: this.getAttribute("surface") });
      }
      const button = event.target.closest("[data-queue-index]");
      if (button) this.playTrack(Number(button.dataset.queueIndex), false);
    }, { signal });
    this.querySelector("[data-stop-queue]")?.addEventListener("click", () => {
      this.stopQueue();
      this.querySelector("[data-queue-status]").textContent = "Playlist continuation stopped. The current song remains under your player controls.";
    }, { signal });
    window.addEventListener("halo:chart-queue-start", () => this.stopQueue(), { signal });
    document.addEventListener("click", event => {
      if (!this.contains(event.target) && event.target.closest("[data-play-track-id]")) this.stopQueue();
    }, { signal });
  }

  stopPreview() {
    clearTimeout(this.previewTimer);
    this.previewActive = false;
    this.previewEpoch = (this.previewEpoch || 0) + 1;
    this.video?.pause();
    if (this.previewButton) this.previewButton.textContent = "Preview 8 seconds · silent";
    const status = this.querySelector("[data-preview-status]");
    if (status) status.textContent = this.motion.matches
      ? "Reduced motion is on. Artwork remains available." : "Preview stopped. Enter the song or choose a playlist.";
  }

  async preview() {
    if (this.motion.matches || document.hidden || document.documentElement.classList.contains("halo-safe-space-mode")) return;
    if (this.previewActive) { this.previewActive = false; this.stopPreview(); return; }
    this.stopPreview();
    const epoch = this.previewEpoch;
    const controller = this.controller;
    this.previewActive = true;
    this.video.muted = true;
    this.video.src = this.video.dataset.source;
    this.previewButton.textContent = "Stop preview";
    try {
      await this.video.play();
      if (controller.signal.aborted || epoch !== this.previewEpoch || this.motion.matches || document.hidden
        || document.documentElement.classList.contains("halo-safe-space-mode")) {
        this.stopPreview();
        return;
      }
      this.querySelector("[data-preview-status]").textContent = "Silent preview playing. Press Enter this song for the music.";
      track("video_discovery_preview", { track: this.querySelector("[data-track]").dataset.track, source_type: this.getAttribute("surface") });
    } catch (error) {
      if (controller.signal.aborted || epoch !== this.previewEpoch) return;
      this.stopPreview();
      this.querySelector("[data-preview-status]").textContent = "Preview could not play. The artwork and song links remain available.";
      console.warn("Video discovery preview failed:", error.name);
    }
  }

  stopQueue() { this.queueActive = false; }

  playTrack(index, continuation) {
    const player = window.HaloPlayer;
    const release = this.queue[index];
    const status = this.querySelector("[data-queue-status]");
    if (!player?.audio || typeof player.play !== "function" || !release) {
      if (status) status.textContent = "The shared player is unavailable. Try again or enter Dreamweaver.";
      return;
    }
    if (!continuation) {
      window.dispatchEvent(new CustomEvent("halo:discovery-queue-start"));
      this.stopPreview();
    }
    if (!this.player) {
      this.player = player;
      this.onEnded = () => {
        if (!this.queueActive || player.track?.id !== this.queue[this.queueIndex]?.id) { this.stopQueue(); return; }
        const next = this.queueIndex + 1;
        if (next >= this.queue.length) {
          this.stopQueue();
          status.textContent = "Playlist complete. Choose another mood or return to the Hub.";
          return;
        }
        this.playTrack(next, true);
      };
      player.audio.addEventListener("ended", this.onEnded);
    }
    this.queueIndex = index;
    this.queueActive = true;
    player.play({ id: release.id, title: release.title, artist: release.artist, src: release.audioUrl, cover: safePoster(release.artwork) });
    status.textContent = `Queued ${release.title}. Playback status is shown in the shared player.`;
    track(continuation ? "video_discovery_continuation" : "video_discovery_playlist_start",
      { track: release.id, variant: this.themeId || "all", source_type: "music" });
  }
}

customElements.define("halo-video-discovery", HaloVideoDiscovery);
