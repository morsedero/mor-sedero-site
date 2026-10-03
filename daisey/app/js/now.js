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
import { watchTasks, watchRun, watchSkips, saveSkips, startRun, extendRun, endRun, skipNow, blockTask, restoreTask } from "./store.js";
import { focusView, handoffView, elapsedMinutes } from "./focus.js";
import { watchCalendar } from "./calendar.js";
import { LATER_MINUTES } from "./weights.js";
import { rank, timeBucket, freeWindow, whySaid } from "./engine.js";
import { localDate, skipSnapshot } from "./model.js";
import { h, icon, bdi, pieces, sizeText, dur } from "./ui.js";

const GREETING = { morning: "Morning.", afternoon: "Afternoon.", evening: "Evening." };
const LATER_MS = LATER_MINUTES * 60000;
const RECENT_DAYS = 2;
const UNDO_MS = 5000;
const SLIDE_MS = 140; // matches the card-out animation in app.css
const motionOK = () => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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
  // The event you said you're free from, as its start time in ms (what
  // engine.freeWindow reports). Cleared on its own once that event is no
  // longer the one running.
  let freeFrom = null;
  let toast = null; // { text, task, before } for 5 s after Later or Pending
  let slideIn = false; // one slide per step-aside, not one per snapshot
  let toastTimer = null;
  const state = { chosen: null, showAlts: false, asking: false };
  // { date, items: { id: { count, until } } } — today's Laters, from Firestore.
  let skipDoc = null;
  const skipItems = () => (skipDoc?.date === localDate() ? skipDoc.items || {} : {});
  const hidden = (now = Date.now()) => Object.entries(skipItems()).filter(([, v]) => v.until > now).map(([id]) => id);
  const skipCounts = () => Object.fromEntries(Object.entries(skipItems()).map(([id, v]) => [id, v.count]));
  const skips = {
    add(id){
      const items = { ...skipItems() };
      items[id] = { count: (items[id]?.count || 0) + 1, until: Date.now() + LATER_MS };
      skipDoc = { date: localDate(), items };
      saveSkips(uid, skipDoc).catch(fail);
    },
    delete(id){
      const items = { ...skipItems() };
      delete items[id];
      skipDoc = { date: localDate(), items };
      saveSkips(uid, skipDoc).catch(fail);
    },
    clear(){
      skipDoc = { date: localDate(), items: {} };
      saveSkips(uid, skipDoc).catch(fail);
    },
    get size(){ return hidden().length; },
  };
  const reset = () => { state.chosen = null; state.showAlts = false; state.asking = false; };
  let shown;
  const showing = (id) => { if (id !== shown) { shown = id; onCard?.(id); } };

  // The card Daisey is proposing says its reasons in the first person; the
  // alternatives keep the plain why line, so only one voice is speaking.
  function taskCard(s, main, ...extra){
    const why = main ? whySaid(s) : s.why;
    return h("div", { className: "now-card" + (main ? " main" : "") },
      h("div", { className: "now-meta" }, ...pieces(s.task.project, sizeText(s.task.size))),
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
      // Stop keeps the task yours; Stuck also sets it Pending (Waiting).
      onStop: ({ pending } = {}) => {
        const minutes = elapsedMinutes(run);
        state.asking = false;
        endRun(uid, task, minutes, { finished: false })
          .then(() => (pending && task ? blockTask(uid, task) : null)).catch(fail);
        run = null; render();
      },
      onExtend: (m) => { const prev = run; run = { ...run, extra: (run.extra || 0) + m }; render(); extendRun(uid, prev, m).catch(fail); },
    }, state);
  }

  const begin = (task) => { handoff = null; reset(); run = { taskId: task.id, startedAt: Date.now(), extra: 0 }; render(); startRun(uid, task).catch(fail); };

  // Later and Pending both move the card on: it slides out, the next slides
  // in, and for 5 seconds a toast offers Undo. Nothing waits on the write.
  function stepAside(task, { label, write }){
    const before = skipSnapshot(task);
    const go = () => {
      skips.add(task.id);
      reset();
      slideIn = true;
      setToast({ task, before, label });
      write().catch(fail);
      render();
    };
    const el = root.querySelector(".now-card.main");
    if (el && motionOK()) { el.classList.add("out"); setTimeout(go, SLIDE_MS); } else go();
  }

  const later = (task) => stepAside(task, { label: `Later (${dur(LATER_MINUTES)}): `, write: () => skipNow(uid, task) });
  const pending = (task) => stepAside(task, { label: "Pending: ", write: () => blockTask(uid, task) });

  function setToast(t){
    clearTimeout(toastTimer);
    toast = t;
    if (t) toastTimer = setTimeout(() => { toast = null; render(); }, UNDO_MS);
  }

  function undo(){
    const { task, before } = toast;
    skips.delete(task.id);
    state.chosen = task.id;
    setToast(null);
    restoreTask(uid, task.id, before).catch(fail);
    render();
  }

  function toastView(){
    const { task } = toast;
    return h("div", { className: "toast", role: "status" },
      h("span", { className: "toast-text" }, toast.label, bdi(task.title)),
      h("button", { className: "toast-undo", type: "button", textContent: "Undo",
        ariaLabel: `Undo: put ${task.title} back on the card`, onclick: undo }));
  }

  // The three quiet actions under Start. Icon plus a small word, with the
  // whole phrase as the tooltip and the screen-reader name.
  const action = (name, label, hint, props) => h("button", {
    className: "iconbtn", type: "button", title: `${label} — ${hint}`, ariaLabel: `${label}: ${hint}`, ...props,
  }, icon(name), h("span", { className: "iconbtn-text", textContent: label }));

  // What the engine knows about this moment: the calendar's window if it
  // answered, today's Laters, and which projects are already warm — momentum
  // and the skip penalty were both scoring zero until this was passed in.
  // The calendar as Daisey should read it now: an event you've overridden
  // doesn't count as busy.
  function calendarNow(){
    if (cal.status !== "ok") return null;
    const busy = cal.events.filter((e) => e.busy !== false && !e.allDay);
    const events = freeFrom ? busy.filter((e) => Date.parse(e.start) !== freeFrom) : busy;
    const fw = freeWindow(events);
    // The override only ever applies to the event that was running; once it
    // ends, or another starts, the calendar speaks for itself again.
    if (freeFrom && !cal.events.some((e) => Date.parse(e.start) === freeFrom && Date.parse(e.end) > Date.now())) freeFrom = null;
    return fw;
  }

  function momentInput(fw = calendarNow()){
    const now = Date.now(), today = localDate(now);
    // Worked on, not merely added or edited: otherwise every project you
    // typed in today counts as momentum and the why line says "back to X"
    // about everything.
    const worked = (tasks || []).filter((t) => t.touchedAt && (t.starts || t.doneAt || t.spentMinutes))
      .sort((a, b) => b.touchedAt - a.touchedAt);
    const lastToday = worked.find((t) => localDate(t.touchedAt) === today);
    return {
      ...(fw ? { window: fw.window, nextEvent: fw.next?.title ?? null } : { realWindow: false }),
      lastProject: lastToday?.project || null,
      recentProjects: worked.filter((t) => now - t.touchedAt < RECENT_DAYS * 864e5).map((t) => t.project),
      sessionSkips: hidden(now),
      skipsToday: skipCounts(),
    };
  }

  function render(){
    document.body.classList.toggle("focus", !!run || !!handoff);
    if (run) { fill(renderFocus()); return; }
    if (handoff) {
      // The task just worked on isn't offered straight back.
      const m = momentInput();
      const r = rank(tasks || [], { ...m, sessionSkips: [...m.sessionSkips, handoff.skip] });
      fill(handoffView(handoff.title, r.pick, {
        onStart: begin,
        onSkip: (task) => { if (task) skips.add(task.id); handoff = null; showing(null); render(); },
      }));
      return;
    }
    const busy = cal.status === "ok" // the event being ignored, before any override
      ? freeWindow(cal.events.filter((e) => e.busy !== false && !e.allDay)).current : null;
    const fw = calendarNow();
    lastWindow = fw?.window;
    const hello = GREETING[timeBucket().part];
    const line = !fw ? [hello]
      : fw.current ? [`${hello} In `, bdi(fw.current.title), ` until ${clock(fw.current.end)}.`]
      : fw.restOfDay ? [`${hello} Free for the rest of the day.`]
      : [`${hello} ${dur(fw.window)} free, then `, bdi(fw.next.title), "."];
    const greet = h("div", { className: "now-greet" },
      h("p", {}, ...line),
      // Said you're free during an event that is still on the calendar.
      freeFrom && busy && h("p", { className: "muted" }, "Ignoring ", bdi(busy.title), " ",
        h("button", { className: "linkish", type: "button", textContent: "put it back",
          ariaLabel: `Stop ignoring ${busy.title}`, onclick: () => { freeFrom = null; render(); } })),
      CAL_NOTE[cal.status] && h("p", { className: "muted" }, CAL_NOTE[cal.status] + " ", h("a", { href: "/daisey/", textContent: "Open old Daisey" })));

    if (tasks == null) { fill(greet, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }

    const r = rank(tasks, momentInput(fw));
    const card = (state.chosen && r.ranked.find((s) => s.task.id === state.chosen)) || r.pick;
    showing(card?.task.id ?? null);
    const tip = toast && toastView();
    if (!card) {
      fill(greet, h("div", { className: "now-card main empty" },
        h("p", { className: "now-empty", textContent: r.empty === "none"
          ? "No tasks yet. Add a few and Daisey will pick."
          : fw?.current ? "Nothing to pick until it ends."
          : `Nothing fits the next ${dur(r.moment.window)}. Take the break.` }),
        fw?.current && h("button", { className: "btn", type: "button", textContent: "I'm free now",
          ariaLabel: `I'm free now: ignore ${fw.current.title} and pick a task anyway`,
          onclick: () => { freeFrom = fw.current.start; render(); } }),
        skips.size > 0 && h("button", { className: "btn quiet", type: "button", textContent: `Show the ${skips.size} you put off`, ariaLabel: `Show the ${skips.size} tasks you put off today`, onclick: () => { skips.clear(); setToast(null); render(); } })), tip);
      return;
    }

    const alts = r.ranked.length > 1 ? [r.pick, ...r.alternatives].filter((s) => s !== card).slice(0, 3) : [];
    // Start is the one loud thing on the tab; the other two stay quiet under it.
    fill(greet, taskCard(card, true,
      h("button", { className: "btn primary start", type: "button", textContent: "Start",
        ariaLabel: `Start: ${card.task.title}`, onclick: () => begin(card.task) }),
      h("div", { className: "now-actions" },
        action("later", "Later", `not now — show the next task instead of ${card.task.title}`,
          { onclick: () => later(card.task) }),
        action("switch", "Switch", state.showAlts ? "hide the other tasks" : `something else — ${alts.length} other tasks`,
          { disabled: !alts.length, ariaExpanded: String(state.showAlts),
            onclick: () => { state.showAlts = !state.showAlts; render(); } }),
        action("pending", "Pending", `${card.task.title} is blocked — set it to Waiting`,
          { onclick: () => pending(card.task) }))),
      state.showAlts && h("div", { className: "now-alts", role: "group", ariaLabel: "Other tasks" }, ...alts.map((s) => h("button", {
        type: "button", className: "now-alt", ariaLabel: `Put ${s.task.title} on the card instead${s.why ? ". " + s.why : ""}`,
        onclick: () => { state.chosen = s.task.id; state.showAlts = false; render(); },
      }, taskCard(s, false)))), tip);
    // One slide-in per step-aside: later snapshots must not replay it.
    if (slideIn) { slideIn = false; if (motionOK()) root.querySelector(".now-card.main")?.classList.add("in"); }
  }

  const fill = (...kids) => root.replaceChildren(...kids.filter(Boolean));
  const fail = (e) => console.error("[daisey] now", e);
  const unsubs = [
    watchTasks(uid, (ts) => { tasks = ts; render(); }, fail),
    watchCalendar((c) => { cal = c; render(); }),
    watchRun(uid, (r) => { run = r; if (r) handoff = null; render(); }, fail),
    watchSkips(uid, (s) => { skipDoc = s; render(); }, fail),
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
    unmount(){ showing(null); clearTimeout(toastTimer); document.body.classList.remove("focus"); unsubs.forEach((u) => u()); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
