import { createLocalSignal, SIGNAL_KEY, SIGNAL_SKINS, signalStreak, unlockedSignalSkins } from "../lib/local-signal.js";

export function mountLocalSignal({ document, window, root }) {
  const section = document.createElement("section");
  section.className = "local-signal";
  section.innerHTML = `<h3>Signal Streak / local cosmetic vault</h3>
    <p>Optional progress stored only in this browser profile, shared by Music World and Obsidian. Anyone using this profile can see it. No network reports, account points, private tracks, stems, prizes or giveaway entries. Local records can be edited and are not proof of listening.</p>
    <p>A UTC day qualifies after 30 seconds of foreground, unmuted playback. Pauses, hidden tabs and seeks do not count. Explore 5 distinct songs for Catalog Explorer; each needs 30 seconds in this session. Keep listening only while you want to.</p>
    <button type="button" data-signal-enable>Enable local progress</button>
    <button type="button" data-signal-disable>Pause local progress</button>
    <button type="button" data-signal-reset>Reset local progress and turn off</button>
    <p data-signal-status role="status" aria-live="polite"></p>
    <label>Earned cosmetic palette<select data-signal-skin></select></label>
    <p>Cosmetic vault: Neon Synth at 3 days; Deep House Amber at 7 days; Obsidian Dark at 60 minutes. Palettes recolor this panel and player accents. Signal Seeker at 3 days, Resonance Holder at 7, Signal Keeper at 30. No audio access is unlocked.</p>`;
  root.append(section);
  const find = selector => section.querySelector(selector);
  const status = find("[data-signal-status]"), select = find("[data-signal-skin]");
  let lastSummary = "", renderedSkins = "";
  const report = error => {
    console.error("Local Signal unavailable", error.name);
    status.textContent = `Local progress unavailable: ${error.message}. No progress was claimed.`;
    section.dataset.signalSkin = "original";
    document.body.dataset.signalSkin = "original";
    lastSummary = "";
  };
  const render = (state, error) => {
    if (error) { report(error); return; }
    const skins = unlockedSignalSkins(state), streak = signalStreak(state, new Date().toISOString().slice(0, 10));
    const tier = state.best >= 30 ? "Signal Keeper" : state.best >= 7 ? "Resonance Holder" : state.best >= 3 ? "Signal Seeker" : "First signal";
    const summary = `${state.enabled ? "On" : "Off"} / ${streak} day streak / best ${state.best} / ${Math.floor(state.seconds / 60)} minutes / ${state.ids.length} distinct songs / ${tier}${state.ids.length >= 5 ? " / Catalog Explorer" : ""}.`;
    if (summary !== lastSummary) { status.textContent = summary; lastSummary = summary; }
    if (renderedSkins !== skins.join(",")) {
      select.replaceChildren(...skins.map(value => {
        const option = document.createElement("option"); option.value = value; option.textContent = SIGNAL_SKINS[value]; return option;
      }));
      renderedSkins = skins.join(",");
    }
    select.value = skins.includes(state.skin) ? state.skin : "original";
    section.dataset.signalSkin = select.value;
    document.body.dataset.signalSkin = select.value;
    find("[data-signal-enable]").disabled = state.enabled;
    find("[data-signal-disable]").disabled = !state.enabled;
  };
  let signal;
  const action = callback => { try { callback(); } catch (error) { report(error); } };
  try {
    signal = createLocalSignal({ storage: window.localStorage, document, now: () => window.performance.now(), changed: render });
    render(signal.read());
  } catch (error) { report(error); }
  find("[data-signal-enable]").addEventListener("click", () => action(() => signal.enable(true)));
  find("[data-signal-disable]").addEventListener("click", () => action(() => signal.enable(false)));
  find("[data-signal-reset]").addEventListener("click", () => action(() => signal.reset()));
  select.addEventListener("change", () => action(() => signal.skin(select.value)));
  window.addEventListener("storage", event => { if (event.key === SIGNAL_KEY || event.key === null) action(() => render(signal.refresh())); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) action(() => render(signal.read())); });
  return signal;
}
