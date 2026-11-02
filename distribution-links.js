(() => {
  // Keep this browser check aligned with Release House's validated-text URL policy.
  const hosts = ["distrokid.com", "hyperfollow.com", "ffm.to", "lnk.to", "found.ee", "linktr.ee"];

  function validate(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw || raw.length > 500 || /[\s\u0000-\u001f\u007f\\]/.test(raw)) return "";
    try {
      const url = new URL(raw);
      if (!/^https:\/\//i.test(raw) || url.protocol !== "https:" || url.username || url.password || url.port || /^https:\/\/[^/?#]*:/i.test(raw)) return "";
      const host = url.hostname.toLowerCase();
      if (!hosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`))) return "";
      if ((host === "distrokid.com" || host.endsWith(".distrokid.com")) && !url.pathname.startsWith("/hyperfollow/")) return "";
      return url.href.length <= 500 ? url.href : "";
    } catch {
      return "";
    }
  }

  function destination(release) {
    if (release?.status !== "published" || release?.isLiveVisible !== true) return "";
    return validate(release.distributionUrl);
  }

  function action(release, className = "action secondary") {
    const href = destination(release);
    if (!href) return "";
    const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
    const label = `Stream / DSPs for ${release.title || "this release"} (external site, opens in a new tab)`;
    return `<a class="${escape(className)} distribution-link" href="${escape(href)}" target="_blank" rel="noopener noreferrer" data-halo-player="off" title="${escape(label)}" aria-label="${escape(label)}">Stream / DSPs <span aria-hidden="true">↗</span></a>`;
  }

  window.HaloDistributionLinks = Object.freeze({ validate, destination, action });
})();
