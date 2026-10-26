const API = "/api/track-drops";
const FALLBACK_ARTWORK = "/assets/releases/halo-premium-placeholder.svg";

const elements = {
  status: document.getElementById("drops-status"),
  signin: document.getElementById("drops-signin"),
  form: document.getElementById("drops-preferences"),
  consentRow: document.getElementById("email-consent-row"),
  save: document.getElementById("save-preferences"),
  rewards: document.getElementById("drops-rewards"),
  rewardTier: document.getElementById("reward-tier"),
  rewardPoints: document.getElementById("reward-points"),
  rewardMessage: document.getElementById("reward-message"),
  inbox: document.getElementById("drops-inbox"),
  list: document.getElementById("drops-list"),
  empty: document.getElementById("drops-empty"),
  markSeen: document.getElementById("mark-seen")
};

function setStatus(message) {
  elements.status.textContent = message;
}

function safeLink(value, fallback) {
  const url = typeof value === "string" ? value : "";
  return url.startsWith("/") && !url.startsWith("//") ? url : fallback;
}

function safeImage(value) {
  const url = typeof value === "string" ? value : "";
  return (url.startsWith("/") && !url.startsWith("//")) || url.startsWith("https://") ? url : FALLBACK_ARTWORK;
}

async function request(body) {
  const response = await fetch(API, body
    ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }
    : { credentials: "same-origin", headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || "Track drop alerts are unavailable right now"), { status: response.status });
  return data;
}

function renderRewards(rewards) {
  elements.rewards.hidden = !rewards?.enabled;
  if (!rewards?.enabled) return;
  elements.rewardTier.textContent = rewards.tier?.label || "Listener";
  elements.rewardPoints.textContent = String(Number(rewards.points) || 0);
  elements.rewardMessage.textContent = rewards.message || "";
}

function renderCard(card) {
  const item = document.createElement("li");
  item.className = "drop-card";
  item.dataset.unread = card.unread ? "true" : "false";
  const image = document.createElement("img");
  image.src = safeImage(card.artworkUrl);
  image.alt = card.artworkAlt || "";
  image.loading = "lazy";
  image.addEventListener("error", () => { image.src = FALLBACK_ARTWORK; }, { once: true });
  const body = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = card.unread ? `${card.eyebrow} · New` : card.eyebrow;
  const title = document.createElement("p");
  title.className = "drop-title";
  title.textContent = card.title;
  const artist = document.createElement("p");
  artist.className = "drop-artist";
  artist.textContent = card.artist;
  const actions = document.createElement("div");
  actions.className = "drop-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = card.ctaLabel;
  open.addEventListener("click", () => openDrop(card, open));
  const fallback = document.createElement("a");
  fallback.href = safeLink(card.fallbackUrl, "/music/");
  fallback.textContent = card.fallbackLabel;
  actions.append(open, fallback);
  body.append(eyebrow, title, artist, actions);
  item.append(image, body);
  return item;
}

function render(state) {
  const preferences = state.preferences || {};
  elements.form.hidden = false;
  elements.form.trackDropsInApp.checked = Boolean(preferences.trackDropsInApp);
  elements.form.trackDropsEmail.checked = Boolean(preferences.trackDropsEmail);
  elements.form.emailConsent.checked = Boolean(preferences.emailConsentGiven);
  elements.form.rewardsEnabled.checked = Boolean(preferences.rewardsEnabled);
  elements.consentRow.hidden = !elements.form.trackDropsEmail.checked;
  renderRewards(state.rewards);
  elements.inbox.hidden = !preferences.trackDropsInApp;
  const cards = Array.isArray(state.notifications) ? state.notifications : [];
  elements.list.replaceChildren(...cards.map(renderCard));
  elements.empty.hidden = cards.length > 0;
  elements.markSeen.hidden = !state.unreadCount;
}

async function openDrop(card, button) {
  button.disabled = true;
  let destination = safeLink(card.ctaUrl, "/music/");
  try {
    const result = await request({ action: "open-drop", dropId: card.id });
    destination = safeLink(result.ctaUrl, destination);
    if (result.message) setStatus(result.message);
  } catch {
    // Opening the release never depends on rewards being available.
  }
  window.location.assign(destination);
}

elements.form.trackDropsEmail.addEventListener("change", () => {
  elements.consentRow.hidden = !elements.form.trackDropsEmail.checked;
});

elements.form.addEventListener("submit", async event => {
  event.preventDefault();
  elements.save.disabled = true;
  setStatus("Saving your alert settings…");
  try {
    const state = await request({
      action: "update-preferences",
      trackDropsInApp: elements.form.trackDropsInApp.checked,
      trackDropsEmail: elements.form.trackDropsEmail.checked,
      emailConsent: elements.form.emailConsent.checked,
      rewardsEnabled: elements.form.rewardsEnabled.checked
    });
    render(state);
    setStatus(state.message || "Track drop alerts saved.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    elements.save.disabled = false;
  }
});

elements.markSeen.addEventListener("click", async () => {
  elements.markSeen.disabled = true;
  try {
    render(await request({ action: "mark-seen" }));
    setStatus("All track drops marked as seen.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    elements.markSeen.disabled = false;
  }
});

try {
  const state = await request();
  render(state);
  setStatus(state.unreadCount ? `${state.unreadCount} new track drop${state.unreadCount === 1 ? "" : "s"}.` : "Your alert settings are up to date.");
} catch (error) {
  if (error.status === 401) {
    elements.signin.hidden = false;
    setStatus("");
  } else {
    setStatus(error.message);
  }
}
