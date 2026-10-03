// The Now tab: one line of context, then the Now card — one task that fits
// this moment, and why. Daisey picks one task at a time; it never lays out
// the day (the day planner was removed, 2026-10-03).
//
// Free time comes only from the calendar — Daisey never asks for it (Mor,
// 2026-10-03). It's the time until the next busy event (calendar.js, read
// through old Daisey's Google token). With no calendar the engine's default
// 60 min only filters what fits and scores nothing.
// Not now → next pick (hidden for this page load). Something else → 2–3
// alternatives, tap one to make it the card.
import { watchTasks } from "./store.js";
import { watchCalendar } from "./calendar.js";
import { rank, timeBucket, freeWindow, whySaid } from "./engine.js";
import { h, sizeText, dur } from "./ui.js";

const GREETING = { morning: "Morning.", afternoon: "Afternoon.", evening: "Evening." };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const CAL_NOTE = {
  not_connected: "Calendar not connected. Sign in to the old Daisey once to link it.",
  needs_reauth: "Calendar sign-in expired. Sign in to the old Daisey again to refresh it.",
};

// onCard(id | null) fires whenever the task on the card changes, so the task
// list can set it aside while it's "physically" on the card.
export function mountNow(root, uid, { onCard } = {}){
  let tasks = null; // null until the first snapshot
  let cal = { status: "loading", events: [] };
  let lastWindow;
  const state = { chosen: null, showAlts: false };
  const skips = new Set();
  const reset = () => { state.chosen = null; state.showAlts = false; };
  let shown;
  const showing = (id) => { if (id !== shown) { shown = id; onCard?.(id); } };

  // The card Daisey is proposing says its reasons in the first person; the
  // alternatives keep the plain why line, so only one voice is speaking.
  function taskCard(s, main, ...extra){
    const why = main ? whySaid(s) : s.why;
    return h("div", { className: "now-card" + (main ? " main" : "") },
      h("div", { className: "now-meta", dir: "auto", textContent: `${s.task.project} · ${sizeText(s.task.size)}` }),
      h("div", { className: "now-title", dir: "auto", textContent: s.task.title }),
      why && h("p", { className: "now-why", textContent: why }),
      ...extra);
  }

  function render(){
    const fw = cal.status === "ok" ? freeWindow(cal.events) : null;
    lastWindow = fw?.window;
    const line = !fw ? "" : fw.current ? ` In ${fw.current.title} until ${clock(fw.current.end)}.`
      : fw.restOfDay ? " Free for the rest of the day."
      : ` ${dur(fw.window)} free, then ${fw.next.title}.`;
    const greet = h("div", { className: "now-greet" },
      h("p", { dir: "auto", textContent: GREETING[timeBucket().part] + line }),
      CAL_NOTE[cal.status] && h("p", { className: "muted" }, CAL_NOTE[cal.status] + " ", h("a", { href: "/daisey/", textContent: "Open old Daisey" })));

    if (tasks == null) { fill(greet, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }

    const r = rank(tasks, fw
      ? { window: fw.window, nextEvent: fw.next?.title ?? null, sessionSkips: [...skips] }
      : { realWindow: false, sessionSkips: [...skips] });
    const card = (state.chosen && r.ranked.find((s) => s.task.id === state.chosen)) || r.pick;
    showing(card?.task.id ?? null);
    if (!card) {
      fill(greet, h("div", { className: "now-card main empty" },
        h("p", { className: "now-empty", textContent: r.empty === "none"
          ? "No tasks yet. Add a few and Daisey will pick."
          : fw?.current ? "Nothing to pick until it ends."
          : `Nothing fits the next ${dur(r.moment.window)}. Take the break.` }),
        skips.size > 0 && h("button", { className: "btn quiet", type: "button", textContent: `Show the ${skips.size} you skipped`, ariaLabel: `Show the ${skips.size} tasks you skipped this session`, onclick: () => { skips.clear(); render(); } })));
      return;
    }

    const alts = r.ranked.length > 1 ? [r.pick, ...r.alternatives].filter((s) => s !== card).slice(0, 3) : [];
    // Start is the one loud thing on the tab; the other two stay quiet under it.
    // Start opens focus mode (step 4 of the Now-screen pass); inert until then.
    fill(greet, taskCard(card, true,
      h("button", { className: "btn primary start", type: "button", textContent: "Start",
        ariaLabel: `Start: ${card.task.title}` }),
      h("div", { className: "now-actions" },
        h("button", { className: "btn quiet", type: "button", textContent: "Not now",
          ariaLabel: `Not now: skip ${card.task.title} and show the next one`,
          onclick: () => { skips.add(card.task.id); reset(); render(); } }),
        h("button", { className: "btn quiet", type: "button", textContent: "Something else", disabled: !alts.length,
          ariaLabel: state.showAlts ? "Hide the other tasks" : `Something else: ${alts.length} other tasks`,
          ariaExpanded: String(state.showAlts), onclick: () => { state.showAlts = !state.showAlts; render(); } }))),
      state.showAlts && h("div", { className: "now-alts", role: "group", ariaLabel: "Other tasks" }, ...alts.map((s) => h("button", {
        type: "button", className: "now-alt", ariaLabel: `Put ${s.task.title} on the card instead${s.why ? ". " + s.why : ""}`,
        onclick: () => { state.chosen = s.task.id; state.showAlts = false; render(); },
      }, taskCard(s, false)))));
  }

  const fill = (...kids) => root.replaceChildren(...kids.filter(Boolean));
  const fail = (e) => console.error("[daisey] now", e);
  const unsubs = [
    watchTasks(uid, (ts) => { tasks = ts; render(); }, fail),
    watchCalendar((c) => { cal = c; render(); }),
  ];
  // The free window counts down between fetches: re-render when its minute changes.
  const tick = setInterval(() => {
    if (!document.hidden && cal.status === "ok" && freeWindow(cal.events).window !== lastWindow) render();
  }, 15000);
  const onVisible = () => { if (!document.hidden) render(); };
  document.addEventListener("visibilitychange", onVisible);
  root.hidden = false;
  render();

  return {
    refresh: render,
    unmount(){ showing(null); unsubs.forEach((u) => u()); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
