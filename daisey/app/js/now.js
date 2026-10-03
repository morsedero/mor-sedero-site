// The Now card, always on top of the page. One task that fits this moment,
// and why — nothing else (Mor: the card holds only the current task). Free
// time comes from today's check-in. Not now → next pick (hidden
// for this page load). Something else → 2–3 alternatives, tap one to make it the card.
// Start / the timer arrive in session 5; Hebrew + RTL in session 4.
import { watchTasks, watchToday } from "./store.js";
import { rank } from "./engine.js";
import { localDate } from "./model.js";
import { h, sizeText } from "./ui.js";

const minText = (m) => (m >= 60 ? `${+(m / 60).toFixed(1)} h` : `${m} min`);

// onCard(id | null) fires whenever the task on the card changes, so the task
// list can set it aside while it's "physically" on the card.
export function mountNow(root, uid, { onCard } = {}){
  let tasks = null; // null until the first snapshot
  let today = null;
  const state = { chosen: null, showAlts: false };
  const skips = new Set();
  const reset = () => { state.chosen = null; state.showAlts = false; };
  let shown;
  const showing = (id) => { if (id !== shown) { shown = id; onCard?.(id); } };

  function taskCard(s, main, ...extra){
    return h("div", { className: "now-card" + (main ? " main" : "") },
      h("div", { className: "now-meta", dir: "auto", textContent: `${s.task.project} · ${sizeText(s.task.size)}` }),
      h("div", { className: "now-title", dir: "auto", textContent: s.task.title }),
      s.why && h("p", { className: "now-why", textContent: s.why }),
      ...extra);
  }

  function render(){
    const head = [];

    if (tasks == null) { fill(...head, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }

    // Until the calendar (session 8) gives a real free window, the stretch
    // is today's free hours from the check-in (capped at 180 by the engine);
    // no check-in → the engine's no-calendar 60.
    const plan = today?.date === localDate() ? today : null;
    const window = plan?.hours ? plan.hours * 60 : undefined;
    const r = rank(tasks, { window, realWindow: false, sessionSkips: [...skips] });
    const card = (state.chosen && r.ranked.find((s) => s.task.id === state.chosen)) || r.pick;
    showing(card?.task.id ?? null);
    if (!card) {
      fill(...head, h("p", { className: "now-empty", textContent: r.empty === "none"
        ? "No tasks yet. Add a few and Daisey will pick."
        : `Nothing fits the next ${minText(r.moment.window)}. Take the break.` }),
        skips.size > 0 && h("button", { className: "btn small", type: "button", textContent: `Show the ${skips.size} you skipped`, onclick: () => { skips.clear(); render(); } }));
      return;
    }

    const alts = r.ranked.length > 1 ? [r.pick, ...r.alternatives].filter((s) => s !== card).slice(0, 3) : [];
    // Start is the one loud thing on the tab; the other two stay quiet under it.
    // Start opens focus mode (step 4 of the Now-screen pass); inert until then.
    fill(...head, taskCard(card, true,
      h("button", { className: "btn primary start", type: "button", textContent: "Start" }),
      h("div", { className: "now-actions" },
        h("button", { className: "btn quiet", type: "button", textContent: "Not now", onclick: () => { skips.add(card.task.id); reset(); render(); } }),
        h("button", { className: "btn quiet", type: "button", textContent: "Something else", disabled: !alts.length,
          ariaExpanded: String(state.showAlts), onclick: () => { state.showAlts = !state.showAlts; render(); } }))),
      state.showAlts && h("div", { className: "now-alts" }, ...alts.map((s) => h("button", {
        type: "button", className: "now-alt", onclick: () => { state.chosen = s.task.id; state.showAlts = false; render(); },
      }, taskCard(s, false)))));
  }

  const fill = (...kids) => root.replaceChildren(...kids.filter(Boolean));
  const fail = (e) => console.error("[daisey] now", e);
  const unsubs = [
    watchTasks(uid, (ts) => { tasks = ts; render(); }, fail),
    watchToday(uid, (t) => { today = t; render(); }, fail),
  ];
  // Roll "today" over at midnight when the tab comes back.
  const onVisible = () => { if (!document.hidden) render(); };
  document.addEventListener("visibilitychange", onVisible);
  root.hidden = false;
  render();

  return {
    refresh: render,
    unmount(){ showing(null); unsubs.forEach((u) => u()); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
