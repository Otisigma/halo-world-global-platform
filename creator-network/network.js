(() => {
  const byId = id => document.getElementById(id);
  let identity, state, sessionVersion = 0, loadVersion = 0;
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
    const ownProjects = state.projects.filter(p => p.owner_member_id === state.memberId && p.status === "open");
    byId("creators").replaceChildren(...state.creators.map(creator => {
      const card = node("article");
      card.append(node("h4", creator.display_name), node("p", creator.bio),
        node("p", [...creator.roles, ...creator.genres, ...creator.languages, ...creator.daw_setup].join(" · ")),
        node("p", creator.bpm_min ? `${creator.bpm_min}–${creator.bpm_max} BPM` : "Tempo flexible"),
        node("p", creator.split_preference));
      if (creator.artist_slug) card.append(roomLink(creator.artist_slug));
      if (ownProjects.length) {
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

  async function refresh() {
    const version = ++sessionVersion;
    state = null;
    byId("workspace").hidden = true;
    byId("locked").hidden = false;
    byId("signOut").hidden = true;
    for (const id of ["creators", "projects", "requests"]) byId(id).replaceChildren();
    byId("profile").reset();
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
  if (window.haloIdentity) ready(window.haloIdentity);
  else window.addEventListener("halo-identity-ready", event => ready(event.detail || window.haloIdentity), { once: true });
})();
