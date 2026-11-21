// HALO console capability state. Anything not yet built and verified stays off here.
export const HALO_CONSOLE_CONFIG = Object.freeze({
  environment: "netlify-production",
  meshMode: "simulation", // No live autonomous scouts exist; every node, packet and log line is simulated.
  payments: Object.freeze({
    enabled: false,
    reason: "Awaiting a deployed smart contract, network configuration and a verified artist wallet registry."
  }),
  gatedCapabilities: Object.freeze([
    "Autonomous crawling",
    "Perceptual audio fingerprinting",
    "Per-asset verified play counts",
    "Smart contracts",
    "Crypto payouts"
  ]),
  telemetry: Object.freeze({
    mode: "first-party-consented", // Consented client reports are never presented as authenticated plays.
    endpoints: Object.freeze({
      // Owner-only aggregate counts; no listener identities are returned.
      sevenDayListenerAggregate: "/api/telemetry/listeners-7d",
      // Per-master observation history; requires sign-in plus songId and versionId owned by the caller.
      masterProvenanceHistory: "/api/song-catalog/master-provenance"
    })
  })
});

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function renderConsoleStatusBadge(targetEl) {
  if (!targetEl) return;
  const banner = el("div", "", "halo-status-banner");
  banner.setAttribute("role", "status");
  const parts = [
    ["Mesh mode:", `${HALO_CONSOLE_CONFIG.meshMode.toUpperCase()} (simulated UI, not live nodes)`],
    ["Payments:", HALO_CONSOLE_CONFIG.payments.enabled ? "Enabled" : `Unavailable. ${HALO_CONSOLE_CONFIG.payments.reason}`],
    ["Telemetry:", "Consented first-party evidence only, owner sign-in required"]
  ];
  parts.forEach(([label, value], index) => {
    if (index) banner.append(" · ");
    banner.append(el("strong", label), ` ${value}`);
  });
  targetEl.replaceChildren(banner);
}

export async function fetchFirstPartyEvidence() {
  try {
    const res = await fetch(HALO_CONSOLE_CONFIG.telemetry.endpoints.sevenDayListenerAggregate, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (res.status === 401 || res.status === 403) return { status: "unauthorized", data: null };
    if (!res.ok) return { status: "unavailable", data: null };
    return { status: "ok", data: await res.json() };
  } catch {
    return { status: "unavailable", data: null };
  }
}
