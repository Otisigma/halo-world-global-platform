export function normalizeHttpsList(rawValue) {
  return String(rawValue || "")
    .split(/\n+/)
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) {
        throw new Error("Use https:// links only for official and video sources.");
      }
      return url.toString();
    });
}
