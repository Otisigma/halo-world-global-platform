/**
 * HALO status navigation controller.
 *
 * Keeps every navigation tile and action button carrying a live status badge:
 *   WORKING   -> G, emerald  (#22C55E)
 *   ATTENTION -> Y, amber    (#F59E0B)
 *   BROKEN    -> R, crimson  (#EF4444)
 *
 * The one-amber-node rule is enforced here: only the active development or
 * repair target may report ATTENTION at any one time. Every other node falls
 * back to its resolved status so technical debt stays visible without noise.
 */

export const STATUS_PRESETS = {
  WORKING: { code: "G", label: "WORKING", className: "status-working", color: "#22C55E" },
  ATTENTION: { code: "Y", label: "ATTENTION", className: "status-attention", color: "#F59E0B" },
  BROKEN: { code: "R", label: "BROKEN", className: "status-broken", color: "#EF4444" }
};

const STATUS_CLASS_NAMES = Object.values(STATUS_PRESETS).map(preset => preset.className);

export const ROUTE_CONFIG = [
  { id: "music-world", path: "/music-world.html", status: "WORKING" },
  { id: "all-music", path: "/music/", status: "WORKING" },
  { id: "dj-halo-x", path: "/halo-x.html", status: "WORKING" },
  { id: "halo-x-mixes", path: "/mixes/", status: "WORKING" },
  { id: "halo-radio", path: "/radio/", status: "WORKING" },
  { id: "song-catalog", path: "/song-catalog/", status: "WORKING" },
  { id: "public-stats", path: "/stats/", status: "WORKING" },
  { id: "dreamweaver", path: "/dreamweaver/", status: "ATTENTION", activeTarget: true, resolvedStatus: "WORKING" }
];

export function normalizeStatus(status) {
  const candidate = String(status || "").trim().toUpperCase();
  return STATUS_PRESETS[candidate] ? candidate : "BROKEN";
}

export function normalizeRoutePath(route = "") {
  const raw = String(route || "").trim();
  if (!raw) return "/";
  let pathname = raw.split("?")[0].split("#")[0] || "/";
  if (pathname === "/") return "/";
  if (pathname.endsWith(".html")) return pathname;
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

/**
 * Applies the one-amber-node rule. The active target keeps ATTENTION; any other
 * amber node drops back to its resolved status (WORKING unless stated).
 */
export function enforceSingleAmberNode(routes = ROUTE_CONFIG) {
  const normalized = routes.map(route => ({ ...route, status: normalizeStatus(route.status) }));
  const amberNodes = normalized.filter(route => route.status === "ATTENTION");
  if (amberNodes.length < 2) return normalized;

  const activeTarget = amberNodes.find(route => route.activeTarget) || amberNodes[0];
  return normalized.map(route => {
    if (route.status !== "ATTENTION" || route === activeTarget) return route;
    return { ...route, status: normalizeStatus(route.resolvedStatus || "WORKING") };
  });
}

function buildBadgeContent(badge, status) {
  const preset = STATUS_PRESETS[normalizeStatus(status)];
  const ownerDocument = badge.ownerDocument;
  badge.textContent = "";

  const dot = ownerDocument.createElement("span");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");

  const code = ownerDocument.createElement("span");
  code.className = "status-code";
  code.setAttribute("aria-hidden", "true");
  code.textContent = preset.code;

  badge.append(dot, code, ` ${preset.label}`);
  return preset;
}

export function applyStatusToBadge(badge, status) {
  const preset = buildBadgeContent(badge, status);
  badge.classList.remove(...STATUS_CLASS_NAMES);
  badge.classList.add(preset.className);
  badge.setAttribute("data-status", normalizeStatus(status));
  return preset;
}

function findStatusNodes(root, path) {
  const normalized = normalizeRoutePath(path);
  const candidates = root.querySelectorAll("[data-halo-status-node], .halo-nav-tile, .halo-status-action");
  return [...candidates].filter(node => {
    const target = node.getAttribute("data-status-path") || node.getAttribute("href");
    return Boolean(target) && normalizeRoutePath(target) === normalized;
  });
}

export function updateMenuStatuses(routes = ROUTE_CONFIG, root = globalThis.document) {
  if (!root || typeof root.querySelectorAll !== "function") return [];

  const resolved = enforceSingleAmberNode(routes);
  const applied = [];

  for (const route of resolved) {
    for (const node of findStatusNodes(root, route.path)) {
      node.setAttribute("data-status", route.status);
      const badge = node.classList?.contains("status-badge") ? node : node.querySelector(".status-badge");
      if (!badge) continue;
      const preset = applyStatusToBadge(badge, route.status);
      const context = node.querySelector(".tile-title")?.textContent?.trim() || route.id;
      badge.setAttribute("title", `${context}: ${preset.label}`);
      applied.push({ id: route.id, path: route.path, status: route.status });
    }
  }

  return applied;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => updateMenuStatuses());
  } else {
    updateMenuStatuses();
  }
}
