// Shared resilience primitives for HALO's mission-critical paths. See RESILIENCE.md.
// Redundancy is applied per tier rather than to every request: user-facing calls fail fast with a
// clear error, ingest/storage paths retry idempotent work and fail over sequentially, background work
// relies on durable rows + scheduled reconcilers, and observability is strictly best-effort.

export const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set([
  "40001", "40P01", "55P03", "08000", "08003", "08006", "53300", "57P01",
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT",
]);

/** Per-tier defaults. Every tier is bounded: no unbounded retries and no request without a timeout. */
export const RESILIENCE_TIERS = Object.freeze({
  // User-facing API requests: one quick retry at most, then a clear, actionable error state.
  interactive: Object.freeze({ timeoutMs: 8_000, retries: 1, baseDelayMs: 250, maxDelayMs: 1_000 }),
  // Upload/ingest: chunk writes are idempotent (keyed by uploadId + index), so retries are safe.
  ingest: Object.freeze({ timeoutMs: 120_000, retries: 3, baseDelayMs: 800, maxDelayMs: 8_000 }),
  // Background jobs: durable DB state + scheduled reconcilers own long-horizon recovery.
  background: Object.freeze({ timeoutMs: 30_000, retries: 2, baseDelayMs: 100, maxDelayMs: 2_000 }),
  // Object storage: replication is the provider's job; the app bounds latency and trips a breaker.
  storage: Object.freeze({ timeoutMs: 10_000, retries: 2, baseDelayMs: 200, maxDelayMs: 2_000, failureThreshold: 5, resetTimeoutMs: 30_000 }),
  // Telemetry/logging: never retried, never allowed to fail or slow the request it describes.
  observability: Object.freeze({ timeoutMs: 2_000, retries: 0 }),
});

export function isTransientError(error) {
  if (!error) return false;
  if (error.circuitOpen) return false;
  if (error.retryable === true) return true;
  if (error.retryable === false) return false;
  return TRANSIENT_CODES.has(error.code) || TRANSIENT_CODES.has(error.cause?.code)
    || RETRYABLE_HTTP_STATUSES.has(Number(error.status))
    || ["TimeoutError", "AbortError"].includes(error.name)
    || (error instanceof TypeError && /fetch failed|network|load failed/i.test(error.message));
}

export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === "") return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(String(value));
  return Number.isFinite(at) ? Math.max(0, at - now) : 0;
}

/** Converts a non-2xx HTTP response into an error that carries status, retryability, and Retry-After. */
export function httpStatusError(response, label = "Request") {
  const status = Number(response?.status) || 0;
  return Object.assign(new Error(`${label} failed with HTTP ${status}`), {
    name: "HttpStatusError",
    status,
    retryable: RETRYABLE_HTTP_STATUSES.has(status),
    retryAfterMs: parseRetryAfter(response?.headers?.get?.("retry-after")),
  });
}

function timeoutError(label, timeoutMs) {
  return Object.assign(new Error(`${label} timed out after ${timeoutMs} ms`), { name: "TimeoutError", code: "ETIMEDOUT", retryable: true });
}

function abortError(reason) {
  if (reason instanceof Error) return reason;
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError", retryable: false });
}

/**
 * Runs `work(signal)` with a hard deadline. On timeout the signal is aborted so the underlying
 * fetch/stream is actually cancelled rather than left running in the background.
 */
export function withTimeout(work, { timeoutMs, signal, label = "Operation" } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve().then(() => work(signal));
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const onAbort = () => {
      const error = abortError(signal.reason);
      controller.abort(error);
      finish(reject, error);
    };
    const timer = setTimeout(() => {
      const error = timeoutError(label, timeoutMs);
      controller.abort(error);
      finish(reject, error);
    }, timeoutMs);
    function finish(settle, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      settle(value);
    }
    if (signal?.aborted) return onAbort();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    Promise.resolve().then(() => work(controller.signal)).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function backoffDelay(attempt, { baseDelayMs = 200, maxDelayMs = 5_000, random = Math.random } = {}) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  // Equal jitter keeps a floor of half the delay while de-synchronising retry storms.
  return Math.round(exponential / 2 + random() * (exponential / 2));
}

/**
 * Retries `work(attempt, signal)` only for transient failures, with jittered exponential backoff.
 * Callers must only use this for idempotent work (safe to repeat after an ambiguous failure).
 */
export async function retryWithBackoff(work, {
  retries = 2,
  baseDelayMs = 200,
  maxDelayMs = 5_000,
  timeoutMs,
  deadline = Infinity,
  signal,
  label = "Operation",
  isRetryable = isTransientError,
  sleep = defaultSleep,
  random = Math.random,
  now = Date.now,
  onRetry = () => {},
} = {}) {
  for (let attempt = 1; ; attempt += 1) {
    if (signal?.aborted) throw abortError(signal.reason);
    if (now() >= deadline) throw Object.assign(new Error(`${label} time budget exhausted`), { name: "TimeoutError", retryable: true });
    try {
      const budget = Number.isFinite(deadline) ? Math.max(1, Math.min(timeoutMs ?? Infinity, deadline - now())) : timeoutMs;
      return await withTimeout(attemptSignal => work(attempt, attemptSignal), { timeoutMs: budget, signal, label });
    } catch (error) {
      if (attempt > retries || !isRetryable(error)) throw error;
      const delayMs = Math.min(maxDelayMs, Math.max(backoffDelay(attempt, { baseDelayMs, maxDelayMs, random }), Number(error?.retryAfterMs) || 0));
      if (now() + delayMs >= deadline) throw error;
      onRetry({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}

/**
 * Classic closed → open → half-open breaker. Only transient dependency failures count against the
 * breaker; caller mistakes (4xx validation errors) never trip it.
 */
export function createCircuitBreaker({
  name = "dependency",
  failureThreshold = 5,
  resetTimeoutMs = 30_000,
  halfOpenMaxCalls = 1,
  isFailure = isTransientError,
  now = Date.now,
  onStateChange = () => {},
} = {}) {
  let state = "closed";
  let failures = 0;
  let openedAt = 0;
  let halfOpenInFlight = 0;

  function transition(next) {
    if (state === next) return;
    const previous = state;
    state = next;
    if (next === "open") openedAt = now();
    if (next === "closed") failures = 0;
    if (next !== "half_open") halfOpenInFlight = 0;
    onStateChange({ name, from: previous, to: next, failures });
  }

  function currentState() {
    if (state === "open" && now() - openedAt >= resetTimeoutMs) transition("half_open");
    return state;
  }

  function canAttempt() {
    const current = currentState();
    return current === "closed" || (current === "half_open" && halfOpenInFlight < halfOpenMaxCalls);
  }

  function recordSuccess() {
    failures = 0;
    if (state !== "closed") transition("closed");
  }

  function recordFailure(error) {
    if (!isFailure(error)) {
      if (state === "half_open") transition("closed");
      return;
    }
    failures += 1;
    if (state === "half_open" || failures >= failureThreshold) transition("open");
  }

  async function execute(work) {
    if (!canAttempt()) {
      throw Object.assign(new Error(`${name} is temporarily unavailable (circuit open)`), { name: "CircuitOpenError", code: "CIRCUIT_OPEN", circuitOpen: true, retryable: false });
    }
    const probing = state === "half_open";
    if (probing) halfOpenInFlight += 1;
    try {
      const value = await work();
      recordSuccess();
      return value;
    } catch (error) {
      recordFailure(error);
      throw error;
    } finally {
      if (probing && halfOpenInFlight > 0) halfOpenInFlight -= 1;
    }
  }

  return {
    name,
    execute,
    canAttempt,
    get state() { return currentState(); },
    isAvailable: () => currentState() !== "open",
    snapshot: () => ({ name, state: currentState(), failures, openedAt: openedAt ? new Date(openedAt).toISOString() : null }),
    reset: () => { failures = 0; openedAt = 0; transition("closed"); },
  };
}

/**
 * Real failover: targets are tried strictly in order. A secondary target is only invoked after the
 * previous one has failed (transient error), been reported unhealthy, or had its breaker open.
 * Unlike `Promise.race`, a backup can never "win" while the primary is healthy, and the result
 * always reports which target actually served the request.
 *
 * targets: [{ name, run(signal), healthCheck?(signal), healthCheckTimeoutMs?, breaker?, timeoutMs?, retry? }]
 */
export async function failover(targets, {
  isFailoverable = error => isTransientError(error) || Boolean(error?.circuitOpen),
  onFailover = () => {},
  signal,
} = {}) {
  if (!Array.isArray(targets) || targets.length === 0) throw new Error("failover requires at least one target");
  const failures = [];
  const moveOn = (index, reason, error) => {
    failures.push({ target: targets[index].name, reason, error });
    if (index < targets.length - 1) onFailover({ from: targets[index].name, to: targets[index + 1].name, reason, error });
  };
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (signal?.aborted) throw abortError(signal.reason);
    if (target.breaker && !target.breaker.canAttempt()) {
      moveOn(index, "circuit_open");
      continue;
    }
    if (target.healthCheck) {
      const healthy = await withTimeout(target.healthCheck, { timeoutMs: target.healthCheckTimeoutMs ?? 1_000, signal, label: `${target.name} health check` }).catch(() => false);
      if (healthy !== true) {
        moveOn(index, "unhealthy");
        continue;
      }
    }
    const runOnce = (_attempt, attemptSignal) => target.breaker ? target.breaker.execute(() => target.run(attemptSignal)) : target.run(attemptSignal);
    try {
      const value = await retryWithBackoff(runOnce, { retries: 0, timeoutMs: target.timeoutMs, signal, label: target.name, ...(target.retry || {}) });
      return { value, target: target.name, failedOver: index > 0, failures };
    } catch (error) {
      if (!isFailoverable(error)) throw error;
      moveOn(index, "error", error);
    }
  }
  throw Object.assign(new Error(`All targets failed: ${failures.map(failure => `${failure.target} (${failure.reason})`).join(", ")}`), {
    name: "FailoverExhaustedError",
    retryable: true,
    failures,
  });
}

/** Observability-tier wrapper: bounded, never throws, never blocks the caller beyond its timeout. */
export async function bestEffort(work, { timeoutMs = RESILIENCE_TIERS.observability.timeoutMs, onError = () => {} } = {}) {
  try {
    return await withTimeout(work, { timeoutMs, label: "Best-effort task" });
  } catch (error) {
    try { onError(error); } catch { /* observability must never throw */ }
    return undefined;
  }
}
