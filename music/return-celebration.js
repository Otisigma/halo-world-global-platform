(() => {
  const KEY = "halo-number-one-celebration-v1";
  let shown = false;

  window.HaloReturnCelebration = {
    show(track) {
      if (shown || document.hidden || track?.rank !== 1 || !["published", "passed"].includes(track.status)
        || typeof track.id !== "string" || !/^[a-zA-Z0-9-]{1,96}$/.test(track.id)
        || typeof track.title !== "string" || !track.title.trim()
        || typeof track.artist !== "string" || !track.artist.trim()) return;
      const nav = window.navigator;
      if (nav.globalPrivacyControl || nav.doNotTrack === "1" || window.doNotTrack === "1") return;
      try {
        const previous = JSON.parse(window.localStorage.getItem(KEY) || "null");
        if (previous?.leader === track.id) return;
        window.localStorage.setItem(KEY, JSON.stringify({ leader: track.id }));
      } catch {
        console.warn("HALO celebration skipped: browser history could not be saved.");
        return;
      }
      shown = true;
      const make = (tag, text, className) => {
        const node = document.createElement(tag);
        node.textContent = text || "";
        if (className) node.className = className;
        return node;
      };
      const panel = make("section", "", "return-celebration");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "false");
      panel.setAttribute("aria-label", "HALO chart leader celebration");
      const burst = make("div", "", "return-celebration-burst");
      burst.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 24; i++) {
        const piece = make("i");
        piece.style.setProperty("--piece", i);
        burst.append(piece);
      }
      const dismiss = make("button", "Dismiss", "return-celebration-dismiss");
      dismiss.type = "button";
      const listen = make("a", "Listen to the chart leader");
      listen.href = `/music/?song=${encodeURIComponent(track.id)}`;
      const status = make("p", `${track.title} by ${track.artist} is #1 on the HALO activity chart.`);
      status.setAttribute("role", "status");
      panel.append(burst, dismiss, make("p", "HALO ACTIVITY CHART · #1"),
        make("h2", track.title), status,
        make("p", "Welcome back to the music. Celebrate this chart moment with us."),
        make("p", "Your commemorative moment — thank you for being part of HALO."), listen);
      const previousFocus = document.activeElement;
      const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const stop = () => { burst.hidden = true; };
      burst.hidden = motion.matches || document.documentElement.classList.contains("halo-safe-space-mode");
      const timer = window.setTimeout(stop, 2400);
      const close = () => {
        window.clearTimeout(timer);
        motion.removeEventListener("change", stop);
        document.removeEventListener("keydown", keydown);
        const restore = panel.contains(document.activeElement);
        panel.remove();
        if (restore && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      };
      const keydown = event => {
        if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(); }
      };
      dismiss.addEventListener("click", close);
      listen.addEventListener("click", close);
      motion.addEventListener("change", stop);
      document.addEventListener("keydown", keydown);
      document.body.append(panel);
    }
  };
})();
