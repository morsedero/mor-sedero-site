// The Now tab: one line of context, then the Now card — one task that fits
// this moment, and why. Daisey picks one task at a time; it never lays out
// the day (the day planner was removed, 2026-10-03).
//
// Free time: tap the chip on the card to say how long you have. It counts
// down from when you set it and, once it runs out, falls back to the
// engine's default guess (60 min, no calendar yet). Only time you set counts
// as a real window for scoring; the guess just filters what fits.
// Not now → next pick (hidden for this page load). Something else → 2–3
// alternatives, tap one to make it the card.
import { watchTasks, watchContext, saveContext } from "./store.js";
import { rank, timeBucket } from "./engine.js";
import { NO_CALENDAR_WINDOW } from "./weights.js";
import { h, chips, sizeText, dur } from "./ui.js";

const FREE = [[15, "15m"], [30, "30m"], [60, "1h"], [120, "2h"], [240, "4h"], [360, "6h"], [480, "8h+"]];
const GREETING = { morning: "Morning.", afternoon: "Afternoon.", evening: "Evening." };

// Minutes left of the free time you set, or null if unset or run out.
const freeLeft = (ctx, now = Date.now()) => {
  if (!ctx?.minutes || !ctx.setAt) return null;
  const left = ctx.minutes - Math.floor((now - ctx.setAt) / 60000);
  return left > 0 ? left : null;
};

// onCard(id | null) fires whenever the task on the card changes, so the task
// list can set it aside while it's "physically" on the card.
export function mountNow(root, uid, { onCard } = {}){
  let tasks = null; // null until the first snapshot
  let ctx = null;
  const state = { chosen: null, showAlts: false, picking: false };
  const skips = new Set();
  const reset = () => { state.chosen = null; state.showAlts = false; };
  let shown, lastLeft;
  const showing = (id) => { if (id !== shown) { shown = id; onCard?.(id); } };

  // ctx: [chip, picker] for the main card's top row, opposite project · size.
  function taskCard(s, main, ctx = [], ...extra){
    const meta = h("div", { className: "now-meta", dir: "auto", textContent: `${s.task.project} · ${sizeText(s.task.size)}` });
    return h("div", { className: "now-card" + (main ? " main" : "") },
      main ? h("div", { className: "now-top" }, meta, ctx[0]) : meta, ctx[1],
      h("div", { className: "now-title", dir: "auto", textContent: s.task.title }),
      s.why && h("p", { className: "now-why", textContent: s.why }),
      ...extra);
  }

  // The context chip and, when tapped open, the free-time choices.
  function context(left){
    const chip = h("button", { type: "button", className: "ctx-chip", ariaExpanded: String(state.picking),
      ariaLabel: `Free time: ${left ? dur(left) : `${dur(NO_CALENDAR_WINDOW)}, a guess`}. Change it`,
      textContent: left ? dur(left) : `${dur(NO_CALENDAR_WINDOW)} (guess)`,
      onclick: () => { state.picking = !state.picking; render(); } });
    const pick = state.picking && chips("How much free time?", FREE, left ? ctx.minutes : null, (v) => {
      ctx = { minutes: v, setAt: Date.now() }; // show it now; the snapshot follows
      state.picking = false; reset(); render();
      saveContext(uid, ctx).catch((e) => console.error("[daisey] context save", e));
    });
    return [chip, pick];
  }

  function render(){
    const left = lastLeft = freeLeft(ctx);
    const greet = h("p", { className: "now-greet", textContent: GREETING[timeBucket().part] + (left ? ` ${dur(left)} free.` : "") });

    if (tasks == null) { fill(greet, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }

    const r = rank(tasks, { window: left ?? undefined, realWindow: left != null, sessionSkips: [...skips] });
    const card = (state.chosen && r.ranked.find((s) => s.task.id === state.chosen)) || r.pick;
    showing(card?.task.id ?? null);
    const [chip, pick] = context(left);
    if (!card) {
      fill(greet, h("div", { className: "now-card main empty" },
        h("div", { className: "now-top" }, chip), pick,
        h("p", { className: "now-empty", textContent: r.empty === "none"
          ? "No tasks yet. Add a few and Daisey will pick."
          : `Nothing fits the next ${dur(r.moment.window)}. Take the break.` }),
        skips.size > 0 && h("button", { className: "btn quiet", type: "button", textContent: `Show the ${skips.size} you skipped`, onclick: () => { skips.clear(); render(); } })));
      return;
    }

    const alts = r.ranked.length > 1 ? [r.pick, ...r.alternatives].filter((s) => s !== card).slice(0, 3) : [];
    // Start is the one loud thing on the tab; the other two stay quiet under it.
    // Start opens focus mode (step 4 of the Now-screen pass); inert until then.
    fill(greet, taskCard(card, true, [chip, pick],
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
    watchContext(uid, (c) => { ctx = c; render(); }, fail),
  ];
  // Count the free time down; re-render only when the minute changes.
  const tick = setInterval(() => { if (!document.hidden && freeLeft(ctx) !== lastLeft) render(); }, 15000);
  const onVisible = () => { if (!document.hidden) render(); };
  document.addEventListener("visibilitychange", onVisible);
  root.hidden = false;
  render();

  return {
    refresh: render,
    unmount(){ showing(null); unsubs.forEach((u) => u()); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
