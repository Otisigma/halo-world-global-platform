(() => {
  const params = new URL(window.location.href).searchParams;
  const projectId = params.get("releaseProject") || sessionStorage.getItem("halo-release-project") || "";
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return;

  sessionStorage.setItem("halo-release-project", projectId);

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  const releaseIdentity = project => {
    const metadata = project.roomData?.metadata || {};
    const idea = project.roomData?.idea || {};
    return {
      artist: metadata.artistName || project.artistName || "Unnamed artist",
      track: metadata.officialTitle || project.trackTitle || idea.workingTitle || "Untitled release",
      date: project.roomData?.upload?.releaseDate || project.targetReleaseDate || ""
    };
  };
  const contextUrl = (path, extra = {}) => {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("releaseProject", projectId);
    Object.entries(extra).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
    return `${url.pathname}${url.search}${url.hash}`;
  };
  const setIfEmpty = (selector, value, defaultValues = []) => {
    if (!value) return false;
    const field = document.querySelector(selector);
    if (!field) return false;
    const current = String(field.value || "").trim();
    if (current && !defaultValues.includes(current)) return false;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };

  function applyPrefill(project) {
    const identity = releaseIdentity(project);
    const releaseId = project.connections?.catalogRelease?.id || project.connections?.artistPage?.releaseId || "";
    setIfEmpty("#studioForm [name='artistName']", identity.artist);
    setIfEmpty("#studioForm [name='releaseTitle']", identity.track);
    setIfEmpty("#studioForm [name='releaseDate']", identity.date);
    setIfEmpty("#campaignForm [name='title']", `${identity.track} — listening party`, ["The First Listening Party"]);
    setIfEmpty("#campaignForm [name='subtitle']", `Hear ${identity.track}, join the room, and help shape the next move.`, ["Hear the full shortlist and choose what HALO releases next."]);
    setIfEmpty("#submissionForm [name='title']", identity.track);
    setIfEmpty("#submissionForm [name='artist']", identity.artist);

    const radioRelease = document.querySelector("#submissionRelease");
    if (radioRelease && releaseId && [...radioRelease.options].some(option => option.value === releaseId) && !radioRelease.value) {
      radioRelease.value = releaseId;
      radioRelease.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const outreachRelease = document.querySelector("#releaseSelect");
    if (outreachRelease && releaseId && [...outreachRelease.options].some(option => option.value === releaseId) && outreachRelease.value !== releaseId) {
      outreachRelease.value = releaseId;
      outreachRelease.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function render(project) {
    if (document.querySelector("[data-halo-release-context]")) return;
    const identity = releaseIdentity(project);
    const score = Math.round(((project.completedRooms || []).length / 13) * 100);
    const connections = project.connections || {};
    const artistPage = connections.artistPage;
    const catalogRelease = connections.catalogRelease;
    const fanCampaign = connections.fanCampaign;
    const currentPath = window.location.pathname;
    const destinations = [
      { key: "house", label: "Release House", href: contextUrl("/release-house/#workspace"), active: currentPath.startsWith("/release-house") },
      { key: "artist", label: "Artist Room", href: artistPage ? contextUrl(`/artists/${artistPage.slug}`) : contextUrl("/artists/", { artist: identity.artist, release: identity.track }), active: currentPath.startsWith("/artists") },
      { key: "campaign", label: "Fan Campaign", href: fanCampaign ? contextUrl("/campaign-studio/", { campaign: fanCampaign.slug }) : contextUrl("/campaign-studio/"), active: currentPath.startsWith("/campaign-studio") },
      { key: "radio", label: "Radio", href: contextUrl("/radio/", { releaseId: catalogRelease?.id || artistPage?.releaseId || "" }), active: currentPath.startsWith("/radio") },
      { key: "outreach", label: "Outreach", href: contextUrl("/outreach.html", { releaseId: catalogRelease?.id || "" }), active: currentPath === "/outreach.html" },
      { key: "team", label: "Weekly Team", href: artistPage ? contextUrl("/artist-team.html", { slug: artistPage.slug }) : contextUrl("/artist-team.html"), active: currentPath === "/artist-team.html" }
    ];

    const bar = document.createElement("aside");
    bar.className = "halo-release-context";
    bar.dataset.haloReleaseContext = "";
    bar.style.setProperty("--release-context-progress", String(score / 100));
    bar.innerHTML = `
      <div class="halo-release-context__signal" aria-hidden="true"><i></i><span>${score}%</span></div>
      <div class="halo-release-context__identity">
        <span>Release passport</span>
        <strong>${escapeHtml(identity.artist)} — ${escapeHtml(identity.track)}</strong>
      </div>
      <nav class="halo-release-context__nav" aria-label="Connected release journey">
        ${destinations.map(destination => `<a href="${escapeHtml(destination.href)}" ${destination.active ? 'aria-current="page"' : ""} data-release-context-destination="${destination.key}">${escapeHtml(destination.label)}</a>`).join("")}
      </nav>
      <div class="halo-release-context__controls">
        <button type="button" data-release-context-collapse aria-expanded="true">Fold</button>
        <button type="button" data-release-context-clear>Clear</button>
      </div>`;

    const header = document.querySelector("body > header, body > .site-header, body > .house-header");
    if (header) header.insertAdjacentElement("afterend", bar);
    else document.body.prepend(bar);

    const collapsed = sessionStorage.getItem("halo-release-context-collapsed") === "true";
    if (collapsed) {
      bar.classList.add("is-collapsed");
      bar.querySelector("[data-release-context-collapse]").setAttribute("aria-expanded", "false");
      bar.querySelector("[data-release-context-collapse]").textContent = "Open";
    }

    bar.addEventListener("click", event => {
      const collapse = event.target.closest("[data-release-context-collapse]");
      if (collapse) {
        const nextCollapsed = !bar.classList.contains("is-collapsed");
        bar.classList.toggle("is-collapsed", nextCollapsed);
        collapse.setAttribute("aria-expanded", String(!nextCollapsed));
        collapse.textContent = nextCollapsed ? "Open" : "Fold";
        sessionStorage.setItem("halo-release-context-collapsed", String(nextCollapsed));
        return;
      }
      const clear = event.target.closest("[data-release-context-clear]");
      if (clear) {
        sessionStorage.removeItem("halo-release-project");
        sessionStorage.removeItem("halo-release-context-collapsed");
        const url = new URL(window.location.href);
        url.searchParams.delete("releaseProject");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        bar.remove();
        return;
      }
      const destination = event.target.closest("[data-release-context-destination]");
      if (destination) window.haloStats?.track("release_next_action_opened", { target: destination.dataset.releaseContextDestination });
    });

    window.haloReleaseContext = { project };
    window.dispatchEvent(new CustomEvent("halo-release-context-ready", { detail: { project } }));
    window.haloStats?.track("release_context_opened", { target: currentPath.slice(0, 80) || "/" });
    applyPrefill(project);
    const observer = new MutationObserver(() => applyPrefill(project));
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 15000);
  }

  fetch("/api/release-house", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(response => response.json())
    .then(data => {
      const project = (data.projects || []).find(candidate => candidate.id === projectId);
      if (project) render(project);
    })
    .catch(() => {});
})();
