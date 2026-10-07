export function createSignalRooms({
  document = globalThis.document,
  window = globalThis.window
} = {}) {
  let rooms = [];
  let activeRoom = null;
  let root;
  const cleanups = [];

  function listen(target, type, handler) {
    target?.addEventListener?.(type, handler);
    cleanups.push(() => target?.removeEventListener?.(type, handler));
  }

  function select(id, { focus = false, updateHash = true } = {}) {
    const selected = rooms.find(room => room.panel.id === id);
    if (!selected) return false;
    const restoreFocus = rooms.some(room => room !== selected && room.panel.contains(document?.activeElement));
    for (const { tab, panel } of rooms) {
      const active = panel === selected.panel;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle("active", active);
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    }
    activeRoom = id;
    if (focus || restoreFocus) selected.tab.focus();
    if (updateHash && window?.location && window.location.hash !== `#${id}`) {
      try {
        if (window.history?.pushState) {
          window.history.pushState(window.history.state, "", `#${id}`);
        } else {
          window.location.hash = id;
        }
      } catch {
        // Fragment navigation still works when the History API is unavailable.
        window.location.hash = id;
      }
    }
    return true;
  }

  function hashRoom() {
    let id;
    try { id = decodeURIComponent(window?.location?.hash?.slice(1) || ""); } catch { return null; }
    const target = document?.getElementById?.(id);
    return rooms.find(room => room.panel.id === id || target && room.panel.contains(target));
  }

  function initialize() {
    root = document?.querySelector?.("[data-signal-rooms]");
    const tablist = root?.querySelector?.("[data-room-tabs]");
    if (!tablist) return;
    const panels = [...root.querySelectorAll("[data-room-panel]")];
    for (const tab of tablist.querySelectorAll("[data-room-tab]")) {
      const panel = panels.find(item => item.id === tab.getAttribute("aria-controls"));
      if (!panel || !tab.id) {
        tab.disabled = true;
        tab.tabIndex = -1;
        tab.setAttribute("aria-selected", "false");
        continue;
      }
      tab.setAttribute("role", "tab");
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      panel.tabIndex = 0;
      rooms.push({ tab, panel });
      listen(tab, "click", () => select(panel.id));
      listen(tab, "keydown", event => {
        const index = rooms.findIndex(room => room.tab === tab);
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % rooms.length;
        if (event.key === "ArrowLeft") next = (index - 1 + rooms.length) % rooms.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = rooms.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        select(rooms[next].panel.id, { focus: true });
      });
    }
    if (!rooms.length) return;
    for (const panel of panels) panel.hidden = true;
    const defaultRoom = rooms.find(room => room.tab.getAttribute("aria-selected") === "true") || rooms[0];
    const initial = hashRoom() || defaultRoom;
    select(initial.panel.id, { updateHash: false });
    tablist.setAttribute("role", "tablist");
    tablist.hidden = false;
    root.classList.add("signal-rooms--ready");
    listen(window, "hashchange", () => {
      const room = hashRoom() || (!window?.location?.hash ? defaultRoom : null);
      if (room) select(room.panel.id, { updateHash: false });
    });
  }

  if (document?.readyState === "loading") {
    listen(document, "DOMContentLoaded", initialize);
  } else {
    initialize();
  }

  return {
    select,
    getActiveRoom: () => activeRoom,
    destroy() {
      cleanups.splice(0).forEach(cleanup => cleanup());
    }
  };
}

if (globalThis.document) createSignalRooms();
