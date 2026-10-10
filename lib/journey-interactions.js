export function createLyricInteractionRecorder({ fetcher = globalThis.fetch, enabled = () => false,
  releaseId = () => "", now = () => Date.now() } = {}) {
  let lastRecorded = -Infinity;
  return (seconds = 0) => {
    const id = releaseId();
    if (!enabled() || !id || !Number.isFinite(seconds) || seconds < 0 || now() - lastRecorded < 5000) return;
    lastRecorded = now();
    Promise.resolve(fetcher("/api/empath-journey", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lyric", releaseId: id, seconds })
    })).catch(() => {});
  };
}
