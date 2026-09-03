/**
 * Shared utilities for HALO World Global Platform.
 *
 * Import or copy into individual modules as needed. These helpers centralise
 * common patterns so they are maintained in one place.
 */

/**
 * Return the element with the given id.
 * @param {string} id
 * @returns {HTMLElement|null}
 */
export function byId(id) {
  return document.getElementById(id);
}

/**
 * Format a number using the en-GB locale (e.g. 1,234,567).
 * @param {number|string} value
 * @returns {string}
 */
export function number(value) {
  return new Intl.NumberFormat("en-GB").format(Number(value || 0));
}

/**
 * Format an ISO date-time string as "DD Mon YYYY, HH:MM UTC".
 * Returns "Not available" when value is falsy.
 * @param {string} value
 * @returns {string}
 */
export function formatDateTime(value) {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC"
      }).format(new Date(value)) + " UTC"
    : "Not available";
}

/**
 * Create a DOM element with optional attributes and child nodes.
 *
 * String children are inserted as text nodes so no HTML injection is possible.
 *
 * @param {string} tag  Element tag name.
 * @param {Record<string,string>|null} attrs  Attribute key/value pairs.
 * @param {...(string|Node)} children  Child text strings or nodes.
 * @returns {HTMLElement}
 */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs || {})) {
    if (val !== null && val !== undefined) node.setAttribute(key, val);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * Replace the children of a list element with items as <li> text nodes.
 *
 * @param {HTMLElement} target  A <ul> or <ol> element.
 * @param {string[]} items      Items to render; falls back to [empty] when absent.
 * @param {string} empty        Placeholder text when items is empty.
 */
export function renderList(target, items, empty) {
  const data = items?.length ? items : [empty];
  target.replaceChildren(...data.map(item => el("li", null, item)));
}
