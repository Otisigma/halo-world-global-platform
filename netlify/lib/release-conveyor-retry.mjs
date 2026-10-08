const TRANSIENT_CODES = new Set(["40001", "40P01", "55P03", "08000", "08003", "08006", "53300", "57P01", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"]);

export function isTransientReleaseError(error) {
  return error?.retryable === true || TRANSIENT_CODES.has(error?.code)
    || [408, 429, 500, 502, 503, 504].includes(Number(error?.status))
    || ["TimeoutError", "AbortError"].includes(error?.name)
    || (error instanceof TypeError && /fetch failed/i.test(error.message));
}

// Only idempotent conveyor work may use this bounded retry policy.
export async function retryReleaseWork(work, { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onRetry = () => {} } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await work(); } catch (error) {
      if (attempt >= 3 || !isTransientReleaseError(error)) throw error;
      onRetry(attempt);
      await sleep(100 * 2 ** (attempt - 1));
    }
  }
}
