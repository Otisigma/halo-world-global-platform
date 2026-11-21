(() => {
  const $ = id => document.getElementById(id);
  const listeners = $("evidence-listener-status");
  const master = $("evidence-master-status");
  const list = $("evidence-master-list");
  const song = $("evidence-song");
  const version = $("evidence-version");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  let listenerRequest = 0;
  let masterRequest = 0;

  async function get(url) {
    const response = await fetch(url, {
      credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(25000)
    });
    if (response.status === 401) throw new Error("Sign in to access this evidence.");
    if (response.status === 403) throw new Error("Your account is not authorized to access this evidence.");
    if (!response.ok) throw new Error(`Evidence unavailable (${response.status}); retry later.`);
    return response.json();
  }

  $("evidence-listeners").addEventListener("click", async () => {
    const request = ++listenerRequest;
    listeners.textContent = "Loading listener aggregate...";
    try {
      const data = await get("/api/halo-control-center?view=outcomes");
      if (request !== listenerRequest) return;
      const source = data.outcomes?.sources?.listeners;
      const count = source?.metrics?.currentListeners;
      if (source?.status !== "available" || !Number.isSafeInteger(count) || count < 0) {
        throw new Error("Listener aggregate unavailable; no count is shown.");
      }
      const end = new Date(data.outcomes?.window?.end);
      if (Number.isNaN(end.getTime())) throw new Error("Listener aggregate has an invalid time window.");
      listeners.textContent = `${count} distinct opted-in members reported listening in the 7 days ending ${end.toISOString()}. This is not a play count; reports can be missing and opt-outs are excluded.`;
    } catch (error) {
      if (request === listenerRequest) listeners.textContent = error.message || "Listener aggregate unavailable.";
    }
  });

  function clearMaster() {
    masterRequest++;
    list.replaceChildren();
    master.textContent = "Not loaded.";
  }

  for (const input of [song, version]) input.addEventListener("input", clearMaster);
  $("evidence-form").addEventListener("submit", async event => {
    event.preventDefault();
    clearMaster();
    const songId = song.value.trim();
    const versionId = version.value.trim();
    if (!uuid.test(songId) || !uuid.test(versionId)) {
      master.textContent = "Enter valid lowercase song and master version IDs.";
      return;
    }
    const request = masterRequest;
    master.textContent = "Loading master observations...";
    try {
      const params = new URLSearchParams({ songId, versionId });
      const data = await get(`/api/song-catalog/master-provenance?${params}`);
      if (request !== masterRequest) return;
      if (!Array.isArray(data.observations)) throw new Error("Master observations unavailable.");
      for (const observation of data.observations) {
        const item = document.createElement("li");
        item.textContent = observation.malformed
          ? `Observation ${observation.observationId}: malformed record.`
          : `${observation.createdAt} | SHA-256 ${observation.sha256} | ${observation.byteSize} bytes | record authentication not checked | ${observation.matchesCurrentSource ? "same source reference" : "source reference differs"}`;
        list.append(item);
      }
      master.textContent = data.observations.length
        ? `Showing ${data.observations.length} observation(s)${data.hasMore ? "; more exist in the catalog" : ""}. Source references do not verify current bytes.`
        : "No recorded observations for this master.";
    } catch (error) {
      if (request === masterRequest) {
        list.replaceChildren();
        master.textContent = error.message || "Master observations unavailable.";
      }
    }
  });

  window.addEventListener("pagehide", () => {
    listenerRequest++;
    listeners.textContent = "Not loaded.";
    clearMaster();
  });
})();
