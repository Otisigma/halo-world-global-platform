import "../halo-safe-text.js";
import { DASH_FIX_AGENTS, canonicalizeWatcherTarget, watchersForPage } from "./watcher-registry.js";

// HALO DJ control room: a silent background loop that detects, classifies,
// safely repairs, and remembers deck/navigation failures. It never shows UI;
// repairs only touch broken state (missing names, hidden placeholder links,
// stale watcher bindings). Anything it cannot fix safely is escalated through
// the shared /api/issues maintenance pipeline by site-monitor.js.

const { text: safeText, lower: safeLower, trimmed: safeTrim } = globalThis.HaloSafeText;

export const CONTROL_ROOM_VERSION = 1;
export const CONTROL_ROOM_SOURCE = "HALO_DJ_CONTROL_ROOM";
export const CONTROL_ROOM_HISTORY_KEY = "halo:control-room:repair-history.v1";
export const CONTROL_ROOM_HISTORY_LIMIT = 200;
export const RECURRING_PATTERN_THRESHOLD = 3;
export const REPAIR_EVENT_LABELS = Object.freeze(["MACHINE_GENERATED", "AUTO_REPAIR"]);

export const FAILURE_TYPES = Object.freeze({
  missingControl: "MISSING_CONTROL",
  unnamedControl: "MISSING_ACCESSIBLE_NAME",
  unsafeLink: "UNSAFE_LINK",
  runtimeException: "RUNTIME_EXCEPTION",
  routeMismatch: "ROUTE_CONTROL_MISMATCH",
  watcherFailure: "WATCHER_FAILURE",
  audioSignal: "AUDIO_SIGNAL_FAILURE",
  missingAltText: "MISSING_ALT_TEXT"
});

export const REPAIR_STATUS = Object.freeze({
  attempted: "ATTEMPTED",
  resolved: "RESOLVED",
  failed: "FAILED"
});

export const DJ_CONTROL_ROOM_SURFACES = Object.freeze(["/dj-deck.html", "/halo-live.html", "/halo-x.html", "/mixes/", "/radio/"]);

const OWNER_AGENTS = new Set(Object.values(DASH_FIX_AGENTS));
const PLAYBACK_PATTERN = /\b(audio|play|playback|deck|track|wave(form)?|stem|record(er|ing)?|mixer|bpm|media)\b/i;
const CONTENT_PATTERN = /\b(catalog|release|artwork|metadata|song|lyrics|dreamweaver)\b/i;
const UNSAFE_SCHEME_PATTERN = /^(javascript|vbscript|data):/i;

export function controlRoomSurface(pagePath = "/") {
  const route = canonicalizeWatcherTarget(pagePath) || "/";
  if (route === "/dj-deck.html") return "dj-deck";
  return DJ_CONTROL_ROOM_SURFACES.includes(route) ? "dj-adjacent" : "site";
}

export function isPlaceholderHref(rawHref) {
  const href = safeTrim(rawHref);
  return !href || href === "#";
}

export function isUnsafeHref(rawHref) {
  if (isPlaceholderHref(rawHref)) return true;
  // Browsers ignore embedded whitespace/control characters in URL schemes.
  const compact = safeText(rawHref).replace(/[\u0000-\u0020\u007f]/g, "");
  return UNSAFE_SCHEME_PATTERN.test(compact);
}

export function ownerAgentForFailure(type, context = {}) {
  if (OWNER_AGENTS.has(context.ownerAgent)) return context.ownerAgent;
  switch (type) {
    case FAILURE_TYPES.missingControl:
    case FAILURE_TYPES.routeMismatch:
    case FAILURE_TYPES.unsafeLink:
    case FAILURE_TYPES.watcherFailure:
      return DASH_FIX_AGENTS.routing;
    case FAILURE_TYPES.audioSignal:
      return DASH_FIX_AGENTS.playback;
    case FAILURE_TYPES.missingAltText:
      return DASH_FIX_AGENTS.content;
    case FAILURE_TYPES.runtimeException: {
      const evidence = `${safeText(context.detail)} ${safeText(context.source)}`;
      if (PLAYBACK_PATTERN.test(evidence)) return DASH_FIX_AGENTS.playback;
      if (CONTENT_PATTERN.test(evidence)) return DASH_FIX_AGENTS.content;
      return DASH_FIX_AGENTS.ui;
    }
    default:
      return DASH_FIX_AGENTS.ui;
  }
}

function hashText(value) {
  let hash = 2166136261;
  const source = safeText(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createDefect({ type, pagePath = "/", key = "", selector = "", detail = "", ownerAgent, source = "" } = {}) {
  const route = canonicalizeWatcherTarget(pagePath) || "/";
  const surface = controlRoomSurface(route);
  const failureType = Object.values(FAILURE_TYPES).includes(type) ? type : FAILURE_TYPES.watcherFailure;
  const fingerprint = `${surface}|${failureType}|${route}|${safeText(key || selector || detail).slice(0, 200)}`;
  return {
    id: `defect-${hashText(fingerprint)}`,
    type: failureType,
    surface,
    pagePath: route,
    selector: safeText(selector).slice(0, 240),
    detail: safeText(detail).slice(0, 500),
    ownerAgent: ownerAgentForFailure(failureType, { ownerAgent, detail, source }),
    fingerprint
  };
}

// Maps a site-monitor check onto a classified defect so escalations carry the
// failure type and owner agent.
export function classifyCheck(check = {}, pagePath = "/") {
  const name = safeText(check.name);
  let type = FAILURE_TYPES.watcherFailure;
  if (check.watcherId) type = check.status === "yellow" ? FAILURE_TYPES.routeMismatch : FAILURE_TYPES.missingControl;
  else if (check.category === "runtime" || name === "Runtime Watcher") type = FAILURE_TYPES.runtimeException;
  else if (name === "Navigation Tester") type = FAILURE_TYPES.unsafeLink;
  else if (name === "Interaction Tester") type = FAILURE_TYPES.unnamedControl;
  else if (name === "Visual Access Tester") type = FAILURE_TYPES.missingAltText;
  else if (check.category === "audio" || name === "Audio Scout") type = FAILURE_TYPES.audioSignal;
  return createDefect({
    type,
    pagePath,
    key: check.watcherId || name,
    selector: check.watcherSelector || "",
    detail: check.detail,
    ownerAgent: check.ownerAgent
  });
}

function getAttribute(element, name) {
  return typeof element?.getAttribute === "function" ? element.getAttribute(name) : null;
}

function safeQuery(root, selector) {
  if (!selector || typeof root?.querySelector !== "function") return null;
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

function safeQueryAll(root, selector) {
  if (!selector || typeof root?.querySelectorAll !== "function") return [];
  try {
    return [...root.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function collapse(value) {
  return safeText(value).replace(/\s+/g, " ").trim();
}

// Same heuristic as the site monitor's Interaction Tester.
export function hasMonitorName(element) {
  return Boolean(
    collapse(element?.textContent)
    || safeText(element?.value)
    || getAttribute(element, "aria-label")
    || getAttribute(element, "title")
  );
}

function labelText(element, root) {
  const labelledBy = safeTrim(getAttribute(element, "aria-labelledby"));
  if (labelledBy && typeof root?.getElementById === "function") {
    const fromIds = labelledBy.split(/\s+/).map(id => collapse(root.getElementById(id)?.textContent)).filter(Boolean).join(" ");
    if (fromIds) return fromIds;
  }
  const id = safeTrim(element?.id);
  if (id) {
    const label = safeQueryAll(root, "label[for]").find(candidate => getAttribute(candidate, "for") === id);
    const labelText = collapse(label?.textContent);
    if (labelText) return labelText;
  }
  const wrappingLabel = typeof element?.closest === "function" ? element.closest("label") : null;
  return collapse(wrappingLabel?.textContent);
}

// Label associations (aria-labelledby, <label for>, wrapping <label>) already
// name a control, so they are not defects and need no repair.
export function hasAccessibleName(element, root) {
  return hasMonitorName(element) || Boolean(labelText(element, root));
}

export function deriveAccessibleName(element, root) {
  const fromLabel = labelText(element, root);
  if (fromLabel) return fromLabel;
  const imageAlt = collapse(getAttribute(safeQuery(element, "img[alt]"), "alt"));
  if (imageAlt) return imageAlt;
  return collapse(getAttribute(element, "placeholder") || getAttribute(element, "alt") || getAttribute(element, "data-label"));
}

export function repairUnnamedControl(element, root) {
  const name = deriveAccessibleName(element, root).slice(0, 120);
  if (!name) {
    return { status: REPAIR_STATUS.failed, action: "No safe source for an accessible name; escalated to UI Agent." };
  }
  element.setAttribute("aria-label", name);
  element.setAttribute("data-halo-control-room", "named");
  return { status: REPAIR_STATUS.resolved, action: `Added accessible name "${name}" from existing markup.` };
}

export function repairUnsafeLink(link, isVisible = () => true) {
  const href = safeText(getAttribute(link, "href"));
  if (!isPlaceholderHref(href)) {
    return { status: REPAIR_STATUS.failed, action: "Unsafe URL scheme left untouched for human security review." };
  }
  if (isVisible(link)) {
    return { status: REPAIR_STATUS.failed, action: "Visible placeholder link needs a real destination; escalated to Routing Agent." };
  }
  link.removeAttribute("href");
  link.setAttribute("data-halo-control-room", "placeholder-href-removed");
  return { status: REPAIR_STATUS.resolved, action: "Removed placeholder href from hidden link until a real destination is assigned." };
}

function isSameOriginHref(rawHref, origin) {
  const href = safeTrim(rawHref);
  if (!href || href.startsWith("//")) return false;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return true;
  if (!origin) return false;
  try {
    return new URL(href).origin === origin;
  } catch {
    return false;
  }
}

export function resolveWatcherControl(root, watcher, { canonicalize = canonicalizeWatcherTarget, origin = "" } = {}) {
  if (!watcher) return { element: null, via: null };
  const bySelector = safeQuery(root, watcher.selector);
  if (bySelector) return { element: bySelector, via: "selector" };
  const byWatcherId = safeQueryAll(root, "[data-watcher-id]").find(element => getAttribute(element, "data-watcher-id") === watcher.id);
  if (byWatcherId) return { element: byWatcherId, via: "watcher-id" };
  const wantedText = safeLower(collapse(watcher.controlText));
  if (!wantedText) return { element: null, via: null };
  const accepted = new Set([watcher.target, ...(watcher.legacyTargets || [])].map(target => canonicalize(target)).filter(Boolean));
  const byTarget = safeQueryAll(root, "a[href]").find(link => {
    const href = getAttribute(link, "href");
    return isSameOriginHref(href, origin)
      && accepted.has(canonicalize(href))
      && safeLower(collapse(link.textContent)) === wantedText;
  });
  return byTarget ? { element: byTarget, via: "canonical-target" } : { element: null, via: null };
}

export function evaluateWatcher(root, watcher, options = {}) {
  const canonicalize = options.canonicalize || canonicalizeWatcherTarget;
  const ownerAgent = ownerAgentForFailure(FAILURE_TYPES.missingControl, { ownerAgent: watcher.ownerAgent });
  const { element, via } = resolveWatcherControl(root, watcher, { ...options, canonicalize });
  const expectedTarget = canonicalize(watcher.target);
  if (!element) {
    return { ...watcher, ownerAgent, status: "red", resolvedVia: null, element: null, detail: `Missing expected control. Dash AI routes this to ${ownerAgent}.` };
  }
  const linkedTarget = typeof element.matches === "function" && element.matches("a[href]")
    ? canonicalize(getAttribute(element, "href") || "")
    : expectedTarget;
  if (linkedTarget !== expectedTarget) {
    return {
      ...watcher,
      ownerAgent,
      status: "yellow",
      resolvedVia: via,
      element,
      detail: `Control resolves to ${linkedTarget || "unknown"} instead of canonical ${expectedTarget}. Dash AI routes this to ${ownerAgent}.`
    };
  }
  return {
    ...watcher,
    ownerAgent,
    status: "green",
    resolvedVia: via,
    element,
    detail: via === "selector"
      ? `Control is present and points to canonical route ${expectedTarget}. Owner agent: ${ownerAgent}.`
      : `Control re-bound by the DJ control room (${via}) and points to canonical route ${expectedTarget}. Owner agent: ${ownerAgent}.`
  };
}

export function describeControlRoomSurface(pageRoute = "/dj-deck.html") {
  const route = canonicalizeWatcherTarget(pageRoute) || "/";
  const regions = {};
  for (const watcher of watchersForPage(route)) {
    const region = watcher.region || "page";
    (regions[region] ||= []).push({
      id: watcher.id,
      label: watcher.label,
      controlText: watcher.controlText || null,
      selector: watcher.selector,
      target: watcher.target,
      ownerAgent: watcher.ownerAgent
    });
  }
  return { pageRoute: route, surface: controlRoomSurface(route), regions };
}

export function createRepairEvent({ defect, status, action = "", attempt = 1, sessionId = "", now = new Date() } = {}) {
  const timestamp = (now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()).toISOString();
  const repairStatus = Object.values(REPAIR_STATUS).includes(status) ? status : REPAIR_STATUS.failed;
  return {
    id: `repair-${hashText(`${defect?.fingerprint}|${repairStatus}|${timestamp}|${attempt}`)}`,
    source: CONTROL_ROOM_SOURCE,
    type: "AUTO_REPAIR_AUDIT",
    labels: [...REPAIR_EVENT_LABELS],
    status: repairStatus,
    timestamp,
    sessionId: safeText(sessionId).slice(0, 64),
    surface: defect?.surface || "site",
    pagePath: defect?.pagePath || "/",
    fingerprint: defect?.fingerprint || "",
    details: {
      defectId: defect?.id || "",
      issueType: defect?.type || FAILURE_TYPES.watcherFailure,
      targetElement: defect?.selector || "",
      assignedAgent: defect?.ownerAgent || DASH_FIX_AGENTS.ui,
      actionTaken: safeText(action).slice(0, 240),
      attempt
    }
  };
}

export function summarizeRepairHistory(events = [], threshold = RECURRING_PATTERN_THRESHOLD) {
  const patterns = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event?.fingerprint) continue;
    const pattern = patterns.get(event.fingerprint) || {
      fingerprint: event.fingerprint,
      issueType: event.details?.issueType || FAILURE_TYPES.watcherFailure,
      assignedAgent: event.details?.assignedAgent || DASH_FIX_AGENTS.ui,
      surface: event.surface || "site",
      pagePath: event.pagePath || "/",
      attempts: 0,
      resolved: 0,
      failed: 0,
      lastSeen: ""
    };
    if (event.status === REPAIR_STATUS.attempted) pattern.attempts += 1;
    if (event.status === REPAIR_STATUS.resolved) pattern.resolved += 1;
    if (event.status === REPAIR_STATUS.failed) pattern.failed += 1;
    if (safeText(event.timestamp) > pattern.lastSeen) pattern.lastSeen = safeText(event.timestamp);
    patterns.set(event.fingerprint, pattern);
  }
  return [...patterns.values()]
    .map(pattern => ({ ...pattern, recurring: pattern.attempts >= threshold, contractCandidate: pattern.attempts >= threshold }))
    .sort((left, right) => right.attempts - left.attempts || left.fingerprint.localeCompare(right.fingerprint));
}

export function createRepairHistory(storage, { key = CONTROL_ROOM_HISTORY_KEY, limit = CONTROL_ROOM_HISTORY_LIMIT } = {}) {
  function read() {
    try {
      const parsed = JSON.parse(storage?.getItem?.(key) || "[]");
      return Array.isArray(parsed) ? parsed.filter(event => event && typeof event === "object") : [];
    } catch {
      return [];
    }
  }
  let events = read().slice(-limit);
  function write() {
    try {
      storage?.setItem?.(key, JSON.stringify(events));
    } catch {
      // Storage can be full or disabled; history stays in memory for this page.
    }
  }
  return {
    record(event) {
      events.push(event);
      events = events.slice(-limit);
      write();
      return event;
    },
    list: () => events.slice(),
    patterns: (threshold = RECURRING_PATTERN_THRESHOLD) => summarizeRepairHistory(events, threshold),
    clear() {
      events = [];
      write();
    }
  };
}

const INTERACTIVE_SELECTOR = "button,a,input,select,textarea";

export function createControlRoom({
  root,
  location = { pathname: "/", origin: "" },
  storage = null,
  sessionId = "",
  isVisible = () => true,
  emit = () => {},
  now = () => new Date(),
  watchers = watchersForPage
} = {}) {
  const history = createRepairHistory(storage);
  const outcomes = new Map();
  const sessionCounts = { attempted: 0, resolved: 0, failed: 0 };
  const attempts = new Map();

  function log(defect, status, action) {
    const attempt = attempts.get(defect.fingerprint) || 1;
    const event = createRepairEvent({ defect, status, action, attempt, sessionId, now: now() });
    history.record(event);
    sessionCounts[status === REPAIR_STATUS.attempted ? "attempted" : status === REPAIR_STATUS.resolved ? "resolved" : "failed"] += 1;
    try {
      emit(event);
    } catch {
      // Emit listeners must never break the repair loop.
    }
    return event;
  }

  function handle(defect, repair) {
    // Escalated defects are logged once per page; resolved defects that break
    // again are re-attempted so recurring patterns are learned.
    if (outcomes.get(defect.fingerprint) === REPAIR_STATUS.failed) return [];
    attempts.set(defect.fingerprint, (attempts.get(defect.fingerprint) || 0) + 1);
    const events = [log(defect, REPAIR_STATUS.attempted, `Detected ${defect.type}; dispatched to ${defect.ownerAgent}.`)];
    let result;
    try {
      result = repair();
    } catch (error) {
      result = { status: REPAIR_STATUS.failed, action: `Repair threw: ${safeText(error?.message, "unknown error")}` };
    }
    outcomes.set(defect.fingerprint, result.status);
    events.push(log(defect, result.status, result.action));
    return events;
  }

  function describeElement(element) {
    const id = safeTrim(element?.id);
    const tag = safeLower(element?.tagName) || "element";
    const classes = safeTrim(getAttribute(element, "class")).split(/\s+/).filter(Boolean).slice(0, 3);
    return id ? `${tag}#${id}` : `${tag}${classes.length ? `.${classes.join(".")}` : ""}`;
  }

  function cycle({ runtimeErrors = [] } = {}) {
    const pagePath = canonicalizeWatcherTarget(location?.pathname) || "/";
    const events = [];

    safeQueryAll(root, INTERACTIVE_SELECTOR).forEach((element, index) => {
      if (typeof element.matches === "function" && element.matches('input[type="hidden"],input[type="file"]')) return;
      if (!isVisible(element) || hasAccessibleName(element, root)) return;
      const selector = describeElement(element);
      const defect = createDefect({ type: FAILURE_TYPES.unnamedControl, pagePath, key: `${selector}|${index}`, selector, detail: "Visible control has no accessible name." });
      events.push(...handle(defect, () => repairUnnamedControl(element, root)));
    });

    safeQueryAll(root, "a[href]").forEach((link, index) => {
      const href = getAttribute(link, "href");
      if (!isUnsafeHref(href)) return;
      const selector = describeElement(link);
      const defect = createDefect({ type: FAILURE_TYPES.unsafeLink, pagePath, key: `${selector}|${index}|${safeText(href).slice(0, 40)}`, selector, detail: `Placeholder or unsafe link: ${safeText(href).slice(0, 80) || "(empty)"}` });
      events.push(...handle(defect, () => repairUnsafeLink(link, isVisible)));
    });

    const watcherResults = (watchers(pagePath) || []).map(watcher => {
      const result = evaluateWatcher(root, watcher, { origin: location?.origin || "" });
      if (result.status === "green" && result.resolvedVia && result.resolvedVia !== "selector") {
        const defect = createDefect({ type: FAILURE_TYPES.missingControl, pagePath, key: watcher.id, selector: watcher.selector, detail: `${watcher.label} selector is stale.`, ownerAgent: watcher.ownerAgent });
        events.push(...handle(defect, () => {
          result.element.setAttribute("data-watcher-id", watcher.id);
          return { status: REPAIR_STATUS.resolved, action: `Re-bound watcher ${watcher.id} to its control via ${result.resolvedVia}.` };
        }));
      } else if (result.status !== "green") {
        const type = result.status === "yellow" ? FAILURE_TYPES.routeMismatch : FAILURE_TYPES.missingControl;
        const defect = createDefect({ type, pagePath, key: watcher.id, selector: watcher.selector, detail: result.detail, ownerAgent: watcher.ownerAgent });
        events.push(...handle(defect, () => ({ status: REPAIR_STATUS.failed, action: `No safe automatic repair; escalated to ${defect.ownerAgent}.` })));
      }
      const { element, ...publicResult } = result;
      return publicResult;
    });

    for (const runtimeError of Array.isArray(runtimeErrors) ? runtimeErrors : []) {
      const message = typeof runtimeError === "object" && runtimeError !== null ? runtimeError.message : runtimeError;
      const source = typeof runtimeError === "object" && runtimeError !== null ? runtimeError.source : "";
      const detail = safeText(message, "Unknown JavaScript error").slice(0, 300);
      const defect = createDefect({ type: FAILURE_TYPES.runtimeException, pagePath, key: detail, detail, source });
      events.push(...handle(defect, () => ({ status: REPAIR_STATUS.failed, action: `No safe automatic repair for runtime exceptions; escalated to ${defect.ownerAgent}.` })));
    }

    const patterns = history.patterns();
    const state = {
      version: CONTROL_ROOM_VERSION,
      source: CONTROL_ROOM_SOURCE,
      pagePath,
      surface: controlRoomSurface(pagePath),
      checkedAt: now().toISOString(),
      sessionId: safeText(sessionId).slice(0, 64),
      description: describeControlRoomSurface(pagePath),
      watchers: watcherResults.map(({ id, label, region, target, ownerAgent, status, resolvedVia }) => ({ id, label, region: region || "page", target, ownerAgent, status, resolvedVia })),
      repairs: { ...sessionCounts },
      historySize: history.list().length,
      recurringPatterns: patterns.filter(pattern => pattern.recurring)
    };
    return { state, watcherResults, events };
  }

  return { cycle, history };
}
