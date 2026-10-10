// HALO Dreamweaver Lyrics Engine.
// Source format (one lyric per line, written in the Song Catalog):
//   [01:15] The room goes quiet || Oracle insight shown on hover / focus
//   [00:12][01:30] A repeated chorus line
//   [Chorus]                 <- untimed section label (lyric book only)
//   An untimed line          <- readable in lyric book mode
// Lyrics and insights are always rendered with textContent, never as HTML.

export const LYRICS_MAX_SOURCE_LENGTH = 16_000;
export const LYRICS_MAX_LINES = 400;
export const LYRIC_TEXT_MAX_LENGTH = 240;
export const LYRIC_INSIGHT_MAX_LENGTH = 480;
export const LYRIC_MAX_SECONDS = 24 * 60 * 60;
export const LYRIC_INSIGHT_DELIMITER = "||";
export const LYRIC_INSTRUMENTAL_MARK = "♪";
export const LYRIC_MODES = Object.freeze(["sync", "book"]);

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;
const LEADING_TAG = /^\s*\[([^\]\n]{1,24})\]/;
const METADATA_TAG = /^\s*\[(?:ar|ti|al|au|by|re|ve|length|offset|#)\s*:[^\]]*\]\s*$/i;
const SECTION_LABEL = /^\s*\[([^\]\d:][^\]]{0,60})\]\s*$/;
const TIMESTAMP = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)(?:[.,](\d{1,3}))?$/;

export function normalizeLyricsSource(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(CONTROL_CHARACTERS, "")
    .split("\n")
    .map(line => line.replace(/[ \u00A0]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, LYRICS_MAX_SOURCE_LENGTH);
}

function cleanLine(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function parseLyricTimestamp(value) {
  const match = TIMESTAMP.exec(String(value || "").trim());
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  if (hours !== undefined && Number(minutes) > 59) return null;
  const total = Number(hours || 0) * 3600 + Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0);
  return Number.isFinite(total) && total <= LYRIC_MAX_SECONDS ? Math.round(total * 1000) / 1000 : null;
}

export function formatLyricTimestamp(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = String(safe % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function parseTimestampedLyrics(source) {
  const normalized = normalizeLyricsSource(source);
  const entries = [];
  let order = 0;
  let lastTime = -1;
  let pendingStanza = false;
  for (const rawLine of normalized ? normalized.split("\n") : []) {
    if (!rawLine.trim()) {
      pendingStanza = entries.length > 0;
      continue;
    }
    if (METADATA_TAG.test(rawLine)) continue;
    const section = SECTION_LABEL.exec(rawLine);
    if (section) {
      entries.push({ order: order++, sortKey: lastTime, time: null, text: cleanLine(section[1], LYRIC_TEXT_MAX_LENGTH), insight: "", kind: "section", stanzaStart: true });
      pendingStanza = false;
      continue;
    }
    const times = [];
    let rest = rawLine;
    for (let tag = LEADING_TAG.exec(rest); tag; tag = LEADING_TAG.exec(rest)) {
      const time = parseLyricTimestamp(tag[1]);
      if (time === null) break;
      times.push(time);
      rest = rest.slice(tag[0].length);
    }
    const delimiterIndex = rest.indexOf(LYRIC_INSIGHT_DELIMITER);
    const text = cleanLine(delimiterIndex >= 0 ? rest.slice(0, delimiterIndex) : rest, LYRIC_TEXT_MAX_LENGTH);
    const insight = delimiterIndex >= 0 ? cleanLine(rest.slice(delimiterIndex + LYRIC_INSIGHT_DELIMITER.length), LYRIC_INSIGHT_MAX_LENGTH) : "";
    if (!text && !times.length) continue;
    const kind = text ? "lyric" : "instrumental";
    const lineText = text || LYRIC_INSTRUMENTAL_MARK;
    if (times.length) {
      for (const time of times) {
        entries.push({ order: order++, sortKey: time, time, text: lineText, insight, kind, stanzaStart: pendingStanza });
      }
      lastTime = Math.max(...times);
    } else {
      entries.push({ order: order++, sortKey: lastTime, time: null, text: lineText, insight, kind, stanzaStart: pendingStanza });
    }
    pendingStanza = false;
    if (entries.length >= LYRICS_MAX_LINES) break;
  }
  const lines = entries
    .slice(0, LYRICS_MAX_LINES)
    .sort((a, b) => a.sortKey - b.sortKey || a.order - b.order)
    .map(({ time, text, insight, kind, stanzaStart }, index) => ({ index, time, text, insight, kind, stanzaStart: index > 0 && stanzaStart }));
  const timedCount = lines.filter(line => line.time !== null).length;
  return {
    lines,
    timed: timedCount > 0,
    timedCount,
    untimedCount: lines.length - timedCount,
    insightCount: lines.filter(line => line.insight).length
  };
}

export function findActiveLyricIndex(lines, currentTime) {
  const now = Number(currentTime);
  if (!Array.isArray(lines) || !Number.isFinite(now)) return -1;
  let active = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const time = lines[index]?.time;
    if (time === null || time === undefined) continue;
    if (time <= now + 0.05) active = index;
    else break;
  }
  return active;
}

export function summarizeLyrics(parsed) {
  if (!parsed?.lines?.length) return "No lyrics yet. Dreamweaver will hide the lyrics room for this song.";
  const parts = parsed.timed
    ? [`${parsed.timedCount} synced line${parsed.timedCount === 1 ? "" : "s"}`]
    : ["Lyric book only (no timestamps)"];
  if (parsed.timed && parsed.untimedCount) parts.push(`${parsed.untimedCount} untimed`);
  if (parsed.insightCount) parts.push(`${parsed.insightCount} Oracle insight${parsed.insightCount === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function createDreamweaverLyricsEngine({
  root,
  list,
  viewport = list,
  audio = null,
  modeToggle = null,
  status = null,
  doc = globalThis.document,
  win = globalThis.window,
  idPrefix = "dw-lyrics",
  onSeek = null,
  onInsight = null
} = {}) {
  if (!root || !list || !doc?.createElement) throw new TypeError("Dreamweaver lyrics need a root, list, and document");
  const engine = { source: null, parsed: parseTimestampedLyrics(""), mode: "sync", preferredMode: "sync", activeIndex: -1, rows: [], openInsight: null };
  const cleanups = [];
  const rowCleanups = [];
  const listen = (target, type, handler, bucket = cleanups) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler);
    bucket.push(() => target.removeEventListener?.(type, handler));
  };
  const listenRow = (target, type, handler) => listen(target, type, handler, rowCleanups);

  function prefersReducedMotion() {
    try { return Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches); } catch { return false; }
  }

  function hideInsight() {
    if (!engine.openInsight) return;
    engine.openInsight.tooltip.hidden = true;
    engine.openInsight.row.classList.remove("is-insight-open");
    engine.openInsight = null;
  }

  function showInsight(row) {
    if (!row?.tooltip) return;
    if (engine.openInsight?.row === row.item) return;
    if (engine.openInsight && engine.openInsight !== row) hideInsight();
    row.tooltip.hidden = false;
    row.item.classList.add("is-insight-open");
    engine.openInsight = { tooltip: row.tooltip, row: row.item };
    if (typeof onInsight === "function") onInsight(engine.parsed.lines[row.index]);
  }

  function seekTo(row) {
    const line = engine.parsed.lines[row.index];
    if (!line || line.time === null) return;
    const duration = Number(audio?.duration);
    const target = Number.isFinite(duration) && duration > 0 ? Math.min(line.time, duration) : line.time;
    if (audio) {
      try { audio.currentTime = target; } catch {}
    }
    update(target);
    if (typeof onSeek === "function") onSeek(target, line);
  }

  function renderStatus() {
    if (modeToggle) {
      modeToggle.disabled = !engine.parsed.timed;
      modeToggle.setAttribute("aria-pressed", engine.mode === "book" ? "true" : "false");
    }
    if (!status) return;
    if (!engine.parsed.lines.length) status.textContent = "";
    else if (!engine.parsed.timed) status.textContent = "Lyric book · these lyrics are not timestamped yet, so read at your own pace.";
    else if (engine.mode === "book") status.textContent = "Lyric book · scroll at your own pace. Select a timed line to jump the song there.";
    else status.textContent = `Synced to playback · ${summarizeLyrics(engine.parsed)}. Select a line to jump the song there.`;
  }

  function renderLines() {
    hideInsight();
    rowCleanups.splice(0).forEach(cleanup => cleanup());
    engine.rows = [];
    engine.activeIndex = -1;
    if (typeof list.replaceChildren === "function") list.replaceChildren();
    else list.textContent = "";
    engine.parsed.lines.forEach(line => {
      const item = doc.createElement("li");
      item.className = `dw-lyric dw-lyric--${line.kind}`;
      item.dataset.index = String(line.index);
      item.dataset.state = "upcoming";
      item.classList.add("is-upcoming");
      if (line.stanzaStart) item.classList.add("starts-stanza");
      if (line.insight) item.classList.add("has-insight");
      const timed = line.time !== null;
      item.classList.add(timed ? "is-timed" : "is-untimed");
      const control = doc.createElement(timed ? "button" : "p");
      control.className = "dw-lyric__line";
      const text = doc.createElement("span");
      text.className = "dw-lyric__text";
      text.textContent = line.text;
      control.appendChild(text);
      if (timed) {
        control.type = "button";
        control.dataset.time = String(line.time);
        const hint = doc.createElement("span");
        hint.className = "dw-sr-only";
        hint.textContent = " — jump to ";
        const time = doc.createElement("span");
        time.className = "dw-lyric__time";
        time.textContent = formatLyricTimestamp(line.time);
        control.appendChild(hint);
        control.appendChild(time);
      }
      item.appendChild(control);
      const row = { index: line.index, item, control, tooltip: null };
      if (line.insight) {
        const tooltip = doc.createElement("span");
        tooltip.className = "dw-lyric__insight";
        tooltip.id = `${idPrefix}-insight-${line.index}`;
        tooltip.setAttribute("role", "tooltip");
        tooltip.hidden = true;
        const label = doc.createElement("strong");
        label.textContent = "Oracle insight";
        const body = doc.createElement("span");
        body.textContent = line.insight;
        tooltip.appendChild(label);
        tooltip.appendChild(body);
        item.appendChild(tooltip);
        control.setAttribute("aria-describedby", tooltip.id);
        if (!timed) control.setAttribute("tabindex", "0");
        row.tooltip = tooltip;
        listenRow(item, "mouseenter", () => showInsight(row));
        listenRow(item, "mouseleave", () => hideInsight());
        listenRow(control, "focus", () => showInsight(row));
        listenRow(control, "blur", () => hideInsight());
      }
      if (timed) listenRow(control, "click", () => seekTo(row));
      list.appendChild(item);
      engine.rows.push(row);
    });
  }

  function scrollToActive(row) {
    if (engine.mode !== "sync" || !row || typeof viewport?.scrollTo !== "function") return;
    const top = Math.max(0, Number(row.item.offsetTop || 0) - (Number(viewport.clientHeight || 0) - Number(row.item.offsetHeight || 0)) / 2);
    try { viewport.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" }); } catch {}
  }

  function update(time = audio?.currentTime) {
    const next = findActiveLyricIndex(engine.parsed.lines, Number(time) || 0);
    if (next === engine.activeIndex) return next;
    engine.activeIndex = next;
    root.dataset.activeIndex = String(next);
    engine.rows.forEach(row => {
      const state = row.index === next ? "active" : next >= 0 && row.index < next ? "past" : "upcoming";
      row.item.dataset.state = state;
      row.item.classList.toggle("is-active", state === "active");
      row.item.classList.toggle("is-past", state === "past");
      row.item.classList.toggle("is-upcoming", state === "upcoming");
      if (state === "active") row.control.setAttribute("aria-current", "true");
      else row.control.removeAttribute("aria-current");
    });
    scrollToActive(engine.rows[next]);
    return next;
  }

  function applyMode() {
    engine.mode = engine.parsed.timed ? engine.preferredMode : "book";
    root.dataset.lyricsMode = engine.mode;
    renderStatus();
    if (engine.mode === "sync") scrollToActive(engine.rows[engine.activeIndex]);
    return engine.mode;
  }

  // Untimed lyrics force lyric book mode without overwriting the listener's own preference.
  function setMode(mode) {
    engine.preferredMode = LYRIC_MODES.includes(mode) ? mode : "sync";
    return applyMode();
  }

  function setSource(value) {
    const source = normalizeLyricsSource(value);
    if (source === engine.source) return engine.parsed;
    engine.source = source;
    engine.parsed = parseTimestampedLyrics(source);
    root.hidden = engine.parsed.lines.length === 0;
    renderLines();
    applyMode();
    update();
    return engine.parsed;
  }

  listen(audio, "timeupdate", () => update());
  listen(audio, "seeked", () => update());
  listen(audio, "loadedmetadata", () => update());
  listen(audio, "emptied", () => update(0));
  listen(modeToggle, "click", () => { if (engine.parsed.timed) setMode(engine.mode === "book" ? "sync" : "book"); });
  listen(root, "keydown", event => {
    if (event?.key === "Escape" && engine.openInsight) hideInsight();
  });

  root.hidden = true;
  root.dataset.lyricsMode = engine.mode;

  return {
    setSource,
    setMode,
    update,
    seekToIndex: index => { const row = engine.rows[index]; if (row) seekTo(row); },
    getState: () => ({ mode: engine.mode, activeIndex: engine.activeIndex, lines: engine.parsed.lines, timed: engine.parsed.timed, insightOpen: Boolean(engine.openInsight) }),
    destroy() {
      hideInsight();
      rowCleanups.splice(0).forEach(cleanup => cleanup());
      cleanups.splice(0).forEach(cleanup => cleanup());
    }
  };
}
