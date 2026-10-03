// The Now popup: opens when you enter the app, reopens from "What now?".
// You say how much time you have; Daisey guesses your energy and shows the
// guess as one chip you tap only if it's wrong. The engine picks one task
// and says why. Not now → next pick (hidden for this page load).
// Something else → 2–3 alternatives, tap one to make it the card.
// Start / the timer arrive in session 5; Hebrew + RTL in session 4.
import { watchTasks } from "./store.js";
import { rank } from "./engine.js";
import { currentEnergy, CORRECTION_HOLD } from "./energy.js";

const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
};

const WINDOWS = [15, 30, 60, 90, 120];
const ENERGIES = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];
// Per-device for now (session 9 moves the energy correction to Firestore so
// it follows you across devices). The page works the same without storage.
const load = (key) => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    if (v && Date.now() - v.at < CORRECTION_HOLD) return v;
  } catch {}
  return null;
};
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify({ ...v, at: Date.now() })); } catch {} };
const WINDOW_KEY = "daisey.window.v1";
const ENERGY_KEY = "daisey.energy.v1";

export function mountNow(dialog, uid){
  let tasks = null; // null until the first snapshot
  const state = { window: load(WINDOW_KEY)?.window ?? 60, energy: currentEnergy(), editEnergy: false, chosen: null, showAlts: false };
  const refreshEnergy = () => { state.energy = currentEnergy({ correction: load(ENERGY_KEY) }); };
  refreshEnergy();
  const reset = () => { state.chosen = null; state.showAlts = false; };
  const skips = new Set();

  const body = h("div", { className: "now-body" });
  const fill = (...kids) => body.replaceChildren(...kids.filter(Boolean));
  const close = h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() });
  dialog.replaceChildren(h("div", { className: "now-head" }, h("h2", { id: "nowTitle", textContent: "What now?" }), close), body);
  // Tap outside the box closes it.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  const chips = (label, options, current, pick) => h("div", { className: "now-group", role: "radiogroup", ariaLabel: label },
    h("div", { className: "now-label", textContent: label }),
    h("div", { className: "now-chips" }, ...options.map(([v, text]) => h("button", {
      type: "button", className: "chip", role: "radio", ariaChecked: String(v === current), textContent: text,
      onclick: () => { pick(v); reset(); render(); },
    }))));

  function taskCard(s){
    return h("div", { className: "now-card" },
      h("div", { className: "now-meta", dir: "auto", textContent: `${s.task.project} · ${s.task.size >= 90 ? "90+" : s.task.size} min` }),
      h("div", { className: "now-title", dir: "auto", textContent: s.task.title }),
      s.why && h("p", { className: "now-why", textContent: s.why }));
  }

  function render(){
    const controls = [
      chips("Free time", WINDOWS.map((w) => [w, w === 120 ? "2 h+" : w === 90 ? "1.5 h" : w === 60 ? "1 h" : `${w} min`]), state.window,
        (v) => { state.window = v; save(WINDOW_KEY, { window: v }); }),
      h("button", { type: "button", className: "now-energy", ariaExpanded: String(state.editEnergy),
        textContent: `Energy: ${state.energy.level}${state.energy.guessed ? " (guess)" : ""} ✎`,
        onclick: () => { state.editEnergy = !state.editEnergy; render(); } }),
      state.editEnergy && chips("How's your energy?", ENERGIES, state.energy.guessed ? null : state.energy.level, (v) => {
        save(ENERGY_KEY, { level: v }); refreshEnergy(); state.editEnergy = false;
      }),
    ].filter(Boolean);
    if (tasks == null) { fill(...controls, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }

    const r = rank(tasks, { window: state.window, energy: state.energy.level, sessionSkips: [...skips] });
    const card = (state.chosen && r.ranked.find((s) => s.task.id === state.chosen)) || r.pick;
    if (!card) {
      fill(...controls, h("p", { className: "now-empty", textContent: r.empty === "none"
        ? "No tasks yet. Add a few and Daisey will pick."
        : `Nothing fits the next ${state.window} minutes. Take the break.` }),
        skips.size > 0 && h("button", { className: "btn small", type: "button", textContent: `Show the ${skips.size} you skipped`, onclick: () => { skips.clear(); render(); } }));
      return;
    }

    const alts = r.ranked.length > 1 ? [r.pick, ...r.alternatives].filter((s) => s !== card).slice(0, 3) : [];
    const notNow = h("button", { className: "btn", type: "button", textContent: "Not now", onclick: () => {
      skips.add(card.task.id); state.chosen = null; state.showAlts = false; render();
    } });
    const other = h("button", { className: "btn", type: "button", textContent: "Something else", disabled: !alts.length,
      ariaExpanded: String(state.showAlts), onclick: () => { state.showAlts = !state.showAlts; render(); } });

    fill(...controls, taskCard(card),
      h("div", { className: "now-actions" }, notNow, other),
      state.showAlts && h("div", { className: "now-alts" }, ...alts.map((s) => h("button", {
        type: "button", className: "now-alt", onclick: () => { state.chosen = s.task.id; state.showAlts = false; render(); },
      }, taskCard(s)))));
  }

  const unsub = watchTasks(uid, (ts) => { tasks = ts; if (dialog.open) render(); }, (e) => console.error("[daisey] now", e));

  return {
    open(){ reset(); refreshEnergy(); state.editEnergy = false; render(); if (!dialog.open) dialog.showModal(); },
    unmount(){ unsub(); if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
