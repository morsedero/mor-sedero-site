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
import { watchTasks, watchRun, watchSkips, saveSkips, startRun, extendRun, endRun, startBatch, tickBatch, endBatch, skipNow, blockTask, restoreTask, watchSettings, saveSettings, watchMoment, saveMoment, watchLearn, bumpLearn, addTask, saveRun, cancelRun } from "./store.js";
import { energyNow, placeNow, workBase } from "./context.js";
import { shouldOffer, sweepList, pickWeekDay } from "./triage.js";
import { focusView, handoffView, elapsedMinutes, batchFocusView, batchName, sinceMark, paused, resumed } from "./focus.js";
import { watchCalendar, deleteEvent } from "./calendar.js";
import { LATER_MINUTES, DRAIN, CANCEL_KEEP_MINUTES } from "./weights.js";
import { rank, freeWindow, whySaid, timeBucket, matchProject } from "./engine.js";
import { localDate, skipSnapshot, shrunk, shrinkPatch, notYet, LABELS } from "./model.js";
import { dayHours, isNight, nextMorning, dayEndAt, bookings, sameTitle, minText } from "./day.js";
import { nextOffer, draftFrom } from "./caltask.js";
import { h, icon, bdi, pieces, sizeText, dur, say } from "./ui.js";

// Nothing sits above the card but the warnings below: the date and time are
// in the top bar (main.js) and the day is in the Schedule panel.
const LATER_MS = LATER_MINUTES * 60000;
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
// onSweep() opens the old-dates sweep (sweep.js). onProject(name) shows that
// project's tab in Tasks.
export function mountNow(root, uid, { onCard, onSweep, onProject } = {}){
  let tasks = null; // null until the first snapshot
  let settings = {}; // state/settings: when the sweep was last offered
  let momentDoc = {}; // state/moment: energy and place corrections
  let learnStats = {}; // state/learn: starts and skips per type and time of day
  let ctxOpen = null; // "energy" | "place": the chip whose choices are showing
  let cal = { status: "loading", events: [] };
  let lastWindow, lastClock;
  let run = null; // the state/now doc while a task is running
  let handoff = null; // { title, next } after Done, until the next choice
  // The event you said you're free from, as its start time in ms (what
  // engine.freeWindow reports). Cleared on its own once that event is no
  // longer the one running.
  let freeFrom = null;
  // "I'm free now" at night: plan as if it were day until the night is over.
  let nightFree = false;
  // The Someday pick (DAISEY_SPEC "Someday comes back"). open: Switch asked
  // for it; picked: ids moved to this week this round; all: show every one.
  const sd = { open: false, picked: [], all: false };
  let calAsk = null; // an event just made into a task: keep it or delete it?
  let toast = null; // { text, task, before } for 5 s after Later or Pending
  let slideIn = false; // one slide per step-aside, not one per snapshot
  let toastTimer = null;
  // laterAsk: Later was tapped and the card is asking "when?"
  // pendAsk: Pending was tapped and the card asks what it's waiting on.
  const state = { chosen: null, showAlts: false, asking: false, laterAsk: false, pendAsk: false };
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
  const reset = () => { state.chosen = null; state.showAlts = false; state.asking = false; state.laterAsk = false; state.pendAsk = false; state.pendText = ""; state.single = false; };
  let shown;
  const showing = (id) => { if (id !== shown) { shown = id; onCard?.(id); } };

  // The card Daisey is proposing says its reasons in the first person; the
  // alternatives keep the plain why line, so only one voice is speaking.
  // Names in the why line (projects, people, events) are their own <bdi>.
  function taskCard(s, main, ...extra){
    const why = main ? whySaid(s) : sentence(s.whyParts);
    return h("div", { className: "now-card" + (main ? " main" : "") },
      main && contextLine(),
      h("div", { className: "now-meta" }, ...(main && s.task.project !== "Inbox"
        // On the card the project name leads to its tab in Tasks.
        ? [h("button", { type: "button", className: "now-proj", title: `Show ${s.task.project} in Tasks`,
            onclick: () => onProject?.(s.task.project) }, bdi(s.task.project)), document.createTextNode(" · "), bdi(sizeText(s.task.size))]
        : pieces(s.task.project, sizeText(s.task.size)))),
      h("div", { className: "now-title", dir: "auto", textContent: s.task.title }),
      s.task.nextStep && h("p", { className: "now-next" }, "Next: ", bdi(s.task.nextStep)),
      why && h("p", { className: "now-why" }, ...say(why)),
      ...extra);
  }

  // The engine's pieces as a plain sentence: capital first, full stop last.
  function sentence(parts){
    if (!parts?.length) return null;
    const [first, ...rest] = parts;
    return [typeof first === "string" ? first[0].toUpperCase() + first.slice(1) : first, ...rest, "."];
  }

  // Energy and place right now: the user's correction for 3 hours, else
  // Daisey's guess from the time of day and the calendar (context.js).
  function feel(){
    const events = cal.status === "ok" ? cal.events : [];
    return {
      energy: energyNow({ correction: momentDoc.energy, history: momentDoc.history || [], events }),
      place: placeNow({ correction: momentDoc.place, events }),
    };
  }

  const PLACES = [["home", "Home"], ["out", "Out"], ["anywhere", "Anywhere"]];
  const ENERGIES = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];

  // The card's context line: "45 min free · Home · Medium energy", and the
  // block it's in if any. Place and energy are chips again (Mor, 2026-10-05):
  // dashed while they're Daisey's guess; tapping one shows its three choices,
  // and a choice is a correction that holds for 3 hours on every device.
  function contextLine(){
    const fw = calendarNow(), block = blockOf(fw), f = feel();
    const chip = (kind, list, cur) => {
      const label = list.find(([v]) => v === cur.value)?.[1] || cur.value;
      return h("button", { type: "button", className: "ctx-chip" + (cur.guessed ? " guess" : ""),
        textContent: kind === "energy" ? `${label} energy` : label, ariaExpanded: String(ctxOpen === kind),
        title: cur.guessed ? "Daisey's guess. Tap to correct." : "Tap to change.",
        onclick: () => { ctxOpen = ctxOpen === kind ? null : kind; render(); } });
    };
    const opts = ctxOpen && (ctxOpen === "place" ? PLACES : ENERGIES);
    return h("div", { className: "ctx" },
      h("div", { className: "ctx-line" },
        fw && !fw.current && h("span", { textContent: `${dur(Math.min(fw.window, 180))}${fw.window >= 180 ? "+" : ""} free` }),
        chip("place", PLACES, f.place), chip("energy", ENERGIES, f.energy),
        block && (block.taskId
          ? h("span", { className: "ctx-block", textContent: `Booked until ${clock(block.end)}` })
          : h("span", { className: "ctx-block" }, "Working on ", bdi(block.project), ` until ${clock(block.end)}`))),
      opts && h("div", { className: "ctx-opts", role: "radiogroup", ariaLabel: ctxOpen === "place" ? "Where are you?" : "Energy" },
        ...opts.map(([v, text]) => h("button", { type: "button", className: "chip", role: "radio", textContent: text,
          ariaChecked: String(f[ctxOpen].value === v), onclick: () => correct(ctxOpen, v) }))));
  }

  // A chip choice: the correction, and for energy one more point in the
  // pattern for this time of day (context.js energyNow).
  function correct(kind, value){
    const now = Date.now();
    const fields = { [kind]: { value, at: now } };
    if (kind === "energy") {
      const b = timeBucket(now);
      fields.history = [...(momentDoc.history || []), { part: b.part, weekend: b.weekend, value }].slice(-100);
    }
    momentDoc = { ...momentDoc, ...fields };
    ctxOpen = null;
    render();
    saveMoment(uid, fields).catch(fail);
  }

  // The calendar's answer to "what now": the event that's running, when it
  // ends and what's left of it. Same card as a task's, so the top of the
  // screen always reads the same way — one thing, in big type, with its
  // reason under it.
  // freeWindow hands back start/end already parsed to epoch ms, not the ISO
  // strings the calendar fetch holds.
  function meetingCard(ev){
    const end = ev.end;
    const left = Math.max(0, Math.round((end - Date.now()) / 60000));
    return h("div", { className: "now-card main meeting" },
      h("div", { className: "now-meta", textContent: `Now · until ${clock(end)}` }),
      h("div", { className: "now-title", dir: "auto", textContent: ev.title }),
      h("p", { className: "now-why", textContent: left
        ? `${dur(left)} left. Daisey picks a task again when it ends.`
        : "Just about done." }),
      h("button", { className: "btn quiet", type: "button", textContent: "I'm free now",
        ariaLabel: `I'm free now: ignore ${ev.title} and pick a task anyway`,
        onclick: () => { freeFrom = ev.start; render(); } }));
  }

  // Focus mode and the handoff own the whole screen (body.focus hides the
  // tabs, the greeting and the + button).
  // A batch: a checklist in focus mode. The last tick ends it and hands off
  // like Done; Stop leaves the unticked ones open with their share of the time.
  function renderBatch(){
    const byId = new Map((tasks || []).map((t) => [t.id, t]));
    const list = run.batch.map((id) => byId.get(id)).filter(Boolean);
    const type = list[0]?.type;
    showing(run.taskId);
    return batchFocusView(run, list, type, {
      onTick: (t) => {
        const prev = run, minutes = sinceMark(run);
        const done = [...(run.done || []), t.id];
        const last = list.every((x) => done.includes(x.id));
        if (last) {
          handoff = { title: batchName(type, list.length), skip: prev.taskId };
          tickBatch(uid, prev, t, minutes).then(() => endBatch(uid, [], 0)).catch(fail);
          run = null;
        } else {
          run = { ...run, done, mark: Date.now() };
          tickBatch(uid, prev, t, minutes).catch(fail);
        }
        render();
      },
      onPause: pause,
      onCancel: cancel,
    });
  }

  // Pause (Mor, 2026-10-05): the clock stops and the main screen comes back,
  // with the paused task held on the card until Resume or Cancel. Cancel ends
  // the run without counting a stop: under CANCEL_KEEP_MINUTES it was a
  // mis-tap and nothing is saved, past it the minutes are kept. A batch keeps
  // the ones already ticked.
  const pause = () => { const doc = paused(run); run = doc; state.asking = false; render(); saveRun(uid, doc).catch(fail); };
  const resume = () => { const doc = resumed(run); run = doc; render(); saveRun(uid, doc).catch(fail); };
  const cancel = () => {
    const prev = run;
    run = null; state.asking = false; render();
    if (prev.batch) { // the minutes since the last tick go to the ones left, as a batch ending does
      const left = (tasks || []).filter((t) => prev.batch.includes(t.id) && !(prev.done || []).includes(t.id));
      const m = sinceMark(prev);
      (m >= CANCEL_KEEP_MINUTES && left.length ? endBatch(uid, left, m) : cancelRun(uid)).catch(fail);
      return;
    }
    const m = elapsedMinutes(prev);
    cancelRun(uid, tasks?.find((t) => t.id === prev.taskId) || null, m >= CANCEL_KEEP_MINUTES ? m : 0).catch(fail);
  };

  // Pause mode: the card is the paused task, and nothing else is offered.
  function pausedCard(){
    const byId = new Map((tasks || []).map((t) => [t.id, t]));
    const task = byId.get(run.taskId);
    const title = run.batch ? batchName(task?.type, run.batch.length) : task?.title || "That task is gone";
    return h("div", { className: "now-card main paused" },
      h("div", { className: "now-meta", textContent: `Paused · ${dur(Math.round(elapsedMinutes(run)))} so far` }),
      h("div", { className: "now-title", dir: "auto", textContent: title }),
      h("button", { className: "btn primary start", type: "button", textContent: "Resume",
        ariaLabel: `Resume ${title}`, onclick: resume }),
      h("div", { className: "now-actions" },
        h("button", { className: "btn quiet", type: "button", textContent: "Cancel",
          ariaLabel: `Cancel ${title}`, onclick: cancel })));
  }

  function renderFocus(){
    if (run.batch) return renderBatch();
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
      onPause: pause,
      onCancel: cancel,
    }, state);
  }

  const begin = (task) => { bumpLearn(uid, task.type, timeBucket().part, "starts").catch(fail); handoff = null; reset(); run = { taskId: task.id, startedAt: Date.now(), extra: 0 }; render(); startRun(uid, task).catch(fail); };

  const beginBatch = (list) => {
    bumpLearn(uid, list[0].type, timeBucket().part, "starts").catch(fail);
    handoff = null; reset();
    const now = Date.now();
    run = { taskId: list[0].id, batch: list.map((t) => t.id), done: [], mark: now, startedAt: now, extra: 0 };
    render();
    startBatch(uid, list).catch(fail);
  };

  // The batch offer (DAISEY_SPEC "Batches"): when the pick earned the batch
  // bonus, the card offers the whole batch — "Offices are open: 3 calls,
  // ~20 min. Together?" — with the list. Start all runs it as a checklist;
  // Just one falls back to the single task, with its usual actions.
  function batchCard(r, b){
    const list = r.ranked.filter((s) => b.ids.includes(s.task.id)).map((s) => s.task);
    const name = batchName(b.type, list.length);
    const office = r.moment.officeOpen && list.some((t) => t.openHours === "office");
    return h("div", { className: "now-card main batch" },
      contextLine(),
      h("div", { className: "now-meta", textContent: `Batch · ~${dur(b.minutes)}` }),
      h("div", { className: "now-title", textContent: name }),
      h("p", { className: "now-why", textContent: `${office ? "Offices are open: " : ""}${name}, ~${dur(b.minutes)}. Together?` }),
      h("ul", { className: "batch-preview" }, ...list.map((t) => h("li", {}, bdi(t.title), h("span", { className: "muted", textContent: ` · ${dur(t.size)}` })))),
      h("button", { className: "btn primary start", type: "button", textContent: "Start all",
        ariaLabel: `Start all ${list.length} as one checklist`, onclick: () => beginBatch(list) }),
      h("div", { className: "now-actions" },
        h("button", { className: "btn quiet", type: "button", textContent: "Just one",
          ariaLabel: `Just one: show only ${list[0].title}`, onclick: () => { state.single = true; render(); } })));
  }

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

  // Later asks when (Mor, 2026-10-04). Every answer is a "not now" to
  // learn from; only "later today" counts toward the stale rule, since the
  // other two are a plan, not a refusal.
  //   today    off the card for LATER_MINUTES, back the same day
  //   tomorrow not before tomorrow (Mor, 2026-10-05)
  //   week     not before the roomiest day this week (triage.pickWeekDay)
  //   someday  parked until moved back
  const declined = (task) => bumpLearn(uid, task.type, timeBucket().part, "skips");
  function later(task, when){
    if (when === "today") {
      stepAside(task, { label: `Later (${dur(LATER_MINUTES)}): `, write: () => Promise.all([skipNow(uid, task), declined(task)]) });
    } else if (when === "tomorrow") {
      const d = new Date(); d.setDate(d.getDate() + 1);
      let day = localDate(d.getTime());
      if (task.dateKind === "deadline" && task.due && task.due < day) day = task.due; // never hide it past its deadline
      stepAside(task, { label: "Tomorrow: ", write: () => Promise.all([restoreTask(uid, task.id, { notBefore: day, touchedAt: Date.now() }), declined(task)]) });
    } else if (when === "week") {
      let day = pickWeekDay(task, { events: cal.status === "ok" ? cal.events : [], tasks: tasks || [] });
      if (task.dateKind === "deadline" && task.due && task.due < day) day = task.due; // never hide it past its deadline
      const label = new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      stepAside(task, { label: `This week (${label}): `, write: () => Promise.all([restoreTask(uid, task.id, { notBefore: day, touchedAt: Date.now() }), declined(task)]) });
    } else if (when === "someday") {
      stepAside(task, { label: "Someday: ", write: () => Promise.all([restoreTask(uid, task.id, { status: "someday", touchedAt: Date.now() }), declined(task)]) });
    }
  }
  // Pending asks what it's waiting on (Mor, 2026-10-04); the reason is
  // optional and lands in the task's "Waiting on".
  const pending = (task, why = "") => stepAside(task, { label: "Pending: ", write: () => blockTask(uid, task, why) });

  function pendingAsk(task){
    // The card redraws on every snapshot and each minute; what's typed lives
    // in state so a redraw doesn't wipe it.
    const input = h("input", { id: "pendWhy", dir: "auto", autocomplete: "off", value: state.pendText || "",
      oninput: (e) => { state.pendText = e.target.value; } });
    const go = () => { const why = input.value; state.pendText = ""; pending(task, why); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    const box = h("div", { className: "pend-ask" },
      h("label", { htmlFor: "pendWhy", textContent: "Waiting on what? (optional)" }),
      h("div", { className: "pend-row" }, input,
        h("button", { className: "btn primary small", type: "button", textContent: "Set pending", onclick: go })));
    setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
    return box;
  }

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
  // Free time ends with the day hours (DAISEY_SPEC "Day hours"); after "I'm
  // free now" at night, only the next event bounds it.
  function calendarNow(){
    if (cal.status !== "ok") return null;
    const busy = cal.events.filter((e) => e.busy !== false && !e.allDay);
    const events = freeFrom ? busy.filter((e) => Date.parse(e.start) !== freeFrom) : busy;
    const now = Date.now(), hrs = dayHours(settings);
    const fw = freeWindow(events, now, isNight(now, hrs) ? null : dayEndAt(now, hrs));
    // The override only ever applies to the event that was running; once it
    // ends, or another starts, the calendar speaks for itself again.
    if (freeFrom && !cal.events.some((e) => Date.parse(e.start) === freeFrom && Date.parse(e.end) > Date.now())) freeFrom = null;
    return fw;
  }

  // A project block: the event running now is titled after a project
  // ("daisey", "Monster Punk audio"). Then the card isn't hidden behind the
  // event — it shows that project's best task, with the time until the
  // block ends as the window (DAISEY_SPEC "Current block"). Any other event
  // keeps the meeting card.
  function blockOf(fw){
    if (!fw?.current) return null;
    // A booked task's slot (an event Daisey made for it, or one titled like
    // it): that task is the card while it runs (DAISEY_SPEC "Booked tasks").
    const live = (tasks || []).filter((t) => t.status !== "done" && t.status !== "dropped");
    const planned = (fw.current.taskId && live.find((t) => t.id === fw.current.taskId)) || live.find((t) => sameTitle(t.title, fw.current.title));
    if (planned) return { project: planned.project, taskId: planned.id, title: planned.title, start: fw.current.start, end: fw.current.end };
    // A lesson or rehearsal is the thing itself, not time set aside for a
    // project — even when a project shares its name ("Teaching").
    const title = String(fw.current.title || "").toLowerCase();
    if (DRAIN.words.some((w) => title.includes(w))) return null;
    const open = (tasks || []).filter((t) => t.status !== "done" && t.status !== "dropped").map((t) => t.project);
    const project = matchProject(fw.current.title, open);
    return project ? { project, start: fw.current.start, end: fw.current.end } : null;
  }

  // What a re-render is worth watching for: normally the free window, but
  // inside a meeting the window stays 0 while the minutes left tick down, and
  // the card now states those minutes.
  // The day/night flip is worth a render too, calendar or not.
  const windowMark = (fw) => `${fw?.current
    ? `m${Math.ceil((fw.current.end - Date.now()) / 60000)}`
    : fw?.window}|${isNight(Date.now(), dayHours(settings))}`;

  // Booked tasks right now, id → { start, end, title } (day.js).
  const booked = () => (cal.status === "ok" ? bookings(tasks || [], cal.events) : new Map());

  function momentInput(fw = calendarNow()){
    const now = Date.now();
    const f = feel();
    const block = blockOf(fw);
    return {
      ...(!fw ? { realWindow: false }
        : block ? { window: Math.floor((block.end - now) / 60000), blockProject: block.project }
        : { window: fw.window, nextEvent: fw.next?.title ?? null }),
      ...workBase(tasks || [], now),
      sessionSkips: hidden(now),
      skipsToday: skipCounts(),
      energy: f.energy.value,
      place: f.place.value,
      learnStats,
      booked: Object.fromEntries([...booked()].map(([id, b]) => [id, b.start])),
    };
  }

  // Night mode (DAISEY_SPEC "Day hours"): outside the day hours the card
  // doesn't push work. It names the first pick for the morning — the engine
  // run for the start of the day, with its window, energy guess and booked
  // slots — and has no Start. "I'm free now" plans as if it were day.
  function nightCard(hrs){
    const now = Date.now(), morning = nextMorning(now, hrs);
    const evs = cal.status === "ok" ? cal.events.filter((e) => e.busy !== false && !e.allDay) : [];
    const fw = cal.status === "ok" ? freeWindow(evs, morning, dayEndAt(morning, hrs)) : null;
    const r = rank(tasks || [], {
      now: morning,
      ...(!fw ? { realWindow: false } : { window: fw.current ? 60 : fw.window, nextEvent: fw.next?.title ?? null }),
      ...workBase(tasks || [], now),
      energy: energyNow({ history: momentDoc.history || [], events: evs, now: morning }).value,
      place: "home",
      learnStats,
      booked: Object.fromEntries([...booked()].map(([id, b]) => [id, b.start])),
    });
    const p = r.pick;
    return h("div", { className: "now-card main night" },
      h("div", { className: "now-meta", textContent: `Night · your day starts at ${minText(hrs.start)}` }),
      p ? h("p", { className: "now-night" }, "Late. Tomorrow first: ", h("strong", {}, bdi(p.task.title)),
        ...(p.whyParts?.length ? [" — ", ...say(p.whyParts)] : []), ".")
        : h("p", { className: "now-night", textContent: "Late. Nothing lined up for tomorrow yet." }),
      h("button", { className: "btn quiet", type: "button", textContent: "I'm free now",
        ariaLabel: "I'm free now: pick a task anyway", onclick: () => { nightFree = true; render(); } }));
  }

  // A booked task, when nothing else fits (DAISEY_SPEC "Booked tasks"): it
  // says when its slot is, with no Start — the slot starting makes it the card.
  // Mor, 2026-10-05: with no Start it read as "stuck, nothing to offer", so
  // it can be started early, and it says why the rest are out.
  function bookedCard(b, r){
    const today = localDate(b.start) === localDate();
    const when = today ? clock(b.start) : `${new Date(b.start).toLocaleDateString([], { weekday: "short" })} ${clock(b.start)}`;
    return h("div", { className: "now-card main booked" },
      contextLine(),
      h("div", { className: "now-meta", textContent: `Booked for ${when}` }),
      h("div", { className: "now-title", dir: "auto", textContent: b.task.title }),
      h("p", { className: "now-why", textContent: "Nothing else fits right now, so this is next." }),
      h("button", { className: "btn primary start", type: "button", textContent: "Start now",
        ariaLabel: `Start ${b.task.title} now, before its slot`, onclick: () => begin(b.task) }),
      outLine(r), putOffButton());
  }

  // Why the open tasks can't come up now, counted: "Out right now: 3 put
  // off today · 2 need offices open." Parked, waiting and future-dated tasks
  // aren't news, so they aren't counted.
  const OUT_SAID = {
    skipped: "put off today", office: "need offices open", place: "can't be done where you are", energy: "need more energy",
    size: "too long for the time you have", evening: "are for the evening", block: "belong to another project", booked: "booked later",
  };
  function outLine(r){
    const n = {};
    for (const o of r.out) if (OUT_SAID[o.reason]) n[o.reason] = (n[o.reason] || 0) + 1;
    delete n.booked; // the card itself is the booked one
    const parts = Object.entries(n).map(([k, c]) => `${c} ${OUT_SAID[k]}`);
    return parts.length ? h("p", { className: "muted now-out", textContent: `Out right now: ${parts.join(" · ")}.` }) : null;
  }
  const putOffButton = () => skips.size > 0 && h("button", { className: "btn quiet", type: "button", textContent: `Show the ${skips.size} you put off`,
    ariaLabel: `Show the ${skips.size} tasks you put off today`, onclick: () => { skips.clear(); setToast(null); render(); } });

  // Someday comes back (DAISEY_SPEC): Sunday morning, or whenever fewer than
  // 3 tasks are active, a short pick — stakes first, a quiet mark on the ones
  // that cost money or keep someone waiting. A pick moves the task back to
  // ready for this week; two picks, Done or Not now close it for the day.
  const somedayTasks = () => (tasks || []).filter((t) => t.status === "someday");
  const STAKES_FIRST = { penalty: 0, money: 1, someone: 2, low: 3 };
  const MARK = { penalty: "penalty if late", money: "costs money", someone: "someone's waiting" };
  function somedayDue(){
    if (!somedayTasks().length) return false;
    if (sd.open) return true;
    if (settings.somedayAsked === localDate()) return false;
    const d = new Date();
    const active = (tasks || []).filter((t) => t.status === "ready" && !notYet(t)).length;
    return (d.getDay() === 0 && d.getHours() < 12) || active < 3;
  }
  function somedayAsk(){
    const list = somedayTasks().sort((a, b) => (STAKES_FIRST[a.stakes] ?? 3) - (STAKES_FIRST[b.stakes] ?? 3)
      || String(a.due || "~").localeCompare(String(b.due || "~")) || (a.createdAt || 0) - (b.createdAt || 0));
    const shownList = sd.all ? list : list.slice(0, 6);
    const close = () => {
      Object.assign(sd, { open: false, picked: [], all: false });
      settings = { ...settings, somedayAsked: localDate() };
      render();
      saveSettings(uid, { somedayAsked: localDate() }).catch(fail);
    };
    const pick = (t) => {
      sd.picked.push(t.id);
      restoreTask(uid, t.id, { status: "ready", notBefore: null, touchedAt: Date.now() }).catch(fail);
      if (sd.picked.length >= 2) close(); else render();
    };
    return h("div", { className: "learn-ask someday-ask", role: "group", ariaLabel: "Pick from Someday" },
      h("p", { className: "muted", textContent: sd.picked.length ? "One more, or that's the week?" : "Pick 1–2 from Someday for this week." }),
      h("div", { className: "someday-list" }, ...shownList.map((t) => h("button", { type: "button", className: "someday-item",
        ariaLabel: `Move ${t.title} to this week${MARK[t.stakes] ? ` (${MARK[t.stakes]})` : ""}`, onclick: () => pick(t) },
        bdi(t.title), MARK[t.stakes] && h("span", { className: "someday-mark", textContent: MARK[t.stakes] })))),
      h("div", { className: "learn-row" },
        list.length > shownList.length && h("button", { className: "chip quiet", type: "button", textContent: `Show all ${list.length}`,
          onclick: () => { sd.all = true; render(); } }),
        h("button", { className: "chip quiet", type: "button", textContent: sd.picked.length ? "Done" : "Not now", onclick: close })));
  }

  // Calendar events that are really tasks (caltask.js): offered once each,
  // with the guesses; ✓ adds the task and then asks about the event. Daisey
  // never touches the event without that second tap.
  const dayShort = (d) => new Date(`${d}T12:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  function calOffer(){
    if (calAsk) {
      const ev = calAsk;
      return h("div", { className: "learn-ask", role: "group", ariaLabel: "Keep the calendar event?" },
        h("p", { className: "muted", textContent: "Added as a task. Keep the calendar event or delete it?" }),
        h("div", { className: "learn-title" }, bdi(ev.title)),
        h("div", { className: "learn-row" },
          h("button", { className: "chip", type: "button", textContent: "Keep it", onclick: () => { calAsk = null; render(); } }),
          ev.editable !== false && h("button", { className: "chip quiet", type: "button", textContent: "Delete event",
            onclick: () => { calAsk = null; render(); deleteEvent(ev).catch(fail); } })));
    }
    if (cal.status !== "ok" || !tasks) return null;
    const offered = settings.calOffered || [];
    const ev = nextOffer(cal.events, tasks, offered);
    if (!ev) return null;
    const d = draftFrom(ev, tasks);
    const asked = () => {
      const ids = [...offered, ev.id].slice(-200);
      settings = { ...settings, calOffered: ids };
      saveSettings(uid, { calOffered: ids }).catch(fail);
    };
    const meta = [LABELS.type[d.guess.type], dur(d.guess.size), d.input.due && `deadline ${dayShort(d.input.due)}`,
      d.guess.stakes !== "low" && LABELS.stakes[d.guess.stakes]].filter(Boolean).join(" · ");
    return h("div", { className: "learn-ask cal-offer", role: "group", ariaLabel: "Make this calendar event a task?" },
      h("p", { className: "muted", textContent: "From your calendar. Make this a task?", title: ev.title }),
      h("div", { className: "learn-title" }, bdi(d.input.title)),
      h("p", { className: "muted", textContent: meta }),
      h("div", { className: "learn-row" },
        h("button", { className: "chip", type: "button", textContent: "✓ Make it a task",
          onclick: () => { asked(); calAsk = ev; render(); addTask(uid, d.input, tasks).catch(fail); } }),
        h("button", { className: "chip quiet", type: "button", textContent: "Not a task", onclick: () => { asked(); render(); } })));
  }

  function render(){
    const live = !!run && !run.pausedAt; // a paused run is back on the main screen
    document.body.classList.toggle("focus", live || !!handoff);
    if (live) { fill(renderFocus()); return; }
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
    lastWindow = windowMark(fw);
    const greet = h("div", { className: "now-greet" },
      // Said you're free during an event that is still on the calendar.
      freeFrom && busy && h("p", { className: "muted" }, "Ignoring ", bdi(busy.title), " ",
        h("button", { className: "linkish", type: "button", textContent: "put it back",
          ariaLabel: `Stop ignoring ${busy.title}`, onclick: () => { freeFrom = null; render(); } })),
      CAL_NOTE[cal.status] && h("p", { className: "muted" }, CAL_NOTE[cal.status] + " ", h("a", { href: "/daisey/", textContent: "Open old Daisey" })),
      // Too many passed dates: one quiet line, at most once a day.
      tasks && shouldOffer(tasks, Date.now(), settings) && h("p", { className: "muted offer" },
        `${sweepList(tasks).length} old dates are piling up.`,
        h("button", { className: "linkish", type: "button", textContent: "Sort them (2 min)", onclick: () => onSweep?.() }),
        h("button", { className: "linkish", type: "button", textContent: "Not today",
          onclick: () => { settings = { ...settings, sweepAnswered: localDate() }; render(); saveSettings(uid, { sweepAnswered: localDate() }).catch(fail); } })));

    if (tasks == null) { fill(greet, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }
    if (run?.pausedAt) { showing(run.taskId); fill(greet, pausedCard(), toast && toastView()); return; }

    const hrs = dayHours(settings);
    if (!isNight(Date.now(), hrs)) nightFree = false;
    if (isNight(Date.now(), hrs) && !nightFree) { fill(greet, nightCard(hrs), toast && toastView()); return; }

    const r = rank(tasks, momentInput(fw));
    const planned = blockOf(fw)?.taskId;
    const card = (state.chosen && r.ranked.find((s) => s.task.id === state.chosen))
      || (planned && r.ranked.find((s) => s.task.id === planned)) || r.pick;
    showing(card?.task.id ?? null);
    // One ask under the card at a time, the most asked-for first.
    const tip = (toast && toastView()) || (sd.open && somedayAsk()) || calOffer() || learnAsk(r) || (somedayDue() && somedayAsk());
    // In a meeting, the meeting IS what's happening now, so the card says
    // which one and how much of it is left (Mor, 2026-10-04) instead of
    // "nothing to pick until it ends", which named nothing and read as if
    // Daisey had simply given up. "I'm free now" still overrides it.
    const block = blockOf(fw);
    if (!card && block) {
      fill(greet, h("div", { className: "now-card main empty" }, contextLine(),
        h("p", { className: "now-empty" }, "Nothing in ", bdi(block.project), " fits right now."),
        h("button", { className: "btn quiet", type: "button", textContent: "I'm free now",
          ariaLabel: `I'm free now: ignore the ${block.project} block and pick any task`,
          onclick: () => { freeFrom = block.start; render(); } })), tip);
      return;
    }
    if (!card && fw?.current) { fill(greet, meetingCard(fw.current), tip); return; }
    const bk = !card && r.out.filter((o) => o.reason === "booked").map((o) => ({ task: o.task, ...booked().get(o.task.id) }))
      .filter((b) => b.start).sort((a, b) => a.start - b.start)[0];
    if (bk) { fill(greet, bookedCard(bk, r), tip); return; }
    if (!card) {
      fill(greet, h("div", { className: "now-card main empty" },
        r.empty === "nofit" && contextLine(), // nothing fits: maybe you're not where Daisey thinks
        h("p", { className: "now-empty", textContent: r.empty === "none"
          ? "No tasks yet. Add a few and Daisey will pick."
          : `Nothing fits the next ${dur(r.moment.window)}. Take the break.` }),
        r.empty === "nofit" && outLine(r), putOffButton()), tip);
      return;
    }

    if (card === r.pick && r.pick.batch && !state.chosen && !state.single) { fill(greet, batchCard(r, r.pick.batch), tip); return; }
    const alts = r.ranked.length > 1 ? [r.pick, ...r.alternatives].filter((s) => s !== card).slice(0, 3) : [];
    const someN = somedayTasks().length;
    // Start is the one loud thing on the tab; the other two stay quiet under it.
    fill(greet, taskCard(card, true,
      h("button", { className: "btn primary start", type: "button", textContent: "Start",
        ariaLabel: `Start: ${card.task.title}`, onclick: () => begin(card.task) }),
      h("div", { className: "now-actions" },
        action("later", "Later", `not now — choose when to see ${card.task.title} again`,
          { ariaExpanded: String(state.laterAsk), onclick: () => { state.laterAsk = !state.laterAsk; state.pendAsk = false; state.showAlts = false; render(); } }),
        // Never a dead end while Someday holds tasks (DAISEY_SPEC "Someday comes back").
        action("switch", "Switch", state.showAlts ? "hide the other tasks"
          : alts.length ? `something else — ${alts.length} other tasks`
          : someN ? "nothing else is active — pick from Someday" : "nothing else is active",
          { disabled: !alts.length && !someN, ariaExpanded: String(state.showAlts),
            onclick: () => { state.showAlts = !state.showAlts; state.laterAsk = false; state.pendAsk = false; render(); } }),
        action("pending", "Pending", `${card.task.title} is blocked — set it to Waiting`,
          { ariaExpanded: String(state.pendAsk), onclick: () => { state.pendAsk = !state.pendAsk; state.laterAsk = false; state.showAlts = false; render(); } })),
      state.pendAsk && pendingAsk(card.task),
      state.laterAsk && h("div", { className: "later-ask", role: "group", ariaLabel: "When instead?" },
        h("span", { className: "muted", textContent: "When?" }),
        ...[["today", "Later today"], ["tomorrow", "Tomorrow"], ["week", "This week"], ["someday", "Someday"]].map(([w, text]) =>
          h("button", { className: "chip", type: "button", textContent: text, onclick: () => later(card.task, w) })))),
      state.showAlts && !alts.length && h("div", { className: "now-alts", role: "group", ariaLabel: "Other tasks" },
        h("p", { className: "muted" }, "Nothing else is active. ",
          h("button", { className: "linkish", type: "button", textContent: "Pick from Someday?",
            onclick: () => { sd.open = true; state.showAlts = false; render(); } }))),
      state.showAlts && alts.length > 0 && h("div", { className: "now-alts", role: "group", ariaLabel: "Other tasks" }, ...alts.map((s) => h("button", {
        type: "button", className: "now-alt", ariaLabel: `Put ${s.task.title} on the card instead${s.why ? ". " + s.why : ""}`,
        onclick: () => { state.chosen = s.task.id; state.showAlts = false; render(); },
      }, taskCard(s, false)))), tip);
    // One slide-in per step-aside: later snapshots must not replay it.
    if (slideIn) { slideIn = false; if (motionOK()) root.querySelector(".now-card.main")?.classList.add("in"); }
  }

  // Learning asks one thing at a time, as a single line under the card, never
  // a form (DAISEY_SPEC "Learning"): make it smaller after two stops, and
  // keep, shrink or drop after five skips. Each answer also clears the reason
  // for asking, so it doesn't come back.
  const asked = new Set();
  function learnAsk(r){
    // Stopped twice (the saved count, so it holds across a reload) and not yet
    // answered: Daisey offers to make it smaller.
    const sp = (tasks || []).find((t) => (t.stopsUnfinished || 0) >= 2 && t.status === "ready" && !asked.has("split:" + t.id));
    if (sp) {
      return h("div", { className: "learn-ask", role: "group", ariaLabel: "Make it smaller?" },
        h("p", { className: "muted", textContent: "Stopped twice without finishing. Make it smaller?" }),
        h("div", { className: "learn-title" }, bdi(sp.title)),
        h("div", { className: "learn-row" },
          h("button", { className: "chip", type: "button", textContent: `Shrink to ${dur(shrunk(sp.size))}`,
            onclick: () => { asked.add("split:" + sp.id); restoreTask(uid, sp.id, shrinkPatch(sp)).catch(fail); render(); } }),
          h("button", { className: "chip quiet", type: "button", textContent: "Not now",
            onclick: () => { asked.add("split:" + sp.id); restoreTask(uid, sp.id, { stopsUnfinished: 0 }).catch(fail); render(); } })));
    }
    const st = r.stale.find((t) => !asked.has(t.id));
    if (!st) return null;
    const answer = (patch) => { asked.add(st.id); restoreTask(uid, st.id, { ...patch, touchedAt: Date.now() }).catch(fail); render(); };
    return h("div", { className: "learn-ask", role: "group", ariaLabel: "Still want this task?" },
      h("p", { className: "muted", textContent: "Skipped five times. Still want it?" }),
      h("div", { className: "learn-title" }, bdi(st.title)),
      h("div", { className: "learn-row" },
        h("button", { className: "chip", type: "button", textContent: "Keep", onclick: () => answer({ skipsSinceStart: 0 }) }),
        h("button", { className: "chip", type: "button", textContent: `Shrink to ${dur(shrunk(st.size))}`, onclick: () => answer(shrinkPatch(st)) }),
        h("button", { className: "chip quiet", type: "button", textContent: "Drop", onclick: () => answer({ status: "dropped" }) })));
  }

  const fill = (...kids) => { root.replaceChildren(...kids.filter(Boolean)); };
  const fail = (e) => console.error("[daisey] now", e);
  const unsubs = [
    watchTasks(uid, (ts) => { tasks = ts; render(); }, fail),
    watchCalendar((c) => { cal = c; render(); }),
    watchRun(uid, (r) => { run = r; if (r) handoff = null; render(); }, fail),
    watchSkips(uid, (s) => { skipDoc = s; render(); }, fail),
    watchSettings(uid, (s) => { settings = s || {}; render(); }, fail),
    watchMoment(uid, (d) => { momentDoc = d || {}; render(); }, fail),
    watchLearn(uid, (d) => { learnStats = d || {}; render(); }, fail),
  ];
  // The timer ticks every second while running; otherwise this only
  // re-renders when the free window's minute changes.
  const tick = setInterval(() => {
    if (document.hidden) return;
    if (run && !run.pausedAt) { const c = Math.floor(elapsedMinutes(run) * 60); if (c !== lastClock) { lastClock = c; render(); } return; }
    if (windowMark(calendarNow()) !== lastWindow) render();
  }, 1000);
  const onVisible = () => { if (!document.hidden) render(); };
  document.addEventListener("visibilitychange", onVisible);
  root.hidden = false;
  render();

  return {
    refresh: render,
    // "Do this now" from the task sheet: the same thing Switch does, driven
    // from the list. A task put off today is un-put-off, or the card would
    // ignore the choice.
    put(id){
      handoff = null;
      skips.delete(id);
      state.chosen = id;
      state.showAlts = false;
      render();
    },
    unmount(){ showing(null); clearTimeout(toastTimer); document.body.classList.remove("focus"); unsubs.forEach((u) => u()); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
