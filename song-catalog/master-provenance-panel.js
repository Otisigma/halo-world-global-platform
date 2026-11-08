export const MAX_LOCAL_COMPARISON_BYTES = 100 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const HISTORY_LIMIT = 20;

const STATUS_COPY = Object.freeze({
  unconfigured: {
    label: "Not configured",
    detail: "The observation service is not configured. No bytes were read or compared.",
  },
  unauthenticated: {
    label: "Sign-in required",
    detail: "Sign in again to view or compare this owner's master observations.",
  },
  forbidden: {
    label: "Request rejected",
    detail: "The service rejected this request. No observation or comparison was confirmed.",
  },
  not_found: {
    label: "Master or observation not found",
    detail: "The selected master or observation is not available for this account.",
  },
  record_unverified: {
    label: "Record not authenticated",
    detail: "The service could not authenticate this observation record. No byte comparison was confirmed.",
  },
  unavailable: {
    label: "Service unavailable",
    detail: "The service is unavailable. No observation or comparison was confirmed.",
  },
  rate_limited: {
    label: "Try again later",
    detail: "The service limits expensive master reads to one per owner per minute.",
  },
  not_checked: {
    label: "No comparison yet",
    detail: "No comparison has been requested for the selected observation.",
  },
  observing: { label: "Reading stored bytes", detail: "Asking the service to record an observation of the current stored master…" },
  verifying: { label: "Comparing bytes", detail: "Asking the service to compare bytes with the selected observation…" },
  observed: {
    label: "Observation recorded",
    detail: "The service recorded the bytes it read from the stored source. The source may change during or after that read.",
  },
  observed_bytes_match: {
    label: "Bytes matched observation",
    detail: "The service reports that the currently read stored bytes matched this observation. This does not show the source stayed unchanged between checks.",
  },
  observed_bytes_differ: {
    label: "Bytes differed",
    detail: "The service reports that the currently read stored bytes differed from this observation. This alone does not establish whether the audio is related.",
  },
  file_bytes_match: {
    label: "Supplied file matched",
    detail: "The selected file's exact bytes matched the authenticated observation manifest. The file stayed in this browser; this does not prove ownership or rights.",
  },
  file_bytes_differ: {
    label: "Supplied file differed",
    detail: "The selected file's exact bytes differed from the authenticated observation manifest. This alone does not establish whether the audio is related.",
  },
  stale: {
    label: "Observation is stale",
    detail: "The service reports that the stored source identity changed since this observation. Record a new observation before comparing again.",
  },
  unsupported_source: {
    label: "Source unsupported",
    detail: "The service cannot read or compare this master source.",
  },
  error: {
    label: "Request not completed",
    detail: "The service could not complete this request. No result was confirmed.",
  },
});

const STORED_VERIFY_STATUSES = new Set([
  "observed_bytes_match", "observed_bytes_differ", "stale", "unsupported_source",
  "record_unverified", "not_found", "forbidden", "rate_limited", "unavailable", "unauthenticated", "unconfigured", "error",
]);
const OBSERVE_STATUSES = new Set([
  "observed", "unsupported_source", "rate_limited", "unavailable",
  "not_found", "forbidden", "unauthenticated", "unconfigured", "error",
]);

function currentMessage(status) {
  return STATUS_COPY[status] || STATUS_COPY.error;
}

function validHistoryRecord(record) {
  if (!record || typeof record !== "object" || !UUID.test(record.observationId || "")
    || !SHA256.test(record.sha256 || "") || !Number.isSafeInteger(record.byteSize) || record.byteSize < 1
    || !["direct", "chunks"].includes(record.sourceType)
    || record.recordAuthenticated !== "not_checked" || typeof record.matchesCurrentSource !== "boolean") return false;
  const date = new Date(record.createdAt);
  return typeof record.createdAt === "string" && !Number.isNaN(date.getTime()) && date.toISOString() === record.createdAt;
}

function safeHistory(data, expected) {
  if (!data || data.songId !== expected.songId || data.versionId !== expected.versionId || !Array.isArray(data.observations)) {
    throw new Error("The observation history response did not match the selected master.");
  }
  const seen = new Set();
  const observations = data.observations.filter(record => {
    if (!validHistoryRecord(record) || seen.has(record.observationId)) return false;
    seen.add(record.observationId);
    return true;
  }).slice(0, HISTORY_LIMIT);
  observations.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    observations,
    hasMore: data.hasMore === true,
    limitation: typeof data.limitation === "string" ? data.limitation.slice(0, 1000) : "",
  };
}

function errorResult(response, body) {
  if (response.status === 401) return "unauthenticated";
  if (response.status === 403) return "forbidden";
  if (response.status === 429) return "rate_limited";
  if (response.status === 409) {
    if (body?.result === "stale") return "stale";
    if (/authenticat/i.test(body?.message || "")) return "record_unverified";
    if (/supported stored master/i.test(body?.message || "")) return "unsupported_source";
    return "error";
  }
  if (response.status === 404) return "not_found";
  if (response.status >= 500) return "unavailable";
  return "error";
}

export function createCatalogMasterProvenanceApi({
  fetchImpl = globalThis.fetch,
  endpoint = "/api/song-catalog/master-provenance",
} = {}) {
  if (typeof fetchImpl !== "function") return null;

  async function request({ method, action, songId, versionId, observationId = "" }) {
    const params = new URLSearchParams({ songId, versionId });
    if (action) params.set("action", action);
    if (observationId) params.set("observationId", observationId);
    const response = await fetchImpl(`${endpoint}?${params}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(errorResult(response, body));
      error.result = errorResult(response, body);
      throw error;
    }
    return body;
  }

  return Object.freeze({
    async getHistory({ songId, versionId }) {
      const data = await request({ method: "GET", action: "", songId, versionId });
      return safeHistory(data, { songId, versionId });
    },
    observe({ songId, versionId }) {
      return request({ method: "POST", action: "observe", songId, versionId });
    },
    verify({ songId, versionId, observationId }) {
      return request({ method: "POST", action: "verify", songId, versionId, observationId });
    },
    getManifest({ songId, versionId, observationId }) {
      return request({ method: "GET", action: "manifest", songId, versionId, observationId });
    },
  });
}

export async function compareFileToManifest(file, manifest, { cryptoProvider = globalThis.crypto } = {}) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || typeof file.arrayBuffer !== "function") {
    throw new Error("Choose a non-empty local file.");
  }
  if (file.size > MAX_LOCAL_COMPARISON_BYTES) throw new Error("Local file comparison is limited to 100 MiB.");
  if (!manifest || !SHA256.test(manifest.sha256 || "") || !Number.isSafeInteger(manifest.byteSize)
    || manifest.byteSize < 1 || !UUID.test(manifest.observationId || "")) {
    throw new Error("The authenticated observation manifest is invalid.");
  }
  if (file.size !== manifest.byteSize) return "file_bytes_differ";
  if (!cryptoProvider?.subtle || typeof cryptoProvider.subtle.digest !== "function") {
    throw new Error("This browser cannot securely compare file bytes.");
  }
  const bytes = await file.arrayBuffer();
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size || bytes.byteLength > MAX_LOCAL_COMPARISON_BYTES) {
    throw new Error("The selected file could not be read within the comparison limit.");
  }
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return hash === manifest.sha256.toLowerCase() ? "file_bytes_match" : "file_bytes_differ";
}

export function createMasterProvenanceController({
  songId,
  versionId,
  api,
  cryptoProvider = globalThis.crypto,
  onStateChange = () => {},
  authenticateStamp = false,
} = {}) {
  const context = {
    songId: typeof songId === "string" ? songId.trim() : "",
    versionId: typeof versionId === "string" ? versionId.trim() : "",
  };
  const adapter = api && typeof api === "object" ? api : null;
  let history = { observations: [], hasMore: false, limitation: "" };
  const authenticatedObservationIds = new Set();
  let stampRecord = null;
  let stampError = "";
  let historyState = typeof adapter?.getHistory === "function" ? "loading" : "unconfigured";
  let historyError = "";
  let status = "not_checked";
  let selectedObservationId = "";
  let busy = "";
  let disposed = false;
  let operation = 0;
  let historyOperation = 0;

  const supports = method => Boolean(context.songId && context.versionId && typeof adapter?.[method] === "function");
  const selectedObservation = () => history.observations.find(item => item.observationId === selectedObservationId) || null;
  const snapshot = () => Object.freeze({
    status,
    historyState,
    historyError,
    observations: history.observations,
    hasMore: history.hasMore,
    limitation: history.limitation,
    selectedObservationId,
    selectedObservation: selectedObservation(),
    authenticatedObservationIds: [...authenticatedObservationIds],
    stampRecord,
    stampError,
    busy,
  });
  const publish = () => {
    if (!disposed) onStateChange(snapshot());
  };
  const setStatus = next => {
    status = STATUS_COPY[next] ? next : "error";
    publish();
  };
  const setErrorStatus = error => {
    const result = STATUS_COPY[error?.result] ? error.result : "error";
    setStatus(result);
  };

  async function refreshHistory() {
    if (busy && busy !== "observe") return snapshot();
    if (disposed || !supports("getHistory")) {
      historyState = "unconfigured";
      publish();
      return snapshot();
    }
    const requestId = ++historyOperation;
    historyState = "loading";
    stampRecord = null;
    stampError = "";
    historyError = "";
    publish();
    try {
      const next = await adapter.getHistory(context);
      if (disposed || requestId !== historyOperation) return snapshot();
      const previousSelection = selectedObservationId;
      history = safeHistory({ ...next, songId: context.songId, versionId: context.versionId }, context);
      selectedObservationId = history.observations.find(item => item.matchesCurrentSource)?.observationId || "";
      historyState = "loaded";
      if (selectedObservationId !== previousSelection && status !== "observed") status = "not_checked";
      publish();
      if (authenticateStamp && selectedObservationId && supports("getManifest")) {
        const selected = selectedObservation();
        try {
          const manifest = await adapter.getManifest({ ...context, observationId: selected.observationId });
          if (disposed || requestId !== historyOperation) return snapshot();
          if (manifest?.observationId !== selected.observationId || manifest.sha256 !== selected.sha256
            || manifest.byteSize !== selected.byteSize || manifest.createdAt !== selected.createdAt) {
            throw new Error("Stamp record does not match the authenticated manifest.");
          }
          stampRecord = { ...manifest };
          authenticatedObservationIds.add(selected.observationId);
          publish();
        } catch (error) {
          if (disposed || requestId !== historyOperation) return snapshot();
          stampRecord = null;
          stampError = STATUS_COPY[error?.result]?.detail || "The stamp record could not be authenticated.";
          publish();
        }
      }
    } catch (error) {
      if (disposed || requestId !== historyOperation) return snapshot();
      historyState = "error";
      historyError = STATUS_COPY[error?.result]?.detail || "Observation history could not be loaded.";
      history = { observations: [], hasMore: false, limitation: "" };
      stampRecord = null;
      selectedObservationId = "";
      if (error?.result) setErrorStatus(error);
      else publish();
    }
    return snapshot();
  }

  async function run({ method, pendingStatus, acceptedStatuses, payload = {}, onResult = () => {} }) {
    if (disposed || busy || !supports(method)) {
      if (!disposed && !busy && !supports(method)) setStatus("unconfigured");
      return status;
    }
    const requestId = ++operation;
    busy = method;
    status = pendingStatus;
    publish();
    try {
      const result = await adapter[method]({ ...context, ...payload });
      if (disposed || requestId !== operation) return status;
      const resultStatus = typeof result?.result === "string" ? result.result : "";
      if (!acceptedStatuses.has(resultStatus) || onResult(result) === false) setStatus("error");
      else setStatus(resultStatus);
    } catch (error) {
      if (!disposed && requestId === operation) {
        if (method === "verify" && error?.result === "stale") {
          stampRecord = null;
          authenticatedObservationIds.add(payload.observationId);
          history = {
            ...history,
            observations: history.observations.map(item => item.observationId === payload.observationId
              ? { ...item, matchesCurrentSource: false }
              : item),
          };
          selectedObservationId = "";
        }
        if (method === "verify" && ["record_unverified", "not_found", "unavailable"].includes(error?.result)) stampRecord = null;
        setErrorStatus(error);
      }
    } finally {
      if (!disposed && requestId === operation) {
        busy = "";
        publish();
      }
    }
    return status;
  }

  if (!supports("getHistory") && !supports("observe") && !supports("verify")) status = "unconfigured";

  return Object.freeze({
    getState: snapshot,
    refreshHistory,
    selectObservation(id) {
      if (disposed || busy) return false;
      const record = history.observations.find(item => item.observationId === id && item.matchesCurrentSource);
      if (!record) return false;
      operation += 1;
      selectedObservationId = record.observationId;
      status = "not_checked";
      publish();
      return true;
    },
    observe() {
      selectedObservationId = "";
      return run({
        method: "observe",
        pendingStatus: "observing",
        acceptedStatuses: OBSERVE_STATUSES,
        onResult(result) {
          if (result?.result !== "observed" || !UUID.test(result.observationId || "")
            || !SHA256.test(result.sha256 || "") || !Number.isSafeInteger(result.byteSize) || result.byteSize < 1
            || typeof result.createdAt !== "string") return false;
          void refreshHistory();
          return true;
        },
      });
    },
    verify() {
      const selected = selectedObservation();
      if (!selected || !selected.matchesCurrentSource) {
        setStatus("not_checked");
        return Promise.resolve(status);
      }
      return run({
        method: "verify",
        pendingStatus: "verifying",
        acceptedStatuses: STORED_VERIFY_STATUSES,
        payload: { observationId: selected.observationId },
        onResult(result) {
          if (["stale", "observed_bytes_differ"].includes(result?.result)) stampRecord = null;
          if (["observed_bytes_match", "observed_bytes_differ", "stale"].includes(result?.result)) {
            authenticatedObservationIds.add(selected.observationId);
          }
          if (result?.result === "stale") {
            history = {
              ...history,
              observations: history.observations.map(item => item.observationId === selected.observationId
                ? { ...item, matchesCurrentSource: false }
                : item),
            };
            selectedObservationId = "";
            publish();
          }
        },
      });
    },
    async compareFile(file) {
      if (disposed || busy || !file || !Number.isSafeInteger(file.size) || file.size < 1) {
        setStatus("error");
        return status;
      }
      if (file.size > MAX_LOCAL_COMPARISON_BYTES) {
        setStatus("error");
        return status;
      }
      const selected = selectedObservation();
      if (!selected || !selected.matchesCurrentSource || !supports("getManifest")) {
        setStatus("unconfigured");
        return status;
      }
      const requestId = ++operation;
      busy = "compareFile";
      status = "verifying";
      publish();
      try {
        const manifest = await adapter.getManifest({ ...context, observationId: selected.observationId });
        if (disposed || requestId !== operation) return status;
        if (manifest?.observationId !== selected.observationId
          || manifest.sha256?.toLowerCase() !== selected.sha256.toLowerCase()
          || manifest.byteSize !== selected.byteSize || manifest.createdAt !== selected.createdAt) {
          status = "error";
          publish();
          return status;
        }
        authenticatedObservationIds.add(selected.observationId);
        publish();
        const comparison = await compareFileToManifest(file, manifest, { cryptoProvider });
        if (!disposed && requestId === operation) setStatus(comparison);
      } catch (error) {
        if (!disposed && requestId === operation) setErrorStatus(error);
      } finally {
        if (!disposed && requestId === operation) {
          busy = "";
          publish();
        }
      }
      return status;
    },
    dispose() {
      disposed = true;
      operation += 1;
      historyOperation += 1;
      history = { observations: [], hasMore: false, limitation: "" };
      selectedObservationId = "";
      authenticatedObservationIds.clear();
      stampRecord = null;
      stampError = "";
      busy = "";
    },
  });
}

let panelSequence = 0;
const panelMarkup = sequence => `
  <section class="master-provenance-panel" aria-labelledby="masterProvenanceTitle-${sequence}">
    <header class="master-provenance-panel__header">
      <div>
        <p class="master-provenance-panel__eyebrow">Private catalog · master integrity</p>
        <h3 id="masterProvenanceTitle-${sequence}">Master byte observations</h3>
        <p class="master-provenance-panel__context" data-provenance-context></p>
      </div>
      <span class="master-provenance-panel__badge" data-provenance-badge data-state="not_checked">No comparison yet</span>
    </header>
    <aside class="master-provenance-stamp" data-provenance-stamp hidden aria-label="Authenticated master observation">
      <img src="/assets/halo-master-provenance.png" alt="" width="144" height="96" loading="lazy">
      <div><strong>HALO provenance recorded</strong>
        <p data-provenance-stamp-details></p>
        <code data-provenance-stamp-hash></code>
        <p>Authenticated byte observation, not proof of ownership or an immutable master certificate.</p>
      </div>
    </aside>
    <p data-provenance-stamp-error role="status" aria-live="polite"></p>
    <p class="master-provenance-panel__result" data-provenance-result data-state="not_checked"
      role="status" aria-live="polite" aria-atomic="true">No comparison has been requested for the selected observation.</p>
    <div class="master-provenance-panel__actions" role="group" aria-label="Master byte observation actions">
      <button class="master-provenance-panel__button master-provenance-panel__button--primary" type="button" data-provenance-observe>Observe stored master</button>
      <button class="master-provenance-panel__button" type="button" data-provenance-refresh>Refresh history</button>
      <button class="master-provenance-panel__button" type="button" data-provenance-verify disabled>Compare stored bytes</button>
    </div>
    <p class="master-provenance-panel__rate-limit">Stored-byte observation and comparison share a limit of one expensive read per owner per minute.</p>
    <div class="master-provenance-panel__history" data-provenance-history aria-live="polite"></div>
    <p class="master-provenance-panel__limitation" data-provenance-limitation></p>
    <div class="master-provenance-panel__file">
      <label for="masterProvenanceFile-${sequence}">Compare a supplied file locally</label>
      <input id="masterProvenanceFile-${sequence}" data-provenance-file type="file" accept="audio/*,.wav,.flac"
        aria-describedby="masterProvenanceFileHelp-${sequence} masterProvenanceFileStatus-${sequence}">
      <p id="masterProvenanceFileHelp-${sequence}">Up to 100 MiB. The browser fetches an authenticated observation manifest, then hashes the selected file locally with SHA-256. The file is never uploaded. Exact bytes only; any change, including metadata or encoding, differs.</p>
      <p id="masterProvenanceFileStatus-${sequence}" class="master-provenance-panel__file-status" data-provenance-file-status role="status" aria-live="polite">A current-source observation and secure browser cryptography are required.</p>
      <button class="master-provenance-panel__button" type="button" data-provenance-verify-file disabled>Compare file</button>
    </div>
    <p class="master-provenance-panel__boundary">An observation records bytes the service read from a mutable source. The source can change during or after that read; chunk reads can combine concurrent writes. A comparison is not a seal, immutable copy, independent proof, ownership or rights determination, or mastering approval.</p>
  </section>`;

const SELECTORS = Object.freeze({
  context: "[data-provenance-context]",
  badge: "[data-provenance-badge]",
  result: "[data-provenance-result]",
  observe: "[data-provenance-observe]",
  refresh: "[data-provenance-refresh]",
  verify: "[data-provenance-verify]",
  history: "[data-provenance-history]",
  limitation: "[data-provenance-limitation]",
  file: "[data-provenance-file]",
  fileStatus: "[data-provenance-file-status]",
  verifyFile: "[data-provenance-verify-file]",
});

function renderHistory(root, state, controller, buttons, api, cryptoSupported) {
  const host = root.querySelector(SELECTORS.history);
  const fileInput = root.querySelector(SELECTORS.file);
  const fileStatus = root.querySelector(SELECTORS.fileStatus);
  const hasManifest = typeof api?.getManifest === "function";
  const records = state.observations;
  host.replaceChildren();
  if (state.historyState === "loading") {
    host.textContent = "Loading this master's private observation history…";
  } else if (state.historyState === "unconfigured") {
    host.textContent = "Observation history is not configured.";
  } else if (state.historyState === "error") {
    host.textContent = state.historyError || "Observation history could not be loaded.";
  } else if (!records.length) {
    host.textContent = "No valid observations are available. Choose Observe stored master to record one.";
  } else {
    const list = root.ownerDocument.createElement("ol");
    list.className = "master-provenance-panel__records";
    list.setAttribute("role", "radiogroup");
    list.setAttribute("aria-label", "Observation records; each is unverified until a server comparison");
    for (const record of records) {
      const item = root.ownerDocument.createElement("li");
      const label = root.ownerDocument.createElement("label");
      const radio = root.ownerDocument.createElement("input");
      radio.type = "radio";
      radio.name = `master-provenance-observation-${root.dataset.panelId}`;
      radio.value = record.observationId;
      radio.checked = record.observationId === state.selectedObservationId;
      radio.disabled = !record.matchesCurrentSource || Boolean(state.busy);
      radio.addEventListener("change", () => controller.selectObservation(record.observationId));
      const details = root.ownerDocument.createElement("span");
      const time = root.ownerDocument.createElement("strong");
      time.textContent = new Date(record.createdAt).toLocaleString();
      const facts = root.ownerDocument.createElement("small");
      facts.textContent = `${record.byteSize.toLocaleString()} bytes · ${record.sourceType} storage`;
      const fingerprint = root.ownerDocument.createElement("code");
      fingerprint.textContent = `SHA-256 ${record.sha256.slice(0, 12)}…`;
      const authentication = root.ownerDocument.createElement("small");
      authentication.textContent = state.authenticatedObservationIds.includes(record.observationId)
        ? "Server record authentication checked during comparison"
        : "Record authentication: not checked";
      const source = root.ownerDocument.createElement("small");
      source.textContent = record.matchesCurrentSource
        ? "Source identity matches current registration"
        : "Source identity differs from current registration";
      details.append(time, facts, fingerprint, authentication, source);
      label.append(radio, details);
      item.append(label);
      list.append(item);
    }
    host.append(list);
    if (state.hasMore) {
      const more = root.ownerDocument.createElement("p");
      more.textContent = "Showing the 20 most recent valid observations. More history is available.";
      host.append(more);
    }
  }
  root.querySelector(SELECTORS.limitation).textContent = state.limitation || "";
  buttons.verify.disabled = Boolean(state.busy) || !state.selectedObservation?.matchesCurrentSource;
  fileInput.disabled = Boolean(state.busy) || !state.selectedObservation?.matchesCurrentSource || !cryptoSupported || !hasManifest;
  buttons.verifyFile.disabled = Boolean(state.busy) || fileInput.disabled || !fileInput.files?.[0];
  if (!cryptoSupported) fileStatus.textContent = "Local comparison is unavailable: secure browser SHA-256 is not supported.";
  else if (!hasManifest) fileStatus.textContent = "Local comparison is unavailable until an authenticated manifest adapter is configured.";
}

export function mountMasterProvenancePanel(root, {
  songId,
  versionId,
  songTitle = "",
  versionLabel = "Sale master",
  api,
  cryptoProvider = globalThis.crypto,
} = {}) {
  if (!root?.ownerDocument || !root.querySelector) return null;
  let mounted = true;
  root.dataset.panelId = String(++panelSequence);
  root.innerHTML = panelMarkup(panelSequence);
  const query = selector => root.querySelector(selector);
  const hasScope = UUID.test(songId || "") && UUID.test(versionId || "");
  const buttons = {
    observe: query(SELECTORS.observe),
    refresh: query(SELECTORS.refresh),
    verify: query(SELECTORS.verify),
    verifyFile: query(SELECTORS.verifyFile),
  };
  const secureCrypto = Boolean(cryptoProvider?.subtle?.digest);
  query(SELECTORS.context).textContent = [songTitle, versionLabel].filter(Boolean).join(" · ") || "Selected catalog master";
  const controller = createMasterProvenanceController({
    songId, versionId, api, cryptoProvider, authenticateStamp: true,
    onStateChange(state) {
      const copy = currentMessage(state.status);
      query(SELECTORS.badge).textContent = copy.label;
      query(SELECTORS.badge).dataset.state = state.status;
      query(SELECTORS.result).textContent = copy.detail;
      query(SELECTORS.result).dataset.state = state.status;
      root.dataset.provenanceState = state.status;
      root.dataset.provenanceBusy = state.busy || "";
      buttons.observe.disabled = Boolean(state.busy) || !hasScope || typeof api?.observe !== "function";
      buttons.refresh.disabled = Boolean(state.busy) || !hasScope || typeof api?.getHistory !== "function";
      buttons.verifyFile.disabled = Boolean(state.busy);
      renderHistory(root, state, controller, buttons, api, secureCrypto);
      const stamp = query("[data-provenance-stamp]");
      stamp.hidden = !state.stampRecord;
      query("[data-provenance-stamp-error]").textContent = state.stampError;
      query("[data-provenance-stamp-details]").textContent = state.stampRecord
        ? `Recorded ${new Date(state.stampRecord.createdAt).toLocaleString()} · ${state.stampRecord.byteSize.toLocaleString()} bytes · ID ${state.stampRecord.observationId}` : "";
      query("[data-provenance-stamp-hash]").textContent = state.stampRecord ? `SHA-256 ${state.stampRecord.sha256}` : "";
    },
  });
  query(SELECTORS.file).addEventListener("change", event => {
    const file = event.currentTarget.files?.[0];
    query(SELECTORS.fileStatus).textContent = file
      ? file.size > MAX_LOCAL_COMPARISON_BYTES
        ? "Files larger than 100 MiB cannot be compared in this browser."
        : `Selected locally · ${file.size.toLocaleString()} bytes. Nothing has been uploaded or compared yet.`
      : "No file selected.";
    buttons.verifyFile.disabled = !file || file.size > MAX_LOCAL_COMPARISON_BYTES || !secureCrypto
      || !controller.getState().selectedObservation;
  });
  buttons.observe.addEventListener("click", () => void controller.observe());
  buttons.refresh.addEventListener("click", () => void controller.refreshHistory());
  buttons.verify.addEventListener("click", () => void controller.verify());
  buttons.verifyFile.addEventListener("click", async () => {
    const result = await controller.compareFile(query(SELECTORS.file).files?.[0]);
    if (!mounted) return;
    query(SELECTORS.fileStatus).textContent = result === "file_bytes_match"
      ? "Local comparison complete: supplied bytes matched. The file was not uploaded."
      : result === "file_bytes_differ"
        ? "Local comparison complete: supplied bytes differed. The file was not uploaded."
        : "Local comparison did not complete. The file was not uploaded.";
  });
  root.querySelector(SELECTORS.file).disabled = !secureCrypto || typeof api?.getManifest !== "function" || !hasScope;
  if (!secureCrypto || typeof api?.getManifest !== "function") {
    query(SELECTORS.fileStatus).textContent = "Local file comparison is unavailable in this browser or service.";
  }
  buttons.observe.disabled = !hasScope || typeof api?.observe !== "function";
  buttons.refresh.disabled = !hasScope || typeof api?.getHistory !== "function";
  buttons.verify.disabled = true;
  buttons.verifyFile.disabled = true;

  void controller.refreshHistory();
  return Object.freeze({
    controller,
    observe: () => controller.observe(),
    refreshHistory: () => controller.refreshHistory(),
    dispose() {
      mounted = false;
      controller.dispose();
      root.replaceChildren();
      delete root.dataset.panelId;
      delete root.dataset.provenanceState;
      delete root.dataset.provenanceBusy;
    },
  });
}
