export function createReleaseTeaserConsole({ root, doc = document, fetcher = fetch }) {
  const status = root.querySelector("[data-teaser-status]");
  const issues = root.querySelector("[data-teaser-issues]");
  const check = root.querySelector("[data-teaser-check]");
  const generate = root.querySelector("[data-teaser-generate]");
  let selectedId = "", revision = 0;

  function reset(message) {
    status.textContent = message;
    issues.replaceChildren();
    generate.disabled = true;
  }
  async function refresh() {
    const songId = selectedId, ticket = ++revision;
    if (!songId) return;
    reset("Checking approved release assets and rendering availability…");
    check.disabled = true;
    root.setAttribute("aria-busy", "true");
    try {
      const response = await fetcher(`/api/release-teaser?songId=${encodeURIComponent(songId)}`, { credentials: "same-origin" });
      const state = await response.json();
      if (ticket !== revision) return;
      if (!response.ok) {
        reset(state.message || "Teaser readiness is unavailable. Retry shortly.");
        return;
      }
      status.textContent = `${state.eligible ? "Release prerequisites passed." : "Release needs attention."} ${state.renderer?.message || "Video rendering is not deployed."}`;
      for (const issue of state.issues || []) {
        const item = doc.createElement("li");
        item.textContent = issue.message;
        issues.append(item);
      }
    } catch {
      if (ticket === revision) reset("Connection interrupted. No teaser was requested. Check readiness again.");
    } finally {
      if (ticket === revision) {
        check.disabled = !selectedId;
        root.setAttribute("aria-busy", "false");
      }
    }
  }
  check.addEventListener("click", refresh);
  return {
    select(songId) {
      selectedId = songId || "";
      revision++;
      reset(selectedId ? "Check teaser readiness for this release. Video rendering is not deployed." : "Select a saved catalog song to check teaser readiness.");
      check.disabled = !selectedId;
      root.setAttribute("aria-busy", "false");
    },
  };
}
