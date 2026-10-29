export function renderCatalogSignals({ root, songs, snapshot, authenticated, onReview }) {
  root.replaceChildren();
  if (!authenticated) return;
  const add = (tag, text, parent = root) => {
    const node = document.createElement(tag);
    node.textContent = text;
    parent.append(node);
    return node;
  };
  if (!songs.length) {
    add("p", "No songs in your catalog yet. Add or import a song to begin.");
    return;
  }
  if (snapshot?.status !== "available") {
    add("p", "Catalog signals unavailable. Refresh to retry; missing data is not zero activity.");
    return;
  }
  add("p", `Snapshot: ${snapshot.asOf}. Last 7 days (${snapshot.recentStart} to snapshot) compared with the preceding 7 days (${snapshot.previousStart} to ${snapshot.recentStart}).`);
  const counts = value => Number.isSafeInteger(value) && value >= 0;
  const entries = songs.map(song => {
    const signal = snapshot.songs?.find(item => item.songId === song.id);
    const valid = signal && [signal.recentClicks, signal.previousClicks, signal.recentOpens, signal.previousOpens].every(counts);
    return { song, signal: valid ? signal : null };
  }).sort((a, b) => (b.signal?.recentClicks || 0) - (a.signal?.recentClicks || 0));
  for (const { song, signal } of entries) {
    const card = add("article", "");
    card.className = "publication-card";
    add("h3", song.title, card);
    if (!signal) {
      add("p", "No linked published release data. Not enough data to compare.", card);
    } else {
      add("p", `Outbound link clicks: ${signal.recentClicks} last 7 days; ${signal.previousClicks} preceding 7 days. Release-room opens: ${signal.recentOpens} last 7 days; ${signal.previousOpens} preceding 7 days.`, card);
      const total = signal.recentClicks + signal.previousClicks + signal.recentOpens + signal.previousOpens;
      add("p", !total ? "No recorded activity in these windows. Not enough data to assess momentum."
        : !signal.previousClicks ? "No outbound clicks in the comparison period; a growth rate is not available."
        : `Outbound click change: ${signal.recentClicks - signal.previousClicks >= 0 ? "+" : ""}${signal.recentClicks - signal.previousClicks}. This is a comparison, not a promotion recommendation.`, card);
    }
    const button = add("button", "Review song", card);
    button.type = "button";
    button.className = "quiet-button";
    button.addEventListener("click", () => onReview(song.id));
  }
}
