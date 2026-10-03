// The Now tab: one line of context, then the Now card — one task that fits
// this moment, and why. Daisey picks one task at a time; it never lays out
// the day (the day planner was removed, 2026-10-03).
//
// Free time comes only from the calendar (session 8) — Daisey never asks
// for it (Mor, 2026-10-03). Until then the engine's default 60 min only
// filters what fits and scores nothing, and the greeting has no time in it.
// Not now → next pick (hidden for this page load). Something else → 2–3
// alternatives, tap one to make it the card.
import { watchTasks } from "./store.js";
import { rank, timeBucket } from "./engine.js";
import { h, sizeText, dur } from "./ui.js";

const GREETING = { morning: "Morning.", afternoon: "Afternoon.", evening: "Evening." };

// onCard(id | null) fires whenever the task on the card changes, so the task
// list can set it aside while it's "physically" on the card.
export function mountNow(root, uid, { onCard } = {}){
  let tasks = null; // null until the first snapshot
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
    const greet = h("p", { className: "now-greet", textContent: GREETING[timeBucket().part] });

    if (tasks == null) { fill(greet, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }

    const r = rank(tasks, { realWindow: false, sessionSkips: [...skips] });
    const card = (state.chosen && r.ranked.find((s) => s.task.id === state.chosen)) || r.pick;
    showing(card?.task.id ?? null);
    if (!card) {
      fill(greet, h("div", { className: "now-card main empty" },
        h("p", { className: "now-empty", textContent: r.empty === "none"
          ? "No tasks yet. Add a few and Daisey will pick."
          : `Nothing fits the next ${dur(r.moment.window)}. Take the break.` }),
        skips.size > 0 && h("button", { className: "btn quiet", type: "button", textContent: `Show the ${skips.size} you skipped`, onclick: () => { skips.clear(); render(); } })));
      return;
    }

    const alts = r.ranked.length > 1 ? [r.pick, ...r.alternatives].filter((s) => s !== card).slice(0, 3) : [];
    // Start is the one loud thing on the tab; the other two stay quiet under it.
    // Start opens focus mode (step 4 of the Now-screen pass); inert until then.
    fill(greet, taskCard(card, true,
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
  ];
  const onVisible = () => { if (!document.hidden) render(); };
  document.addEventListener("visibilitychange", onVisible);
  root.hidden = false;
  render();

  return {
    refresh: render,
    unmount(){ showing(null); unsubs.forEach((u) => u()); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
