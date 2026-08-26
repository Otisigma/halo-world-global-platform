(() => {
  const numberFormatter = new Intl.NumberFormat("en-GB");
  const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  });

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
  }

  function number(value) {
    return numberFormatter.format(Number(value || 0));
  }

  function formatDateTime(value, fallback = "Not available") {
    return value ? `${dateTimeFormatter.format(new Date(value))} UTC` : fallback;
  }

  function toErrorMessage(error, fallback) {
    return error instanceof Error ? error.message : fallback;
  }

  function appendChildren(parent, children = []) {
    for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
      if (child === null || child === undefined || child === false) continue;
      parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return parent;
  }

  function createElement(tagName, options = {}, children = []) {
    const element = document.createElement(tagName);
    const { className, text, attrs = {}, dataset = {}, hidden } = options;
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    if (hidden !== undefined) element.hidden = Boolean(hidden);
    Object.entries(attrs).forEach(([name, value]) => {
      if (value !== undefined && value !== null) element.setAttribute(name, String(value));
    });
    Object.entries(dataset).forEach(([key, value]) => {
      if (value !== undefined && value !== null) element.dataset[key] = String(value);
    });
    return appendChildren(element, children);
  }

  async function requestJson(url, options = {}, fallbackMessage = "Request failed.") {
    const { method = "GET", body, credentials = "same-origin", headers = {} } = options;
    let response;
    try {
      response = await fetch(url, {
        method,
        credentials,
        headers: body ? { "Content-Type": "application/json", ...headers } : headers,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new Error(fallbackMessage);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data.message === "string" && data.message.trim() ? data.message : fallbackMessage);
    }
    return data;
  }

  window.haloUtils = Object.freeze({
    ...(window.haloUtils || {}),
    appendChildren,
    byId,
    createElement,
    escapeHtml,
    formatDateTime,
    number,
    requestJson,
    toErrorMessage
  });
})();
