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
import { watchWhere, setRide } from "./where.js";
import { shouldOffer, sweepList, pickWeekDay } from "./triage.js";
import { focusView, handoffView, elapsedMinutes, targetMinutes, batchFocusView, batchName, sinceMark, paused, resumed } from "./focus.js";
import { watchCalendar, deleteEvent, logDone } from "./calendar.js";
import { LATER_MINUTES, DRAIN, CANCEL_KEEP_MINUTES } from "./weights.js";
import { rank, freeWindow, timeBucket, matchProject } from "./engine.js";
import { localDate, skipSnapshot, shrunk, shrinkPatch, notYet, LABELS } from "./model.js";
import { dayHours, isNight, nextMorning, dayEndAt, bookings, sameTitle, minText } from "./day.js";
import { nextOffer, draftFrom } from "./caltask.js";
import { h, icon, bdi, pieces, sizeText, dur, say } from "./ui.js";
import { greeting, freeDur, areaClass, areaName, projectShown, doneToday, dirOf, stemDaisy, moonDaisy } from "./look.js";

// Above the card: the greeting, the one free-time line, the place and energy
// chips, and any warnings. The day itself is in the Today panel.
const LATER_MS = LATER_MINUTES * 60000;
const UNDO_MS = 5000;
const SLIDE_MS = 140; // matches the card-out animation in app.css
const motionOK = () => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
// "Mon 5 Oct", under the time in the clock tile; the tick below keeps both current.
const dayText = (ms = Date.now()) => new Date(ms).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

// onCard(id | null) fires whenever the task on the card changes, so the task
// list can set it aside while it's "physically" on the card.
// onSweep() opens the old-dates sweep (sweep.js). onProject(name) shows that
// project's tab in Tasks. name: the first name for the greeting. onDone(n):
// how many tasks are done today, for the header's daisy. ctxSlot: the spot
// in the header row where the place and energy chips go.
export function mountNow(root, uid, { onCard, onSweep, onProject, onEdit, name = "", onDone, ctxSlot } = {}){
  let tasks = null; // null until the first snapshot
  let settings = {}; // state/settings: when the sweep was last offered
  let momentDoc = {}; // state/moment: energy and place corrections
  let learnStats = {}; // state/learn: starts and skips per type and time of day
  let located = null; // "home" | "out" from the phone's location (where.js), null = unknown
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
  // sel: the empty state's picks, not yet brought back.
  const sd = { open: false, picked: [], all: false, sel: [] };
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
    // Several at once, one write: "Show the 2 you put off".
    drop(ids){
      const items = { ...skipItems() };
      for (const id of ids) delete items[id];
      skipDoc = { date: localDate(), items };
      saveSkips(uid, skipDoc).catch(fail);
    },
    get size(){ return hidden().length; },
  };
  const reset = () => { state.chosen = null; state.showAlts = false; state.laterAsk = false; state.pendAsk = false; state.pendText = ""; state.single = false; };
  let shown;
  const showing = (id) => { if (id !== shown) { shown = id; onCard?.(id); } };

  // The card Daisey is proposing says its reasons in the first person; the
  // alternatives keep the plain why line, so only one voice is speaking.
  // Names in the why line (projects, people, events) are their own <bdi>.
  function taskCard(s, main, ...extra){
    const why = !main && sentence(s.whyParts);
    const t = s.task;
    return h("div", { className: "now-card" + (main ? " main hero" : "") + areaClass(t) },
      main ? heroTop(t, sizeText(t.size))
        : h("div", { className: "now-meta" }, ...pieces(t.project, sizeText(t.size))),
      h("div", { className: "now-title", dir: "auto", textContent: t.title }),
      t.nextStep && h("p", { className: "now-next" }, "Next: ", bdi(t.nextStep)),
      main ? reasonTags(s.whyParts) : why && h("p", { className: "now-why" }, ...say(why)),
      ...extra);
  }

  // The card's reasons as soft tags in the area's colour, one per reason
  // (Mor, 2026-10-05: "I'd do this now: …" read as a paragraph; tags read
  // at a glance). Nothing to say → no tags.
  function reasonTags(parts){
    const groups = [[]];
    for (const p of parts || []) p === ", " ? groups.push([]) : groups.at(-1).push(p);
    const tags = groups.filter((g) => g.length).map(([first, ...rest]) => h("li", { className: "why-tag" },
      ...say([typeof first === "string" ? first[0].toUpperCase() + first.slice(1) : first, ...rest])));
    return tags.length ? h("ul", { className: "why-tags", ariaLabel: "Why this one" }, ...tags) : null;
  }

  // The hero's top row: area dot, "Area · project" in the area's colour, and
  // on the far side the size (or whatever the card says there). On the card
  // the project name leads to its tab in Tasks.
  // The pencil opens the task's own settings, the same form as Tasks (Mor,
  // 2026-10-05). Not on a batch: that card holds several tasks.
  function heroTop(t, side, editable = true){
    const area = areaName(t);
    const proj = projectShown(t) && h("button", { type: "button", className: "now-proj",
      title: `Show ${t.project} in Tasks`, onclick: () => onProject?.(t.project) }, bdi(t.project));
    return h("div", { className: "hero-top" },
      h("span", { className: "hero-area" }, h("span", { className: "dot", ariaHidden: "true" }),
        h("span", {}, area, area && proj ? " · " : "", proj || (area ? "" : "Inbox"))),
      h("span", { className: "hero-end" },
        side && h("span", { className: "hero-side", textContent: side }),
        editable && onEdit && h("button", { type: "button", className: "hero-edit", ariaLabel: `Edit ${t.title}`,
          title: "Edit task", onclick: () => onEdit(t) }, icon("edit"))));
  }

  // The card, with the next piece peeking in from the far side like
  // Tetris's NEXT (Mor, 2026-10-05): the engine's next real pick, so it never
  // promises a task that isn't there. Tap it, or swipe the card away, and it
  // slides in. The card breathes while nothing is asked of it (CSS; off
  // under reduced motion).
  function deck(card, next, still){
    const el = h("div", { className: `deck${still ? " still" : ""}` }, card,
      next && h("button", { type: "button", className: "now-peek" + areaClass(next.task),
        ariaLabel: `Next: ${next.task.title}. Put it on the card`, onclick: () => advance(next) },
        h("span", { className: "peek-top" }, h("span", { className: "dot" }), sizeText(next.task.size)),
        h("span", { className: "peek-title", dir: "auto", textContent: next.task.title })));
    if (next) {
      let x0 = null, y0 = 0;
      card.addEventListener("pointerdown", (e) => { x0 = e.target.closest("input, textarea") ? null : e.clientX; y0 = e.clientY; });
      card.addEventListener("pointerup", (e) => {
        if (x0 === null) return;
        const dx = (e.clientX - x0) * (getComputedStyle(card).direction === "rtl" ? -1 : 1), dy = e.clientY - y0;
        x0 = null;
        if (dx < -50 && Math.abs(dx) > 1.5 * Math.abs(dy)) advance(next);
      });
    }
    return el;
  }
  // The next piece takes the card: this one slides out, that one slides in.
  function advance(next){
    const go = () => { reset(); state.chosen = next.task.id; slideIn = true; render(); };
    const el = root.querySelector(".now-card.main");
    if (el && motionOK()) { el.classList.add("out"); root.querySelector(".now-peek")?.classList.add("pull"); setTimeout(go, SLIDE_MS); } else go();
  }
  const asking = () => state.laterAsk || state.pendAsk || state.showAlts;

  // The one loud button: amber, with a play icon.
  const startButton = (text, aria, onclick) => h("button", { className: "btn primary start", type: "button", ariaLabel: aria, onclick },
    icon("play"), h("span", { textContent: text }));

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
      place: placeNow({ correction: momentDoc.place, located, events }),
    };
  }

  // The ONE free-time line (Mor, 2026-10-05: every other free-time number
  // went): "4 h 44 free until מנטור at 17:00", or until the day's end. In a
  // project block or a booked slot it says that instead; in a meeting the
  // meeting card already says it all.
  function freeLine(fw){
    const block = blockOf(fw);
    if (!fw || (fw.current && !block)) return null;
    const line = (...kids) => h("p", { className: "freeline" }, ...kids);
    if (block) return block.taskId ? line(`Booked until ${clock(block.end)}`) : line("Working on ", bdi(block.project), ` until ${clock(block.end)}`);
    if (fw.window < 1) return null;
    if (fw.next) return line(`${freeDur(fw.window)} free until `, bdi(fw.next.title), ` at ${clock(fw.next.start)}`);
    if (nightFree) return line(`${freeDur(fw.window)} free`);
    return line(`${freeDur(fw.window)} free until ${clock(dayEndAt(Date.now(), dayHours(settings)))}`);
  }

  // The top of the day screen, folded into the header row (Mor, 2026-10-05:
  // "a lot of unused space in the middle"): the greeting with the free line
  // under it, then the time and date as a clock tile. No place or energy
  // chips any more: place comes from the phone's location (where.js), energy
  // from the time of day and the calendar, corrected from Switch (energyRow).
  function topOf(fw){
    const now = Date.now();
    ctxSlot?.replaceChildren(
      h("div", { className: "greet-col" },
        h("h2", { className: "greeting", textContent: greeting(name) }),
        moving(freeLine(fw))),
      h("div", { className: "clock-tile" },
        h("span", { className: "clock-time", textContent: clock(now) }),
        h("span", { className: "clock-date", textContent: dayText(now) })));
    return null;
  }

  // On the move, the free line says so first: "On the train · 2 h free …".
  const MODE_WORD = { walk: "Walking", train: "On the train", bus: "On the bus", ride: "On the move" };
  function moving(line){
    const p = feel().place;
    const word = p.value === "spot" ? `At ${p.spot}` : MODE_WORD[p.value];
    if (!word) return line;
    if (!line) return h("p", { className: "freeline", textContent: word });
    line.prepend(`${word} · `);
    return line;
  }

  // A ride the phone can't name (speed says train, bus or car alike): ask
  // once; the answer holds for the rest of the ride (where.js RIDE_MS).
  function rideAsk(){
    const pick = (mode, text) => h("button", { type: "button", className: "chip", textContent: text, onclick: () => setRide(mode) });
    return h("div", { className: "ride-ask", role: "group", ariaLabel: "How are you travelling?" },
      h("span", { className: "muted", textContent: "On a" }),
      pick("train", "Train"), pick("bus", "Bus"), pick("car", "Driving"));
  }

  // Driving and no call to make (hands-free calls are the one thing that
  // fits, Mor 2026-10-05): just this. "I'm a passenger" counts as a bus
  // ride (sitting, phone in hand).
  function drivingCard(){
    return h("div", { className: "now-card main hero meeting" },
      h("div", { className: "now-meta", textContent: "Driving" }),
      h("div", { className: "now-title", textContent: "Eyes on the road" }),
      h("p", { className: "now-why", textContent: "I'll have something ready when you stop." }),
      h("button", { className: "btn quiet", type: "button", textContent: "I'm a passenger", onclick: () => setRide("bus") }));
  }

  // Switch is where "not this one" happens, so it's where you say why:
  // lighter or bigger. Same correction the energy chip made (3 hours, and
  // one more point in the time-of-day pattern); tapping the one that's on
  // goes back to medium. The card re-picks straight away.
  function energyRow(){
    const cur = feel().energy;
    const on = (v) => !cur.guessed && cur.value === v;
    const pick = (v, text, aria) => h("button", { type: "button", className: "chip energy-pick", ariaPressed: String(on(v)), ariaLabel: aria,
      onclick: () => { state.showAlts = false; state.chosen = null; correct("energy", on(v) ? "medium" : v); } },
      icon(v === "low" ? "lighter" : "energy"), h("span", { textContent: text }));
    return h("div", { className: "energy-row" },
      pick("low", "Something lighter", "I'm low on energy: show something lighter"),
      pick("high", "Something bigger", "I've got energy: show something bigger"));
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
    return h("div", { className: "now-card main hero meeting" },
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
  // tabs, the greeting and the Tell bar).
  // A batch: a checklist in focus mode. The last tick ends it and hands off
  // like Done; Stop leaves the unticked ones open with their share of the time.
  // A finished task goes into Google Calendar's "Daisey log" as a lookback,
  // unless turned off in the account menu. Under a minute isn't worth a
  // block. A failure is only logged: the task is done either way.
  const logFinished = (title, minutes, taskId, planned) => {
    if (settings.logDone === false || minutes < 1) return;
    const note = `Done with Daisey: ${dur(Math.round(minutes))}${planned ? ` (planned ${dur(planned)})` : ""}.`;
    logDone({ title, minutes, taskId, note }).catch((e) => console.error("[daisey] log to calendar", e));
  };

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
          handoff = { title: batchName(type, list.length), skip: prev.taskId, minutes: elapsedMinutes(prev), ids: [...prev.batch] };
          tickBatch(uid, prev, t, minutes).then(() => endBatch(uid, [], 0)).catch(fail);
          logFinished(`${batchName(type, list.length)}: ${list.map((x) => x.title).join(", ")}`, elapsedMinutes(prev), prev.taskId,
            list.reduce((s, x) => s + (x.size || 0), 0));
          run = null;
        } else {
          run = { ...run, done, mark: Date.now() };
          tickBatch(uid, prev, t, minutes).catch(fail);
        }
        render();
      },
      onPause: pause,
      onResume: resume,
      onStop: () => endSession(),
    });
  }

  // Pause (Mor, 2026-10-05): the clock stops and focus mode stays, with
  // Resume where Pause was. Stop ends the session (endSession) and the normal
  // card comes back. Ending keeps the minutes, except under
  // CANCEL_KEEP_MINUTES (a mis-tap), and is never counted as a stop. A batch
  // keeps the ones already ticked.
  const pause = () => { const doc = paused(run); run = doc; render(); saveRun(uid, doc).catch(fail); };
  const resume = () => { const doc = resumed(run); run = doc; render(); saveRun(uid, doc).catch(fail); };
  const endSession = ({ quiet = false } = {}) => {
    const prev = run;
    if (!prev) return;
    run = null;
    if (!quiet) render();
    if (prev.batch) { // the minutes since the last tick go to the ones left, as a batch ending does
      const left = (tasks || []).filter((t) => prev.batch.includes(t.id) && !(prev.done || []).includes(t.id));
      const m = sinceMark(prev);
      (m >= CANCEL_KEEP_MINUTES && left.length ? endBatch(uid, left, m) : cancelRun(uid)).catch(fail);
      return;
    }
    const m = elapsedMinutes(prev);
    cancelRun(uid, tasks?.find((t) => t.id === prev.taskId) || null, m >= CANCEL_KEEP_MINUTES ? m : 0).catch(fail);
  };

  function renderFocus(){
    if (run.batch) return renderBatch();
    const task = tasks?.find((t) => t.id === run.taskId) || null;
    showing(run.taskId);
    return focusView(run, task, {
      // Done is finished — no "or more left?" (Pause covers more left).
      onDone: () => {
        if (!run) return; // the hold finished after the run moved on
        const minutes = elapsedMinutes(run);
        handoff = { title: task ? task.title : "", skip: run.taskId, minutes, ids: [run.taskId] };
        endRun(uid, task, minutes, { finished: true }).catch(fail);
        if (task) logFinished(task.title, minutes, task.id, targetMinutes(run, task));
        run = null; render();
      },
      onExtend: (m) => { const prev = run; run = { ...run, extra: (run.extra || 0) + m }; render(); extendRun(uid, prev, m).catch(fail); },
      onPause: pause,
      onResume: resume,
      onStop: () => endSession(),
      // Pending from focus mode: stop, and the card, back on this task, asks
      // what it's waiting on.
      onPending: () => { const id = run.taskId; endSession({ quiet: true }); reset(); state.chosen = id; state.pendAsk = true; render(); },
    });
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
    return h("div", { className: "now-card main hero batch" + areaClass(list[0]) },
      heroTop(list[0], `Batch · ~${dur(b.minutes)}`, false),
      h("div", { className: "now-title", textContent: name }),
      h("p", { className: "now-why", textContent: `${office ? "Offices are open: " : ""}${name}, ~${dur(b.minutes)}. Together?` }),
      h("ul", { className: "batch-preview" }, ...list.map((t) => h("li", {}, bdi(t.title), h("span", { className: "muted", textContent: ` · ${dur(t.size)}` })))),
      startButton("Start all", `Start all ${list.length} as one checklist`, () => beginBatch(list)),
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
      spot: f.place.spot,
      learnStats,
      booked: Object.fromEntries([...booked()].map(([id, b]) => [id, b.start])),
    };
  }

  // Night mode (DAISEY_SPEC "Day hours"): outside the day hours the card
  // doesn't push work. It names the first pick for the morning — the engine
  // run for the start of the day, with its window, energy guess and booked
  // slots — and has no Start. "I'm free now" plans as if it were day.
  // The whole screen goes dark for it (.night on <html>), whatever the theme:
  // a dimmed daisy under a moon, a few stars, tomorrow's first calendar block
  // and then that first pick.
  function nightView(hrs){
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
    // Before the day starts it's still "tonight" until 04:00; after that the
    // morning's plan is today's, not tomorrow's.
    const early = new Date(now).getHours() >= 4 && localDate(morning) === localDate(now);
    const day = localDate(morning);
    const first = evs.filter((e) => localDate(Date.parse(e.start)) === day)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    const meta = p && [areaName(p.task) || projectShown(p.task), dur(p.task.size),
      MARK[p.task.stakes] && `${MARK[p.task.stakes]}`].filter(Boolean).join(" · ");
    const who = name ? `, ${name}` : "";
    return [
      h("div", { className: "stars", ariaHidden: "true" }, ...[0, 1, 2, 3].map(() => h("span"))),
      h("div", { className: "night-hero" }, moonDaisy(),
        h("h2", { className: "night-h", textContent: early ? `Early${who}.` : `Late${who}.` }),
        h("p", { className: "night-p", textContent: early ? "Nothing needs you yet. Here's your day." : "Nothing needs you tonight. Here's tomorrow." })),
      h("section", { className: "now-card main night", ariaLabel: early ? "First today" : "Tomorrow first" },
        h("div", { className: "night-label", textContent: early ? "First today" : "Tomorrow first" }),
        first && h("div", { className: "night-row" },
          h("span", { className: "night-time", textContent: clock(Date.parse(first.start)) }),
          h("div", { className: "night-ev", style: first.color ? `--ev:${first.color}` : "" },
            h("span", { className: "night-ev-time", textContent: `${clock(Date.parse(first.start))}–${clock(Date.parse(first.end))}` }),
            h("span", { className: "night-ev-title" }, bdi(first.title)))),
        p ? h("div", { className: "night-row" },
          h("span", { className: "night-time", textContent: first ? "After" : minText(hrs.start) }),
          h("div", { className: "night-task" + areaClass(p.task) },
            h("div", { className: "night-task-title", dir: "auto", textContent: p.task.title }),
            meta && h("div", { className: "night-task-meta", textContent: meta })))
          : h("p", { className: "night-none", textContent: "Nothing lined up yet." })),
      h("div", { className: "night-foot" },
        h("button", { className: "pill-btn", type: "button", textContent: "I'm free now, show me something",
          ariaLabel: "I'm free now: pick a task anyway", onclick: () => { nightFree = true; render(); } }),
        h("span", { className: "night-hours", textContent: `Day hours ${minText(hrs.start)}–${minText(hrs.end)}` })),
    ];
  }

  // A booked task, when nothing else fits (DAISEY_SPEC "Booked tasks"): it
  // says when its slot is, with no Start — the slot starting makes it the card.
  // Mor, 2026-10-05: with no Start it read as "stuck, nothing to offer", so
  // it can be started early, and it says why the rest are out.
  function bookedCard(b, r){
    const today = localDate(b.start) === localDate();
    const when = today ? clock(b.start) : `${new Date(b.start).toLocaleDateString([], { weekday: "short" })} ${clock(b.start)}`;
    return h("div", { className: "now-card main hero booked" + areaClass(b.task) },
      heroTop(b.task, `Booked for ${when}`),
      h("div", { className: "now-title", dir: "auto", textContent: b.task.title }),
      h("p", { className: "now-why", textContent: "Nothing else fits right now, so this is next." }),
      startButton("Start now", `Start ${b.task.title} now, before its slot`, () => begin(b.task)),
      ...cardActions(b.task, []), outLine(r), putOffButton(r));
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
  // Counts only what the engine is really holding back as put off. Pending,
  // Tomorrow, This week and Someday also hide a task for a while (stepAside),
  // but its status or date keeps it out anyway — counting those made the
  // button promise tasks it couldn't bring back, and tapping it showed nothing.
  function putOffButton(r){
    const ids = r.out.filter((o) => o.reason === "skipped").map((o) => o.task.id);
    return ids.length > 0 && h("button", { className: "btn quiet", type: "button", textContent: `Show the ${ids.length} you put off`,
      ariaLabel: `Show the ${ids.length} tasks you put off today`, onclick: () => { skips.drop(ids); setToast(null); render(); } });
  }

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
  const somedaySorted = () => somedayTasks().sort((a, b) => (STAKES_FIRST[a.stakes] ?? 3) - (STAKES_FIRST[b.stakes] ?? 3)
    || String(a.due || "~").localeCompare(String(b.due || "~")) || (a.createdAt || 0) - (b.createdAt || 0));

  // The empty state when nothing is active — every open task is waiting,
  // parked in Someday or dated later (Mor, 2026-10-05: "Nothing fits the next
  // 3 h. Take the break." was wrong there; it isn't about time). Up to 3 from
  // Someday, stakes first; tap to select, then bring them back in one go.
  // "Just rest" closes it for the day, the same as the Someday ask's Not now.
  const QUIET = new Set(["waiting", "someday", "notyet", "stale"]);
  function restState(){
    const list = somedaySorted().slice(0, 3);
    const rested = settings.somedayAsked === localDate();
    const offer = list.length > 0 && !rested;
    sd.sel = sd.sel.filter((id) => list.some((t) => t.id === id));
    const card = h("div", { className: "now-card main hero empty rest" },
      stemDaisy(),
      h("h2", { className: "rest-h", textContent: "Nothing active right now" }),
      h("p", { className: "rest-p", textContent: offer ? "You have time. Want to bring 1–2 back from Someday?"
        : rested ? "Rest it is. Everything else is waiting or set for later."
        : "You have time. Everything else is waiting or set for later." }));
    if (!offer) return [card];
    const n = sd.sel.length;
    const bring = () => {
      const now = Date.now();
      for (const id of sd.sel) restoreTask(uid, id, { status: "ready", notBefore: null, touchedAt: now }).catch(fail);
      sd.sel = [];
      render();
    };
    const rest = () => {
      sd.sel = [];
      settings = { ...settings, somedayAsked: localDate() };
      render();
      saveSettings(uid, { somedayAsked: localDate() }).catch(fail);
    };
    return [card,
      h("h3", { className: "sd-head", textContent: "From Someday" }),
      h("ul", { className: "sd-pick" }, ...list.map((t) => {
        const on = sd.sel.includes(t.id);
        const meta = [areaName(t) || projectShown(t), dur(t.size)].filter(Boolean).join(" · ");
        return h("li", {}, h("button", { type: "button", className: "sd-row" + (on ? " on" : ""), dir: dirOf(t.title),
          ariaPressed: String(on), ariaLabel: `Bring back ${t.title}${MARK[t.stakes] ? ` (${MARK[t.stakes]})` : ""}`,
          onclick: () => { sd.sel = on ? sd.sel.filter((id) => id !== t.id) : [...sd.sel, t.id]; render(); } },
        h("span", { className: "sd-text" },
          h("span", { className: "sd-title", textContent: t.title }),
          h("span", { className: "sd-meta", dir: "ltr" }, MARK[t.stakes] && h("span", { className: "tag", textContent: MARK[t.stakes] }),
            h("span", { textContent: meta }))),
        h("span", { className: "sd-tick", ariaHidden: "true" }, icon(on ? "check" : "plus"))));
      })),
      h("div", { className: "rest-actions" },
        h("button", { className: "btn primary big", type: "button", disabled: !n, onclick: bring,
          textContent: n ? `Bring ${n} back to this week` : "Pick 1–2 to bring back" }),
        h("button", { className: "btn quiet", type: "button", textContent: "Just rest", onclick: rest }))];
  }

  function somedayAsk(){
    const list = somedaySorted();
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

  // Later · Switch · Pending and what each opens, for any card that holds
  // one task — the pick, or a booked task shown early (Mor, 2026-10-05: a
  // booked card with only "Start now" left nowhere to go).
  function cardActions(task, alts){
    const card = { task };
    const someN = somedayTasks().length;
    return [
      h("div", { className: "now-actions trio" },
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
          h("button", { className: "chip", type: "button", textContent: text, onclick: () => later(card.task, w) }))),
    ];
  }

  // Switch's list: the other tasks, or the way into Someday when there are none.
  function altsFor(alts){
    return [
      state.showAlts && energyRow(),
      state.showAlts && !alts.length && h("div", { className: "now-alts", role: "group", ariaLabel: "Other tasks" },
        h("p", { className: "muted" }, "Nothing else is active. ",
          h("button", { className: "linkish", type: "button", textContent: "Pick from Someday?",
            onclick: () => { sd.open = true; state.showAlts = false; render(); } }))),
      state.showAlts && alts.length > 0 && h("div", { className: "now-alts", role: "group", ariaLabel: "Other tasks" }, ...alts.map((s) => h("button", {
        type: "button", className: "now-alt", ariaLabel: `Put ${s.task.title} on the card instead${s.why ? ". " + s.why : ""}`,
        onclick: () => { state.chosen = s.task.id; state.showAlts = false; render(); },
      }, taskCard(s, false)))),
    ];
  }

  // Done today, for the header's daisy: what the snapshot says, plus what was
  // just finished and hasn't come back from Firestore yet.
  function doneCount(){
    const ids = new Set(doneToday(tasks || []).map((t) => t.id));
    for (const id of handoff?.ids || []) ids.add(id);
    return ids.size;
  }
  let reported = null;

  function render(){
    const live = !!run; // paused or not, a run is focus mode
    document.body.classList.toggle("focus", live || !!handoff);
    ctxSlot?.replaceChildren(); // topOf fills it on the day screens only
    const hrs = dayHours(settings);
    if (!isNight(Date.now(), hrs)) nightFree = false;
    const night = !live && !handoff && tasks != null && isNight(Date.now(), hrs) && !nightFree;
    document.documentElement.classList.toggle("night", night);
    const n = doneCount();
    if (n !== reported) { reported = n; onDone?.(n); }

    if (live) { fill(renderFocus()); return; }
    if (handoff) {
      // The task just worked on isn't offered straight back.
      const m = momentInput();
      const r = rank(tasks || [], { ...m, sessionSkips: [...m.sessionSkips, handoff.skip] });
      const cheer = !handoff.cheered; // the petals once, not on every re-render
      handoff.cheered = true;
      fill(handoffView({ title: handoff.title, minutes: handoff.minutes || 0, count: n }, r.pick, {
        cheer,
        onStart: begin,
        onSkip: (task) => { if (task) skips.add(task.id); handoff = null; showing(null); render(); },
      }));
      if (cheer) navigator.vibrate?.(15);
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
      // Too many passed dates: one quiet line, at most once a day.
      tasks && shouldOffer(tasks, Date.now(), settings) && h("p", { className: "muted offer" },
        `${sweepList(tasks).length} old dates are piling up.`,
        h("button", { className: "linkish", type: "button", textContent: "Sort them (2 min)", onclick: () => onSweep?.() }),
        h("button", { className: "linkish", type: "button", textContent: "Not today",
          onclick: () => { settings = { ...settings, sweepAnswered: localDate() }; render(); saveSettings(uid, { sweepAnswered: localDate() }).catch(fail); } })));

    const head = night ? [greet] : [topOf(fw), greet];
    if (tasks == null) { fill(...head, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }

    if (night) { fill(...head, ...nightView(hrs), toast && toastView()); return; }
    if (located === "ride") head.push(rideAsk());

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
    // Driving with no call to make: the driving card, not "nothing fits".
    if (!card && feel().place.value === "car") { fill(...head, drivingCard(), toast && toastView()); return; }
    const block = blockOf(fw);
    if (!card && block) {
      fill(...head, h("div", { className: "now-card main hero empty" },
        h("p", { className: "now-empty" }, "Nothing in ", bdi(block.project), " fits right now."),
        h("button", { className: "btn quiet", type: "button", textContent: "I'm free now",
          ariaLabel: `I'm free now: ignore the ${block.project} block and pick any task`,
          onclick: () => { freeFrom = block.start; render(); } })), tip);
      return;
    }
    if (!card && fw?.current) { fill(...head, meetingCard(fw.current), tip); return; }
    const bk = !card && r.out.filter((o) => o.reason === "booked").map((o) => ({ task: o.task, ...booked().get(o.task.id) }))
      .filter((b) => b.start).sort((a, b) => a.start - b.start)[0];
    if (bk) { fill(...head, bookedCard(bk, r), ...altsFor([]), tip); return; }
    // Nothing active at all: everything open is waiting, in Someday or dated
    // later. Its own calm card, with Someday right there (restState).
    if (!card && r.out.length && r.out.every((o) => QUIET.has(o.reason))) {
      fill(...head, ...restState(), toast && toastView());
      return;
    }
    if (!card) {
      fill(...head, h("div", { className: "now-card main hero empty" },
        h("p", { className: "now-empty", textContent: r.empty === "none"
          ? "No tasks yet. Add a few and Daisey will pick."
          : `Nothing fits the next ${dur(r.moment.window)}. Take the break.` }),
        r.empty === "nofit" && outLine(r), putOffButton(r)), tip);
      return;
    }

    if (card === r.pick && r.pick.batch && !state.chosen && !state.single) { fill(...head, batchCard(r, r.pick.batch), tip); return; }
    const alts = r.ranked.length > 1 ? [r.pick, ...r.alternatives].filter((s) => s !== card).slice(0, 3) : [];
    // The next piece: the one after this card in the engine's order, round
    // again at the end, so tapping through visits every alternative.
    const order = [r.pick, ...r.alternatives].filter(Boolean);
    const next = alts.length ? order[(order.indexOf(card) + 1) % order.length] ?? alts[0] : null;
    // Start is the one loud thing on the tab; the other two stay quiet under it.
    fill(...head, deck(taskCard(card, true,
      startButton("Start", `Start: ${card.task.title}`, () => begin(card.task)),
      ...cardActions(card.task, alts)), next !== card && next, asking()),
      ...altsFor(alts), tip);
    // One slide-in per step-aside: later snapshots must not replay it.
    if (slideIn) { slideIn = false; if (motionOK()) root.querySelector(".now-card.main")?.classList.add("in"); }
  }

  // Learning asks one thing at a time, as a single line under the card, never
  // a form (DAISEY_SPEC "Learning"): make it smaller after two stops, and
  // keep, shrink or drop after five skips. Each answer also clears the reason
  // for asking, so it doesn't come back.
  const asked = new Set();
  function learnAsk(r){
    // (The "Stopped twice — make it smaller?" ask is gone, Mor 2026-10-05.)
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

  // Focus mode hands back the same node every second (focus.js); an
  // unchanged screen is left be rather than taken out and put back.
  const fill = (...kids) => {
    kids = kids.filter(Boolean);
    if (kids.length === root.children.length && kids.every((k, i) => root.children[i] === k)) return;
    root.replaceChildren(...kids);
  };
  const fail = (e) => console.error("[daisey] now", e);
  const unsubs = [
    watchWhere((v) => { located = v; render(); }),
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
    for (const [sel, text] of [[".clock-time", clock(Date.now())], [".clock-date", dayText()]]) {
      const el = ctxSlot?.querySelector(sel);
      if (el && el.textContent !== text) el.textContent = text;
    }
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
    unmount(){ showing(null); ctxSlot?.replaceChildren(); clearTimeout(toastTimer); document.body.classList.remove("focus"); document.documentElement.classList.remove("night"); unsubs.forEach((u) => u()); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
