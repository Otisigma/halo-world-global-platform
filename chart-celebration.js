(() => {
  // Living Chart #1 celebration, social post formatter and Public Frequency broadcast.
  // Shared by the shop (/music, /music-upload) and the Signal Network public feed.
  const root = typeof window !== "undefined" ? window : globalThis;
  const CANONICAL_ORIGIN = "https://halo-world-global-platform.netlify.app";
  const CANONICAL_PATH = "/music-upload/";
  const CELEBRATED_STORAGE_KEY = "halo.livingChart.celebratedLeader";
  const BROADCAST_STORAGE_KEY = "halo.publicFrequency.chartBroadcast";
  const BROADCAST_CHANNEL = "halo-public-frequency";
  const BROADCAST_EVENT = "halo:public-frequency-broadcast";
  const BROADCAST_TYPE = "living-chart-number-one";
  const SIGNAL_FEED_PATH = "/signal-network/#feed";
  const CONFETTI_PIECES = 28;
  const SOCIAL_PLATFORMS = Object.freeze([
    Object.freeze({ id: "signal", label: "Signal Network", limit: 1000 }),
    Object.freeze({ id: "instagram", label: "Instagram", limit: 2200 }),
    Object.freeze({ id: "tiktok", label: "TikTok", limit: 2200 }),
    Object.freeze({ id: "x", label: "X", limit: 280 })
  ]);

  function clean(value, max = 120) {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function safeUrl(value, fallback = "") {
    try {
      const base = root.location?.origin && /^https?:/.test(root.location.origin) ? root.location.origin : CANONICAL_ORIGIN;
      const url = new URL(String(value ?? ""), base);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : fallback;
    } catch {
      return fallback;
    }
  }

  function canonicalTrackUrl(releaseId, { origin = CANONICAL_ORIGIN } = {}) {
    const base = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(String(origin || "")) ? origin : CANONICAL_ORIGIN;
    const url = new URL(CANONICAL_PATH, base);
    const id = clean(releaseId, 96);
    if (id) url.searchParams.set("song", id);
    return url.href;
  }

  function normalizeMomentum(momentum) {
    const value = clean(momentum?.value, 16);
    const label = clean(momentum?.label, 24);
    if (!value && !label) return { value: "—", label: "Holding" };
    return { value: value || "—", label: label || "Holding" };
  }

  function momentumText(momentum) {
    const { value, label } = normalizeMomentum(momentum);
    return value === "—" ? label : `${value} ${label}`;
  }

  function trackFromRelease(release = {}) {
    const activity = release.chartActivity || {};
    return {
      id: clean(release.id, 96),
      title: clean(release.title) || "Untitled",
      artist: clean(release.artist) || "HALO artist",
      artwork: safeUrl(release.artwork || release.artworkUrl || ""),
      rank: Number(release.rank || 1),
      signalScore: Number(release.signalScore || 0),
      momentum: normalizeMomentum(release.momentum),
      metrics: {
        recentListens: Number(activity.recentListens || 0),
        recentOpens: Number(activity.recentOpens || 0),
        votes: Number(release.votes || 0)
      }
    };
  }

  function hashtag(value) {
    const tag = String(value || "").normalize("NFKD").replace(/[^A-Za-z0-9]/g, "");
    return tag && tag.length <= 30 ? `#${tag}` : "";
  }

  function socialPostParts(track, platform, options) {
    const title = clean(track.title) || "Untitled";
    const artist = clean(track.artist) || "HALO artist";
    return { title, artist, momentum: momentumText(track.momentum), url: canonicalTrackUrl(track.id, options), artistTag: hashtag(artist) };
  }

  function composeSocialPost({ title, artist, momentum, url, artistTag }, platform) {
    if (platform === "instagram") {
      return [
        "👑 NEW #1 ON THE LIVING CHART 👑",
        "",
        `“${title}” — ${artist}`,
        `📈 7-day momentum: ${momentum}`,
        "",
        "Listen, vote and keep it at the top:",
        url,
        "",
        ["#HALOWorld", "#TheLivingChart", "#NewMusic", "#NumberOne", artistTag].filter(Boolean).join(" ")
      ].join("\n");
    }
    if (platform === "tiktok") {
      return [
        `#1 on The Living Chart 🔥 “${title}” by ${artist}`,
        `7-day momentum: ${momentum}`,
        `Listen + vote: ${url}`,
        ["#HALOWorld", "#LivingChart", "#NewMusic", "#fyp", artistTag].filter(Boolean).join(" ")
      ].join("\n");
    }
    if (platform === "x") {
      return `🏆 New #1 on The Living Chart: “${title}” by ${artist} (${momentum}, 7 days). Listen + vote: ${url} #HALOWorld`;
    }
    return [
      "🏆 #1 on The Living Chart",
      `“${title}” by ${artist} just took the top spot on HALO.`,
      `7-day momentum: ${momentum}`,
      `Listen, vote and share: ${url}`
    ].join("\n");
  }

  // Produces platform-optimized copy; posts always fit the platform's character limit.
  function formatSocialPost(track = {}, platform = "signal", options = {}) {
    const target = SOCIAL_PLATFORMS.find(item => item.id === platform) || SOCIAL_PLATFORMS[0];
    const parts = socialPostParts(track, target.id, options);
    let post = composeSocialPost(parts, target.id);
    while (post.length > target.limit && parts.title.length > 1) {
      parts.title = `${parts.title.slice(0, Math.max(1, parts.title.length - (post.length - target.limit) - 1)).trimEnd()}…`;
      post = composeSocialPost(parts, target.id);
      if (parts.title.length <= 2) break;
    }
    return post.slice(0, target.limit);
  }

  function shouldCelebrate(leader, lastCelebratedId = "") {
    if (!leader?.id) return false;
    if (Number(leader.rank || 1) !== 1) return false;
    if (!(Number(leader.signalScore || 0) > 0)) return false;
    return String(leader.id) !== String(lastCelebratedId || "");
  }

  function readStorage(key) {
    try { return root.localStorage?.getItem(key) || ""; } catch { return ""; }
  }

  function writeStorage(key, value) {
    try { root.localStorage?.setItem(key, value); } catch {}
  }

  function broadcastPayload(track, options = {}) {
    const momentum = momentumText(track.momentum);
    return {
      type: BROADCAST_TYPE,
      releaseId: track.id,
      title: track.title,
      artist: track.artist,
      artwork: track.artwork,
      momentum: normalizeMomentum(track.momentum),
      metrics: { ...track.metrics },
      url: canonicalTrackUrl(track.id, options),
      message: `“${track.title}” by ${track.artist} is #1 on The Living Chart (${momentum}, 7 days).`,
      at: new Date().toISOString()
    };
  }

  // Notifies open Public Frequency feeds (this tab, other tabs) that a new #1 landed.
  function broadcast(track, options = {}) {
    const payload = broadcastPayload(track, options);
    writeStorage(BROADCAST_STORAGE_KEY, JSON.stringify(payload));
    try { root.dispatchEvent?.(new CustomEvent(BROADCAST_EVENT, { detail: payload })); } catch {}
    try {
      if (typeof root.BroadcastChannel === "function") {
        const channel = new root.BroadcastChannel(BROADCAST_CHANNEL);
        channel.postMessage(payload);
        channel.close();
      }
    } catch {}
    return payload;
  }

  function subscribeBroadcasts(handler) {
    const accept = payload => { if (payload?.type === BROADCAST_TYPE && payload.releaseId) handler(payload); };
    const onEvent = event => accept(event.detail);
    root.addEventListener?.(BROADCAST_EVENT, onEvent);
    let channel = null;
    try {
      if (typeof root.BroadcastChannel === "function") {
        channel = new root.BroadcastChannel(BROADCAST_CHANNEL);
        channel.addEventListener("message", event => accept(event.data));
      }
    } catch {}
    return () => {
      root.removeEventListener?.(BROADCAST_EVENT, onEvent);
      channel?.close();
    };
  }

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  async function copyText(text, textarea) {
    try {
      await root.navigator.clipboard.writeText(text);
      return true;
    } catch {
      textarea?.focus();
      textarea?.select();
      return false;
    }
  }

  function metricList(doc, track) {
    const list = el(doc, "dl", "chart-celebration__metrics");
    for (const [label, value, highlight] of [
      ["7-day momentum", momentumText(track.momentum), true],
      ["Listens · 7 days", track.metrics.recentListens],
      ["Room opens · 7 days", track.metrics.recentOpens],
      ["Fan votes", track.metrics.votes]
    ]) {
      const item = el(doc, "div", highlight ? "is-momentum" : "");
      item.append(el(doc, "dt", "", label), el(doc, "dd", "", value));
      list.append(item);
    }
    return list;
  }

  function shareDrawer(doc, track, options) {
    const drawer = el(doc, "section", "chart-celebration__share");
    drawer.setAttribute("aria-label", "Share the new #1");
    drawer.append(el(doc, "h3", "", "Share the #1"));
    const tabs = el(doc, "div", "chart-celebration__platforms");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Choose a platform");
    const preview = el(doc, "textarea", "chart-celebration__preview");
    preview.readOnly = true;
    preview.rows = 7;
    preview.setAttribute("aria-label", "Social post preview");
    const count = el(doc, "p", "chart-celebration__count");
    const status = el(doc, "p", "chart-celebration__status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    let active = SOCIAL_PLATFORMS[0];
    const select = platform => {
      active = platform;
      preview.value = formatSocialPost(track, platform.id, options);
      count.textContent = `${preview.value.length} / ${platform.limit} characters · ${platform.label}`;
      status.textContent = "";
      tabs.querySelectorAll("[data-celebration-platform]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.celebrationPlatform === platform.id));
      });
    };
    for (const platform of SOCIAL_PLATFORMS) {
      const button = el(doc, "button", "", platform.label);
      button.type = "button";
      button.dataset.celebrationPlatform = platform.id;
      button.addEventListener("click", () => select(platform));
      tabs.append(button);
    }
    const actions = el(doc, "div", "chart-celebration__actions");
    const copy = el(doc, "button", "chart-celebration__copy", "Copy post");
    copy.type = "button";
    copy.dataset.celebrationCopy = "";
    copy.addEventListener("click", async () => {
      const copied = await copyText(preview.value, preview);
      status.textContent = copied ? `${active.label} post copied to your clipboard.` : "Post selected — press Ctrl+C or ⌘C to copy.";
      root.haloStats?.track?.("copy_chart_number_one_post", { target: active.id, track: track.id });
    });
    const feedLink = el(doc, "a", "chart-celebration__feed-link", "Open the Public Frequency ↗");
    feedLink.href = SIGNAL_FEED_PATH;
    actions.append(copy, feedLink);
    drawer.append(tabs, preview, count, actions, status);
    select(active);
    return drawer;
  }

  function confetti(doc) {
    const layer = el(doc, "div", "chart-celebration__confetti");
    layer.setAttribute("aria-hidden", "true");
    for (let index = 0; index < CONFETTI_PIECES; index += 1) {
      const piece = el(doc, "i");
      piece.style.setProperty("--x", `${(index * 37) % 100}%`);
      piece.style.setProperty("--delay", `${(index % 7) * 0.18}s`);
      piece.style.setProperty("--spin", `${(index % 2 ? 1 : -1) * (180 + (index * 29) % 360)}deg`);
      piece.style.setProperty("--hue", String([45, 50, 38, 0, 180][index % 5]));
      layer.append(piece);
    }
    return layer;
  }

  // Gold celebration modal with artwork, metrics and the share drawer.
  function celebrate(release, options = {}) {
    const doc = options.document || root.document;
    if (!doc?.body) return null;
    const track = release?.metrics ? release : trackFromRelease(release);
    doc.querySelector("[data-chart-celebration]")?.remove();
    const previousFocus = doc.activeElement;
    const overlay = el(doc, "div", `chart-celebration${options.confetti === false ? " is-share-only" : ""}`);
    overlay.dataset.chartCelebration = track.id;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "chartCelebrationTitle");
    const panel = el(doc, "div", "chart-celebration__panel");
    const close = el(doc, "button", "chart-celebration__close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close celebration");
    const banner = el(doc, "p", "chart-celebration__banner", options.confetti === false ? "#1 · The Living Chart" : "🏆 New #1 · The Living Chart");
    const hero = el(doc, "div", "chart-celebration__hero");
    const art = el(doc, "div", "chart-celebration__art");
    if (track.artwork) {
      const image = el(doc, "img");
      image.src = track.artwork;
      image.alt = `${track.title} cover artwork`;
      art.append(image);
    }
    art.append(el(doc, "span", "chart-celebration__rank", "#1"));
    const copy = el(doc, "div", "chart-celebration__copy-block");
    const title = el(doc, "h2", "", track.title);
    title.id = "chartCelebrationTitle";
    copy.append(title, el(doc, "p", "chart-celebration__artist", track.artist), metricList(doc, track));
    hero.append(art, copy);
    panel.append(close, banner, hero, shareDrawer(doc, track, options));
    if (options.confetti !== false) overlay.append(confetti(doc));
    overlay.append(panel);
    const dismiss = () => {
      overlay.remove();
      doc.removeEventListener("keydown", onKey);
      if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
    };
    const onKey = event => { if (event.key === "Escape") dismiss(); };
    close.addEventListener("click", dismiss);
    overlay.addEventListener("click", event => { if (event.target === overlay) dismiss(); });
    doc.addEventListener("keydown", onKey);
    doc.body.append(overlay);
    close.focus();
    return { element: overlay, close: dismiss };
  }

  // Trigger: celebrate and broadcast once per new Living Chart leader in this browser.
  function maybeCelebrate(leader, options = {}) {
    if (!shouldCelebrate(leader, readStorage(CELEBRATED_STORAGE_KEY))) return false;
    const track = trackFromRelease(leader);
    writeStorage(CELEBRATED_STORAGE_KEY, track.id);
    celebrate(track, options);
    broadcast(track, options);
    root.haloStats?.track?.("chart_number_one_celebration", { target: track.id });
    return true;
  }

  // Pinned system broadcast card for the Public Frequency feed.
  function renderBroadcast(container, payload, options = {}) {
    const doc = container?.ownerDocument;
    if (!doc || !payload?.releaseId) return null;
    const track = trackFromRelease({ id: payload.releaseId, title: payload.title, artist: payload.artist, artwork: payload.artwork, momentum: payload.momentum, chartActivity: payload.metrics, votes: payload.metrics?.votes });
    const card = el(doc, "article", "signal-feed__post chart-broadcast");
    card.dataset.chartBroadcast = track.id;
    const header = el(doc, "header");
    header.append(el(doc, "strong", "", "HALO System"), el(doc, "span", "", "System broadcast · The Living Chart"));
    const body = el(doc, "div", "chart-broadcast__body");
    if (track.artwork) {
      const image = el(doc, "img", "chart-broadcast__art");
      image.src = track.artwork;
      image.alt = `${track.title} cover artwork`;
      image.loading = "lazy";
      body.append(image);
    }
    const copy = el(doc, "div");
    copy.append(
      el(doc, "p", "chart-broadcast__kicker", "🏆 New #1 on The Living Chart"),
      el(doc, "p", "signal-feed__body", `“${track.title}” by ${track.artist} leads the chart. 7-day momentum: ${momentumText(track.momentum)}.`)
    );
    body.append(copy);
    const actions = el(doc, "div", "signal-feed__actions");
    const open = el(doc, "a", "", "Open the #1 release ↗");
    open.href = canonicalTrackUrl(track.id, options);
    const share = el(doc, "button", "", "Share the #1");
    share.type = "button";
    share.dataset.chartBroadcastShare = track.id;
    share.addEventListener("click", () => celebrate(track, { ...options, confetti: false }));
    actions.append(open, share);
    card.append(header, body, actions);
    container.replaceChildren(card);
    container.hidden = false;
    return card;
  }

  root.HaloChartCelebration = Object.freeze({
    CANONICAL_ORIGIN,
    CANONICAL_PATH,
    BROADCAST_CHANNEL,
    BROADCAST_EVENT,
    BROADCAST_TYPE,
    SOCIAL_PLATFORMS,
    canonicalTrackUrl,
    momentumText,
    trackFromRelease,
    formatSocialPost,
    shouldCelebrate,
    broadcastPayload,
    broadcast,
    subscribeBroadcasts,
    celebrate,
    maybeCelebrate,
    renderBroadcast
  });
})();
