(() => {
  const paths = Object.freeze({
    solo: { title: "Solo Builder", route: "/release-house/?mode=solo" },
    coop: { title: "Catalog Co-Op", route: "/song-catalog/?mode=coop" },
    collab: { title: "Collaborator & Performer", route: "/artist-team.html?mode=collab" },
    testing: { title: "Market Testing", route: "/music/?mode=testing" }
  });
  const questions = [
    {
      title: "How many finished tracks or unreleased demos do you have ready?",
      options: [
        { label: "Just starting out / 1–2 tracks", path: "solo" },
        { label: "An EP or album (3–9 tracks)", path: "coop" },
        { label: "A deep library (10+ tracks)", path: "coop" },
        { label: "Looking for instrumentals or stems to write over", path: "collab" }
      ]
    },
    {
      title: "What is your primary goal on HALO today?",
      options: [
        { label: "Launch my solo music into release rotation", path: "solo" },
        { label: "Team up to manage a catalog and share resources", path: "coop" },
        { label: "Collaborate as a producer, vocalist, or featured artist", path: "collab" },
        { label: "Test unreleased demos with Living Chart listeners", path: "testing" }
      ]
    },
    {
      title: "What would help you take your next step?",
      options: [
        { label: "A guided release workflow for my own music", path: "solo" },
        { label: "Organizing masters, versions, and metadata at scale", path: "coop" },
        { label: "Coordinating collaborators, performances, and credits", path: "collab" },
        { label: "Audience feedback before committing to a full release", path: "testing" }
      ]
    }
  ];
  const initialState = () => ({ step: 0, answers: [] });
  const validAnswer = (step, answer) => Number.isInteger(answer) && Boolean(questions[step]?.options[answer]);

  function transition(state, action) {
    if (action.type === "restart") return initialState();
    if (action.type === "back") return { ...state, step: Math.max(0, state.step - 1) };
    if (action.type === "select" && validAnswer(state.step, action.answer)) {
      const answers = [...state.answers];
      answers[state.step] = action.answer;
      return { ...state, answers };
    }
    if (action.type === "next" && validAnswer(state.step, state.answers[state.step])) {
      return { ...state, step: Math.min(questions.length, state.step + 1) };
    }
    return state;
  }

  function score(answers) {
    if (answers.length !== questions.length || !questions.every((_, step) => validAnswer(step, answers[step]))) {
      throw new Error("Answer all three questions before choosing a path.");
    }
    const counts = Object.fromEntries(Object.keys(paths).map(path => [path, 0]));
    answers.forEach((answer, step) => counts[questions[step].options[answer].path]++);
    const highest = Math.max(...Object.values(counts));
    const tied = Object.keys(paths).filter(path => counts[path] === highest);
    const goal = questions[1].options[answers[1]].path;
    const path = tied.includes(goal) ? goal : tied[0];
    return {
      path, counts, ...paths[path],
      explanation: `${counts[path]} of 3 answers point to ${paths[path].title}.${tied.length > 1 ? " Your primary goal breaks the tie." : ""}`
    };
  }

  // Store only a browser-local dismissal marker, never answers or account data.
  const storageKey = "halo-onboarding-v1";
  let dismissed = false;
  function isDismissed() {
    if (dismissed) return true;
    for (const name of ["localStorage", "sessionStorage"]) {
      try {
        if (["skipped", "completed"].includes(globalThis[name]?.getItem(storageKey))) return true;
      } catch {}
    }
    return false;
  }
  function dismiss(status) {
    if (!["skipped", "completed"].includes(status)) return;
    dismissed = true;
    for (const name of ["localStorage", "sessionStorage"]) {
      try { globalThis[name]?.setItem(storageKey, status); } catch {}
    }
  }
  function isHome(location) {
    return ["/", "/halo", "/halo.html"].includes(location.pathname)
      && !location.hash && !new URLSearchParams(location.search).has("room");
  }
  function workspaceForLocation(location) {
    return Object.entries(paths).find(([, path]) => {
      const route = new URL(path.route, "https://halo.local");
      return route.pathname === location.pathname && route.search === location.search;
    })?.[0] || null;
  }
  function navigate(path, window = globalThis.window) {
    if (!Object.hasOwn(paths, path)) return false;
    window.history.pushState({ haloPathWorkspace: path }, "", paths[path].route);
    window.dispatchEvent(new window.PopStateEvent("popstate"));
    return true;
  }
  const homeRoutes = ["/", "/halo", "/halo/", "/halo.html"];
  const consoleRoutes = ["/ai-workgroup", "/halo-tv", "/listening-party", "/radio-dj"];
  function navigateApp(route, window = globalThis.window) {
    const url = new URL(route, window.location.href);
    if (url.origin !== window.location.origin) return false;
    if (!homeRoutes.includes(url.pathname) && !consoleRoutes.includes(url.pathname) && !workspaceForLocation(url)) return false;
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new window.PopStateEvent("popstate"));
    return true;
  }
  function connectWorkspace(frame, window = globalThis.window) {
    let document;
    try { document = frame.contentDocument; } catch { return; }
    if (!document) return;
    document.addEventListener("click", event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.("a[href]");
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href, document.baseURI);
      if (url.origin !== window.location.origin || link.getAttribute("href")?.startsWith("#")) return;
      if (navigateApp(url.href, window)) event.preventDefault();
      else link.target = "_top";
    });
  }

  globalThis.HaloOnboarding = {
    paths, questions, initialState, transition, score, isDismissed, dismiss,
    isHome, workspaceForLocation, navigate, navigateApp, connectWorkspace
  };
})();
