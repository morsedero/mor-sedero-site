// The Now tab: one line of context, then the Now card — one task that fits
// this moment, and why. Daisey picks one task at a time; it never lays out
// the day (the day planner was removed, 2026-10-03).
//
// Free time comes only from the calendar — Daisey never asks for it (Mor,
// 2026-10-03). It's the time until the next busy event (calendar.js, read
// through old Daisey's Google token). With no calendar the engine's default
// 60 min only filters what fits and scores nothing.
// Not now → next pick (hidden for this page load). Something else → 2–3
// alternatives, tap one to make it the card. Start → focus mode (focus.js):
// the run lives in Firestore, so this tab, a reload and the phone all show
// the same timer.
import { watchTasks, watchRun, startRun, extendRun, endRun } from "./store.js";
import { focusView, handoffView, elapsedMinutes } from "./focus.js";
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
  let lastWindow, lastClock;
  let run = null; // the state/now doc while a task is running
  let handoff = null; // { title, next } after Done, until the next choice
  const state = { chosen: null, showAlts: false, asking: false };
  const skips = new Set();
  const reset = () => { state.chosen = null; state.showAlts = false; state.asking = false; };
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

  // Focus mode and the handoff own the whole screen (body.focus hides the
  // tabs, the greeting and the + button).
  function renderFocus(){
    const task = tasks?.find((t) => t.id === run.taskId) || null;
    showing(run.taskId);
    return focusView(run, task, {
      onDone: (finished) => {
        if (finished === undefined) { state.asking = true; render(); return; }
        const minutes = elapsedMinutes(run);
        state.asking = false;
        handoff = { title: task ? task.title : "", skip: run.taskId };
        endRun(uid, task, minutes, { finished }).catch(fail);
        run = null; render();
      },
      onStop: () => {
        const minutes = elapsedMinutes(run);
        state.asking = false;
        endRun(uid, task, minutes, { finished: false }).catch(fail);
        run = null; render();
      },
      onExtend: (m) => { const prev = run; run = { ...run, extra: (run.extra || 0) + m }; render(); extendRun(uid, prev, m).catch(fail); },
    }, state);
  }

  const begin = (task) => { handoff = null; reset(); run = { taskId: task.id, startedAt: Date.now(), extra: 0 }; render(); startRun(uid, task).catch(fail); };

  // What the engine knows about this moment, from the calendar if it answered.
  const momentInput = (fw = cal.status === "ok" ? freeWindow(cal.events) : null) => (fw
    ? { window: fw.window, nextEvent: fw.next?.title ?? null }
    : { realWindow: false });

  function render(){
    document.body.classList.toggle("focus", !!run || !!handoff);
    if (run) { fill(renderFocus()); return; }
    if (handoff) {
      // The task just worked on isn't offered straight back.
      const r = rank(tasks || [], { ...momentInput(), sessionSkips: [...skips, handoff.skip] });
      fill(handoffView(handoff.title, r.pick, {
        onStart: begin,
        onSkip: (task) => { if (task) skips.add(task.id); handoff = null; showing(null); render(); },
      }));
      return;
    }
    const fw = cal.status === "ok" ? freeWindow(cal.events) : null;
    lastWindow = fw?.window;
    const line = !fw ? "" : fw.current ? ` In ${fw.current.title} until ${clock(fw.current.end)}.`
      : fw.restOfDay ? " Free for the rest of the day."
      : ` ${dur(fw.window)} free, then ${fw.next.title}.`;
    const greet = h("div", { className: "now-greet" },
      h("p", { dir: "auto", textContent: GREETING[timeBucket().part] + line }),
      CAL_NOTE[cal.status] && h("p", { className: "muted" }, CAL_NOTE[cal.status] + " ", h("a", { href: "/daisey/", textContent: "Open old Daisey" })));

    if (tasks == null) { fill(greet, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }

    const r = rank(tasks, { ...momentInput(fw), sessionSkips: [...skips] });
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
    fill(greet, taskCard(card, true,
      h("button", { className: "btn primary start", type: "button", textContent: "Start",
        ariaLabel: `Start: ${card.task.title}`, onclick: () => begin(card.task) }),
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
    watchRun(uid, (r) => { run = r; if (r) handoff = null; render(); }, fail),
  ];
  // The timer ticks every second while running; otherwise this only
  // re-renders when the free window's minute changes.
  const tick = setInterval(() => {
    if (document.hidden) return;
    if (run) { const c = Math.floor(elapsedMinutes(run) * 60); if (c !== lastClock) { lastClock = c; render(); } return; }
    if (cal.status === "ok" && freeWindow(cal.events).window !== lastWindow) render();
  }, 1000);
  const onVisible = () => { if (!document.hidden) render(); };
  document.addEventListener("visibilitychange", onVisible);
  root.hidden = false;
  render();

  return {
    refresh: render,
    unmount(){ showing(null); document.body.classList.remove("focus"); unsubs.forEach((u) => u()); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
