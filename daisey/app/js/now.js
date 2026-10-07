// The top of the home screen (layout round 3, Mor 2026-10-06; New Design/
// 6-home-schedule-tab): the compact Now card — one task that fits this
// moment, and why. The day itself is the panel's Schedule page
// (schedule.js); Needs you is the header's amber chip, counted here.
// Daisey picks one task at a time; it never lays out the day.
//
// Free time comes only from the calendar — Daisey never asks for it (Mor,
// 2026-10-03). It's the time until the next busy event (calendar.js, read
// through old Daisey's Google token). With no calendar the engine's default
// 60 min only filters what fits and scores nothing.
// Not now → next pick (hidden for this page load). Something else → 2–3
// alternatives, tap one to make it the card. Start → focus mode (focus.js):
// the run lives in Firestore, so this tab, a reload and the phone all show
// the same timer.
import { overruled, eventKey } from "./reality.js";
import * as deep from "./deep.js";
import { addTask, watchTasks, watchRun, watchSkips, saveSkips, startRun, extendRun, endRun, startBatch, tickBatch, endBatch, skipNow, blockTask, restoreTask, finishTask, watchSettings, saveSettings, watchMoment, saveMoment, watchLearn, bumpLearn, saveRun, cancelRun, watchDayPlan, saveDayPlan, holdTask, releaseTask } from "./store.js";
import { proposeDay, timeline, nextPlanned, planProgress } from "./proposal.js";
import { rethink } from "./rethink.js";
import { placeNow, workBase } from "./context.js";
import { watchWhere, setRide, setStill, saveSpot, setManual, placeAsk, notHomeHere, quietHere, reservedName } from "./where.js";
import { pickWeekDay } from "./triage.js";
import { focusView, handoffView, elapsedMinutes, targetMinutes, batchFocusView, batchName, sinceMark, paused, resumed, runCap, bookedMinutes, holdButton, stillOnMinutes, burst } from "./focus.js";
import { watchCalendar, logDone } from "./calendar.js";
import { LATER_MINUTES, DRAIN, CANCEL_KEEP_MINUTES } from "./weights.js";
import { rank, freeWindow, timeBucket, matchProject, dueAt } from "./engine.js";
import { leftMinutes, toMinutes, progressOf, progressPatch, localDate, skipSnapshot, skipLesson, pendingCheck, notYet, pushedTo, bringBack, againInput } from "./model.js";
import { waitingFor, personOf } from "./nudge.js";
import { dayHours, isNight, nextMorning, dayEndAt, bookings, sameTitle, minText, gapsToday } from "./day.js";
import { collectNeeds } from "./needs.js";
import { h, icon, bdi, pieces, sizeText, sizeChip, progressBar, dur, say, nightDivider, flash, askProgress } from "./ui.js";
import { areaClass, areaName, projectShown, doneToday, dirOf, stemDaisy, moonDaisy, watchProjectColors } from "./look.js";

const LATER_MS = LATER_MINUTES * 60000;
const UNDO_MS = 5000;
const SLIDE_MS = 140; // matches the card-out animation in app.css
const motionOK = () => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// onCard(id | null) fires whenever the task on the card changes (the project
// screen marks it NOW). onProject(name)
// opens that project's screen. onOpen(task) opens the task sheet — the
// card's title is the way in. onEvent(ev): an event's details. name: the first name for the night screen. onDone(n):
// how many tasks are done today, for the header's chip. onNeedsCount(n):
// how many decisions Needs you holds, for the amber chip.
export function mountNow(root, uid, { onCard, onProject, onOpen, onEvent, name = "", onDone, onNeedsCount, onPlanProgress, guest = false } = {}){
  let tasks = null; // null until the first snapshot
  let settings = {}; // state/settings: when the sweep was last offered
  let momentDoc = {}; // state/moment: place corrections
  let learnStats = {}; // state/learn: starts and skips per type and time of day
  let located = null; // "home" | "out" from the phone's location (where.js), null = unknown
  let cal = { status: "loading", events: [] };
  let lastWindow, lastClock;
  let run = null; // the state/now doc while a task is running
  let handoff = null; // { title, next } after Done, until the next choice
  // The day's proposed schedule (proposal.js). dayPlan: today's saved doc
  // (state/dayplan). prop: the proposal on the card while it's open — items
  // in the user's order, the ids they deleted, the Rethink box.
  let dayPlan, planKnown = false;
  const prop = { open: false, items: [], exclude: [], ask: false, text: "", busy: false, note: "", auto: null };
  let holdAsk = false, holdText = ""; // "Waiting for reply" on the running card
  let placeNaming = false, placeName = ""; // "Name this place?" (placeAskView)
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
  let toast = null; // { text, task, before } for 5 s after Later or Pending
  let slideIn = false; // one slide per step-aside, not one per snapshot
  let toastTimer = null;
  // laterAsk: Later was tapped and the card is asking "when?"
  // pendAsk: Pending was tapped and the card asks what it's waiting on.
  const state = { chosen: null, showAlts: false, asking: false, laterAsk: false, pendAsk: false, notNow: false };
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
  const reset = () => { state.chosen = null; state.showAlts = false; state.laterAsk = false; state.pendAsk = false; state.notNow = false; state.pendText = ""; state.pendCheck = ""; state.single = false; };
  let shown;
  const showing = (id) => { if (id !== shown) { shown = id; onCard?.(id); } };

  // The card Daisey is proposing says its reasons in the first person; the
  // alternatives keep the plain why line, so only one voice is speaking.
  // Names in the why line (projects, people, events) are their own <bdi>.
  // On the main card the title is a button: it opens the task sheet (Mor,
  // 2026-10-05: no pencil). The why line is one plain sentence (the reason
  // tags went with round 2).
  function taskCard(s, main, ...extra){
    const why = sentence(s.whyParts);
    const t = s.task;
    // The why line fits the time LEFT (engine leftMinutes), so the chip says it
    // too once some is done/spent: "30 min" beside "fills your free 23 min"
    // read as a contradiction (Mor, 2026-10-07). Plus the % and a bar.
    const sizeLbl = sizeChip(t);
    return h("div", { className: "now-card" + (main ? " main hero" : "") + areaClass(t) },
      main ? heroTop(t, sizeLbl)
        : h("div", { className: "now-meta" }, ...pieces(t.project, sizeLbl)),
      main && onOpen ? titleButton(t) : h("div", { className: "now-title", dir: "auto", textContent: t.title }),
      t.nextStep && h("p", { className: "now-next" }, "Next: ", bdi(t.nextStep)),
      why && h("p", { className: "now-why" }, ...say(why)),
      progressBar(t),
      ...extra);
  }
  const titleButton = (t) => h("button", { type: "button", className: "now-title", dir: "auto", textContent: t.title,
    ariaLabel: `Open ${t.title}`, onclick: () => onOpen(t) });

  // The hero's top row, on ONE line: area dot, "Area · project" in the
  // area's colour, and on the far side the size (or whatever the card says
  // there). The project name opens its project screen.
  function heroTop(t, side){
    const area = areaName(t);
    const proj = projectShown(t) && h("button", { type: "button", className: "now-proj",
      title: `Open ${t.project}`, onclick: () => onProject?.(t.project) }, bdi(t.project));
    return h("div", { className: "hero-top" },
      h("span", { className: "hero-area" }, h("span", { className: "dot", ariaHidden: "true" }),
        h("span", { className: "hero-where" }, area, area && proj ? " · " : "", proj || (area ? "" : "Inbox"))),
      side && h("span", { className: "hero-side", textContent: side }));
  }

  // The card. Swipe it away and the engine's next real pick slides in. (The
  // Tetris NEXT peek beside it gave its place to the day, Mor 2026-10-05.)
  // The card breathes while nothing is asked of it (CSS; off under reduced
  // motion).
  function deck(card, next, still){
    const el = h("div", { className: `deck${still ? " still" : ""}` }, card);
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
    if (el && motionOK()) { el.classList.add("out"); setTimeout(go, SLIDE_MS); } else go();
  }
  const asking = () => state.notNow || state.pendAsk || state.showAlts;

  // The one loud button: amber, with a play icon.
  const startButton = (text, aria, onclick) => h("button", { className: "btn primary start", type: "button", ariaLabel: aria, onclick },
    icon("play"), h("span", { textContent: text }));

  // The engine's pieces as a plain sentence: capital first, full stop last.
  function sentence(parts){
    if (!parts?.length) return null;
    const [first, ...rest] = parts;
    return [typeof first === "string" ? first[0].toUpperCase() + first.slice(1) : first, ...rest, "."];
  }

  // Place right now: the user's correction for 3 hours, else the phone,
  // else the calendar (context.js).
  function feel(){
    const events = cal.status === "ok" ? cal.events : [];
    return {
      place: placeNow({ correction: momentDoc.place, located, events }),
    };
  }

  // Above the card, only inside a project block or a booked slot: one quiet
  // line saying so, with "I'm free now" (Mor, 2026-10-05: always one tap
  // away inside an event). No greeting since round 3; a meeting's own card
  // says the rest.
  function freeNow(start, title){
    return h("button", { className: "linkish free-now", type: "button", textContent: "I'm free now",
      ariaLabel: `I'm free now: ignore ${title} and pick any task`, onclick: () => { freeFrom = start; render(); } });
  }
  function topOf(fw){
    const block = blockOf(fw);
    return h("div", { className: "now-top" },
      block && h("p", { className: "freeline" },
        ...(block.taskId ? [`Booked until ${clock(block.end)}`] : ["Working on ", bdi(block.project), ` until ${clock(block.end)}`]),
        " · ", freeNow(block.start, block.title || block.project)));
  }

  // A ride the phone can't name (speed says train, bus or car alike): ask
  // once; the answer holds for the rest of the ride (where.js RIDE_MS).
  // "Not moving" is for when the phone got it wrong.
  function rideAsk(){
    const pick = (mode, text) => h("button", { type: "button", className: "chip", textContent: text, onclick: () => setRide(mode) });
    return h("div", { className: "ride-ask", role: "group", ariaLabel: "How are you travelling?" },
      h("span", { className: "muted", textContent: "On a" }),
      pick("train", "Train"), pick("bus", "Bus"), pick("car", "Driving"),
      h("button", { type: "button", className: "chip", textContent: "Not moving", onclick: () => setStill() }));
  }

  // Places are learned by asking, not in Settings (Mor, 2026-10-07: "no one
  // will ever do that intentionally"). where.js placeAsk decides when: no Home
  // yet → "Are you home?"; a spot you keep coming back to → "Name it?".
  // Each spot is asked once; "Not now" silences it for good.
  function placeAskView(kind){
    const chip = (text, onclick, cls = "chip") => h("button", { type: "button", className: cls, textContent: text, onclick });
    const failed = () => flash("Couldn't get your location. Allow it for this site and try again.");
    if (kind === "home") return h("div", { className: "ride-ask", role: "group", ariaLabel: "Are you home?" },
      h("span", { className: "muted", textContent: "Are you home right now?" }),
      chip("Yes", async () => { if (!await saveSpot("Home")) failed(); }),
      chip("No", () => notHomeHere()));
    const save = async () => {
      const n = placeName.trim();
      if (!n) return;
      if (reservedName(n)) { flash(`"${n}" is taken. Pick another name.`); return; }
      placeNaming = false; placeName = "";
      if (await saveSpot(n)) flash(`Saved. I'll know when you're at ${n}.`); else failed();
      render();
    };
    if (!placeNaming) return h("div", { className: "ride-ask", role: "group", ariaLabel: "Name this place?" },
      h("span", { className: "muted", textContent: "You're here a lot. Name this place?" }),
      chip("Name it", () => { placeNaming = true; render(); }),
      chip("Not now", () => quietHere()));
    const input = h("input", { id: "placeHere", dir: "auto", autocomplete: "off", enterkeyhint: "done", value: placeName,
      placeholder: "Work, Studio, Gym…", oninput: (e) => { placeName = e.target.value; } });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
    setTimeout(() => { if (input.isConnected && document.activeElement !== input) input.focus(); });
    return h("div", { className: "pend-ask" },
      h("label", { htmlFor: "placeHere", textContent: "What's this place? Tasks that mention it come first here." }),
      h("div", { className: "pend-row" }, input, chip("Save", save, "btn primary small"),
        chip("Cancel", () => { placeNaming = false; placeName = ""; render(); }, "btn quiet small")));
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
      // With someone a Pending task waits on: worth raising while you're there.
      ...waitingFor(ev.title, tasks || []).slice(0, 3).map((t) => h("p", { className: "now-wait" },
        `Waiting on ${personOf(t.waitingOn)}: `, bdi(t.title))),
      h("button", { className: "btn quiet free-now", type: "button", textContent: "I'm free now",
        ariaLabel: `I'm free now: ignore ${ev.title} and pick a task anyway`,
        onclick: () => { freeFrom = ev.start; render(); } }));
  }

  // Focus mode and the handoff own the whole screen (body.focus hides the
  // header, the panel and the Tell pill).
  // A batch: a checklist in focus mode. The last tick ends it and hands off
  // like Done; Stop leaves the unticked ones open with their share of the time.
  // A finished task goes into Google Calendar's "Daisey log" as a lookback,
  // unless turned off in the account menu. Under a minute isn't worth a
  // block. A failure is only logged: the task is done either way.
  const logFinished = (title, minutes, taskId, planned, end) => {
    if (settings.logDone === false || minutes < 1) return;
    const note = `Done with Daisey: ${dur(Math.round(minutes))}${planned ? ` (planned ${dur(planned)})` : ""}.`;
    logDone({ title, minutes, taskId, note, ...(end ? { end } : {}) }).catch((e) => console.error("[daisey] log to calendar", e));
  };

  function renderBatch(){
    const byId = new Map((tasks || []).map((t) => [t.id, t]));
    const list = run.batch.map((id) => byId.get(id)).filter(Boolean);
    const type = list[0]?.type;
    showing(run.taskId);
    return batchFocusView(run, list, type, {
      onTick: (t) => {
        const prev = run, minutes = Math.min(sinceMark(run), runCap(t.size));
        const done = [...(run.done || []), t.id];
        const last = list.every((x) => done.includes(x.id));
        if (last) {
          const total = Math.min(elapsedMinutes(prev), runCap(list.reduce((s, x) => s + (x.size || 0), 0) + (prev.extra || 0)));
          handoff = { title: batchName(type, list.length), skip: prev.taskId, minutes: total, ids: [...prev.batch] };
          tickBatch(uid, prev, t, minutes).then(() => endBatch(uid, [], 0)).catch(fail);
          logFinished(`${batchName(type, list.length)}: ${list.map((x) => x.title).join(", ")}`, total, prev.taskId,
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
      const m = Math.min(sinceMark(prev), runCap(left.reduce((s, t) => s + (t.size || 0), 0)));
      (m >= CANCEL_KEEP_MINUTES && left.length ? endBatch(uid, left, m) : cancelRun(uid)).catch(fail);
      return;
    }
    const task = tasks?.find((t) => t.id === prev.taskId) || null;
    const m = bookedMinutes(prev, task);
    cancelRun(uid, task, m >= CANCEL_KEEP_MINUTES ? m : 0).catch(fail);
  };

  // Done on a running task, from Deep Focus or the dashboard card.
  const finishRun = (task, minutes, end) => {
    if (!run) return; // the hold finished after the run moved on
    if (!task) return finishRunNow(task, minutes, end);
    // How much got done? Under 100% the minutes are kept, the task stays
    // open and goes back on the list for the day the user names.
    askProgress(task, {
      start: progressOf(task) || 50,
      onFull: () => finishRunNow(task, minutes, end),
      onPartial: (pct, when) => {
        if (!run) return;
        cancelRun(uid, task, minutes).catch(fail);
        run = null; render();
        later(task, when, progressPatch(pct));
      },
    });
  };
  const finishRunNow = (task, minutes, end) => {
    if (!run) return;
    handoff = { title: task ? task.title : "", skip: run.taskId, minutes, ids: [run.taskId] };
    endRun(uid, task, minutes, { finished: true }).catch(fail);
    if (task) logFinished(task.title, minutes, task.id, targetMinutes(run, task), end);
    run = null; render();
  };
  // Deep Focus is the whole screen (master spec s.20): a run in "focus" mode, a
  // batch, or one from before modes existed. "inline" keeps the dashboard.
  const focusing = () => !!run && (!!run.batch || run.mode == null || run.mode === "focus");
  const runKey = () => `${run.taskId}@${run.startedAt}`;
  // Into Deep Focus on a task that's already running (or out of it, to the dashboard).
  const setMode = (mode) => { const doc = { ...run, mode }; run = doc; if (mode === "focus") deep.enter(runKey()); render(); saveRun(uid, doc).catch(fail); };

  function renderFocus(){
    if (run.batch) return renderBatch();
    const task = tasks?.find((t) => t.id === run.taskId) || null;
    const finish = (minutes, end) => finishRun(task, minutes, end);
    showing(run.taskId);
    return focusView(run, task, {
      // Done is finished — no "or more left?" (Pause covers more left).
      onDone: () => finish(bookedMinutes(run, task)), // capped: a forgotten timer doesn't book the night
      // Forgot to hit Done: the minutes the user says it took, logged as
      // ending that long after the start rather than now.
      onFinishedAfter: (m) => finish(Math.min(m, elapsedMinutes(run)), run.startedAt + m * 60000),
      onExtend: (m) => { const prev = run; run = { ...run, extra: (run.extra || 0) + m }; render(); extendRun(uid, prev, m).catch(fail); },
      onPause: pause,
      onResume: resume,
      onStop: () => endSession(),
      onBack: () => setMode("inline"),
      onWait: () => { holdAsk = true; setMode("inline"); },
      // Pending from focus mode: stop, and the card, back on this task, asks
      // what it's waiting on.
      onPending: () => { const id = run.taskId; endSession({ quiet: true }); reset(); state.chosen = id; state.pendAsk = true; render(); },
    });
  }

  // mode "inline": Start, the dashboard stays. "focus": Deep Focus, the whole
  // screen (call it from a tap: full screen needs one, deep.js).
  const begin = (task, mode = "inline") => {
    bumpLearn(uid, task.type, timeBucket().part, "starts").catch(fail); handoff = null; reset();
    prop.open = false; holdAsk = false;
    run = { taskId: task.id, startedAt: Date.now(), extra: 0, mode };
    if (mode === "focus") deep.enter(runKey());
    render(); startRun(uid, task, mode).catch(fail);
  };

  const beginBatch = (list) => {
    bumpLearn(uid, list[0].type, timeBucket().part, "starts").catch(fail);
    handoff = null; reset();
    const now = Date.now();
    run = { taskId: list[0].id, batch: list.map((t) => t.id), done: [], mark: now, startedAt: now, extra: 0 };
    deep.enter(runKey());
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
  function stepAside(task, { label, write, lesson = false }){
    const before = skipSnapshot(task);
    const go = () => {
      skips.add(task.id);
      reset();
      slideIn = true;
      setToast({ task, before, label, lesson });
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
  function later(task, when, extra = null){
    if (when === "today") {
      stepAside(task, { label: `Later (${dur(LATER_MINUTES)}): `, lesson: true, write: () => Promise.all([skipNow(uid, task), declined(task), extra ? restoreTask(uid, task.id, extra) : null]) });
    } else if (when === "tomorrow") {
      const d = new Date(); d.setDate(d.getDate() + 1);
      let day = localDate(d.getTime());
      if (task.dateKind === "deadline" && task.due && task.due < day) day = task.due; // never hide it past its deadline
      stepAside(task, { label: "Tomorrow: ", lesson: true, write: () => Promise.all([restoreTask(uid, task.id, { ...pushedTo(task, { notBefore: day }), ...extra }), declined(task)]) });
    } else if (when === "week") {
      let day = pickWeekDay(task, { events: cal.status === "ok" ? cal.events : [], tasks: tasks || [], hours: dayHours(settings) });
      if (task.dateKind === "deadline" && task.due && task.due < day) day = task.due; // never hide it past its deadline
      const label = new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      stepAside(task, { label: `This week (${label}): `, lesson: true, write: () => Promise.all([restoreTask(uid, task.id, { ...pushedTo(task, { notBefore: day }), ...extra }), declined(task)]) });
    } else if (when === "someday") {
      stepAside(task, { label: "Not now: ", lesson: true, write: () => Promise.all([restoreTask(uid, task.id, { status: "someday", touchedAt: Date.now(), ...extra }), declined(task)]) });
    }
  }
  // Pending asks what it's waiting on (Mor, 2026-10-04); the reason is
  // optional and lands in the task's "Waiting on".
  // The check date (Mor, 2026-10-05): when Needs you asks "still pending?";
  // PENDING_CHECK_DAYS on (or the day before a deadline) unless changed here.
  const pending = (task, why = "", checkOn = "") => stepAside(task, { label: "Pending: ", write: () => blockTask(uid, task, why, checkOn) });

  function pendingAsk(task){
    // The card redraws on every snapshot and each minute; what's typed lives
    // in state so a redraw doesn't wipe it.
    const input = h("input", { id: "pendWhy", dir: "auto", autocomplete: "off", value: state.pendText || "",
      oninput: (e) => { state.pendText = e.target.value; } });
    const check = h("input", { id: "pendCheck", type: "date", value: state.pendCheck || pendingCheck(task), min: localDate(),
      oninput: (e) => { state.pendCheck = e.target.value; } });
    const go = () => { const why = input.value; state.pendText = ""; state.pendCheck = ""; pending(task, why, check.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    const box = h("div", { className: "pend-ask" },
      h("label", { htmlFor: "pendWhy", textContent: "Waiting on what? (optional)" }),
      h("div", { className: "pend-row" }, input,
        h("button", { className: "btn primary small", type: "button", textContent: "Set pending", onclick: go })),
      h("div", { className: "pend-check" }, h("label", { htmlFor: "pendCheck", textContent: "Ask me again" }), check));
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

  // The one optional tap after a skip: why. It fixes the field that was
  // wrong (model.skipLesson) instead of asking for it when the task was added.
  function teach(reason){
    if (!toast || toast.taught) return;
    const task = (tasks || []).find((t) => t.id === toast.task.id) || toast.task;
    toast.taught = reason;
    restoreTask(uid, task.id, skipLesson(task, reason, { place: feel().place.value })).catch(fail);
    render();
  }

  function toastView(){
    const { task } = toast;
    const why = (reason, text, aria) => h("button", { className: "toast-why", type: "button", textContent: text, ariaLabel: aria, onclick: () => teach(reason) });
    return h("div", { className: "toast", role: "status" },
      h("div", { className: "toast-row" },
        h("span", { className: "toast-text" }, toast.label, bdi(task.title)),
        h("button", { className: "toast-undo", type: "button", textContent: "Undo",
          ariaLabel: `Undo: put ${task.title} back on the card`, onclick: undo })),
      toast.lesson && (toast.taught
        ? h("div", { className: "toast-why-row" }, h("span", { className: "toast-thanks", textContent: "Got it" }))
        : h("div", { className: "toast-why-row", role: "group", ariaLabel: "Why? (optional)" },
          why("toobig", "Too big", "Too big: offer it in pieces"),
          why("nothere", "Not here", "Not here: don't offer it where I am now"))));
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
  // ("I'm free now"), or one reality overruled (reality.js: you started or
  // logged work during it), doesn't count as busy.
  // Free time ends with the day hours (DAISEY_SPEC "Day hours"); after "I'm
  // free now" at night, only the next event bounds it.
  function calendarNow(){
    if (cal.status !== "ok") return null;
    const busy = cal.events.filter((e) => e.busy !== false && !e.allDay);
    const now = Date.now(), hrs = dayHours(settings);
    const over = overruled(busy, { tasks: tasks || [], run, now });
    const events = busy.filter((e) => Date.parse(e.start) !== freeFrom && !over.has(eventKey(e)));
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
    : fw?.window}|${saidFree() ?? ""}|${isNight(Date.now(), dayHours(settings))}`;

  // Booked tasks right now, id → { start, end, title } (day.js).
  const booked = () => (cal.status === "ok" ? bookings(tasks || [], cal.events) : new Map());

  // "I have 30 minutes" (Tell Daisey, moment.free): the user's own word for
  // how long they have, counting down from when they said it. It only ever
  // shortens the window — the calendar can still say less.
  const saidFree = (now = Date.now()) => {
    const f = momentDoc.free;
    const left = f && Number.isFinite(f.minutes) ? Math.floor(f.minutes - (now - f.at) / 60000) : 0;
    return left > 0 ? left : null;
  };
  function momentInput(fw = calendarNow()){
    const now = Date.now();
    const said = saidFree(now);
    const f = feel();
    const block = blockOf(fw);
    return {
      ...(!fw ? { realWindow: false }
        : block ? { window: Math.floor((block.end - now) / 60000), blockProject: block.project }
        : { window: fw.window, nextEvent: fw.next?.title ?? null }),
      ...(said ? { window: Math.min(said, !fw ? 60 : block ? Math.floor((block.end - now) / 60000) : fw.window), realWindow: true } : {}),
      ...workBase(tasks || [], now),
      sessionSkips: hidden(now),
      skipsToday: skipCounts(),
      place: f.place.value,
      spot: f.place.spot,
      learnStats,
      booked: Object.fromEntries([...booked()].map(([id, b]) => [id, b.start])),
    };
  }

  // Night mode (DAISEY_SPEC "Day hours"): outside the day hours the card
  // doesn't push work. It names the first pick for the morning — the engine
  // run for the start of the day, with its window and booked
  // slots — and has no Start. "I'm free now" plans as if it were day.
  // The whole screen goes dark for it (.night on <html>), whatever the theme:
  // a dimmed daisy under a moon, a few stars, tomorrow's first calendar block
  // and then that first pick.
  function nightView(hrs){
    const now = Date.now(), morning = nextMorning(now, hrs);
    const evs = cal.status === "ok" ? cal.events.filter((e) => e.busy !== false && !e.allDay) : [];
    const fw = cal.status === "ok" ? freeWindow(evs, morning, dayEndAt(morning, hrs)) : null;
    // Before the day starts it's still "tonight" until 04:00; after that the
    // morning's plan is today's, not tomorrow's.
    const early = new Date(now).getHours() >= 4 && localDate(morning) === localDate(now);
    // A real deadline that's today and still open (2026-10-06): the night
    // screen said "Nothing needs you tonight" over it, and by morning it read
    // "deadline passed". It gets named, with a Start — the one thing night
    // mode lets through.
    const today = localDate(now);
    const dueTonight = early ? [] : (tasks || []).filter((t) => t.status === "ready" && t.dateKind === "deadline"
      && t.due === today && !notYet(t, now) && !(t.dueTime && now >= dueAt(t)));
    // Already named under "Due today" — don't offer it again as tomorrow's pick.
    const dueIds = new Set(dueTonight.map((t) => t.id));
    const r = rank((tasks || []).filter((t) => !dueIds.has(t.id)), {
      now: morning,
      ...(!fw ? { realWindow: false } : { window: fw.current ? 60 : fw.window, nextEvent: fw.next?.title ?? null }),
      ...workBase(tasks || [], now),
      place: "home",
      learnStats,
      booked: Object.fromEntries([...booked()].map(([id, b]) => [id, b.start])),
    });
    const p = r.pick;
    const day = localDate(morning);
    const first = evs.filter((e) => localDate(Date.parse(e.start)) === day)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    const who = name ? `, ${name}` : "";
    const lead = dueTonight.length === 1 ? "One deadline is still open today." : `${dueTonight.length} deadlines are still open today.`;
    return [
      h("div", { className: "stars", ariaHidden: "true" }, ...[0, 1, 2, 3].map(() => h("span"))),
      h("div", { className: "night-hero" }, moonDaisy(),
        h("h2", { className: "night-h", textContent: early ? `Early${who}.` : `Late${who}.` }),
        h("p", { className: "night-p", textContent: early ? "Nothing needs you yet. Here's your day."
          : dueTonight.length ? lead : "Nothing needs you tonight. Here's tomorrow." })),
      // Both cards wear the main card's design (Mor, 2026-10-07): hero top row,
      // big title, why line, the same actions. The label is the eyebrow above.
      dueTonight.length > 0 && h("section", { className: "now-card main hero night" + areaClass(dueTonight[0]), ariaLabel: "Due today" },
        h("div", { className: "night-label", textContent: "Due today" }),
        heroTop(dueTonight[0], dueTonight[0].dueTime ? `Due ${dueTonight[0].dueTime}` : "Today"),
        onOpen ? titleButton(dueTonight[0]) : h("div", { className: "now-title", dir: "auto", textContent: dueTonight[0].title }),
        h("p", { className: "now-why", textContent: dur(Math.max(5, (dueTonight[0].size || 0) - (dueTonight[0].spentMinutes || 0))) + " left" }),
        dueTonight.length > 1 && h("p", { className: "now-why", textContent: "Also due: " + dueTonight.slice(1).map((t) => t.title).join(", ") }),
        ...cardActions(dueTonight[0], [], startButton("Start", `Start: ${dueTonight[0].title}`, () => begin(dueTonight[0])))),
      h("section", { className: "now-card main hero night" + (p ? areaClass(p.task) : ""), ariaLabel: early ? "First today" : "Tomorrow first" },
        h("div", { className: "night-label", textContent: early ? "First today" : "Tomorrow first" }),
        ...(p ? [
          heroTop(p.task, [dur(p.task.size), MARK[p.task.stakes]].filter(Boolean).join(" · ")),
          onOpen ? titleButton(p.task) : h("div", { className: "now-title", dir: "auto", textContent: p.task.title }),
          h("p", { className: "now-why", textContent: first
            ? `${minText(hrs.start)}, after ${first.title} (${clock(Date.parse(first.start))}–${clock(Date.parse(first.end))})`
            : `Starts ${minText(hrs.start)}` }),
        ] : [
          first && h("p", { className: "now-why", textContent: `${clock(Date.parse(first.start))}–${clock(Date.parse(first.end))} ${first.title}` }),
          h("p", { className: "now-empty", textContent: "Nothing lined up yet." }),
        ])),
      h("div", { className: "night-foot" },
        h("button", { className: "pill-btn", type: "button", textContent: "I'm free now, show me something",
          ariaLabel: "I'm free now: pick a task anyway", onclick: () => { nightFree = true; render(); } }),
        nightDivider(minText(hrs.end), minText(hrs.start))),
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
      onOpen ? titleButton(b.task) : h("div", { className: "now-title", dir: "auto", textContent: b.task.title }),
      h("p", { className: "now-why", textContent: "Nothing else fits right now, so this is next." }),
      ...cardActions(b.task, [], startButton("Start now", `Start ${b.task.title} now, before its slot`, () => begin(b.task))), outLine(r), putOffButton(r));
  }

  // Nothing fits before the next calendar event: the event is the card —
  // when it starts, how long until then — and it opens like any event.
  // ev: freeWindow's next (start/end already epoch ms).
  function upcomingCard(ev, r){
    const mins = Math.max(0, Math.round((ev.start - Date.now()) / 60000));
    return h("div", { className: "now-card main hero empty upcoming" },
      h("div", { className: "now-meta", textContent: `Coming up · ${clock(ev.start)}` }),
      onEvent ? h("button", { type: "button", className: "now-title", dir: "auto", textContent: ev.title, ariaLabel: `Open ${ev.title}`, onclick: () => onEvent({ ...ev, start: new Date(ev.start).toISOString(), end: new Date(ev.end).toISOString() }) })
        : h("div", { className: "now-title", dir: "auto", textContent: ev.title }),
      h("p", { className: "now-why", textContent: mins ? `In ${dur(mins)}. Nothing else fits before it.` : "Starting now." }),
      outLine(r), putOffButton(r));
  }

  // Why the open tasks can't come up now, counted: "Out right now: 3 put
  // off today · 2 need offices open." Parked, waiting and future-dated tasks
  // aren't news, so they aren't counted.
  const OUT_SAID = {
    skipped: "put off today", office: "need offices open", place: "can't be done where you are",
    size: "too long for the time you have", evening: "are for the evening", block: "belong to another project", booked: "booked later",
  };
  function outLine(r){
    const n = {};
    for (const o of r.out) if (OUT_SAID[o.reason]) n[o.reason] = (n[o.reason] || 0) + 1;
    delete n.booked; // the card itself is the booked one
    const parts = Object.entries(n).map(([k, c]) => `${c} ${OUT_SAID[k]}`);
    if (!parts.length) return null;
    const line = h("p", { className: "muted now-out", textContent: `Out right now: ${parts.join(" · ")}.` });
    return n.place ? h("div", {}, line, placeFix(r.moment)) : line;
  }
  // The place guess was invisible, so a wrong one just read as "nothing
  // fits" (Mor, 2026-10-06: a free day at home, no tasks). Say where Daisey
  // thinks you are, and fix it in one tap. "I'm home" re-saves Home right
  // here: if it's being asked, the saved Home is off or missing.
  const PLACE_SAID = { out: "out", walk: "walking", ride: "on the move", train: "on a train", bus: "on a bus", car: "driving" };
  function placeFix(m){
    const where = m.place === "spot" ? `at ${m.spot}` : PLACE_SAID[m.place] || m.place;
    const chip = (text, onclick) => h("button", { type: "button", className: "chip", textContent: text, onclick });
    const moving = ["walk", "ride", "train", "bus", "car"].includes(m.place);
    return h("div", { className: "ride-ask place-fix", role: "group", ariaLabel: "Where are you?" },
      h("span", { className: "muted" }, "You seem to be ", bdi(where), "."),
      chip("I'm home", async () => {
        if (await saveSpot("Home")) setManual("home"); // and hold it, so the next noisy read can't flip it straight back
        else flash("Couldn't get your location. Allow it for this site and try again.");
      }),
      moving && chip("Not moving", () => setStill()));
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

  // Someday comes back (DAISEY_SPEC). The weekly pick itself is in Needs you
  // now (needs.js); what's left here is Switch's "Pick from Someday?" when
  // nothing else is active — a short pick — stakes first, a quiet mark on the ones
  // that cost money or keep someone waiting. A pick moves the task back to
  // ready for this week; two picks, Done or Not now close it for the day.
  const somedayTasks = () => (tasks || []).filter((t) => t.status === "someday");
  const STAKES_FIRST = { penalty: 0, money: 1, someone: 2, low: 3 };
  const MARK = { penalty: "penalty if late", money: "costs money", someone: "someone's waiting" };
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
      h("p", { className: "rest-p", textContent: offer ? "You have time. Want to bring 1–2 back from Not now?"
        : rested ? "Rest it is. Everything else is waiting or set for later."
        : "You have time. Everything else is waiting or set for later." }));
    if (!offer) return [card];
    const n = sd.sel.length;
    const bring = () => {
      const now = Date.now();
      for (const id of sd.sel) { const t = (tasks || []).find((x) => x.id === id); if (t) restoreTask(uid, id, bringBack(t, { now })).catch(fail); }
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
      h("h3", { className: "sd-head", textContent: "From Not now" }),
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
      restoreTask(uid, t.id, bringBack(t)).catch(fail);
      if (sd.picked.length >= 2) close(); else render();
    };
    return h("div", { className: "learn-ask someday-ask", role: "group", ariaLabel: "Pick from Not now" },
      h("p", { className: "muted", textContent: sd.picked.length ? "One more, or that's the week?" : "Pick 1–2 from Not now for this week." }),
      h("div", { className: "someday-list" }, ...shownList.map((t) => h("button", { type: "button", className: "someday-item",
        ariaLabel: `Move ${t.title} to this week${MARK[t.stakes] ? ` (${MARK[t.stakes]})` : ""}`, onclick: () => pick(t) },
        bdi(t.title), MARK[t.stakes] && h("span", { className: "someday-mark", textContent: MARK[t.stakes] })))),
      h("div", { className: "learn-row" },
        list.length > shownList.length && h("button", { className: "chip quiet", type: "button", textContent: `Show all ${list.length}`,
          onclick: () => { sd.all = true; render(); } }),
        h("button", { className: "chip quiet", type: "button", textContent: sd.picked.length ? "Done" : "Not now", onclick: close })));
  }

  // Start, then Later · Switch · Pending as 50px squares, all on one row
  // (round 3), and what each opens, for any card that holds one task — the
  // pick, or a booked task shown early (Mor, 2026-10-05: a booked card with
  // only "Start now" left nowhere to go).
  function cardActions(task, alts, start){
    const card = { task };
    const someN = somedayTasks().length;
    return [
      // Later, Pending, Done, then Start at the row's far end (Mor,
      // 2026-10-07: Pending is a real step, so its own first tap; Later asks
      // only when; Focus lives on the running card).
      h("div", { className: "now-actions now-row" },
        action("later", "Later", `choose when to see ${card.task.title} again`,
          { ariaExpanded: String(state.notNow), onclick: () => { state.notNow = !state.notNow; state.pendAsk = false; state.showAlts = false; render(); } }),
        action("pending", "Pending", `${card.task.title} is blocked: set it to Pending`,
          { ariaExpanded: String(state.pendAsk), onclick: () => { state.pendAsk = !state.pendAsk; state.notNow = false; state.showAlts = false; render(); } }),
        bloom(action("check", "Done", `hold to show how much of ${card.task.title} is done`, {}), card.task),
        start),
      state.notNow && h("div", { className: "later-ask", role: "group", ariaLabel: "When instead?" },
        ...[["today", "Later today"], ["tomorrow", "Tomorrow"], ["week", "This week"], ["someday", "Not now"]].map(([w, text]) =>
          h("button", { className: "chip", type: "button", textContent: text, onclick: () => later(card.task, w) }))),
      state.pendAsk && pendingAsk(card.task),
      // Never a dead end while Not now holds tasks (DAISEY_SPEC "Someday comes back").
      (alts.length || someN) && h("button", { className: "linkish now-else", type: "button", ariaExpanded: String(state.showAlts),
        textContent: state.showAlts ? "Hide other tasks" : "Something else",
        onclick: () => { state.showAlts = !state.showAlts; state.notNow = false; state.pendAsk = false; render(); } }),
    ];
  }

  // Done is a hold (Mor, 2026-10-07: "a mini game, one action, some or all"):
  // a daisy opens over the card a petal at a time while Done is held. Let go
  // when it matches what you did; all eight petals is done, with a burst.
  // Fewer is that much progress, off the card for a while (not a skip). A
  // tap only says to hold. The daisy lives on <body>, so a re-render mid-hold
  // doesn't take it away; the release is heard on window.
  const PETAL_MS = 300, PETALS = 8;
  function bloom(btn, task){
    let t0 = 0, raf = 0, n = 0, ov = null, out = null, petals = [];
    const listen = (on) => ["pointerup", "pointercancel", "keyup", "blur"].forEach((t) => (on ? addEventListener : removeEventListener)(t, stop));
    const pct = () => Math.round((n / PETALS) * 100);
    const open = () => {
      const r = (root.querySelector(".now-card.main") || btn).getBoundingClientRect();
      const NS = "http://www.w3.org/2000/svg", el = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
      const size = Math.max(48, Math.min(120, r.height - 64)); // fits a short card too
      const svg = el("svg", { viewBox: "0 0 40 40", width: size, height: size, "aria-hidden": "true" }), g = el("g", { class: "daisy-petals" });
      petals = Array.from({ length: PETALS }, (_, i) => el("ellipse", { cx: 20, cy: 9, rx: 4.2, ry: 8, transform: `rotate(${(360 / PETALS) * i} 20 20)` }));
      g.append(...petals); svg.append(g, el("circle", { cx: 20, cy: 20, r: 6.5, class: "daisy-heart" }));
      out = h("p", { className: "bloom-p", role: "status" });
      ov = h("div", { className: "bloom" }, svg, out);
      Object.assign(ov.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      document.body.append(ov);
    };
    const shut = (ms) => { const o = ov; ov = null; if (o) { o.classList.add("gone"); setTimeout(() => o.remove(), ms); } };
    const step = (now) => {
      const k = Math.min(PETALS, Math.floor((now - t0) / PETAL_MS));
      if (k !== n) {
        n = k; if (!ov) open();
        petals.forEach((p, i) => p.classList.toggle("on", i < n));
        out.textContent = n === PETALS ? "All done!" : `${pct()}% done`;
        navigator.vibrate?.(8);
      }
      if (n === PETALS) { // full bloom: done without waiting for the release
        const r = ov.getBoundingClientRect();
        listen(false); t0 = 0; ov.classList.add("full");
        if (motionOK()) burst(r.left + r.width / 2, r.top + r.height / 2);
        setTimeout(() => { shut(200); quickDoneNow(task); }, 450);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    const start = (e) => {
      if (t0) return;
      if (e.type === "keydown") { if (e.repeat || (e.key !== " " && e.key !== "Enter")) return; e.preventDefault(); }
      else if (e.button) return;
      t0 = performance.now(); n = 0;
      raf = requestAnimationFrame(step); listen(true);
    };
    function stop(e){
      if (!t0) return;
      if (e.type === "keyup" && e.key !== " " && e.key !== "Enter") return;
      cancelAnimationFrame(raf); listen(false); t0 = 0;
      if (!n) { flash("Hold Done: the daisy opens. Let go at how much you did."); return; }
      const p = pct();
      shut(250);
      stepAside(task, { label: `${p}% done: `, write: () => Promise.all([skipNow(uid, task), restoreTask(uid, task.id, progressPatch(p))]) });
    }
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("keydown", start);
    btn.addEventListener("contextmenu", (e) => e.preventDefault()); // a long press on a phone is not a menu
    return btn;
  }

  // Done on a task that was never started here (already finished, or done
  // elsewhere): finished with no time booked, with an Undo.
  function quickDone(task){
    askProgress(task, {
      start: progressOf(task) || 50,
      onFull: () => quickDoneNow(task),
      onPartial: (pct, when) => later(task, when, progressPatch(pct)),
    });
  }
  function quickDoneNow(task){
    const before = { status: task.status || "ready", doneAt: task.doneAt ?? null, skipsSinceStart: task.skipsSinceStart ?? 0 };
    handoff = { title: task.title, skip: task.id, minutes: 0, ids: [task.id] };
    finishTask(uid, task).catch(fail);
    reset(); render();
    flash("Done: ", task.title, { undo: () => { handoff = null; restoreTask(uid, task.id, before).catch(fail); render(); } });
  }

  // The card while a task runs and the dashboard stays: area and project,
  // title, the clock, then Pause, Stop, Focus and hold-to-finish. Past the
  // "Still on it?" point it asks the same question Deep Focus does.
  const clockText = (min) => { const t = Math.floor(min * 60), p2 = (n) => String(n).padStart(2, "0"); return t >= 3600 ? `${Math.floor(t / 3600)}:${p2(Math.floor(t / 60) % 60)}:${p2(t % 60)}` : `${Math.floor(t / 60)}:${p2(t % 60)}`; };
  // Once a second, only the clock's text: nothing is rebuilt under a finger.
  const paintInlineClock = () => { const el = root.querySelector(".inl-time"); if (el && run) el.textContent = clockText(elapsedMinutes(run)); };
  function inlineCard(){
    const task = tasks?.find((t) => t.id === run.taskId) || null;
    const mins = elapsedMinutes(run), target = task ? targetMinutes(run, task) : 0, cap = runCap(target);
    const paused_ = !!run.pausedAt, what = task?.title || "this task";
    const hold = holdButton(`inline:${runKey()}`, `Hold to finish ${what}`, !task, () => finishRun(task, bookedMinutes(run, task)));
    // Waiting for a reply (Mor, 2026-10-07): on hold, but the timer keeps
    // going — the wait is part of the task. "Got the reply" takes it off hold.
    const onHold = task?.onHold;
    const waitLine = onHold && h("p", { className: "hold-line", role: "status" }, icon("pending"),
      h("span", {}, ...(onHold.who ? ["Waiting on ", bdi(onHold.who)] : ["Waiting for a reply"]), ` · since ${clock(onHold.since)} · timer running`));
    const setHold = () => { const who = holdText; holdAsk = false; holdText = ""; render(); holdTask(uid, task, who).catch(fail); };
    const holdBox = holdAsk && !onHold && (() => {
      const input = h("input", { id: "holdWho", dir: "auto", autocomplete: "off", value: holdText, oninput: (e) => { holdText = e.target.value; } });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); setHold(); } });
      setTimeout(() => { if (input.isConnected && document.activeElement !== input) input.focus(); });
      return h("div", { className: "pend-ask" },
        h("label", { htmlFor: "holdWho", textContent: "Waiting on who? (optional) The timer keeps running." }),
        h("div", { className: "pend-row" }, input, h("button", { className: "btn primary small", type: "button", textContent: "Wait", onclick: setHold })));
    })();
    return h("div", { className: "now-card main hero running" + (onHold ? " on-hold" : "") + areaClass(task) },
      task ? heroTop(task, onHold ? "On hold" : "Running") : h("div", { className: "now-meta", textContent: "Running" }),
      task && onOpen ? titleButton(task) : h("div", { className: "now-title", dir: "auto", textContent: task?.title || "That task is gone" }),
      h("p", { className: "now-why inl-clock" }, h("b", { className: "inl-time", textContent: clockText(mins) }), target ? ` of ${dur(target)}` : "", paused_ ? " · paused" : ""),
      waitLine,
      holdBox,
      mins > cap && h("div", { className: "focus-still", role: "status" },
        h("p", { className: "focus-still-text", textContent: `Still on it? It's been ${dur(Math.round(mins))}. If you stopped earlier, Done and Stop count ${dur(Math.round(cap))}.` }),
        h("div", { className: "focus-still-btns" },
          h("button", { className: "btn line", type: "button", textContent: "Still on it", onclick: () => { const prev = run, m = stillOnMinutes(prev, task); run = { ...run, extra: (run.extra || 0) + m }; render(); extendRun(uid, prev, m).catch(fail); } }),
          h("button", { className: "btn line", type: "button", textContent: "Stop", onclick: () => endSession() }))),
      h("div", { className: "now-actions now-row" },
        onHold
          ? action("play", "Replied", `the reply came: take ${what} off hold`, { onclick: () => releaseTask(uid, task).catch(fail) })
          : action(paused_ ? "play" : "pause", paused_ ? "Resume" : "Pause", `${paused_ ? "resume" : "pause"} ${what}`, { onclick: paused_ ? resume : pause }),
        !onHold && task && action("pending", "Waiting", `waiting for a reply on ${what}: put it on hold, the timer keeps running`,
          { ariaExpanded: String(holdAsk), onclick: () => { holdAsk = !holdAsk; render(); } }),
        action("stop", "Stop", `stop ${what} for now; the time so far is kept`, { onclick: () => endSession() }),
        action("focus", "Focus", "Deep Focus, full screen", { onclick: () => setMode("focus") }),
        hold));
  }

  // Switch's list: the other tasks, or the way into Someday when there are none.
  function altsFor(alts){
    return [
      state.showAlts && !alts.length && h("div", { className: "now-alts", role: "group", ariaLabel: "Other tasks" },
        h("p", { className: "muted" }, "Nothing else is active. ",
          h("button", { className: "linkish", type: "button", textContent: "Pick from Not now?",
            onclick: () => { sd.open = true; state.showAlts = false; render(); } }))),
      state.showAlts && alts.length > 0 && h("div", { className: "now-alts", role: "group", ariaLabel: "Other tasks" }, ...alts.map((s) => h("button", {
        type: "button", className: "now-alt", ariaLabel: `Put ${s.task.title} on the card instead${s.why ? ". " + s.why : ""}`,
        onclick: () => { state.chosen = s.task.id; state.showAlts = false; render(); },
      }, taskCard(s, false)))),
    ];
  }

  // ---------- The day's proposed schedule (proposal.js, 2026-10-07) ----------
  // At the start of the day the card is Daisey's proposal for the rest of
  // today: approve it, reorder it, drop items, open one to edit it, or ask
  // for a rethink. On demand from the plan line, the Free row or Schedule's
  // "Plan my day". Approved, the card follows it in order.
  const planCtx = () => ({ tasks: tasks || [], events: cal.status === "ok" ? cal.events : [], now: Date.now(), hours: dayHours(settings), settings, run });
  const todaysPlan = () => (dayPlan?.date === localDate() ? dayPlan : null);
  const approvedPlan = () => (todaysPlan()?.status === "approved" ? dayPlan : null);
  function openProposal(){
    const saved = todaysPlan();
    prop.items = saved?.items?.length && saved.status !== "dismissed"
      ? saved.items.filter((it) => (tasks || []).some((t) => t.id === it.taskId && t.status === "ready"))
      : proposeDay({ ...planCtx(), exclude: prop.exclude });
    prop.open = true; prop.ask = false; prop.note = ""; handoff = null;
    render();
  }
  const closeProposal = () => { prop.open = false; prop.ask = false; prop.note = ""; render(); };
  const savePlan = (status, items) => {
    dayPlan = { date: localDate(), status, items, at: Date.now() };
    saveDayPlan(uid, { date: dayPlan.date, status, items }).catch(fail);
  };
  function approve(){
    const n = prop.items.length;
    savePlan("approved", prop.items.map(({ taskId, minutes }) => ({ taskId, minutes })));
    prop.open = false; prop.ask = false; prop.note = ""; reset();
    render();
    flash(`Plan set: ${n} ${n === 1 ? "task" : "tasks"}. The card follows it.`);
  }
  function dismiss(){ savePlan("dismissed", []); closeProposal(); }
  function move(i, by){
    const j = i + by;
    if (j < 0 || j >= prop.items.length) return;
    const items = [...prop.items];
    [items[i], items[j]] = [items[j], items[i]];
    prop.items = items; render();
  }
  // A plan item that no longer fits (it's late) can be cut to what's left.
  function shorten(i, minutes){
    prop.items = prop.items.map((it, k) => (k === i ? { ...it, minutes } : it));
    render();
  }
  function dropItem(i){
    const items = [...prop.items];
    const [gone] = items.splice(i, 1);
    if (gone) prop.exclude = [...prop.exclude, gone.taskId];
    prop.items = items; render();
  }
  async function doRethink(text){
    if (prop.busy) return;
    prop.busy = true; prop.note = ""; render();
    const ctx = planCtx();
    try {
      const free = gapsToday(ctx.events, ctx.now, ctx.hours).reduce((t, g) => t + g.minutes, 0);
      const r = String(text || "").trim()
        ? await rethink(text, { ...ctx, current: prop.items, exclude: prop.exclude, freeMinutes: free, guest })
        : { items: proposeDay({ ...ctx, exclude: prop.exclude }), note: "" };
      prop.items = r.items;
      prop.note = r.note || (r.items.length ? "" : "Nothing fits what's left of today.");
      prop.text = ""; prop.ask = false;
    } catch (e) { fail(e); prop.note = "Couldn't rethink it. Try again."; }
    prop.busy = false; render();
  }
  function rethinkBox(){
    const input = h("input", { id: "rethinkText", dir: "auto", autocomplete: "off", value: prop.text, oninput: (e) => { prop.text = e.target.value; } });
    const go = () => doRethink(input.value);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    const chip = (text) => h("button", { type: "button", className: "chip", textContent: text, disabled: prop.busy, onclick: () => doRethink(text) });
    setTimeout(() => { if (!input.isConnected || document.activeElement === input) return; input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
    return h("div", { className: "pp-ask" },
      h("label", { htmlFor: "rethinkText", textContent: "What should change? (blank = a fresh take)" }),
      h("div", { className: "pend-row" }, input,
        h("button", { className: "btn primary small", type: "button", disabled: prop.busy, textContent: "Rethink", onclick: go })),
      h("div", { className: "pp-chips" }, chip("Lighter"), chip("Fewer tasks"), chip("Quick ones first"), chip("No calls")));
  }
  // Done today, under the plan (one chip opens both), oldest first. null when empty.
  function doneCard(){
    const list = doneToday(tasks || []).sort((a, b) => a.doneAt - b.doneAt);
    if (!list.length) return null;
    return h("section", { className: "plan done-list", ariaLabel: "Done today" },
      h("div", { className: "plan-head" }, h("span", { className: "plan-name", textContent: "Done today" })),
      h("div", { className: "pj-drawer" }, ...list.map((t) => h("div", { className: "pj-drow" },
            h("span", { className: "pj-tick on", ariaHidden: "true" }, icon("check")),
            h("button", { type: "button", className: "pj-quiet", onclick: () => onOpen?.(t) }, bdi(t.title)),
            h("span", { className: "pj-meta", dir: "ltr", textContent: new Date(t.doneAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })))));
  }
  function proposalCard(){
    const { rows, over } = timeline(prop.items, planCtx());
    const approved = !!approvedPlan();
    const total = rows.reduce((t, r) => t + r.minutes, 0);
    const last = rows[rows.length - 1];
    const pos = new Map(prop.items.map((it, i) => [it.taskId, i]));
    const row = (r, isOver) => {
      const i = pos.get(r.taskId), t = r.task;
      const ctl = (text, label, disabled, onclick) => h("button", { type: "button", className: "pp-ctl", textContent: text, title: label, ariaLabel: `${label}: ${t.title}`, disabled, onclick });
      return h("li", { className: "pp-row" + areaClass(t) + (isOver ? " over" : "") },
        isOver ? h("span", { className: "pp-time", textContent: "No room" })
          : h("span", { className: "pp-time", ariaLabel: `${clock(r.start)} to ${clock(r.end)}` }, clock(r.start), h("small", { textContent: clock(r.end) })),
        h("button", { type: "button", className: "pp-task", ariaLabel: `Edit ${t.title}`, onclick: () => onOpen?.(t) },
          h("span", { className: "pp-title", dir: "auto", textContent: t.title }),
          h("span", { className: "pp-meta" }, ...pieces(projectShown(t) ? t.project : "", dur(r.minutes)))),
        h("span", { className: "pp-ctls" },
          ctl("↑", "Move earlier", i === 0, () => move(i, -1)),
          ctl("↓", "Move later", i === prop.items.length - 1, () => move(i, 1)),
          ctl("✕", "Take off today's plan", false, () => dropItem(i))),
        isOver && r.room > 0 && h("button", { type: "button", className: "pp-fit", ariaLabel: `Shorten ${t.title} to ${dur(r.room)}`, onclick: () => shorten(i, r.room) },
          `Shorten to ${dur(r.room)}`));
    };
    const plural = (n) => (n === 1 ? ["One doesn't", "it"] : [`${n} don't`, "them"]);
    return h("section", { className: "now-card main hero proposal", ariaLabel: approved ? "Today's plan" : "Proposed schedule" },
      h("div", { className: "hero-top" },
        h("span", { className: "hero-area", textContent: approved ? "Today's plan" : "Proposed for today" }),
        rows.length > 0 && h("span", { className: "hero-side", textContent: `${dur(total)} · until ${clock(last.end)}` })),
      h("p", { className: "now-why pp-why", textContent: approved ? "Reorder, drop or rethink, then save." : "How I'd use the rest of today. Approve it, or change it first." }),
      rows.length || over.length
        ? h("ol", { className: "pp-list" }, ...rows.map((r) => row(r, false)), ...over.map((r) => row(r, true)))
        : h("p", { className: "now-empty", textContent: "No open task fits the free time left today." }),
      // An approved plan never changes itself (Mor, 2026-10-07): late in the
      // day it says so and offers a fresh take on what's left.
      over.length > 0 && approved && !prop.busy && h("p", { className: "pp-note pp-late" }, "Running late. ",
        h("button", { type: "button", className: "linkish", textContent: "Rethink for what's left?", onclick: () => doRethink("") })),
      over.length > 0 && !approved && h("p", { className: "muted pp-note", textContent: `${plural(over.length)[0]} fit today. ${over.some((o) => o.room) ? `Shorten ${plural(over.length)[1]}, move` : "Move"} ${plural(over.length)[1]} up, or take ${plural(over.length)[1]} off.` }),
      prop.note && h("p", { className: "pp-note", role: "status", textContent: prop.note }),
      prop.ask && rethinkBox(),
      h("div", { className: "pp-actions" },
        h("button", { className: "btn primary start", type: "button", disabled: !prop.items.length || prop.busy, onclick: approve },
          icon("check"), h("span", { textContent: approved ? "Save plan" : "Approve" })),
        h("button", { className: "btn line", type: "button", ariaExpanded: String(prop.ask), disabled: prop.busy,
          textContent: prop.busy ? "Thinking…" : prop.ask ? "Cancel" : "Rethink", onclick: () => { prop.ask = !prop.ask; render(); } }),
        h("button", { className: "btn quiet", type: "button", textContent: approved ? "Close" : "Not today", onclick: approved ? closeProposal : dismiss })));
  }
  // Once a plan is approved, how far along it is goes to the header chip
  // (next to Needs you); tapping it reopens the plan to change it.
  function planProgressNow(){
    const p = approvedPlan();
    if (!p || !tasks) return null;
    const { done, total } = planProgress(p, tasks);
    return total ? { done, total } : null;
  }

  // Done today, for the header's daisy: what the snapshot says, plus what was
  // just finished and hasn't come back from Firestore yet.
  function doneCount(){
    const ids = new Set(doneToday(tasks || []).map((t) => t.id));
    for (const id of handoff?.ids || []) ids.add(id);
    return ids.size;
  }
  let reported = null, reportedNeeds = null, reportedPlan = "";

  function render(){
    const live = !!run; // paused or not
    const deepOn = focusing();
    if (!deepOn) deep.leave();
    else if (!deep.isOn()) deep.enter(runKey()); // a reload or the other device: no tap, so no full screen, but awake and counting
    document.body.classList.toggle("focus", deepOn || !!handoff);
    const hrs = dayHours(settings);
    if (!isNight(Date.now(), hrs)) nightFree = false;
    const night = !live && !handoff && tasks != null && isNight(Date.now(), hrs) && !nightFree;
    document.documentElement.classList.toggle("night", night);
    const n = doneCount();
    if (n !== reported) { reported = n; onDone?.(n); }
    const pp = planProgressNow(), ppKey = pp ? `${pp.done}/${pp.total}` : "";
    if (ppKey !== reportedPlan) { reportedPlan = ppKey; onPlanProgress?.(pp); }
    if (!live && tasks) {
      const nn = collectNeeds({ tasks, events: cal.events || [], calOk: cal.status === "ok", settings }).length;
      if (nn !== reportedNeeds) { reportedNeeds = nn; onNeedsCount?.(nn); }
    }

    if (deepOn) { fill(renderFocus()); return; }
    // Started, and the dashboard stays: the card is the running task (Mor,
    // 2026-10-06). Deep Focus is one tap away on it.
    if (live && tasks != null) { showing(run.taskId); fill(topOf(calendarNow()), inlineCard(), toast && toastView()); return; }
    if (handoff) {
      // The task just worked on isn't offered straight back.
      const m = momentInput();
      const r = rank(tasks || [], { ...m, sessionSkips: [...m.sessionSkips, handoff.skip] });
      const pn = nextPlanned(approvedPlan(), tasks || [], localDate());
      const nextPick = (pn && r.ranked.find((s) => s.task.id === pn)) || r.pick;
      // Every option the card has, right here (Mor, 2026-10-07: not just
      // Start / Not now). Later, Switch and Pending open the card on that
      // task with the same ask already open.
      const onCardWith = (task, open) => { handoff = null; reset(); state.chosen = task.id; state.notNow = true; Object.assign(state, open); render(); };
      const cheer = !handoff.cheered; // the petals once, not on every re-render
      handoff.cheered = true;
      // "Again?" (2026-10-06): one task finished, not a batch → offer next week / next month.
      const finished = handoff.ids?.length === 1 ? (tasks || []).find((t) => t.id === handoff.ids[0]) : null;
      const again = finished && {
        suggest: finished.again || null,
        made: handoff.againMade || null,
        pick: (period) => {
          const input = againInput(finished, period);
          addTask(uid, input, tasks || []).catch(fail);
          handoff.againMade = new Date(`${input.notBefore}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
          render();
        },
      };
      fill(handoffView({ title: handoff.title, minutes: handoff.minutes || 0, count: n, again }, nextPick, {
        cheer,
        onStart: begin,
        onFocus: (task) => begin(task, "focus"),
        onDone: (task) => { handoff = null; quickDone(task); },
        onLater: (task) => onCardWith(task, {}),
        onSwitch: (task) => onCardWith(task, { notNow: false, showAlts: true }),
        onPending: (task) => onCardWith(task, { notNow: false, pendAsk: true }),
        onOpen: onOpen ? (task) => onOpen(task) : null,
        onPlan: () => openProposal(),
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
          ariaLabel: `Stop ignoring ${busy.title}`, onclick: () => { freeFrom = null; render(); } })));

    const head = night ? [greet] : [topOf(fw), greet];
    if (tasks == null) { fill(...head, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }

    if (night) { fill(...head, ...nightView(hrs), toast && toastView()); return; }
    if (located === "ride") head.push(rideAsk());
    else { const ask = placeAsk(); if (ask) head.push(placeAskView(ask)); }

    // The start of the day: once per day, until it's approved or turned
    // down, the card opens as the proposal (when there's something to plan).
    if (!prop.open && planKnown && cal.status !== "loading" && prop.auto !== localDate() && !todaysPlan()) {
      prop.auto = localDate();
      const items = proposeDay({ ...planCtx() });
      if (items.length >= 2) { prop.items = items; prop.exclude = []; prop.open = true; }
    }
    if (prop.open) { showing(null); day(...head, proposalCard(), doneCard(), toast && toastView()); return; }

    const r = rank(tasks, momentInput(fw));
    const planned = blockOf(fw)?.taskId;
    const planNext = nextPlanned(approvedPlan(), tasks, localDate());
    const card = (state.chosen && r.ranked.find((s) => s.task.id === state.chosen))
      || (planned && r.ranked.find((s) => s.task.id === planned))
      || (planNext && r.ranked.find((s) => s.task.id === planNext)) || r.pick;
    showing(card?.task.id ?? null);
    // One ask under the card at a time, the most asked-for first.
    // (The calendar offer and the weekly Someday pick moved to Needs you.)
    const tip = (toast && toastView()) || (sd.open && somedayAsk());
    // In a meeting, the meeting IS what's happening now, so the card says
    // which one and how much of it is left (Mor, 2026-10-04) instead of
    // "nothing to pick until it ends", which named nothing and read as if
    // Daisey had simply given up. "I'm free now" still overrides it.
    // Driving with no call to make: the driving card, not "nothing fits".
    if (!card && feel().place.value === "car") { day(...head, drivingCard(), toast && toastView()); return; }
    const block = blockOf(fw);
    if (!card && block) {
      day(...head, h("div", { className: "now-card main hero empty" },
        h("p", { className: "now-empty" }, "Nothing in ", bdi(block.project), " fits right now."),
        h("button", { className: "btn quiet free-now", type: "button", textContent: "I'm free now",
          ariaLabel: `I'm free now: ignore the ${block.project} block and pick any task`,
          onclick: () => { freeFrom = block.start; render(); } })), tip);
      return;
    }
    if (!card && fw?.current) { day(...head, meetingCard(fw.current), tip); return; }
    const bk = !card && r.out.filter((o) => o.reason === "booked").map((o) => ({ task: o.task, ...booked().get(o.task.id) }))
      .filter((b) => b.start).sort((a, b) => a.start - b.start)[0];
    if (bk) { day(...head, bookedCard(bk, r), ...altsFor([]), tip); return; }
    // Nothing active at all: everything open is waiting, in Someday or dated
    // later. Its own calm card, with Someday right there (restState).
    // With something coming up today, that is the card in both cases below
    // (Mor, 2026-10-07): the next event, and how long until it.
    const up = !card && fw?.next ? upcomingCard(fw.next, r) : null;
    if (!card && r.out.length && r.out.every((o) => QUIET.has(o.reason))) {
      const [rest, ...more] = restState();
      day(...head, up || rest, ...more, toast && toastView());
      return;
    }
    if (up) { day(...head, up, tip); return; }
    if (!card) {
      day(...head, h("div", { className: "now-card main hero empty" },
        h("p", { className: "now-empty", textContent: r.empty === "none"
          ? "No tasks yet. Add a few and Daisey will pick."
          : `Nothing fits the next ${dur(r.moment.window)}. Take the break.` }),
        r.empty === "nofit" && outLine(r), putOffButton(r)), tip);
      return;
    }

    if (card === r.pick && r.pick.batch && !state.chosen && !state.single) { day(...head, batchCard(r, r.pick.batch), tip); return; }
    const alts = r.ranked.length > 1 ? [r.pick, ...r.alternatives].filter((s) => s !== card).slice(0, 3) : [];
    // The next piece: the one after this card in the engine's order, round
    // again at the end, so tapping through visits every alternative.
    const order = [r.pick, ...r.alternatives].filter(Boolean);
    const next = alts.length ? order[(order.indexOf(card) + 1) % order.length] ?? alts[0] : null;
    // Start is the one loud thing on the tab; the other two stay quiet under it.
    day(...head, deck(taskCard(card, true,
      ...cardActions(card.task, alts, startButton("Start", `Start: ${card.task.title}`, () => begin(card.task)))), next !== card && next, asking()),
      ...altsFor(alts), tip);
    // One slide-in per step-aside: later snapshots must not replay it.
    if (slideIn) { slideIn = false; if (motionOK()) root.querySelector(".now-card.main")?.classList.add("in"); }
  }

  // (The "Skipped five times. Still want it?" line that lived here moved to
  // Needs you, 2026-10-06: under the card a toast could crowd it out and a
  // reload forgot it had been answered.)

  // Focus mode hands back the same node every second (focus.js); an
  // unchanged screen is left be rather than taken out and put back.
  const fill = (...kids) => {
    kids = kids.filter(Boolean);
    // One "I'm free now" at a time: the card's own wins over the top line's.
    if (kids.slice(1).some((k) => k.querySelector?.(".free-now"))) {
      const top = kids[0]?.querySelector?.(".freeline .free-now");
      if (top) top.parentNode.remove();
    }
    if (kids.length === root.children.length && kids.every((k, i) => root.children[i] === k)) return;
    root.replaceChildren(...kids);
  };
  // The day screens: the card and what's under it. (After this and the
  // Needs you row went with round 3: the panel's Schedule page and the
  // header's chip hold them now.)
  const day = fill;
  const fail = (e) => console.error("[daisey] now", e);
  // "Start task" on a notification (sw.js → ?start=<id>). The suggestion was
  // made minutes ago; what happened since wins (reality.js). Something
  // already running stays, and its focus screen is what opens; a task done,
  // parked or set Pending since isn't started. A cold start from the
  // notification has neither the tasks nor the run yet, so it waits for both.
  let noticeStart = null, runKnown = false;
  const tryNoticeStart = () => {
    if (!noticeStart || tasks === null || !runKnown) return;
    const id = noticeStart;
    noticeStart = null;
    const task = tasks.find((t) => t.id === id);
    if (run || !task || task.status !== "ready" || notYet(task)) return;
    skips.delete(id);
    begin(task);
  };
  deep.watch(() => { if (focusing()) render(); }); // came back from another app: the away line
  const unsubs = [
    watchWhere((v) => { located = v; render(); }),
    watchProjectColors(() => render()),
    watchTasks(uid, (ts) => { tasks = ts; render(); tryNoticeStart(); }, fail),
    watchCalendar((c) => { cal = c; render(); }),
    watchRun(uid, (r) => { run = r; runKnown = true; if (r) handoff = null; render(); tryNoticeStart(); }, fail),
    watchSkips(uid, (s) => { skipDoc = s; render(); }, fail),
    watchSettings(uid, (s) => { settings = s || {}; render(); }, fail),
    watchMoment(uid, (d) => { momentDoc = d || {}; render(); }, fail),
    watchLearn(uid, (d) => { learnStats = d || {}; render(); }, fail),
    watchDayPlan(uid, (d) => { dayPlan = d || null; planKnown = true; render(); }, fail),
  ];
  // The timer ticks every second while running; otherwise this only
  // re-renders when the free window's minute changes.
  const tick = setInterval(() => {
    if (document.hidden) return;
    if (run && !run.pausedAt) {
      const c = Math.floor(elapsedMinutes(run) * 60);
      if (c !== lastClock) { lastClock = c; if (focusing()) render(); else paintInlineClock(); }
      return;
    }
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
    // Start a task from elsewhere (the task sheet, a project).
    // A parked or pending task starting is back in play.
    start(id){
      const task = (tasks || []).find((t) => t.id === id);
      if (!task) return;
      if (task.status !== "ready") restoreTask(uid, id, { status: "ready", waitingOn: null, checkOn: null, notBefore: null, touchedAt: Date.now() }).catch(fail);
      skips.delete(id);
      begin(task);
    },
    startFromNotice(id){ noticeStart = id; tryNoticeStart(); },
    // Tasks finished today, newest first, for the header's done chip.
    doneList(){ return doneToday(tasks || []).sort((a, b) => b.doneAt - a.doneAt); },
    // "Plan my day" from the Schedule: the proposal on the card.
    plan(){ if (prop.open) { closeProposal(); return; } if (run) { flash("Finish or stop the running task first."); return; } openProposal(); },
    unmount(){ deep.leave(); deep.watch(() => {}); showing(null); clearTimeout(toastTimer); document.body.classList.remove("focus"); document.documentElement.classList.remove("night"); unsubs.forEach((u) => u()); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
