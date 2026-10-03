import { curatedCreators } from "/lib/creator-directory.js";

(() => {
  const byId = id => document.getElementById(id);
  let identity, state, sessionVersion = 0, loadVersion = 0, guardianVersion = 0;
  const status = message => { byId("status").textContent = message; };
  const values = form => Object.fromEntries(new FormData(form));
  const tagFields = ["roles", "genres", "languages", "dawSetup"];

  async function api(body, query = "") {
    const response = await fetch(`/api/creator-network${query}`, {
      method: body ? "POST" : "GET", credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Creator Network could not be loaded");
    return result;
  }

  function node(tag, content) {
    const element = document.createElement(tag);
    element.textContent = content || "";
    return element;
  }

  function renderPublicCreators(creators) {
    const curated = creators.filter(creator => creator.curated);
    const members = creators.filter(creator => !creator.curated);
    for (const [container, entries] of [[byId("verifiedCreators"), curated], [byId("publicCreators"), members]]) {
      container.replaceChildren(...entries.map(creator => {
        const card = node("article");
        card.className = creator.curated ? "creator-profile-card verified-card" : "creator-profile-card";
        card.append(node("h3", creator.display_name), node("p", creator.bio));
        if (creator.verified && creator.curated) card.append(node("p", "✓ Verified HALO seed · curated profile"));
        const tags = [...(creator.roles || []), ...(creator.genres || []), ...(creator.languages || [])];
        if (tags.length) {
          const profileTags = node("p", tags.join(" · "));
          profileTags.className = "profile-tags";
          card.append(profileTags);
        }
        card.append(node("p", creator.bpm_min ? `${creator.bpm_min}–${creator.bpm_max} BPM` : "Tempo flexible"));
        if (creator.artist_slug) card.append(roomLink(creator.artist_slug));
        const join = node("a", "Sign in to collaborate");
        join.href = "/creator-network/#locked";
        card.append(join);
        return card;
      }));
      if (!entries.length) container.append(node("p", "No public Creator Passes match yet. Try another filter or check back soon."));
    }
  }

  async function loadPublicCreators() {
    const query = new URLSearchParams(values(byId("publicFilters")));
    const result = await api(null, `?view=public&${query}`);
    renderPublicCreators(result.creators || []);
    if (result.directoryUnavailable) byId("publicCreators").prepend(node("p", "Showing HALO-curated profiles. Member discovery is temporarily unavailable."));
  }

  async function loadReleaseDeck() {
    const select = byId("studioTrack");
    const audio = byId("studioPlayer");
    try {
      const response = await fetch("/api/release-catalog", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Release catalog unavailable");
      const result = await response.json();
      const releases = (Array.isArray(result.releases) ? result.releases : []).map(release => {
        const preview = window.HaloReleaseArtwork?.resolveAudio({
          audioUrl: release.audioUrl,
          audio_url: release.audio_url,
          previewAudio: release.previewAudio,
          preview_audio: release.preview_audio,
          streamUrl: release.streamUrl
        }, { preferPreview: true, requirePlayable: true });
        return preview?.src ? { release, src: preview.src } : null;
      }).filter(Boolean);
      select.replaceChildren();
      if (!releases.length) {
        select.append(node("option", "No published preview is available"));
        byId("playerStatus").textContent = "CATALOG / NO PLAYABLE PREVIEW";
        return;
      }
      releases.forEach(({ release }, index) => {
        const option = node("option", `${release.title || "Untitled release"} · ${release.artist || "HALO artist"}`);
        option.value = String(index);
        select.append(option);
      });
      function chooseRelease() {
        const selected = releases[Number(select.value)];
        if (!selected) return;
        audio.src = selected.src;
        byId("trackTitle").textContent = selected.release.title || "Untitled release";
        byId("trackMeta").textContent = `${selected.release.artist || "HALO artist"} · Published HALO release preview`;
        byId("trackSpecs").textContent = `BPM ${selected.release.bpm || "—"} · KEY ${selected.release.musicalKey || "—"}`;
        byId("playerStatus").textContent = "CATALOG SYNC / READY";
      }
      select.addEventListener("change", chooseRelease);
      chooseRelease();
    } catch {
      select.replaceChildren(node("option", "Release previews are temporarily unavailable"));
      byId("playerStatus").textContent = "CATALOG / CONNECTION DELAYED";
    }
  }

  function action(label, body) {
    const button = node("button", label);
    button.type = "button";
    button.addEventListener("click", () => mutate(body, button));
    return button;
  }

  function roomLink(slug) {
    const link = node("a", "Artist room + follows");
    link.href = `/artists/${encodeURIComponent(slug)}/`;
    return link;
  }

  function render() {
    const profile = state.profile;
    const mapping = { displayName: "display_name", artistSlug: "artist_slug", dawSetup: "daw_setup",
      bpmMin: "bpm_min", bpmMax: "bpm_max", splitPreference: "split_preference" };
    for (const input of byId("profile").elements) {
      if (!input.name) continue;
      const value = profile?.[mapping[input.name] || input.name];
      if (input.type === "checkbox") input.checked = value === true;
      else input.value = Array.isArray(value) ? value.join(", ") : value ?? "";
    }
    const displayName = profile?.display_name || "Your artist name";
    byId("passName").textContent = displayName;
    byId("passInitial").textContent = displayName.trim().charAt(0).toUpperCase() || "H";
    byId("passRole").textContent = profile?.roles?.join(" · ") || "Creator / collaborator";
    byId("passSummary").textContent = profile
      ? `${profile.discoverable ? "Public discovery is on" : "Your Creator Pass is private"} · ${profile.roles?.length ? profile.roles.join(" / ") : "Creator profile"}`
      : "Set your Creator Pass and choose what to share.";
    const ownProjects = state.projects.filter(p => p.owner_member_id === state.memberId && p.status === "open");
    byId("creators").replaceChildren(...state.creators.map(creator => {
      const card = node("article");
      card.append(node("h4", creator.display_name), node("p", creator.bio),
        node("p", [...creator.roles, ...creator.genres, ...creator.languages, ...(creator.daw_setup || [])].join(" · ")),
        node("p", creator.bpm_min ? `${creator.bpm_min}–${creator.bpm_max} BPM` : "Tempo flexible"),
        node("p", creator.split_preference));
      if (creator.artist_slug) card.append(roomLink(creator.artist_slug));
      if (creator.verified && creator.curated) card.append(node("p", "✓ Verified HALO seed · curated profile"));
      if (ownProjects.length && creator.member_id) {
        const select = document.createElement("select");
        select.setAttribute("aria-label", `Project to invite ${creator.display_name} to`);
        ownProjects.forEach(project => {
          const option = node("option", project.title);
          option.value = project.id;
          select.append(option);
        });
        const button = node("button", "Invite to project");
        button.type = "button";
        button.addEventListener("click", () => mutate({
          action: "invite", projectId: select.value, memberId: creator.member_id
        }, button));
        card.append(select, button);
      }
      return card;
    }));
    byId("projects").replaceChildren(...state.projects.map(project => {
      const card = node("article");
      const owns = project.owner_member_id === state.memberId;
      card.append(node("h4", project.title), node("p", project.brief),
        node("p", [project.creator_name, project.kind, project.role_needed, project.genre,
          project.language, project.bpm && `${project.bpm} BPM`, project.musical_key, project.status].filter(Boolean).join(" · ")));
      if (project.song_id) {
        const link = node("a", "Open existing song catalog");
        link.href = `/song-catalog/?song=${encodeURIComponent(project.song_id)}`;
        card.append(link);
      }
      if (project.stem_pack_id) card.append(node("p", `Stem vault reference: ${project.stem_pack_id} (owner access unchanged)`));
      if (project.rights_work_id) {
        const link = node("a", "Review linked rights in Artist Economy");
        link.href = "/artist/dashboard";
        card.append(link);
      }
      if (project.status === "open") {
        const existing = state.participants.find(p => p.project_id === project.id && p.member_id === state.memberId);
        if (owns) card.append(action("Close opportunity", { action: "close_project", projectId: project.id }));
        else if (existing) card.append(node("p", `Your request: ${existing.status}`));
        else card.append(action("Apply to collaborate", { action: "apply", projectId: project.id }));
      }
      return card;
    }));
    byId("requests").replaceChildren(...state.participants.map(participant => {
      const card = node("article");
      const incoming = participant.kind === "invite"
        ? participant.member_id === state.memberId
        : participant.owner_member_id === state.memberId;
      card.append(node("h4", participant.title),
        node("p", `${incoming ? "Incoming" : "Outgoing"} ${participant.kind} · ${participant.status}`),
        node("p", `Creator: ${participant.participant_name || "HALO member"} · Owner: ${participant.owner_name || "HALO member"}`),
        node("p", participant.message));
      if (incoming && participant.status === "pending" && participant.project_status === "open") {
        for (const choice of ["accepted", "declined"]) card.append(action(choice === "accepted" ? "Accept" : "Decline", {
          action: "respond", projectId: participant.project_id, memberId: participant.member_id, status: choice
        }));
      }
      return card;
    }));
    for (const id of ["creators", "projects", "requests"]) {
      if (!byId(id).children.length) byId(id).append(node("p", "Nothing here yet."));
    }
    const reviewable = state.projects.filter(project => project.owner_member_id === state.memberId ||
      state.participants.some(participant => participant.project_id === project.id && participant.member_id === state.memberId && participant.status === "accepted"));
    guardianVersion++;
    byId("guardianReport").replaceChildren();
    byId("guardianProject").replaceChildren(...reviewable.map(project => {
      const option = node("option", project.title);
      option.value = project.id;
      return option;
    }));
    if (!reviewable.length) {
      const placeholder = node("option", "Create or join a project first");
      placeholder.value = "";
      byId("guardianProject").append(placeholder);
    }
  }

  async function load() {
    const version = sessionVersion, latest = ++loadVersion;
    const query = new URLSearchParams(values(byId("filters")));
    const result = await api(null, `?${query}`);
    if (version !== sessionVersion || latest !== loadVersion) return;
    state = result;
    render();
    byId("locked").hidden = true;
    byId("workspace").hidden = false;
    byId("signOut").hidden = false;
  }

  async function mutate(body, button, form) {
    const version = sessionVersion;
    button.disabled = true;
    try {
      const result = await api(body);
      if (version !== sessionVersion) return;
      if (form?.id === "project") form.reset();
      await load();
      status(result.message);
    } catch (error) {
      if (version === sessionVersion) status(error.message);
    } finally {
      button.disabled = false;
    }
  }

  for (const id of ["profile", "project"]) byId(id).addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget, body = values(form);
    body.action = id === "profile" ? "save_profile" : "create_project";
    if (id === "profile") {
      tagFields.forEach(field => { body[field] = body[field].split(",").map(value => value.trim()).filter(Boolean); });
      body.discoverable = form.elements.discoverable.checked;
    }
    mutate(body, form.querySelector('button[type="submit"]'), form);
  });
  byId("filters").addEventListener("submit", async event => {
    event.preventDefault();
    try { await load(); status("Matches updated"); } catch (error) { status(error.message); }
  });
  byId("publicFilters").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try { await loadPublicCreators(); }
    catch (error) { status(error.message); }
    finally { button.disabled = false; }
  });
  byId("login").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      if (!identity) throw new Error("Identity is still loading. Please try again.");
      const data = values(event.currentTarget);
      await identity.login(data.email, data.password);
      byId("login").reset();
      await refresh();
    } catch (error) { status(error.message); } finally { button.disabled = false; }
  });
  byId("signOut").addEventListener("click", async () => {
    try { await identity.logout(); await refresh(); } catch (error) { status(error.message); }
  });
  byId("guardianForm").addEventListener("submit", async event => {
    event.preventDefault();
    const version = sessionVersion, button = event.submitter;
    const projectId = byId("guardianProject").value;
    if (!projectId || !button) return;
    const latest = ++guardianVersion;
    const buttons = [...event.currentTarget.querySelectorAll("button")];
    buttons.forEach(control => { control.disabled = true; });
    byId("guardianReport").textContent = "Studio Guardian is reviewing the project…";
    try {
      const response = await fetch("/api/studio-guardian", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: button.value, projectId })
      });
      const result = await response.json();
      if (version !== sessionVersion || latest !== guardianVersion || projectId !== byId("guardianProject").value) return;
      if (!response.ok) throw new Error(result.message || "Review unavailable");
      const report = byId("guardianReport");
      report.replaceChildren();
      if (result.health) {
        report.append(node("h3", `${result.health.score}/100 · ${result.health.status.replaceAll("_", " ")}`),
          node("p", result.health.summary));
        for (const insight of result.health.audioInsights) report.append(node("p", insight));
        const steps = node("ul");
        result.health.actionableNextSteps.forEach(step => steps.append(node("li", step)));
        report.append(steps);
      }
      if (result.review) {
        for (const agent of result.review.council) report.append(node("h3", agent.agentName), node("p", agent.content));
        report.append(node("p", result.review.finalVerdict));
        const steps = node("ul");
        result.review.recommendedActions.forEach(step => steps.append(node("li", step)));
        report.append(steps);
      }
      report.append(node("p", `Review mode: ${result.health?.provider || result.review?.provider || "checklist"} · Advisory only`));
    } catch (error) {
      if (version === sessionVersion && latest === guardianVersion) byId("guardianReport").textContent = error.message;
    } finally {
      buttons.forEach(control => { control.disabled = false; });
    }
  });
  byId("guardianProject").addEventListener("change", () => {
    guardianVersion++;
    byId("guardianReport").replaceChildren();
  });

  async function refresh() {
    const version = ++sessionVersion;
    guardianVersion++;
    state = null;
    byId("workspace").hidden = true;
    byId("locked").hidden = false;
    byId("signOut").hidden = true;
    byId("guardianReport").replaceChildren();
    byId("guardianProject").replaceChildren();
    for (const id of ["creators", "projects", "requests"]) byId(id).replaceChildren();
    byId("profile").reset();
    byId("project").reset();
    try {
      const user = await identity.getUser();
      if (version !== sessionVersion) return;
      if (user) { await load(); status("Member workspace ready"); }
      else status("Sign in to view profiles and collaboration requests.");
    } catch (error) {
      if (version === sessionVersion) status(error.message);
    }
  }

  function ready(value) {
    if (identity) return;
    identity = value;
    identity.onAuthChange(() => refresh());
    refresh();
  }
  renderPublicCreators(curatedCreators());
  loadPublicCreators().catch(() => {
    byId("publicCreators").prepend(node("p", "Showing HALO-curated profiles. Member discovery is temporarily unavailable."));
  });
  loadReleaseDeck();
  if (window.haloIdentity) ready(window.haloIdentity);
  else window.addEventListener("halo-identity-ready", event => ready(event.detail || window.haloIdentity), { once: true });
})();
