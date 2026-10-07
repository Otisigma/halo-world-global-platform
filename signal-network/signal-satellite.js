// HALO Signal satellite: floating dock, chat drawer and HALO Points rewards dialog.
// Points are a local engagement layer persisted in this browser only. They never
// grant ownership, licensing rights or paid access; fulfilment is confirmed by HALO.

export const SATELLITE_STORAGE_KEY = "halo_signal_satellite_v1";
export const SATELLITE_EVENT = "halo:signal-engagement";
export const COMMAND_PALETTE_EVENT = "halo:command-palette";

export const SATELLITE_CHANNELS = Object.freeze({
  inner_circle: "Inner Circle",
  collaborator_vault: "Collaborator Vault"
});

export const REWARD_CATALOG = Object.freeze([
  { id: "track_wav", title: "Unreleased Track WAV", cost: 150, desc: "Request a high-quality WAV of an upcoming demo." },
  { id: "gold_theme", title: "Gold Accent UI Theme", cost: 200, desc: "Request luxury gold highlights across your feed." },
  { id: "signal_boost", title: "24-Hour Signal Boost", cost: 300, desc: "Request a pinned spot at the top of the Public Frequency." },
  { id: "stem_pack", title: "Pro Stem Pack Access", cost: 350, desc: "Request multi-track WAV stems for remixing." },
  { id: "bronze_theme", title: "Midnight Bronze Theme", cost: 400, desc: "Request the dark-oak and brushed bronze UI." },
  { id: "featured_listing", title: "Featured Marketplace Spot", cost: 750, desc: "Request a 3-day front-page feature for your listing." }
].map(Object.freeze));

export const TIERS = Object.freeze([
  { name: "Initiate", minHP: 0 },
  { name: "Signal Artisan", minHP: 500 },
  { name: "Sonic Catalyst", minHP: 2500 },
  { name: "Vault Architect", minHP: 7500 },
  { name: "HALO Luminary", minHP: 20000 }
].map(Object.freeze));

// Anti-spam: every action has a per-day cap, the satellite has an overall daily
// ceiling, boosts and saves award once per post, and chat needs a cooldown plus
// non-duplicate, non-trivial text.
export const EARN_RULES = Object.freeze({
  chat: Object.freeze({ points: 2, dailyCap: 20, label: "Chat contribution" }),
  publish: Object.freeze({ points: 15, dailyCap: 45, label: "Published a signal" }),
  boost: Object.freeze({ points: 5, dailyCap: 25, label: "Boosted a signal", oncePerPost: true }),
  save: Object.freeze({ points: 2, dailyCap: 10, label: "Saved a signal", oncePerPost: true }),
  comment: Object.freeze({ points: 3, dailyCap: 15, label: "Commented on a signal" })
});
export const DAILY_CEILING = 100;
export const WELCOME_BONUS = 100;
export const CHAT_COOLDOWN_MS = 15000;
export const CHAT_MIN_LENGTH = 3;
export const MESSAGE_MAX_LENGTH = 500;

const MAX_HISTORY = 50;
const MAX_MESSAGES = 100;
const MAX_TRACKED_POSTS = 200;
const MAX_POINTS = 1e9;

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const count = value => Number.isFinite(value) && value > 0 ? Math.floor(Math.min(value, MAX_POINTS)) : 0;
const text = (value, max) => typeof value === "string" ? value.slice(0, max) : "";
const pad = value => String(value).padStart(2, "0");

export function dayKey(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function emptyDaily(ms) {
  return { day: dayKey(ms), total: 0, earned: Object.fromEntries(Object.keys(EARN_RULES).map(kind => [kind, 0])) };
}

export function defaultState(ms = Date.now()) {
  return {
    version: 1,
    welcomed: false,
    points: 0,
    lifetimePoints: 0,
    history: [],
    messages: [],
    unread: 0,
    activeChannel: "inner_circle",
    redeemedRewards: [],
    daily: emptyDaily(ms),
    awardedPosts: { boost: [], save: [] },
    lastChatAwardAt: 0,
    lastChatText: ""
  };
}

export function sanitizeState(raw, ms = Date.now()) {
  const state = defaultState(ms);
  if (!isObject(raw)) return state;
  state.welcomed = raw.welcomed === true;
  state.lifetimePoints = count(raw.lifetimePoints);
  state.points = Math.min(count(raw.points), state.lifetimePoints);
  state.history = (Array.isArray(raw.history) ? raw.history : [])
    .filter(item => isObject(item) && typeof item.reason === "string" && Number.isFinite(item.pts))
    .slice(0, MAX_HISTORY)
    .map(item => ({ id: text(item.id, 40), reason: text(item.reason, 140), pts: Math.trunc(item.pts), at: text(item.at, 40) }));
  state.messages = (Array.isArray(raw.messages) ? raw.messages : [])
    .filter(item => isObject(item) && typeof item.text === "string" && Object.hasOwn(SATELLITE_CHANNELS, item.channel))
    .slice(-MAX_MESSAGES)
    .map(item => ({
      id: text(item.id, 40), sender: text(item.sender, 40) || "You", text: text(item.text, MESSAGE_MAX_LENGTH),
      channel: item.channel, at: text(item.at, 40), system: item.system === true
    }));
  state.unread = Math.min(count(raw.unread), 999);
  if (Object.hasOwn(SATELLITE_CHANNELS, raw.activeChannel)) state.activeChannel = raw.activeChannel;
  const known = new Set(REWARD_CATALOG.map(reward => reward.id));
  state.redeemedRewards = [...new Set(Array.isArray(raw.redeemedRewards) ? raw.redeemedRewards : [])].filter(id => known.has(id));
  if (isObject(raw.daily) && raw.daily.day === state.daily.day) {
    for (const kind of Object.keys(EARN_RULES)) {
      state.daily.earned[kind] = Math.min(count(raw.daily.earned?.[kind]), EARN_RULES[kind].dailyCap);
    }
    state.daily.total = Math.min(count(raw.daily.total), DAILY_CEILING);
  }
  for (const kind of Object.keys(state.awardedPosts)) {
    const posts = isObject(raw.awardedPosts) && Array.isArray(raw.awardedPosts[kind]) ? raw.awardedPosts[kind] : [];
    state.awardedPosts[kind] = posts.filter(id => typeof id === "string" && id).map(id => id.slice(0, 120)).slice(-MAX_TRACKED_POSTS);
  }
  state.lastChatAwardAt = count(raw.lastChatAwardAt);
  state.lastChatText = text(raw.lastChatText, MESSAGE_MAX_LENGTH);
  return state;
}

export function tierFor(lifetimePoints) {
  const lifetime = count(lifetimePoints);
  let index = 0;
  TIERS.forEach((tier, position) => { if (lifetime >= tier.minHP) index = position; });
  const tier = TIERS[index];
  const next = TIERS[index + 1] || null;
  const progress = next ? Math.min(100, Math.round(((lifetime - tier.minHP) / (next.minHP - tier.minHP)) * 100)) : 100;
  return { tier, index, next, progress, lifetime };
}

export function createSatelliteEngine({ storage = null, now = () => Date.now(), onChange = () => {} } = {}) {
  let sequence = 0;
  let persistFailed = false;
  let state = load();
  const id = () => `${now().toString(36)}-${(sequence++).toString(36)}`;

  function load() {
    let raw = null;
    try {
      const saved = storage?.getItem?.(SATELLITE_STORAGE_KEY);
      if (saved) raw = JSON.parse(saved);
    } catch { raw = null; }
    return sanitizeState(raw, now());
  }

  function commit() {
    try {
      storage?.setItem?.(SATELLITE_STORAGE_KEY, JSON.stringify(state));
      persistFailed = false;
    } catch {
      persistFailed = true;
    }
    onChange(state);
  }

  function rollDay() {
    if (state.daily.day !== dayKey(now())) state.daily = emptyDaily(now());
  }

  function record(reason, pts) {
    state.history.unshift({ id: id(), reason, pts, at: new Date(now()).toISOString() });
    state.history.length = Math.min(state.history.length, MAX_HISTORY);
  }

  function pushMessage(message) {
    state.messages.push({ id: id(), channel: state.activeChannel, at: new Date(now()).toISOString(), system: false, ...message });
    if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES);
  }

  function grant(kind, postId) {
    const rule = EARN_RULES[kind];
    if (!rule) return { awarded: 0, reason: "unknown" };
    rollDay();
    if (rule.oncePerPost) {
      if (typeof postId !== "string" || !postId) return { awarded: 0, reason: "invalid" };
      if (state.awardedPosts[kind].includes(postId)) return { awarded: 0, reason: "repeat" };
    }
    const remaining = Math.min(rule.dailyCap - state.daily.earned[kind], DAILY_CEILING - state.daily.total);
    if (remaining <= 0) return { awarded: 0, reason: "cap" };
    const pts = Math.min(rule.points, remaining);
    state.points += pts;
    state.lifetimePoints += pts;
    state.daily.earned[kind] += pts;
    state.daily.total += pts;
    if (rule.oncePerPost) {
      state.awardedPosts[kind].push(postId.slice(0, 120));
      if (state.awardedPosts[kind].length > MAX_TRACKED_POSTS) state.awardedPosts[kind].shift();
    }
    record(rule.label, pts);
    return { awarded: pts, reason: rule.label };
  }

  if (!state.welcomed) {
    state.welcomed = true;
    state.points += WELCOME_BONUS;
    state.lifetimePoints += WELCOME_BONUS;
    record("Welcome to the Signal satellite", WELCOME_BONUS);
    commit();
  }

  return {
    getState: () => JSON.parse(JSON.stringify(state)),
    get persistFailed() { return persistFailed; },
    reload() { state = load(); onChange(state); },
    award(kind, { postId } = {}) {
      const result = grant(kind, postId);
      if (result.awarded) commit();
      return result;
    },
    sendMessage(input) {
      const clean = String(input ?? "").replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX_LENGTH);
      if (!clean) return { ok: false, reason: "empty", award: { awarded: 0, reason: "empty" } };
      pushMessage({ sender: "You", text: clean });
      const normalized = clean.toLowerCase();
      let award;
      if (clean.length < CHAT_MIN_LENGTH) award = { awarded: 0, reason: "short" };
      else if (normalized === state.lastChatText) award = { awarded: 0, reason: "duplicate" };
      else if (now() - state.lastChatAwardAt < CHAT_COOLDOWN_MS) award = { awarded: 0, reason: "cooldown" };
      else {
        award = grant("chat");
        if (award.awarded) state.lastChatAwardAt = now();
      }
      state.lastChatText = normalized;
      commit();
      return { ok: true, award };
    },
    notify(message, { unread = true } = {}) {
      pushMessage({ sender: "HALO", text: String(message).slice(0, MESSAGE_MAX_LENGTH), system: true });
      if (unread) state.unread = Math.min(state.unread + 1, 999);
      commit();
    },
    redeem(rewardId) {
      const reward = REWARD_CATALOG.find(item => item.id === rewardId);
      if (!reward) return { ok: false, reason: "unknown" };
      if (state.redeemedRewards.includes(reward.id)) return { ok: false, reason: "redeemed", reward };
      if (state.points < reward.cost) return { ok: false, reason: "insufficient", reward };
      state.points -= reward.cost;
      state.redeemedRewards.push(reward.id);
      record(`Redeemed: ${reward.title}`, -reward.cost);
      commit();
      return { ok: true, reward };
    },
    setChannel(channel) {
      if (!Object.hasOwn(SATELLITE_CHANNELS, channel) || channel === state.activeChannel) return false;
      state.activeChannel = channel;
      commit();
      return true;
    },
    markRead() {
      if (!state.unread) return;
      state.unread = 0;
      commit();
    }
  };
}

function formatTime(iso, options) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try { return options === "date" ? date.toLocaleDateString() : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

export function createSignalSatellite({
  document = globalThis.document,
  window = globalThis.window,
  storage
} = {}) {
  const cleanups = [];
  const listen = (target, type, handler) => {
    target?.addEventListener?.(type, handler);
    cleanups.push(() => target?.removeEventListener?.(type, handler));
  };
  let engine = null;
  const controller = {
    get engine() { return engine; },
    openDrawer: () => false,
    closeDrawer: () => false,
    openRewards: () => false,
    closeRewards: () => false,
    destroy() { cleanups.splice(0).forEach(cleanup => cleanup()); }
  };

  function initialize() {
    const byId = id => document?.getElementById?.(id);
    const root = document?.querySelector?.("[data-signal-satellite]");
    const el = {
      pointsBtn: byId("haloPointsBadgeBtn"), points: byId("haloUserPointsDisplay"), tier: byId("haloUserTierDisplay"),
      chatBtn: byId("haloChatToggleBtn"), unread: byId("haloChatUnread"), unreadLabel: byId("haloChatUnreadLabel"),
      drawer: byId("haloChatDrawer"), closeChat: byId("haloCloseChatBtn"), messages: byId("haloChatMessages"),
      form: byId("haloChatForm"), input: byId("haloChatMessageInput"), chatStatus: byId("haloChatStatus"),
      modal: byId("haloRewardsModal"), closeRewards: byId("haloCloseRewardsBtn"), balance: byId("modalPointsBalance"),
      modalTier: byId("modalCurrentTier"), nextLabel: byId("modalNextTierLabel"), nextReq: byId("modalNextTierReq"),
      progress: byId("modalTierProgress"), progressFill: byId("modalTierProgressBar"), rewards: byId("haloRewardsGrid"),
      rewardStatus: byId("haloRewardStatus"), tiersBody: byId("haloTiersBody"), rules: byId("haloEarnRules"),
      history: byId("haloEarnHistoryList"), status: byId("haloSatelliteStatus")
    };
    if (!root || !el.pointsBtn || !el.chatBtn || !el.drawer || !el.modal || !el.form) return;
    if (storage === undefined) {
      try { storage = window?.localStorage ?? null; } catch { storage = null; }
    }

    const node = (tag, content, className) => {
      const result = document.createElement(tag);
      if (content != null) result.textContent = String(content);
      if (className) result.className = className;
      return result;
    };
    const announce = (message, target = el.status) => { if (target) target.textContent = message; };
    let drawerOpener = null;
    let modalOpener = null;
    let renderedChannel = null;
    const renderedIds = new Set();
    const rewardButtons = new Map();
    let persistWarned = false;

    function renderMessages(state) {
      if (!el.messages) return;
      const list = state.messages.filter(message => message.channel === state.activeChannel);
      const stale = renderedChannel !== state.activeChannel || [...renderedIds].some(id => !list.some(message => message.id === id));
      if (stale) {
        renderedIds.clear();
        renderedChannel = state.activeChannel;
        const notice = node("p", `Channel: ${SATELLITE_CHANNELS[state.activeChannel]} · notes stay in this browser`, "halo-satellite__notice");
        el.messages.replaceChildren(notice);
      }
      for (const message of list) {
        if (renderedIds.has(message.id)) continue;
        renderedIds.add(message.id);
        const own = message.sender === "You" && !message.system;
        const bubble = node("div", null, `halo-satellite__bubble ${own ? "is-me" : message.system ? "is-system" : "is-other"}`);
        const time = formatTime(message.at);
        bubble.append(node("span", time ? `${message.sender} · ${time}` : message.sender, "halo-satellite__meta"), node("span", message.text));
        el.messages.append(bubble);
      }
      el.messages.scrollTop = el.messages.scrollHeight;
    }

    function buildStatic() {
      if (el.rewards) {
        el.rewards.replaceChildren(...REWARD_CATALOG.map(reward => {
          const card = node("article", null, "halo-satellite__reward");
          const body = node("div");
          body.append(node("h4", reward.title), node("p", reward.desc));
          const footer = node("div", null, "halo-satellite__reward-footer");
          const button = node("button", "Redeem", "halo-satellite__redeem");
          button.type = "button";
          button.dataset.rewardId = reward.id;
          rewardButtons.set(reward.id, button);
          footer.append(node("span", `${reward.cost} HP`, "halo-satellite__cost"), button);
          card.append(body, footer);
          return card;
        }));
      }
      if (el.tiersBody) {
        el.tiersBody.replaceChildren(...TIERS.map((tier, index) => {
          const row = node("tr");
          row.dataset.tier = tier.name;
          const next = TIERS[index + 1];
          row.append(node("td", tier.name), node("td", next ? `${tier.minHP.toLocaleString()}–${(next.minHP - 1).toLocaleString()} HP` : `${tier.minHP.toLocaleString()}+ HP`));
          return row;
        }));
      }
      if (el.rules) {
        el.rules.replaceChildren(...Object.values(EARN_RULES).map(rule => node("li",
          `${rule.label}: +${rule.points} HP${rule.oncePerPost ? " once per post" : ""}, up to ${rule.dailyCap} HP per day`)),
        node("li", `All activity: up to ${DAILY_CEILING} HP per day. Chat needs ${CHAT_MIN_LENGTH}+ characters, no repeats and ${CHAT_COOLDOWN_MS / 1000}s between earning messages.`));
      }
    }

    function render(state) {
      const { tier, next, progress, lifetime } = tierFor(state.lifetimePoints);
      if (el.points) el.points.textContent = state.points.toLocaleString();
      if (el.tier) el.tier.textContent = tier.name;
      if (el.balance) el.balance.textContent = `${state.points.toLocaleString()} HP`;
      if (el.modalTier) el.modalTier.textContent = tier.name;
      if (el.nextLabel) el.nextLabel.textContent = next ? `Next: ${next.name}` : "Top tier reached";
      if (el.nextReq) el.nextReq.textContent = next ? `${lifetime.toLocaleString()} / ${next.minHP.toLocaleString()} lifetime HP` : `${lifetime.toLocaleString()} lifetime HP`;
      if (el.progressFill) el.progressFill.style.width = `${progress}%`;
      if (el.progress) {
        el.progress.setAttribute("aria-valuenow", String(progress));
        el.progress.setAttribute("aria-valuetext", next ? `${progress}% of the way to ${next.name}` : "Top tier reached");
      }
      if (el.unread) {
        el.unread.hidden = !state.unread;
        el.unread.textContent = state.unread > 99 ? "99+" : String(state.unread);
      }
      if (el.unreadLabel) el.unreadLabel.textContent = state.unread ? `, ${state.unread} unread` : "";
      for (const tab of root.querySelectorAll("[data-satellite-channel]")) {
        const active = tab.dataset.satelliteChannel === state.activeChannel;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        tab.classList.toggle("is-active", active);
      }
      if (el.messages) el.messages.setAttribute("aria-label", `${SATELLITE_CHANNELS[state.activeChannel]} messages`);
      renderMessages(state);
      for (const reward of REWARD_CATALOG) {
        const button = rewardButtons.get(reward.id);
        if (!button) continue;
        const redeemed = state.redeemedRewards.includes(reward.id);
        const shortfall = reward.cost - state.points;
        button.disabled = redeemed || shortfall > 0;
        button.textContent = redeemed ? "Requested" : shortfall > 0 ? `Need ${shortfall} HP` : "Redeem";
        button.setAttribute("aria-label", `${button.textContent}: ${reward.title}, ${reward.cost} HP`);
      }
      el.tiersBody?.querySelectorAll?.("tr").forEach(row => {
        const current = row.dataset.tier === tier.name;
        row.classList.toggle("is-current", current);
        if (current) row.setAttribute("aria-current", "true"); else row.removeAttribute("aria-current");
      });
      if (el.history) {
        el.history.replaceChildren(...(state.history.length ? state.history.map(entry => {
          const item = node("li", null, "halo-satellite__history-item");
          const label = node("span", entry.reason);
          const date = formatTime(entry.at, "date");
          if (date) label.append(" ", node("small", `(${date})`));
          item.append(label, node("span", `${entry.pts >= 0 ? "+" : "−"}${Math.abs(entry.pts)} HP`, entry.pts >= 0 ? "is-earn" : "is-spend"));
          return item;
        }) : [node("li", "No HALO Points activity yet.", "halo-satellite__history-item")]));
      }
      if (engine?.persistFailed && !persistWarned) {
        persistWarned = true;
        announce("HALO Points can't be saved in this browser; progress resets when you leave.");
      }
    }

    buildStatic();
    engine = createSatelliteEngine({ storage, onChange: state => render(state) });
    render(engine.getState());
    root.hidden = false;

    const drawerOpen = () => !el.drawer.hidden;
    function openDrawer() {
      drawerOpener = document.activeElement && document.activeElement !== document.body ? document.activeElement : el.chatBtn;
      el.drawer.hidden = false;
      el.chatBtn.setAttribute("aria-expanded", "true");
      engine.markRead();
      render(engine.getState());
      el.input?.focus?.();
      return true;
    }
    function closeDrawer({ restoreFocus = true } = {}) {
      if (!drawerOpen()) return false;
      const hadFocus = el.drawer.contains?.(document.activeElement);
      el.drawer.hidden = true;
      el.chatBtn.setAttribute("aria-expanded", "false");
      if (restoreFocus && hadFocus) (drawerOpener?.isConnected === false ? el.chatBtn : drawerOpener || el.chatBtn).focus?.();
      drawerOpener = null;
      return true;
    }
    function openRewards() {
      if (el.modal.open) return false;
      modalOpener = document.activeElement || el.pointsBtn;
      announce("", el.rewardStatus);
      if (typeof el.modal.showModal === "function") el.modal.showModal();
      else el.modal.setAttribute("open", "");
      el.pointsBtn.setAttribute("aria-expanded", "true");
      el.closeRewards?.focus?.();
      return true;
    }
    function closeRewards() {
      if (!el.modal.open && !el.modal.hasAttribute?.("open")) return false;
      if (typeof el.modal.close === "function") el.modal.close();
      else { el.modal.removeAttribute("open"); onModalClosed(); }
      return true;
    }
    function onModalClosed() {
      el.pointsBtn.setAttribute("aria-expanded", "false");
      const target = modalOpener?.isConnected === false ? el.pointsBtn : modalOpener || el.pointsBtn;
      modalOpener = null;
      target.focus?.();
    }
    Object.assign(controller, { openDrawer, closeDrawer, openRewards, closeRewards });

    listen(el.chatBtn, "click", () => drawerOpen() ? closeDrawer({ restoreFocus: false }) : openDrawer());
    listen(el.closeChat, "click", () => { el.chatBtn.focus?.(); closeDrawer({ restoreFocus: false }); });
    listen(el.pointsBtn, "click", openRewards);
    listen(el.closeRewards, "click", closeRewards);
    listen(el.modal, "close", onModalClosed);
    listen(el.modal, "click", event => { if (event.target === el.modal) closeRewards(); });

    const channelTabs = () => [...root.querySelectorAll("[data-satellite-channel]")];
    for (const tab of channelTabs()) {
      listen(tab, "click", () => {
        engine.setChannel(tab.dataset.satelliteChannel);
        announce(`Switched to ${SATELLITE_CHANNELS[tab.dataset.satelliteChannel]}.`, el.chatStatus);
      });
      listen(tab, "keydown", event => rovingKeys(event, channelTabs(), next => { next.focus(); next.click(); }));
    }

    const modalTabs = () => [...el.modal.querySelectorAll("[data-satellite-tab]")];
    function selectModalTab(selected) {
      for (const tab of modalTabs()) {
        const active = tab === selected;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        tab.classList.toggle("is-active", active);
        const panel = byId(tab.getAttribute("aria-controls"));
        if (panel) panel.hidden = !active;
      }
    }
    for (const tab of modalTabs()) {
      listen(tab, "click", () => selectModalTab(tab));
      listen(tab, "keydown", event => rovingKeys(event, modalTabs(), next => { selectModalTab(next); next.focus(); }));
    }

    listen(el.form, "submit", event => {
      event.preventDefault();
      const result = engine.sendMessage(el.input?.value);
      if (!result.ok) { announce("Type a message before sending.", el.chatStatus); return; }
      if (el.input) el.input.value = "";
      const { awarded, reason } = result.award;
      const messages = {
        short: `Sent. Messages need ${CHAT_MIN_LENGTH}+ characters to earn HALO Points.`,
        duplicate: "Sent. Repeated messages don't earn HALO Points.",
        cooldown: `Sent. Next chat points unlock ${CHAT_COOLDOWN_MS / 1000}s after your last earning message.`,
        cap: "Sent. Today's chat points are maxed out."
      };
      announce(awarded ? `Sent. +${awarded} HP for chat contribution.` : messages[reason] || "Sent.", el.chatStatus);
    });

    listen(el.rewards, "click", event => {
      const button = event.target?.closest?.("[data-reward-id]");
      if (!button || button.disabled) return;
      const result = engine.redeem(button.dataset.rewardId);
      if (result.ok) {
        const message = `Request recorded: ${result.reward.title}. HALO will confirm fulfilment separately.`;
        announce(message, el.rewardStatus);
        engine.notify(message, { unread: !drawerOpen() });
        el.rewardStatus?.focus?.();
      } else if (result.reason === "insufficient") {
        announce(`You need ${result.reward.cost - engine.getState().points} more HP for ${result.reward.title}.`, el.rewardStatus);
      } else if (result.reason === "redeemed") {
        announce(`${result.reward.title} has already been requested.`, el.rewardStatus);
      }
    });

    // Feed integration: signal-feed.js dispatches this only after the server confirms the action.
    listen(document, SATELLITE_EVENT, event => {
      const detail = isObject(event?.detail) ? event.detail : {};
      if (!Object.hasOwn(EARN_RULES, detail.kind) || detail.kind === "chat" || detail.active === false) return;
      const result = engine.award(detail.kind, { postId: typeof detail.postId === "string" ? detail.postId : "" });
      if (!result.awarded) return;
      const message = `+${result.awarded} HP · ${result.reason}`;
      engine.notify(message, { unread: !drawerOpen() });
      announce(`${message}. Balance ${engine.getState().points} HP.`);
    });

    listen(document, "keydown", event => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && drawerOpen() && !el.modal.open) {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (String(event.key).toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || el.modal.open) return;
      event.preventDefault();
      const Custom = window?.CustomEvent || globalThis.CustomEvent;
      if (typeof Custom === "function") {
        const palette = new Custom(COMMAND_PALETTE_EVENT, { cancelable: true, detail: { source: "signal-satellite" } });
        document.dispatchEvent(palette);
        if (palette.defaultPrevented) return;
      }
      const search = document.querySelector("[data-halo-command-search]");
      if (search && !search.disabled && !search.closest("[hidden]")) {
        const panel = search.closest("[data-signal-panel]");
        if (panel?.hidden) document.querySelector(`[data-signal-tab="${panel.dataset.signalPanel}"]`)?.click();
        search.focus();
        search.select?.();
        return;
      }
      const fallback = document.querySelector("[data-halo-search-fallback]");
      announce("Sign in to Signal Network to search collaborators.");
      if (fallback && !fallback.closest("[hidden]")) fallback.focus();
    });

    listen(window, "storage", event => {
      if (event.key === SATELLITE_STORAGE_KEY) engine.reload();
    });
  }

  function rovingKeys(event, tabs, activate) {
    const index = tabs.indexOf(event.currentTarget);
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next === undefined || index < 0) return;
    event.preventDefault();
    activate(tabs[next]);
  }

  if (document?.readyState === "loading") listen(document, "DOMContentLoaded", initialize);
  else initialize();
  return controller;
}

if (globalThis.document) createSignalSatellite();
