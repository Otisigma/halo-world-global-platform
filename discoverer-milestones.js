const API = "/api/discoverer-milestones";

export async function milestoneRequest(body) {
  const response = await fetch(API, {
    credentials: "same-origin",
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Celebrations are unavailable. Please retry.");
  if (!Array.isArray(result.notifications) || !Array.isArray(result.milestones) || typeof result.enabled !== "boolean") {
    throw new Error("Celebrations are unavailable. Please retry.");
  }
  return result;
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function artistMilestoneCard(milestone) {
  const card = node("article", "", "milestone-card");
  card.append(node("p", "Milestone Reached", "kicker"), node("h3", milestone.title),
    node("p", `${milestone.artist} · Reviewed radio rotation`),
    node("p", `${milestone.supporterCount} eligible early discoverers (up to 20). Fan identities remain private.`));
  const label = node("label", "Your thank-you draft (not sent)");
  const draft = node("textarea");
  draft.maxLength = 500;
  draft.value = `Thank you for supporting ${milestone.title} early. Your support means a lot!`;
  label.append(draft);
  const consentLabel = node("label");
  const consent = node("input");
  consent.type = "checkbox";
  consentLabel.append(consent, node("span", " I will share this only through a channel where the recipient has consented."));
  const copy = node("button", "Copy text draft");
  copy.type = "button";
  copy.disabled = true;
  const status = node("p");
  status.setAttribute("role", "status");
  consent.addEventListener("change", () => { copy.disabled = !consent.checked; });
  copy.addEventListener("click", async () => {
    if (!consent.checked || copy.disabled) return;
    copy.disabled = true;
    status.textContent = "Copying draft…";
    try {
      await navigator.clipboard.writeText(draft.value.slice(0, 500));
      status.textContent = "Draft copied. Nothing has been sent.";
    } catch {
      status.textContent = "Copy unavailable. Select the draft manually. Nothing has been sent.";
    } finally { copy.disabled = !consent.checked; }
  });
  const voice = node("button", "Voice recording / delivery unavailable");
  voice.type = "button";
  voice.disabled = true;
  card.append(label, consentLabel, copy, voice,
    node("p", "HALO has no supported private voice-note delivery here. No microphone is used and no fan messages are sent."), status);
  return card;
}

export function mountMilestones(panel) {
  const artist = panel.dataset.milestones === "artist";
  const status = node("p", "Loading celebrations…");
  status.setAttribute("role", "status");
  const list = node("div");
  const refresh = node("button", "Refresh celebrations");
  refresh.type = "button";
  let version = 0;
  let busy = false;
  let enabled = false;
  const preference = node("input");
  preference.type = "checkbox";
  const preferenceLabel = node("label");
  preferenceLabel.append(preference, node("span", " Notify me in-app when my early radio support earns a Discoverer rank."));
  panel.append(status);
  if (!artist) panel.append(preferenceLabel);
  panel.append(refresh, list);

  async function load(body) {
    const current = ++version;
    busy = true;
    refresh.disabled = preference.disabled = true;
    status.textContent = body ? "Saving…" : "Loading celebrations…";
    try {
      const state = await milestoneRequest(body);
      if (current !== version) return;
      enabled = state.enabled;
      preference.checked = enabled;
      const items = artist ? state.milestones : state.notifications;
      list.replaceChildren(...items.map(item => {
        if (artist) return artistMilestoneCard(item);
        const card = node("article", "", "milestone-card");
        card.append(node("h3", item.title), node("p", item.message));
        if (item.unread) {
          const seen = node("button", "Mark celebration seen");
          seen.type = "button";
          seen.addEventListener("click", () => { if (!busy) load({ action: "seen", releaseId: item.releaseId }); });
          card.append(seen);
        }
        return card;
      }));
      status.textContent = items.length ? "Celebrations up to date." : artist
        ? "No reviewed rotation milestones yet."
        : "No new celebrations. Opt in before a release reaches rotation to receive its private rank card.";
    } catch (error) {
      if (current !== version) return;
      list.replaceChildren();
      preference.checked = enabled;
      status.textContent = error.message;
    } finally {
      if (current === version) {
        busy = false;
        refresh.disabled = preference.disabled = false;
      }
    }
  }
  preference.addEventListener("change", () => { if (!busy) load({ action: "preferences", enabled: preference.checked }); });
  refresh.addEventListener("click", () => { if (!busy) load(); });
  window.addEventListener("halo-release-auth-changed", event => {
    ++version;
    list.replaceChildren();
    if (event.detail) load();
    else {
      busy = false;
      enabled = preference.checked = false;
      refresh.disabled = preference.disabled = false;
      status.textContent = "Sign in to view your milestones.";
    }
  });
  load();
}

if (typeof document !== "undefined") {
  document.querySelectorAll("[data-milestones]").forEach(mountMilestones);
}
