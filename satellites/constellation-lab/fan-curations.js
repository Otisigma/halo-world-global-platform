export function createFanCurationDesk(root, {
  document = globalThis.document, fetch = globalThis.fetch, onState = () => {}, onReset = () => {}
} = {}) {
  const form = root.querySelector("[data-curation-form]");
  const title = root.querySelector("[data-curation-title]");
  const choices = root.querySelector("[data-curation-tracks]");
  const save = root.querySelector("[data-curation-save]");
  const refreshButton = root.querySelector("[data-curation-refresh]");
  const status = root.querySelector("[data-curation-status]");
  const wallet = root.querySelector("[data-curation-wallet]");
  const saved = root.querySelector("[data-curation-saved]");
  const selection = root.querySelector("[data-curation-selection]");
  let revision = 0, controller = null, state = null, busy = false;

  function reset() {
    onReset();
    revision++;
    controller?.abort();
    controller = null;
    state = null;
    busy = false;
    form.reset();
    choices.replaceChildren();
    saved.replaceChildren();
    wallet.textContent = "Sign in to load your verified Signal Point balance.";
    status.textContent = "Sign in to save private curations. Browser-local HALO Points cannot unlock these rewards.";
    selection.textContent = "Choose 3-12 tracks.";
    save.disabled = true;
    refreshButton.disabled = false;
    root.setAttribute("aria-busy", "false");
  }
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  };
  const link = (text, href) => {
    const node = element("a", text);
    node.href = href;
    return node;
  };

  function selectedIds() {
    return Array.from(choices.querySelectorAll("input:checked"), input => input.value);
  }
  function updateSelection() {
    const count = selectedIds().length;
    selection.textContent = `${count} of 12 selected. Choose at least 3 different tracks.`;
    save.disabled = busy || !state || count < 3 || count > 12;
    for (const input of choices.querySelectorAll("input")) input.disabled = busy || (count >= 12 && !input.checked);
  }

  function render(data) {
    if (!data?.wallet || !Number.isSafeInteger(data.wallet.available) || data.wallet.available < 0
      || !Number.isSafeInteger(data.wallet.earned) || !Number.isSafeInteger(data.wallet.spent)
      || data.wallet.earned - data.wallet.spent !== data.wallet.available
      || typeof data.wallet.enabled !== "boolean" || !Array.isArray(data.releases) || !Array.isArray(data.curations)
      || data.policy?.cardCost !== 25 || data.policy?.earnedPoints !== 25) throw new Error("Invalid curation state");
    state = data;
    onState(data);
    wallet.textContent = `${data.wallet.available} available Signal Points / ${data.wallet.earned} lifetime earned / ${data.wallet.spent} spent.${data.wallet.enabled
      ? "" : " Rewards are off: no new points or claims. Existing cards remain yours to download."}`;
    const selected = new Set(selectedIds());
    choices.replaceChildren(...data.releases.map(track => {
      const label = element("label");
      const input = element("input");
      input.type = "checkbox";
      input.value = track.id;
      input.checked = selected.has(track.id);
      label.append(input, element("span", `${track.title} - ${track.artist}`));
      return label;
    }));
    saved.replaceChildren(...data.curations.map(curation => {
      const article = element("article"), heading = element("h3", curation.title), list = element("ol");
      for (const track of curation.tracks) {
        const item = element("li");
        item.append(track.available
          ? link(`${track.title} - ${track.artist}`, `/music/?song=${encodeURIComponent(track.id)}`)
          : element("span", "Release no longer public"));
        list.append(item);
      }
      article.append(heading, list);
      const available = curation.tracks.every(track => track.available);
      if (curation.redeemed && available) {
        article.append(link("Download your listening card (already unlocked)", `/api/fan-curations/card?curationId=${encodeURIComponent(curation.id)}`));
      } else {
        const button = element("button", curation.redeemed ? "Card unavailable: a release is no longer public" : "Unlock listening card - 25 Signal Points");
        button.type = "button";
        button.dataset.redeemCuration = curation.id;
        button.disabled = busy || !available || curation.redeemed || !data.wallet.enabled || data.wallet.available < 25;
        article.append(button);
      }
      return article;
    }));
    if (!data.curations.length) saved.append(element("p", "No saved curations yet. Pick your first tracklist above."));
    updateSelection();
  }

  async function refresh() {
    const current = ++revision;
    controller?.abort();
    controller = new AbortController();
    root.setAttribute("aria-busy", "true");
    state = null;
    onReset();
    save.disabled = true;
    for (const button of saved.querySelectorAll("button")) button.disabled = true;
    status.textContent = "Loading your curations and verified rewards...";
    try {
      const response = await fetch("/api/fan-curations", {
        credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)])
      });
      if (current !== revision) return false;
      if (response.status === 401) { reset(); return false; }
      if (!response.ok) throw new Error("Could not load curations. Refresh before saving or redeeming.");
      const data = await response.json();
      if (current !== revision) return false;
      render(data);
      status.textContent = data.releases.length
        ? "Ready. Curations stay private; artist ownership stays unchanged."
        : "No public releases are available for curation yet.";
      return true;
    } catch (error) {
      if (current !== revision) return false;
      state = null;
      saved.replaceChildren();
      choices.replaceChildren();
      wallet.textContent = "Balance unavailable - no balance or claim is assumed.";
      status.textContent = error.message || "Curations could not be loaded.";
      return false;
    } finally {
      if (current === revision) {
        controller = null;
        root.setAttribute("aria-busy", "false");
        updateSelection();
      }
    }
  }

  async function mutate(payload) {
    if (busy || !state) return;
    busy = true;
    const current = revision;
    updateSelection();
    for (const button of saved.querySelectorAll("button")) button.disabled = true;
    refreshButton.disabled = true;
    status.textContent = payload.action === "save" ? "Saving your curation..." : "Checking and redeeming your reward...";
    let message, succeeded = false;
    try {
      const response = await fetch("/api/fan-curations", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(12000)
      });
      const result = await response.json();
      if (current !== revision) return;
      if (!response.ok) throw new Error(result.message || "The request could not be completed.");
      message = result.message;
      succeeded = true;
      if (payload.action === "save") form.reset();
    } catch (error) {
      if (current !== revision) return;
      message = error.message || "Request interrupted. Refresh before retrying; a save or claim may have completed.";
    } finally {
      if (current === revision) {
        busy = false;
        refreshButton.disabled = false;
        const refreshed = await refresh();
        if (refreshed) status.textContent = message;
        else if (succeeded) status.textContent = `${message} Could not refresh the balance. Refresh to see the saved result; do not assume the operation failed.`;
      }
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const ids = selectedIds();
    if (ids.length < 3 || ids.length > 12) {
      status.textContent = "Choose 3-12 different public releases.";
      return;
    }
    return mutate({ action: "save", title: title.value, releaseIds: ids });
  });
  choices.addEventListener("change", updateSelection);
  saved.addEventListener("click", event => {
    const button = event.target.closest("[data-redeem-curation]");
    if (!button || button.disabled) return;
    return mutate({ action: "redeem", curationId: button.dataset.redeemCuration, rewardId: "listening-card" });
  });
  refreshButton.addEventListener("click", () => { if (!busy) return refresh(); });
  reset();
  return { refresh, reset };
}
