const endpoint = "/api/signal-feed";
const byId = id => document.getElementById(id);
const feedState = { memberId: "", cursor: null, saved: false, generation: 0, session: 0, busy: false, notificationCursor: null };
const posts = byId("feedPosts");
const status = byId("feedStatus");
const publishForm = byId("feedPublishForm");
const mutationOrigin = () => ({ session: feedState.session, generation: feedState.generation });
function ensureOrigin(origin, checkGeneration = true) {
  if (origin.session !== feedState.session || (checkGeneration && origin.generation !== feedState.generation)) {
    const error = new Error("Feed session changed");
    error.name = "FeedSessionChanged";
    throw error;
  }
}
function actionError(error, origin) {
  if (origin.session === feedState.session && origin.generation === feedState.generation && error.name !== "FeedSessionChanged") status.textContent = error.message;
}
function node(tag, content, className) {
  const result = document.createElement(tag);
  if (content != null) result.textContent = String(content);
  if (className) result.className = className;
  return result;
}
function button(label, action) {
  const result = node("button", label);
  result.type = "button";
  result.addEventListener("click", async () => {
    const origin = mutationOrigin();
    result.disabled = true;
    try { await action(result, origin); }
    catch (error) { actionError(error, origin); }
    finally { if (origin.session === feedState.session) result.disabled = false; }
  });
  return result;
}
function link(label, url) {
  const result = node("a", label);
  result.href = url;
  result.target = "_blank";
  result.rel = "noopener noreferrer";
  return result;
}
async function request(params = {}, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${endpoint}?${new URLSearchParams(params)}`, {
      credentials: "same-origin", signal: controller.signal,
      ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "The Signal feed is unavailable. Please retry.");
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The feed took too long to respond. Please retry.");
    throw error;
  } finally { clearTimeout(timeout); }
}
async function mutate(action, data, origin = mutationOrigin()) {
  ensureOrigin(origin);
  const result = await request({}, { action, ...data });
  ensureOrigin(origin);
  return result;
}
function requireMember() {
  if (feedState.memberId) return;
  byId("signalAuthButton").click();
  throw new Error("Sign in with your Creator Pass to participate.");
}
function identityControls(memberId) {
  feedState.memberId = memberId || "";
  byId("feedPublish").disabled = !feedState.memberId;
  byId("feedSaved").disabled = !feedState.memberId;
  byId("feedSignIn").hidden = Boolean(feedState.memberId);
}
function displayDate(value) {
  return new Date(value).toLocaleString();
}
function publicCommentForm(post, container, reload) {
  const form = node("form", null, "signal-feed__comment-form");
  const context = node("p", "Add a public comment");
  const parent = node("input"); parent.type = "hidden"; parent.name = "parentId";
  const label = node("label", "Comment");
  const input = node("textarea"); input.maxLength = 1200; input.required = true; input.rows = 2;
  label.append(input);
  form.append(context, parent, label);
  let seconds;
  if (["AUDIO", "VIDEO"].includes(post.kind)) {
    const timeLabel = node("label", "Optional timestamp (whole seconds)");
    seconds = node("input"); seconds.type = "number"; seconds.min = "0"; seconds.max = "86400"; seconds.step = "1";
    timeLabel.append(seconds); form.append(timeLabel);
  }
  const consentLabel = node("label", " I deliberately publish this comment for everyone to see.");
  const consent = node("input"); consent.type = "checkbox"; consent.required = true;
  consentLabel.prepend(consent);
  const submit = node("button", "Publish comment"); submit.type = "submit";
  form.append(consentLabel, submit, button("Cancel reply", () => { parent.value = ""; context.textContent = "Add a public comment"; }));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const origin = mutationOrigin();
    submit.disabled = true;
    try {
      requireMember();
      await mutate("comment", {
        postId: post.id, body: input.value, parentId: parent.value || null, publishPublic: consent.checked,
        timestampSeconds: seconds?.value ? Number(seconds.value) : null
      }, origin);
      form.reset(); context.textContent = "Add a public comment"; await reload();
      ensureOrigin(origin);
      status.textContent = "Comment published publicly.";
    } catch (error) { actionError(error, origin); }
    finally { if (origin.session === feedState.session) submit.disabled = false; }
  });
  container.append(form);
  return comment => {
    requireMember();
    parent.value = comment.id;
    context.textContent = `Replying publicly to ${comment.authorName} (one level only)`;
    input.focus();
  };
}
function commentsPanel(post, audio) {
  const details = node("details", null, "signal-feed__comments");
  details.append(node("summary", "Comments & one-level replies"));
  const list = node("div");
  const more = button("More comments", () => load(true)); more.hidden = true;
  details.append(list, more);
  let cursor = null, loaded = false, busy = false;
  const reply = publicCommentForm(post, details, () => load(false));
  async function load(append) {
    if (busy) return;
    busy = true;
    const generation = feedState.generation;
    list.setAttribute("aria-busy", "true");
    try {
      const data = await request({ view: "comments", postId: post.id, ...(append && cursor ? { cursor } : {}) });
      if (generation !== feedState.generation) return;
      if (!append) list.replaceChildren();
      for (const comment of data.items) {
        const entry = node("article", null, comment.parentId ? "signal-feed__reply" : "signal-feed__comment");
        entry.id = `feed-comment-${comment.id}`;
        entry.append(node("strong", comment.authorName), node("small", displayDate(comment.createdAt)), node("p", comment.body));
        if (comment.parentId) entry.append(node("small", `Reply to comment ${comment.parentId.slice(0, 8)}`));
        if (comment.timestampSeconds != null) {
          const at = `At ${Math.floor(comment.timestampSeconds / 60)}:${String(comment.timestampSeconds % 60).padStart(2, "0")}`;
          entry.append(audio ? button(at, () => {
            if (!Number.isFinite(audio.duration) || comment.timestampSeconds > audio.duration) throw new Error("Load the audio first; timestamp must be within its duration.");
            audio.currentTime = comment.timestampSeconds; audio.focus();
          }) : node("span", at));
        }
        if (!comment.parentId) entry.append(button("Reply", () => reply(comment)));
        if (comment.memberId === feedState.memberId) entry.append(button("Remove comment", async () => {
          if (!window.confirm("Remove your public comment and its replies?")) return;
          await mutate("delete_comment", { postId: post.id, commentId: comment.id }); await load(false);
        }));
        entry.append(...safetyButtons(comment.memberId));
        list.append(entry);
      }
      if (!list.children.length) list.append(node("p", "No comments yet."));
      cursor = data.nextCursor; more.hidden = !cursor; loaded = true;
    } catch (error) {
      status.textContent = error.message;
      if (!loaded) list.replaceChildren(button("Retry comments", () => load(false)));
    } finally { busy = false; list.setAttribute("aria-busy", "false"); }
  }
  details.addEventListener("toggle", () => { if (details.open && !loaded) load(false); });
  return details;
}
function safetyButtons(memberId) {
  if (!feedState.memberId || memberId === feedState.memberId) return [];
  return [
    button("Block member", async (_element, origin) => {
      if (!window.confirm("Hide this member and prevent feed interactions in either direction? Their public posts remain visible to signed-out visitors.")) return;
      await mutate("block", { memberId }, origin); await loadFeed();
      ensureOrigin(origin, false);
      await loadNotifications(); await loadBlocks();
      ensureOrigin(origin, false);
      status.textContent = "Member blocked. Manage blocks in the Safety section.";
    }),
    button("Report", async () => {
      const reason = window.prompt("Describe the safety concern (3–800 characters). Reports are private.");
      if (reason == null) return;
      await mutate("report", { memberId, reason }); status.textContent = "Report saved for review.";
    })
  ];
}
function renderPost(post) {
  const article = node("article", null, "signal-feed__post");
  article.id = `feed-post-${post.id}`;
  const heading = node("header");
  heading.append(node("strong", post.authorName), node("span", post.kind), node("time", displayDate(post.createdAt)));
  heading.lastChild.dateTime = post.createdAt;
  article.append(heading, node("p", post.body, "signal-feed__body"));
  let audio;
  if (post.kind === "AUDIO") {
    if (post.media?.audioUrl) {
      article.append(node("h3", `${post.media.title} — ${post.media.artist}`));
      const musicDetails = [
        post.media.bpm != null ? `${post.media.bpm} BPM` : "",
        post.media.musicalKey ? `Key: ${post.media.musicalKey}` : "",
        post.media.genres?.length ? post.media.genres.join(" / ") : ""
      ].filter(Boolean);
      if (musicDetails.length) article.append(node("p", musicDetails.join(" · "), "signal-feed__music-metadata"));
      const wave = node("div", null, "signal-feed__waveform");
      wave.setAttribute("aria-hidden", "true");
      for (let index = 0; index < 48; index++) wave.append(node("i"));
      audio = node("audio"); audio.controls = true; audio.preload = "none"; audio.src = post.media.audioUrl;
      audio.setAttribute("aria-label", `${post.media.title} audio player`);
      article.append(wave, node("small", "Curated visual waveform — decorative, not analyzed audio."), audio);
      if (post.media.purchaseUrl) article.append(link("Purchase at the release's existing destination ↗", post.media.purchaseUrl));
    } else article.append(node("p", "This release's public audio is no longer available. No private asset is exposed."));
  }
  if (post.linkUrl) article.append(link(post.kind === "VIDEO" ? "Open public video ↗" : "Open public brief ↗", post.linkUrl));
  const actions = node("div", null, "signal-feed__actions");
  for (const kind of ["boost", "save"]) {
    const key = kind === "boost" ? "boosted" : "saved";
    const label = () => kind === "boost" ? `${post.boosted ? "Boosted" : "Boost"} · ${post.boosts}` : post.saved ? "Saved" : "Save";
    const toggle = button(label(), async element => {
      requireMember();
      const active = !post[key];
      await mutate(kind, { postId: post.id, active });
      if (kind === "boost") post.boosts = Math.max(0, post.boosts + (active ? 1 : -1));
      post[key] = active; element.textContent = label(); element.setAttribute("aria-pressed", String(active));
      if (kind === "save" && feedState.saved && !active) article.remove();
    });
    toggle.setAttribute("aria-pressed", String(post[key]));
    actions.append(toggle);
  }
  actions.append(...safetyButtons(post.memberId));
  if (post.memberId === feedState.memberId) actions.append(button("Remove post", async () => {
    if (!window.confirm("Remove this public post and all comments?")) return;
    await mutate("delete_post", { postId: post.id }); article.remove();
  }));
  article.append(actions, commentsPanel(post, audio));
  return article;
}
async function loadFeed(append = false) {
  if (append && (feedState.busy || !feedState.cursor)) return;
  if (!append) feedState.generation++;
  const generation = feedState.generation;
  feedState.busy = true; posts.setAttribute("aria-busy", "true");
  byId("feedMore").disabled = true;
  status.textContent = "Loading public posts…";
  try {
    const data = await request({ view: feedState.saved ? "saved" : "feed", ...(append ? { cursor: feedState.cursor } : {}) });
    if (generation !== feedState.generation) return;
    identityControls(data.memberId);
    if (!append) posts.replaceChildren();
    for (const post of data.items) posts.append(renderPost(post));
    if (!posts.children.length) posts.append(node("p", feedState.saved ? "No saved posts yet." : "No public signals yet. Be the first to deliberately publish one."));
    feedState.cursor = data.nextCursor; byId("feedMore").hidden = !data.nextCursor;
    status.textContent = "Public feed loaded. Newest first.";
  } catch (error) {
    if (generation === feedState.generation) {
      status.textContent = error.message;
      if (!append) posts.replaceChildren(button("Retry public feed", () => loadFeed()));
    }
  } finally {
    if (generation === feedState.generation) {
      feedState.busy = false; posts.setAttribute("aria-busy", "false"); byId("feedMore").disabled = false;
    }
  }
}
let notificationBusy = false;
async function loadNotifications(append = false) {
  if (!feedState.memberId || notificationBusy) return;
  notificationBusy = true;
  const memberId = feedState.memberId, generation = feedState.generation;
  try {
    const data = await request({ view: "notifications", ...(append && feedState.notificationCursor ? { cursor: feedState.notificationCursor } : {}) });
    if (generation !== feedState.generation || memberId !== feedState.memberId) return;
    const list = byId("feedNotificationList");
    if (!append) list.replaceChildren();
    for (const item of data.items) {
      const entry = node("div", null, "signal-feed__notification");
      entry.append(node("p", `${item.actorName}: ${item.kind} · ${displayDate(item.createdAt)}`));
      entry.append(button("Find post in public feed", async (_element, origin) => {
        feedState.saved = false; byId("feedSaved").setAttribute("aria-pressed", "false"); await loadFeed();
        ensureOrigin(origin, false);
        const post = byId(`feed-post-${item.postId}`);
        if (post) post.scrollIntoView({ behavior: "auto", block: "center" });
        else status.textContent = "This post is older than the first page. Load older posts to find it.";
      }));
      if (!item.readAt) entry.append(button("Mark read", async element => {
        await mutate("read_notification", { notificationId: item.id }); element.remove();
      }));
      list.append(entry);
    }
    if (!list.children.length) list.append(node("p", "No notifications yet."));
    byId("feedNotificationCount").textContent = data.items.some(item => !item.readAt) ? "(unread updates)" : "";
    feedState.notificationCursor = data.nextCursor; byId("feedMoreNotifications").hidden = !data.nextCursor;
  } catch (error) {
    if (generation === feedState.generation && memberId === feedState.memberId) byId("feedNotificationList").replaceChildren(node("p", error.message));
  }
  finally { notificationBusy = false; }
}
let catalogLoaded = false;
async function loadBlocks() {
  if (!feedState.memberId) return;
  const memberId = feedState.memberId, generation = feedState.generation;
  try {
    const data = await request({ view: "blocked" });
    if (generation !== feedState.generation || memberId !== feedState.memberId) return;
    const list = byId("feedBlockedList"); list.replaceChildren();
    for (const item of data.items) {
      const entry = node("p", item.displayName);
      entry.append(button("Unblock", async (_element, origin) => {
        await mutate("unblock", { memberId: item.memberId }, origin); await loadFeed();
        ensureOrigin(origin, false); await loadBlocks(); ensureOrigin(origin, false);
        status.textContent = "Your block removed. A block set by the other member still applies.";
      }));
      list.append(entry);
    }
    if (!data.items.length) list.append(node("p", "You have no blocked members."));
    if (data.hasMore) list.append(node("p", "Showing the 100 most recent blocks. Removing blocks reveals older entries."));
  } catch (error) {
    if (generation === feedState.generation && memberId === feedState.memberId) byId("feedBlockedList").replaceChildren(node("p", error.message));
  }
}
async function postType() {
  const session = feedState.session;
  const kind = byId("feedKind").value;
  byId("feedReleaseField").hidden = kind !== "AUDIO";
  byId("feedPurchaseField").hidden = kind !== "AUDIO";
  byId("feedLinkField").hidden = !["VIDEO", "BRIEF_LINK"].includes(kind);
  byId("feedRelease").required = kind === "AUDIO";
  publishForm.elements.linkUrl.required = ["VIDEO", "BRIEF_LINK"].includes(kind);
  if (kind !== "AUDIO" || catalogLoaded) return;
  try {
    const response = await fetch("/api/release-catalog", { credentials: "same-origin", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("Published release catalog unavailable. Choose another type or try again.");
    const data = await response.json();
    if (session !== feedState.session) return;
    byId("feedRelease").replaceChildren(node("option", "Choose a published release"));
    byId("feedRelease").firstChild.value = "";
    for (const release of data.releases || []) {
      if (release.status !== "published" || !release.isLiveVisible) continue;
      const option = node("option", `${release.title} — ${release.artist}`);
      option.value = release.id; byId("feedRelease").append(option);
    }
    catalogLoaded = true;
  } catch (error) { if (session === feedState.session) status.textContent = error.message; }
}
byId("feedKind").addEventListener("change", postType);
publishForm.addEventListener("submit", async event => {
  event.preventDefault();
  const origin = mutationOrigin();
  const submit = byId("feedPublish"); submit.disabled = true;
  try {
    requireMember();
    const values = publishForm.elements;
    await mutate("publish", {
      kind: values.kind.value, body: values.body.value, releaseId: values.releaseId.value,
      linkUrl: values.linkUrl.value, includePurchase: values.kind.value === "AUDIO" && values.includePurchase.checked,
      publishPublic: values.publishPublic.checked
    }, origin);
    publishForm.reset(); postType(); feedState.saved = false;
    byId("feedSaved").setAttribute("aria-pressed", "false"); await loadFeed();
    ensureOrigin(origin, false);
    status.textContent = "Signal deliberately published to the public feed.";
  } catch (error) { actionError(error, origin); }
  finally { if (origin.session === feedState.session) submit.disabled = !feedState.memberId; }
});
byId("feedRefresh").addEventListener("click", async () => { await loadFeed(); loadNotifications(); loadBlocks(); if (!catalogLoaded) postType(); });
byId("feedMore").addEventListener("click", () => loadFeed(true));
byId("feedSaved").addEventListener("click", () => {
  feedState.saved = !feedState.saved; byId("feedSaved").setAttribute("aria-pressed", String(feedState.saved)); loadFeed();
});
byId("feedSignIn").addEventListener("click", () => byId("signalAuthButton").click());
byId("feedMoreNotifications").addEventListener("click", () => loadNotifications(true));
byId("feedNotifications").addEventListener("toggle", () => { if (byId("feedNotifications").open) loadNotifications(); });
byId("feedBlocked").addEventListener("toggle", () => { if (byId("feedBlocked").open) loadBlocks(); });
function connectIdentity() {
  window.haloIdentity.onAuthChange(async () => {
    feedState.session++;
    publishForm.reset(); postType();
    identityControls(""); feedState.saved = false;
    byId("feedSaved").setAttribute("aria-pressed", "false");
    byId("feedNotificationList").replaceChildren(node("p", "Sign in to see your notifications."));
    byId("feedBlockedList").replaceChildren(node("p", "Sign in to manage your blocks."));
    byId("feedNotificationCount").textContent = ""; byId("feedMoreNotifications").hidden = true;
    await loadFeed(); loadNotifications(); loadBlocks();
  });
}
if (window.haloIdentity) connectIdentity();
else window.addEventListener("halo-identity-ready", connectIdentity, { once: true });
// System broadcast: the current Living Chart #1, derived from the public chart for every member.
async function loadChartBroadcast() {
  const celebration = window.HaloChartCelebration;
  const container = byId("feedSystemBroadcast");
  if (!celebration || !container) return;
  try {
    const response = await fetch("/api/catalog/chart?sort=signal", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) return;
    const data = await response.json();
    const leader = (data.releases || []).find(release => Number(release.rank) === 1);
    if (!leader || !(Number(leader.signalScore) > 0)) return;
    celebration.renderBroadcast(container, celebration.broadcastPayload(celebration.trackFromRelease(leader)));
  } catch {}
}
window.HaloChartCelebration?.subscribeBroadcasts(payload => window.HaloChartCelebration.renderBroadcast(byId("feedSystemBroadcast"), payload));
loadChartBroadcast();
loadFeed().then(() => { loadNotifications(); loadBlocks(); });
setInterval(() => { if (!document.hidden) loadNotifications(); }, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadNotifications(); });
