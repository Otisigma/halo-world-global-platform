// Shared null-safe string helpers. Loaded as a classic script (window.HaloSafeText)
// and imported as a side-effect module by /lib/dj-control-room.js and Node contracts.
(root => {
  if (root.HaloSafeText) return;

  function text(value, fallback = "") {
    if (value === undefined || value === null) return String(fallback ?? "");
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
    if (typeof value === "symbol" || typeof value === "function") return String(fallback ?? "");
    try {
      return String(value);
    } catch {
      return String(fallback ?? "");
    }
  }

  function lower(value, fallback = "") {
    return text(value, fallback).toLowerCase();
  }

  function upper(value, fallback = "") {
    return text(value, fallback).toUpperCase();
  }

  function trimmed(value, fallback = "") {
    return text(value, fallback).trim();
  }

  function eventKey(event) {
    return lower(event && event.key);
  }

  root.HaloSafeText = Object.freeze({ text, lower, upper, trimmed, eventKey });
})(typeof globalThis !== "undefined" ? globalThis : window);
