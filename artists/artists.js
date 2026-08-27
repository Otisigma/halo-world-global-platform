(() => {
  const state = {
    page: null,
    canEdit: false,
    radioSubmission: null,
    releaseAudioVersions: [],
    videos: [],
    mixes: [],
    user: null,
    identity: null,
    authMode: "login",
    pendingStudio: false,
    scoutStarted: false,
    connections: {
      authenticated: false,
      following: false,
      followerCount: 0,
      activity: [],
      recentPlays: [],
      upcomingShows: []
    }
  };
  const uploadHelper = window.HaloUploadProgress;

  const elements = {
    page: document.getElementById("artistPage"),
    upload: document.getElementById("uploadButton"),
    share: document.getElementById("shareButton"),
    studio: document.getElementById("studioDialog"),
    studioForm: document.getElementById("studioForm"),
    studioMessage: document.getElementById("studioMessage"),
    publish: document.getElementById("publishButton"),
    sourceLink: document.getElementById("sourceLink"),
    scout: document.getElementById("scoutButton"),
    scoutStatus: document.getElementById("scoutStatus"),
    scoutSources: document.getElementById("scoutSources"),
    catalogPreview: document.getElementById("catalogPreview"),
    radioSend: document.getElementById("radioSendDialog"),
    radioSendForm: document.getElementById("radioSendForm"),
    radioSendMessage: document.getElementById("radioSendMessage"),
    radioUploadProgress: document.getElementById("radioUploadProgress"),
    auth: document.getElementById("authDialog"),
    authForm: document.getElementById("authForm"),
    authNameField: document.getElementById("authNameField"),
    authName: document.getElementById("authName"),
    authEmail: document.getElementById("authEmail"),
    authPassword: document.getElementById("authPassword"),
    authMessage: document.getElementById("authMessage"),
    authSubmit: document.getElementById("authSubmit"),
    toast: document.getElementById("toast")
  };
  const radioUploadUi = uploadHelper.createUploadUi({ panel: elements.radioSendForm, status: elements.radioSendMessage, track: elements.radioUploadProgress, fill: elements.radioUploadProgress?.querySelector("span"), idleMessage: "Choose a stored version or upload a broadcast-ready audio file." });

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function currentSlug() {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts[1] && parts[1] !== "index.html" ? decodeURIComponent(parts[1]).toLowerCase() : "owen-anthony";
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => elements.toast.classList.remove("visible"), 3200);
  }

  function formatDate(value) {
    if (!value) return "Available now";
    const date = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return "Available now";
    return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  }

  function safePreviewUrl(value, fallback = "/assets/halo-app-icon-512.png") {
    try {
      const url = new URL(value, location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : fallback;
    } catch {
      return fallback;
    }
  }

  function wireArtworkFallbacks(root = document) {
    root.querySelectorAll("img[data-artwork-fallback]").forEach(image => {
      if (image.dataset.fallbackReady === "true") return;
      image.dataset.fallbackReady = "true";
      const frame = image.closest("[data-artwork-frame]");
      const recover = () => {
        const fallback = image.dataset.artworkFallback;
        if (fallback && image.getAttribute("src") !== fallback) {
          frame?.classList.add("artwork-recovered");
          image.src = fallback;
          return;
        }
        frame?.classList.add("artwork-missing");
        image.hidden = true;
      };
      image.addEventListener("load", () => frame?.classList.remove("artwork-missing"));
      image.addEventListener("error", recover);
      if (image.complete && image.naturalWidth === 0) recover();
    });
  }

  function videoEmbed(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      let id = "";
      if (parsed.hostname === "youtu.be") id = parsed.pathname.slice(1).split("/")[0];
      if (parsed.hostname.endsWith("youtube.com")) {
        id = parsed.searchParams.get("v") || parsed.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1] || "";
      }
      if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
      if (parsed.hostname.endsWith("vimeo.com")) {
        id = parsed.pathname.split("/").filter(Boolean).find(part => /^\d+$/.test(part)) || "";
        if (id) return `https://player.vimeo.com/video/${id}`;
      }
    } catch {}
    return "";
  }

  function linkAttributes(url) {
    try {
      return new URL(url, location.origin).origin === location.origin ? "" : ' target="_blank" rel="noopener"';
    } catch {
      return "";
    }
  }

  function platformLabel(url) {
    try {
      const hostname = new URL(url, location.origin).hostname;
      if (hostname.includes("spotify.com")) return "Play on Spotify";
      if (hostname.includes("music.apple.com")) return "Play on Apple Music";
      if (hostname.includes("youtube.com") || hostname === "youtu.be") return "Watch on YouTube";
    } catch {}
    return "Open artist link";
  }

  function roomCard(label, title, copy, url, className, eventName) {
    if (!url) return "";
    const destination = url === "/#community" ? "/#clubhouse" : url;
    return `<a class="room-card ${className}" href="${escapeHtml(destination)}"${linkAttributes(destination)} data-stat-event="${eventName}" data-stat-target="${escapeHtml(state.page.slug)}">
      <span class="room-label">${label}</span>
      <strong>${title}</strong>
      <p>${copy}</p>
      <i aria-hidden="true">↗</i>
    </a>`;
  }

  function formatMoment(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Soon";
    return date.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function connectionMarkup() {
    const connections = state.connections;
    const shows = connections.upcomingShows.slice(0, 3).map(show => `
      <a class="artist-signal-item" href="/radio/#schedule">
        <span>${escapeHtml(show.room)} room / ${escapeHtml(formatMoment(show.startsAt))}</span>
        <strong>${escapeHtml(show.title)}</strong>
        <small>${escapeHtml(show.hostName || "HALO Radio Team")}</small>
        <i>↗</i>
      </a>`).join("");
    const plays = connections.recentPlays.slice(0, 4).map(play => `
      <article class="artist-spin-item">
        <span>${escapeHtml(play.room)} room</span>
        <strong>${escapeHtml(play.title)}</strong>
        <small>${escapeHtml(formatMoment(play.startedAt))}</small>
      </article>`).join("");
    const activity = connections.activity.slice(0, 5).map(item => {
      const body = `<span>${escapeHtml(item.kind)}${item.startsAt ? ` / ${escapeHtml(formatMoment(item.startsAt))}` : ""}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.description)}</p><i>↗</i>`;
      return item.url
        ? `<a class="artist-activity-item" href="${escapeHtml(item.url)}"${linkAttributes(item.url)}>${body}</a>`
        : `<article class="artist-activity-item">${body}</article>`;
    }).join("");
    return `
      <section class="artist-connections" id="artistSignal">
        <header>
              <div><p class="section-code">04 / Stay connected</p><h2>From one listen<br><em>to the next moment.</em></h2></div>
          <div class="artist-follow-block">
            <span>${connections.followerCount} ${connections.followerCount === 1 ? "HALO follower" : "HALO followers"}</span>
            <button class="artist-follow-button ${connections.following ? "active" : ""}" id="followArtistButton" type="button">${connections.following ? "Following this artist" : "Follow this artist"}<i>+</i></button>
            <small>Follow for radio appearances, releases, stories, replays, and community moments inside HALO.</small>
          </div>
        </header>
        <div class="artist-connection-grid">
          <div class="artist-signal-column"><p class="connection-label">Upcoming radio</p>${shows || `<p class="connection-empty">The next artist broadcast appears here when it joins the programme grid.</p>`}</div>
          <div class="artist-signal-column"><p class="connection-label">Recent station plays</p><div class="artist-spin-grid">${plays || `<p class="connection-empty">Verified HALO Radio spins build this artist history.</p>`}</div></div>
          <div class="artist-signal-column activity-column"><p class="connection-label">Stories, events + replays</p>${activity || `<p class="connection-empty">Magazine stories, live moments, and replays connect here.</p>`}</div>
        </div>
      </section>`;
  }

  function radioCardMarkup() {
    const submission = state.radioSubmission;
    if (!state.canEdit && submission?.status !== "rotation") return "";
    if (!state.canEdit) {
      return `<a class="radio-card-signal is-rotation" href="/radio/#preview" data-stat-event="artist_radio_rotation_open" data-stat-target="${escapeHtml(state.page.slug)}"><span>On HALO Radio</span><strong>${escapeHtml(submission.title)}</strong><small>${escapeHtml(submission.room)} room rotation</small><i aria-hidden="true">↗</i></a>`;
    }
    const stage = String(state.page.releaseStage || "release").replace(/_/g, " ");
    const statusLabels = {
      rotation: "In station rotation",
      held: "Held for a later programme",
      rejected: "Station review complete",
      preview: submission?.reviewedAt ? "Kept in community preview" : "In community preview"
    };
    const status = submission?.hasUnreadUpdate ? "New station update" : submission ? statusLabels[submission.status] || "Station review updated" : `${stage} · ready for review`;
    const action = submission?.hasUnreadUpdate ? "Read the station decision" : submission ? "Send another version" : "Send to HALO Radio";
    const storedVersions = state.releaseAudioVersions.length;
    const detail = submission?.artistMessage || (submission ? `${submission.title} · ${submission.room} room` : storedVersions ? `${storedVersions} linked audio ${storedVersions === 1 ? "version" : "versions"} ready` : "Upload audio and confirm the rights");
    return `<button class="radio-card-signal ${submission ? `is-${escapeHtml(submission.status)}` : ""} ${submission?.hasUnreadUpdate ? "is-unread" : ""}" id="sendToRadioButton" type="button" data-stat-event="artist_radio_submit_open" data-stat-target="${escapeHtml(state.page.slug)}"><span>${escapeHtml(status)}</span><strong>${escapeHtml(action)}</strong><small>${escapeHtml(detail)}</small><i aria-hidden="true">↗</i></button>`;
  }

  function frequencyRoute({ label, title, copy, url, className = "", eventName = "" }) {
    const content = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p><i aria-hidden="true">↗</i>`;
    if (!url) return `<article class="frequency-route is-muted ${className}">${content}</article>`;
    return `<a class="frequency-route ${className}" href="${escapeHtml(url)}"${linkAttributes(url)} data-stat-event="${escapeHtml(eventName)}" data-stat-target="${escapeHtml(state.page.slug)}">${content}</a>`;
  }

  function frequencyMarkup() {
    const page = state.page;
    const submission = state.radioSubmission;
    const plays = state.connections.recentPlays || [];
    const shows = state.connections.upcomingShows || [];
    const releaseKitBase = page.releaseId ? `/release-kit.html?slug=${encodeURIComponent(page.releaseId)}` : "";
    const djRoute = page.djRoomUrl || (releaseKitBase ? `${releaseKitBase}&audience=dj` : "");
    const radioRoute = page.radioRoomUrl || (releaseKitBase ? `${releaseKitBase}&audience=radio` : "");
    const pressRoute = page.pressRoomUrl || (releaseKitBase ? `${releaseKitBase}&audience=press` : "");
    const radioStatus = submission?.hasUnreadUpdate
      ? "Station update waiting"
      : submission?.status === "rotation"
        ? "In HALO Radio rotation"
        : submission
          ? `${String(submission.status || "preview").replace(/_/g, " ")} / station review`
          : "Ready for station review";
    const latestPlay = plays[0];
    const releaseStage = String(page.releaseStage || "release").replace(/_/g, " ");
    const versionCount = state.releaseAudioVersions.length;
    const frequencyAction = state.canEdit
      ? `<button class="frequency-radio-action" id="frequencyRadioButton" type="button"><span>${submission ? "Update the station delivery" : "Put this work on the frequency"}</span><i aria-hidden="true">↗</i></button>`
      : radioRoute
        ? `<a class="frequency-radio-action" href="${escapeHtml(radioRoute)}"${linkAttributes(radioRoute)} data-stat-event="artist_radio_room_open" data-stat-target="${escapeHtml(page.slug)}"><span>Open the radio service</span><i aria-hidden="true">↗</i></a>`
        : `<a class="frequency-radio-action" href="/radio/#preview" data-stat-event="artist_radio_preview_open" data-stat-target="${escapeHtml(page.slug)}"><span>Hear the HALO frequency</span><i aria-hidden="true">↗</i></a>`;

    return `
      <section class="frequency-desk" id="frequencyDesk">
        <div class="frequency-heading">
          <p class="section-code">03 / Promotion + airplay</p>
          <h2>PUT YOUR WORK<br><em>ON THE FREQUENCY.</em></h2>
          <p>One release signal for listeners, DJs, radio programmers, press, and the people carrying the record forward.</p>
        </div>
        <div class="frequency-console">
          <div class="frequency-status">
            <div class="frequency-status-topline"><span>HALO transmission desk</span><b>${escapeHtml(releaseStage)}</b></div>
            <div class="frequency-wave" aria-hidden="true">${Array.from({ length: 26 }, (_, index) => `<i style="--wave:${(index * 7) % 13};--delay:${index}"></i>`).join("")}</div>
            <div class="frequency-record">
              <span>Current transmission</span>
              <strong>${escapeHtml(page.releaseTitle || page.artistName)}</strong>
              <small>${escapeHtml(page.artistName)} / ${formatDate(page.releaseDate)}</small>
            </div>
            ${frequencyAction}
          </div>
          <div class="frequency-routes" aria-label="Promotion routes">
            ${frequencyRoute({ label: "01 / DJ delivery", title: "Give selectors the right version.", copy: djRoute ? "Approved audio, release context, and a direct path to report support." : "Add a DJ room or publish the release campaign to open this route.", url: djRoute, className: "is-dj", eventName: "artist_dj_delivery_open" })}
            ${frequencyRoute({ label: "02 / Radio service", title: radioStatus, copy: submission?.artistMessage || (versionCount ? `${versionCount} Track Vault ${versionCount === 1 ? "version is" : "versions are"} linked to this release.` : "Broadcast-ready audio, rights confirmation, and the artist's own station status."), url: state.canEdit ? "" : radioRoute, className: "is-radio", eventName: "artist_radio_delivery_open" })}
            ${frequencyRoute({ label: "03 / Press + promotion", title: "Carry the story with the record.", copy: pressRoute ? "Campaign-ready artwork, credits, narrative, and official release details." : "Add a press room or publish the release campaign to complete the promotion route.", url: pressRoute, className: "is-press", eventName: "artist_press_delivery_open" })}
          </div>
          <aside class="frequency-intelligence" aria-label="Radio and DJ intelligence">
            <div class="frequency-intelligence-heading"><span>Live intelligence</span><strong>DJ / RADIO</strong></div>
            <dl>
              <div><dt>Verified station plays</dt><dd>${plays.length}</dd></div>
              <div><dt>Upcoming broadcasts</dt><dd>${shows.length}</dd></div>
              <div><dt>Audio versions ready</dt><dd>${versionCount}</dd></div>
            </dl>
            <div class="frequency-latest">
              <span>${latestPlay ? "Latest verified play" : "Airplay history"}</span>
              <strong>${escapeHtml(latestPlay?.title || "The first spin starts here.")}</strong>
              <p>${latestPlay ? `${escapeHtml(latestPlay.room)} room / ${escapeHtml(formatMoment(latestPlay.startedAt))}` : "Every confirmed HALO Radio play returns to this artist page as permanent signal."}</p>
            </div>
            <a class="frequency-intelligence-link" href="#artistSignal">See the full artist signal <i aria-hidden="true">↓</i></a>
          </aside>
        </div>
      </section>`;
  }

  function mixEditionMarkup() {
    const mixes = state.mixes || [];
    if (!mixes.length) return "";
    return `<section class="artist-mixes" id="mixEditions">
      <header><div><p class="section-code">05 / Remix editions</p><h2>THE VERSIONS<br><em>LIVE HERE.</em></h2></div><a href="/mixes/#upload">Upload a new mix ↗</a></header>
      <div class="artist-mix-grid">${mixes.map(mix => {
        const status = !mix.clientSaleEnabled ? "Stream only" : mix.salesStatus === "ready" ? "Edition available" : mix.salesStatus === "mastering" ? "HALO mixing package" : "Rights review";
        return `<a class="artist-mix-card" href="${escapeHtml(mix.salesPageUrl)}" data-stat-event="artist_mix_open" data-stat-target="${escapeHtml(mix.id)}">
          <span class="artist-mix-art"><img src="${escapeHtml(mix.artworkUrl)}" alt="${escapeHtml(`${mix.title} artwork`)}" loading="lazy"></span>
          <span class="artist-mix-status">${escapeHtml(status)}</span>
          <strong>${escapeHtml(mix.title)}</strong>
          <small>${escapeHtml(mix.originalArtist)} · Remix by ${escapeHtml(mix.remixerName)}</small>
          <i aria-hidden="true">↗</i>
        </a>`;
      }).join("")}</div>
    </section>`;
  }

  function renderPage() {
    const page = state.page;
    document.title = `${page.artistName} — HALO Artist Room`;
    document.documentElement.style.setProperty("--artist-accent", page.accentColor || "#d5ff52");
    const teamLink = document.getElementById("teamLink");
    if (teamLink) {
      teamLink.hidden = !state.canEdit;
      teamLink.href = `/artist-team.html?slug=${encodeURIComponent(page.slug)}`;
    }
    const embed = videoEmbed(page.videoUrl);
    const artwork = page.artworkUrl || "/assets/halo-app-icon-512.png";
    const featuredUrl = page.websiteUrl && page.websiteUrl !== page.releaseUrl ? page.websiteUrl : "";
    const editChip = state.canEdit ? `<button class="edit-chip" id="editPageButton" type="button">Edit this room</button>` : "";
    const attachedVideos = state.videos || [];
    const featuredVideo = attachedVideos.find(video => video.featured) || attachedVideos[0];
    const videoStage = featuredVideo
      ? featuredVideo.sourceType === "youtube"
        ? `<div class="video-frame"><iframe src="${escapeHtml(featuredVideo.embedUrl)}" title="${escapeHtml(featuredVideo.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`
        : `<div class="video-frame"><video src="${escapeHtml(featuredVideo.sourceUrl)}"${featuredVideo.thumbnailUrl ? ` poster="${escapeHtml(featuredVideo.thumbnailUrl)}"` : ""} title="${escapeHtml(featuredVideo.title)}" controls playsinline preload="metadata"></video></div>`
      : page.videoUrl
      ? embed
        ? `<div class="video-frame"><iframe src="${embed}" title="${escapeHtml(page.videoTitle || `${page.artistName} music video`)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`
        : `<a class="video-external" href="${escapeHtml(page.videoUrl)}" target="_blank" rel="noopener" data-stat-event="artist_video_open" data-stat-target="${escapeHtml(page.slug)}"><span>Open the visual</span><strong>${escapeHtml(page.videoTitle || "Official music video")}</strong><i aria-hidden="true">↗</i></a>`
      : `<div class="video-empty"><span class="empty-play" aria-hidden="true">▶</span><div><p>Visual room</p><strong>The screen is ready.</strong><span>${state.canEdit ? "Add a YouTube or Vimeo link in Hyper Upload." : "The next official visual lands here."}</span></div></div>`;
    const videoGallery = attachedVideos.length > 1
      ? `<div class="artist-video-gallery">${attachedVideos.map(video => `<button class="artist-video-card" type="button" data-video-id="${escapeHtml(video.id)}" data-video-type="${escapeHtml(video.sourceType)}" data-video-source="${escapeHtml(video.sourceType === "youtube" ? video.embedUrl : video.sourceUrl)}" data-video-title="${escapeHtml(video.title)}" data-video-poster="${escapeHtml(video.thumbnailUrl)}"><span class="artist-video-thumb">${video.thumbnailUrl ? `<img src="${escapeHtml(video.thumbnailUrl)}" alt="">` : `<i aria-hidden="true">▶</i>`}</span><strong>${escapeHtml(video.title)}</strong><small>${video.sourceType === "youtube" ? "YouTube / live" : "HALO upload"}${video.sofaVisible ? " · On the sofa" : ""}</small></button>`).join("")}</div>`
      : "";

    elements.page.innerHTML = `
      <section class="artist-hero">
        <div class="hero-copy">
          <div class="hero-meta"><span>Artist room / ${escapeHtml(page.location || "HALO World")}</span>${editChip}</div>
          <h1>${escapeHtml(page.artistName)}</h1>
          <p class="artist-tagline">${escapeHtml(page.tagline || "Music, visuals, and every door forward.")}</p>
          <div class="hero-actions">
            ${page.releaseUrl ? `<a class="primary-action" href="${escapeHtml(page.releaseUrl)}" target="_blank" rel="noopener" data-stat-event="artist_release_open" data-stat-target="${escapeHtml(page.slug)}"><span>Play ${escapeHtml(page.releaseTitle || "latest release")}</span><i aria-hidden="true">↗</i></a>` : ""}
            ${featuredUrl ? `<a class="featured-action" href="${escapeHtml(featuredUrl)}"${linkAttributes(featuredUrl)} data-stat-event="artist_website_open" data-stat-target="${escapeHtml(page.slug)}"><span>${platformLabel(featuredUrl)}</span><i aria-hidden="true">↗</i></a>` : ""}
            <a class="text-action" href="#artistSignal">Follow the signal <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div class="hero-art">
          <div class="art-number">01</div>
          <div class="art-frame" data-artwork-frame>
            <span class="art-fallback" aria-hidden="true"><b>${escapeHtml((page.releaseTitle || page.artistName).slice(0, 1))}</b><small>HALO / permanent cover signal</small></span>
            <img src="${escapeHtml(artwork)}" alt="${escapeHtml(page.releaseTitle || page.artistName)} artwork" data-artwork-fallback="/assets/halo-app-icon-512.png">
          </div>
          <div class="art-caption"><span>Current signal</span><strong>${escapeHtml(page.releaseTitle || page.artistName)}</strong><small>${formatDate(page.releaseDate)}</small></div>
          ${radioCardMarkup()}
        </div>
        <div class="hero-rail" aria-hidden="true"><span>Music</span><span>Visuals</span><span>Rooms</span><span>Contact</span></div>
      </section>

      <section class="artist-statement">
        <p class="section-code">02 / The signal</p>
        <blockquote>“${escapeHtml(page.tagline || "The music is only the beginning of the relationship.")}”</blockquote>
        <p>${escapeHtml(page.bio || "This artist room brings the complete story into one permanent place.")}</p>
      </section>

      ${frequencyMarkup()}

      ${connectionMarkup()}

      ${mixEditionMarkup()}

      <section class="visual-section" id="visuals">
        <header><div><p class="section-code">06 / Watch</p><h2>${escapeHtml(featuredVideo?.title || page.videoTitle || "The visual room")}</h2></div><span>Full screen / headphones advised</span></header>
        ${videoStage}
        ${videoGallery}
      </section>

      <section class="rooms-section" id="rooms">
        <header><p class="section-code">07 / Choose a door</p><h2>One artist.<br><em>Different reasons to enter.</em></h2></header>
        <div class="room-grid">
          ${roomCard("For listeners", "Join the community", "Follow the story beyond the stream and enter the shared HALO world.", page.communityUrl, "room-community", "artist_community_open")}
          ${roomCard("For selectors", "DJ room", "Open approved music, context, versions, and the next action for the dancefloor.", page.djRoomUrl, "room-dj", "artist_dj_room_open")}
          ${roomCard("For broadcasters", "Radio room", "Find clean details, programming context, service links, and artist information.", page.radioRoomUrl, "room-radio", "artist_radio_room_open")}
          ${roomCard("For storytellers", "Press room", "Access the narrative, credits, artwork, and campaign-ready details.", page.pressRoomUrl, "room-press", "artist_press_room_open")}
        </div>
      </section>

      <section class="contact-section">
        <div><p class="section-code">08 / Build the next thing</p><h2>Bring the artist<br>into the room.</h2></div>
        <div class="contact-actions">
          ${page.bookingUrl ? `<a href="${escapeHtml(page.bookingUrl)}"${linkAttributes(page.bookingUrl)} data-stat-event="artist_booking_open" data-stat-target="${escapeHtml(page.slug)}"><span>Bookings + collaborations</span><i aria-hidden="true">↗</i></a>` : ""}
          ${page.websiteUrl ? `<a href="${escapeHtml(page.websiteUrl)}"${linkAttributes(page.websiteUrl)} data-stat-event="artist_website_open" data-stat-target="${escapeHtml(page.slug)}"><span>Featured artist link</span><i aria-hidden="true">↗</i></a>` : ""}
          <button type="button" id="shareRoomInline"><span>Share this artist room</span><i aria-hidden="true">↗</i></button>
        </div>
      </section>`;

    wireArtworkFallbacks(elements.page);
    document.getElementById("editPageButton")?.addEventListener("click", openStudio);
    document.getElementById("shareRoomInline")?.addEventListener("click", shareRoom);
    document.getElementById("followArtistButton")?.addEventListener("click", toggleArtistFollow);
    document.getElementById("sendToRadioButton")?.addEventListener("click", openRadioSend);
    document.getElementById("frequencyRadioButton")?.addEventListener("click", openRadioSend);
    document.querySelectorAll(".artist-video-card").forEach(card => card.addEventListener("click", () => {
      const frame = document.querySelector(".visual-section .video-frame");
      if (!frame) return;
      frame.innerHTML = card.dataset.videoType === "youtube"
        ? `<iframe src="${escapeHtml(card.dataset.videoSource)}?autoplay=1" title="${escapeHtml(card.dataset.videoTitle)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`
        : `<video src="${escapeHtml(card.dataset.videoSource)}"${card.dataset.videoPoster ? ` poster="${escapeHtml(card.dataset.videoPoster)}"` : ""} title="${escapeHtml(card.dataset.videoTitle)}" controls autoplay playsinline></video>`;
      document.querySelector(".visual-section h2").textContent = card.dataset.videoTitle;
      frame.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  }

  function renderError(message) {
    elements.page.innerHTML = `<section class="error-state"><span>404 / Signal lost</span><h1>This artist room is between transmissions.</h1><p>${escapeHtml(message)}</p><a href="/music/">Open HALO Music ↗</a></section>`;
  }

  async function loadPage(slug = currentSlug()) {
    elements.page.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(`/api/artist-pages?slug=${encodeURIComponent(slug)}`, { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Artist room not found");
      state.page = data.page;
      state.canEdit = Boolean(data.canEdit);
      state.radioSubmission = data.radioSubmission || null;
      state.releaseAudioVersions = Array.isArray(data.releaseAudioVersions) ? data.releaseAudioVersions : [];
      state.videos = Array.isArray(data.videos) ? data.videos : [];
      state.mixes = Array.isArray(data.mixes) ? data.mixes : [];
      try {
        const connectionResponse = await fetch(`/api/artist/connections?slug=${encodeURIComponent(slug)}`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
        if (connectionResponse.ok) state.connections = await connectionResponse.json();
      } catch {}
      renderPage();
    } catch (error) {
      renderError(error.message || "This artist room could not be loaded.");
    } finally {
      elements.page.removeAttribute("aria-busy");
    }
  }

  function openRadioSend() {
    if (!state.canEdit || !state.page) return;
    const artwork = document.getElementById("radioReleaseArtwork");
    artwork.src = state.page.artworkUrl || "/assets/halo-logo-mark.webp";
    artwork.alt = `${state.page.releaseTitle || state.page.artistName} artwork`;
    artwork.dataset.artworkFallback = "/assets/halo-logo-mark.webp";
    wireArtworkFallbacks(elements.radioSend);
    document.getElementById("radioReleaseTitle").textContent = state.page.releaseTitle || "Current release";
    document.getElementById("radioReleaseArtist").textContent = state.page.artistName;
    document.getElementById("radioReleaseStage").textContent = String(state.page.releaseStage || "release").replace(/_/g, " ");
    const versionSelect = elements.radioSendForm.elements.audioVersionId;
    versionSelect.innerHTML = `<option value="">Upload a new version</option>${state.releaseAudioVersions.map(version => `<option value="${escapeHtml(version.id)}">${escapeHtml(version.label)}${version.fileName ? ` · ${escapeHtml(version.fileName)}` : ""}</option>`).join("")}`;
    versionSelect.value = "";
    updateRadioAudioSource();
    const statusMessages = {
      rotation: "is in station rotation",
      held: "is being held for a later programme",
      rejected: "was not selected in this review round",
      preview: state.radioSubmission?.reviewedAt ? "is staying in community preview" : "is in community preview"
    };
    elements.radioSendMessage.textContent = state.radioSubmission
      ? state.radioSubmission.artistMessage || `${state.radioSubmission.title} ${statusMessages[state.radioSubmission.status] || "has a station update"}. You can send a new edit or version here.`
      : state.releaseAudioVersions.length
        ? "Choose a linked Track Vault version or upload a new one for this exact promo card."
        : "Upload the first broadcast-ready version for this exact promo card.";
    elements.radioSend.showModal();
    acknowledgeRadioUpdate();
    versionSelect.focus();
  }

  async function acknowledgeRadioUpdate() {
    if (!state.radioSubmission?.hasUnreadUpdate) return;
    try {
      const response = await fetch("/api/radio/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "acknowledgeArtistUpdate", trackId: state.radioSubmission.id })
      });
      if (!response.ok) return;
      state.radioSubmission.hasUnreadUpdate = false;
      document.getElementById("sendToRadioButton")?.classList.remove("is-unread");
    } catch {}
  }

  function updateRadioAudioSource() {
    const useStoredVersion = Boolean(elements.radioSendForm.elements.audioVersionId.value);
    document.getElementById("radioDropZone").hidden = useStoredVersion;
    document.getElementById("radioVersionTypeField").hidden = useStoredVersion;
    elements.radioSendForm.elements.trackFile.required = !useStoredVersion;
    elements.radioSendMessage.textContent = useStoredVersion
      ? "This stored version remains in the Track Vault and is submitted without uploading it again."
      : "The new file becomes a reusable audio version linked permanently to this promo card.";
  }

  function radioAudioType(file) {
    const extension = String(file.name || "").split(".").pop()?.toLowerCase() || "";
    const types = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", wav: "audio/wav", flac: "audio/flac" };
    const aliases = { "audio/mp3": "audio/mpeg", "audio/x-mp3": "audio/mpeg", "audio/m4a": "audio/mp4", "audio/x-m4a": "audio/mp4", "audio/x-aac": "audio/aac", "application/ogg": "audio/ogg", "audio/vorbis": "audio/ogg", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav", "audio/x-flac": "audio/flac", "application/x-flac": "audio/flac" };
    const browserType = String(file.type || "").split(";")[0].toLowerCase();
    return aliases[browserType] || browserType || types[extension] || "";
  }

  function radioAudioDuration(file) {
    return new Promise(resolve => {
      const audio = document.createElement("audio");
      const url = URL.createObjectURL(file);
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        const duration = Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0;
        URL.revokeObjectURL(url);
        resolve(duration);
      };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
      audio.src = url;
    });
  }

  async function uploadRadioChunk(body) {
    return uploadHelper.sendFormDataWithRetry("/api/radio/submissions", body, { retryDelays: [700, 1400] });
  }

  async function submitToRadio(event) {
    event.preventDefault();
    if (!state.canEdit || !state.page) return;
    const form = event.currentTarget;
    const file = form.elements.trackFile.files[0];
    const audioVersionId = form.elements.audioVersionId.value;
    const button = form.querySelector("button[type=submit]");
    if (!state.page.releaseId) {
      elements.radioSendMessage.textContent = "Save this release card once before sending its audio to radio.";
      return;
    }
    if (audioVersionId) {
      button.disabled = true;
      radioUploadUi.start("Linking saved HALO audio to radio…");
      try {
        const fields = Object.fromEntries(new FormData(form).entries());
        delete fields.trackFile;
        const response = await fetch("/api/radio/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ ...fields, action: "submitReleaseVersion", artistSlug: state.page.slug, releaseId: state.page.releaseId, rightsConfirmed: form.elements.rightsConfirmed.checked })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "Track submission failed");
        radioUploadUi.success(`${data.message}. The submission remains linked to this promo card.`, false);
        showToast(data.message || "Linked version entered HALO Radio review.");
        form.reset();
        await loadPage();
        setTimeout(() => elements.radioSend.close(), 1200);
      } catch (error) {
        radioUploadUi.fail(error instanceof Error ? error.message : "The linked version could not be submitted.");
      } finally {
        button.disabled = false;
        setTimeout(() => radioUploadUi.idle("Choose a stored version or upload a broadcast-ready audio file."), 1800);
      }
      return;
    }
    if (!file) {
      elements.radioSendMessage.textContent = "Choose a stored version or upload a broadcast-ready audio file.";
      return;
    }
    if (file.size > 128 * 1024 * 1024) {
      elements.radioSendMessage.textContent = "Choose an audio file smaller than 128 MB.";
      return;
    }
    const contentType = radioAudioType(file);
    const allowedTypes = new Set(["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/x-wav", "audio/flac"]);
    if (!allowedTypes.has(contentType)) {
      elements.radioSendMessage.textContent = "Choose an MP3, M4A, AAC, OGG, WAV, or FLAC audio file.";
      return;
    }
    const chunkSize = 3 * 1024 * 1024;
    const uploadId = crypto.randomUUID ? crypto.randomUUID() : `radio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    button.disabled = true;
    radioUploadUi.start(`Transmitting audio 0% · ${file.name}`);
    try {
      const { chunkCount } = await uploadHelper.uploadChunkedFile({
        url: "/api/radio/submissions",
        file,
        chunkSize,
        retryDelays: [700, 1400],
        buildBody({ chunkIndex, chunkCount, start, end }) {
          const body = new FormData();
          body.append("chunk", file.slice(start, end, contentType), file.name);
          body.append("uploadId", uploadId);
          body.append("chunkIndex", String(chunkIndex));
          body.append("chunkCount", String(chunkCount));
          body.append("contentType", contentType);
          return body;
        },
        onProgress(percent) {
          radioUploadUi.progress(percent * 0.82 / 100 * 100, `Transmitting audio ${Math.round(percent)}% · ${file.name}`);
        }
      });
      const fields = Object.fromEntries(new FormData(form).entries());
      delete fields.trackFile;
      radioUploadUi.progress(92, "Saving the upload to Halo Radio…");
      const response = await fetch("/api/radio/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          ...fields,
          action: "publish",
          artistSlug: state.page.slug,
          releaseId: state.page.releaseId,
          artist: state.page.artistName,
          title: state.page.releaseTitle || file.name.replace(/\.[^.]+$/, ""),
          uploadId,
          chunkCount,
          byteSize: file.size,
          contentType,
          fileName: file.name,
          durationSeconds: await radioAudioDuration(file),
          rightsConfirmed: form.elements.rightsConfirmed.checked
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Track submission failed");
      radioUploadUi.success(`${data.message}. Your artist card is now linked to the station desk.`, true);
      showToast(data.message || "Track entered HALO Radio review.");
      form.reset();
      document.getElementById("radioFileLabel").textContent = "Choose the broadcast-ready audio";
      await loadPage();
      setTimeout(() => elements.radioSend.close(), 1200);
    } catch (error) {
      radioUploadUi.fail(error instanceof Error ? error.message : "The track could not be transmitted.");
    } finally {
      button.disabled = false;
      setTimeout(() => radioUploadUi.idle("Choose a stored version or upload a broadcast-ready audio file."), 1800);
    }
  }

  async function toggleArtistFollow() {
    if (!state.user) return openAuth("login");
    const button = document.getElementById("followArtistButton");
    if (button) button.disabled = true;
    try {
      const response = await fetch("/api/artist/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "follow", slug: state.page.slug, following: !state.connections.following })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "The artist follow could not be updated");
      state.connections = data;
      renderPage();
      showToast(data.message || "Artist connection updated.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The artist connection is unavailable.");
      if (button) button.disabled = false;
    }
  }

  function setFormValue(name, value) {
    const field = elements.studioForm.elements.namedItem(name);
    if (field) field.value = value || "";
  }

  function slugify(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  }

  function buildLinkContext() {
    const params = new URLSearchParams(location.search);
    return {
      source: params.get("source") || params.get("url") || "",
      artist: params.get("artist") || "",
      release: params.get("release") || ""
    };
  }

  function openSourceImport() {
    if (!buildLinkContext().source || state.scoutStarted || elements.studio.open || elements.auth.open) return;
    openStudio();
  }

  function renderScoutSources(sources = []) {
    elements.scoutSources.replaceChildren();
    sources.forEach(source => {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = source.title || new URL(source.url).hostname;
      elements.scoutSources.append(link);
    });
  }

  function applyScoutDraft(draft) {
    const releaseFields = new Set(["artworkUrl", "releaseTitle", "releaseDate", "releaseUrl", "videoTitle", "videoUrl", "websiteUrl"]);
    Object.entries(draft).forEach(([name, value]) => {
      if (["confidence", "reviewNote"].includes(name) || !value) return;
      const field = elements.studioForm.elements.namedItem(name);
      const isDefaultAccent = name === "accentColor" && field?.value === "#d5ff52";
      if (field && (releaseFields.has(name) || !field.value.trim() || isDefaultAccent)) field.value = value;
    });
    const artistName = elements.studioForm.elements.namedItem("artistName");
    const slug = elements.studioForm.elements.namedItem("slug");
    if (artistName?.value && slug && !slug.value) slug.value = slugify(artistName.value);
    renderCatalogPreview();
  }

  function renderCatalogPreview() {
    const form = new FormData(elements.studioForm);
    const title = String(form.get("releaseTitle") || "").trim();
    const artist = String(form.get("artistName") || "").trim();
    if (!title && !artist) {
      elements.catalogPreview.innerHTML = `<p class="catalog-preview-empty">Scout details appear here as the release card that joins ALL RELEASES after the published artist room is saved.</p>`;
      return;
    }
    const artwork = safePreviewUrl(String(form.get("artworkUrl") || ""));
    const releaseDate = String(form.get("releaseDate") || "");
    const tagline = String(form.get("tagline") || "").trim();
    const status = String(form.get("status") || "draft");
    elements.catalogPreview.innerHTML = `<article class="catalog-preview-card">
      <div class="catalog-preview-art" data-artwork-frame><img src="${escapeHtml(artwork)}" alt="${escapeHtml(`${title || "Release"} cover preview`)}" data-artwork-fallback="/assets/halo-app-icon-512.png"><span>${status === "published" ? "Publishes to catalog" : "Draft only"}</span></div>
      <div class="catalog-preview-copy"><div><div class="catalog-preview-meta"><span>${escapeHtml(formatDate(releaseDate))}</span><span>HALO release</span></div><h5>${escapeHtml(title || "Untitled release")}</h5><p class="catalog-preview-artist">${escapeHtml(artist || "Artist name")}</p>${tagline ? `<p>${escapeHtml(tagline)}</p>` : ""}</div><div class="catalog-preview-actions"><span>Listen now ↗</span><span>Release room</span></div></div>
    </article>`;
    wireArtworkFallbacks(elements.catalogPreview);
  }

  async function runScout() {
    const sourceUrl = elements.sourceLink.value.trim();
    if (!sourceUrl) {
      elements.scoutStatus.textContent = "Add one public artist or release link first.";
      elements.sourceLink.focus();
      return;
    }

    const artistHint = elements.studioForm.elements.namedItem("artistName")?.value || "";
    const releaseHint = elements.studioForm.elements.namedItem("releaseTitle")?.value || buildLinkContext().release;
    const currentDraft = Object.fromEntries(new FormData(elements.studioForm).entries());
    delete currentDraft.sourceLink;
    delete currentDraft.status;
    const statusSteps = ["Reading the starting signal…", "Checking the verified release and public artist sources…", "Completing the full editable card…"];
    let statusIndex = 0;
    elements.scout.disabled = true;
    elements.scoutStatus.textContent = statusSteps[statusIndex];
    renderScoutSources();
    const statusTimer = setInterval(() => {
      statusIndex = Math.min(statusIndex + 1, statusSteps.length - 1);
      elements.scoutStatus.textContent = statusSteps[statusIndex];
    }, 2600);

    try {
      const response = await fetch("/api/artist-page-scout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ sourceUrl, artistHint, releaseHint, currentDraft })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "The scout team could not fill this draft");
      applyScoutDraft(data.draft || {});
      renderScoutSources(data.sources || []);
      const confidence = data.draft?.confidence ? ` Match confidence: ${data.draft.confidence}.` : "";
      elements.scoutStatus.textContent = `${data.message || "Draft filled for review."}${confidence}`;
      if (data.draft?.reviewNote) elements.studioMessage.textContent = data.draft.reviewNote;
      showToast("Scout draft ready for your review.");
    } catch (error) {
      elements.scoutStatus.textContent = error.message || "The scout team could not fill this draft.";
    } finally {
      clearInterval(statusTimer);
      elements.scout.disabled = false;
    }
  }

  function fillStudio(page) {
    elements.studioForm.reset();
    renderScoutSources();
    elements.scoutStatus.textContent = "";
    setFormValue("accentColor", "#d5ff52");
    const context = buildLinkContext();
    if (!page) {
      setFormValue("sourceLink", context.source);
      setFormValue("artistName", context.artist);
      setFormValue("releaseTitle", context.release);
      setFormValue("communityUrl", "/#clubhouse");
      setFormValue("status", "draft");
      renderCatalogPreview();
      return;
    }
    Object.entries(page).forEach(([name, value]) => setFormValue(name, value));
    setFormValue("sourceLink", context.source);
    renderCatalogPreview();
  }

  function openStudio() {
    if (!state.user) {
      state.pendingStudio = true;
      openAuth("login");
      return;
    }
    fillStudio(state.canEdit ? state.page : null);
    elements.studioMessage.textContent = "";
    elements.studio.showModal();
    if (elements.sourceLink.value && !state.scoutStarted) {
      state.scoutStarted = true;
      runScout();
    }
  }

  function updateAuthMode() {
    const signup = state.authMode === "signup";
    elements.authNameField.hidden = !signup;
    elements.authName.required = signup;
    elements.authPassword.autocomplete = signup ? "new-password" : "current-password";
    elements.authSubmit.textContent = signup ? "Create artist account" : "Sign in";
    document.querySelectorAll("[data-auth-mode]").forEach(button => button.setAttribute("aria-selected", String(button.dataset.authMode === state.authMode)));
  }

  function openAuth(mode) {
    state.authMode = mode;
    elements.authMessage.textContent = "";
    updateAuthMode();
    elements.auth.showModal();
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (!state.identity) return;
    elements.authSubmit.disabled = true;
    elements.authMessage.textContent = state.authMode === "signup" ? "Creating your HALO identity…" : "Opening your HALO identity…";
    try {
      let user;
      if (state.authMode === "signup") {
        user = await state.identity.signup(elements.authEmail.value, elements.authPassword.value, { full_name: elements.authName.value.trim() });
        if (!user?.emailVerified) {
          elements.authMessage.textContent = "Check your email to confirm the account, then return to publish.";
          return;
        }
      } else {
        user = await state.identity.login(elements.authEmail.value, elements.authPassword.value);
      }
      state.user = { name: user.name || user.userMetadata?.full_name || "HALO artist" };
      elements.auth.close();
      showToast("HALO identity connected.");
      await loadPage();
      if (state.pendingStudio) {
        state.pendingStudio = false;
        openStudio();
      }
    } catch (error) {
      elements.authMessage.textContent = error.message || "Identity could not be connected.";
    } finally {
      elements.authSubmit.disabled = false;
    }
  }

  async function saveArtistPage(event) {
    event.preventDefault();
    elements.publish.disabled = true;
    elements.studioMessage.textContent = "Publishing the artist room…";
    const payload = Object.fromEntries(new FormData(elements.studioForm).entries());
    try {
      const response = await fetch("/api/artist-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "The artist room could not be saved");
      state.page = data.page;
      state.canEdit = Boolean(data.canEdit);
      const destination = `/artists/${data.page.slug}`;
      history.pushState({}, "", destination);
      renderPage();
      elements.studio.close();
      showToast(data.message || "Artist room published.");
    } catch (error) {
      elements.studioMessage.textContent = error.message || "The artist room could not be saved.";
    } finally {
      elements.publish.disabled = false;
    }
  }

  async function shareRoom() {
    const shareData = { title: document.title, text: state.page?.tagline || "Enter this HALO artist room.", url: location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(location.href);
        showToast("Artist room address copied.");
      }
    } catch (error) {
      if (error.name !== "AbortError") showToast("The room address is ready in your browser.");
    }
  }

  async function connectIdentity() {
    state.identity = window.haloIdentity;
    if (!state.identity) return;
    const user = await state.identity.getUser();
    state.user = user ? { name: user.name || user.userMetadata?.full_name || "HALO artist" } : null;
    state.identity.onAuthChange(async (_event, nextUser) => {
      state.user = nextUser ? { name: nextUser.name || nextUser.userMetadata?.full_name || "HALO artist" } : null;
      await loadPage();
    });
    openSourceImport();
  }

  elements.upload.addEventListener("click", openStudio);
  elements.share.addEventListener("click", shareRoom);
  elements.scout.addEventListener("click", runScout);
  elements.studioForm.addEventListener("input", renderCatalogPreview);
  elements.studioForm.addEventListener("change", renderCatalogPreview);
  elements.studioForm.addEventListener("submit", saveArtistPage);
  elements.authForm.addEventListener("submit", submitAuth);
  elements.radioSendForm.addEventListener("submit", submitToRadio);
  elements.radioSendForm.elements.audioVersionId.addEventListener("change", updateRadioAudioSource);
  elements.radioSendForm.elements.trackFile.addEventListener("change", event => {
    document.getElementById("radioFileLabel").textContent = event.target.files[0]?.name || "Choose the broadcast-ready audio";
  });
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => {
    state.authMode = button.dataset.authMode;
    elements.authMessage.textContent = "";
    updateAuthMode();
  }));
  window.addEventListener("popstate", () => loadPage());

  if (window.haloIdentity) connectIdentity();
  else window.addEventListener("halo-identity-ready", connectIdentity, { once: true });
  loadPage();
})();
