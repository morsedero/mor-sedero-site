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
import { addTask, watchTasks, watchRun, watchSkips, saveSkips, startRun, extendRun, endRun, startBatch, tickBatch, endBatch, skipNow, blockTask, restoreTask, finishTask, setDoneMinutes, watchSettings, saveSettings, watchMoment, saveMoment, watchLearn, bumpLearn, saveRun, cancelRun, watchDayPlan, saveDayPlan, holdTask, releaseTask } from "./store.js";
import { sortable } from "./ppdrag.js";
import { proposeDay, timeline, withBreaks, trimBreaks, isBreak, nextPlanned, planProgress, refit, topUp, daySig, relayMeals } from "./proposal.js";
import { rethink } from "./rethink.js";
import { placeNow, workBase, watchProjectTiers } from "./context.js";
import { watchWhere, setManual, setStill, saveSpot, whereAsk, homeAt } from "./where.js";
import { withTrips, ridingAs, chainFrom, setTripDay, MODES } from "./trips.js";
import { pickWeekDay } from "./triage.js";
import { focusView, handoffView, elapsedMinutes, targetMinutes, batchFocusView, batchName, sinceMark, paused, resumed, runCap, bookedMinutes, holdButton, stillOnMinutes, bloomHold } from "./focus.js";
import { watchCalendar, logDone } from "./calendar.js";
import { LATER_MINUTES, DRAIN, CANCEL_KEEP_MINUTES, LIGHTER } from "./weights.js";
import { missState, silenceText } from "./miss.js";
import { takeQuiet } from "./push.js";
import { rank, freeWindow, timeBucket, matchProject, dueAt } from "./engine.js";
import { leftMinutes, toMinutes, progressOf, progressPatch, shrinkPatch, shrunk, localDate, skipSnapshot, skipLesson, pendingCheck, notYet, pushedTo, bringBack, againInput, dayAfter, doneSnapshot } from "./model.js";
import { isRoutine, routineCalendar, eventsToLog, sessionPatch } from "./routine.js";
import { waitingFor, personOf } from "./nudge.js";
import { dayHours, isNight, nextMorning, dayEndAt, bookings, sameTitle, minText, gapsToday } from "./day.js";
import { collectNeeds } from "./needs.js";
import { h, icon, bdi, pieces, sizeText, sizeChip, progressBar, dur, say, nightDivider, flash, weekDots, focusField } from "./ui.js";
import { areaClass, areaName, projectShown, doneToday, dirOf, stemDaisy, moonDaisy, watchProjectColors } from "./look.js";

const LATER_MS = LATER_MINUTES * 60000;
const UNDO_MS = 3500;
const SLIDE_MS = 140; // matches the card-out animation in app.css
const motionOK = () => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// onCard(id | null) fires whenever the task on the card changes (the project
// screen marks it NOW). onProject(name)
// opens that project's screen. onOpen(task) opens the task sheet — the
// card's title is the way in. onEvent(ev): an event's details. name: the first name for the night screen. onDone(n):
// how many tasks are done today, for the header's chip. onNeedsCount(n):
// how many decisions Needs you holds, for the amber chip.
export function mountNow(root, uid, { onCard, onProject, onOpen, onEvent, name = "", onDone, onNeedsCount, onPlanProgress, planRoot, onPlanScreen, onReady, guest = false } = {}){
  let tasks = null; // null until the first snapshot
  let settings = {}; // state/settings: when the sweep was last offered
  let momentDoc = {}; // state/moment: place corrections
  let learnStats = {}; // state/learn: starts and skips per type and time of day
  let located = null; // "home" | "out" from the phone's location (where.js), null = unknown
  let cal = { status: "loading", events: [] };
  // The calendar as fetched; cal is it with the travel legs added (trips.js),
  // so every read below — the window, the place, the plan — sees the trips.
  // The leg under way takes the ride you're on (ridingAs).
  let rawCal = cal;
  const applyTrips = () => {
    cal = rawCal.status === "ok" ? { ...rawCal, events: ridingAs(withTrips(rawCal.events, settings.trips || {}, settings.tripDay || [], settings.laptop ?? null), located) } : rawCal;
  };
  let lastWindow, lastClock;
  let run = null; // the state/now doc while a task is running
  let handoff = null; // { title, next } after Done, until the next choice
  // The day's proposed schedule (proposal.js). dayPlan: today's saved doc
  // (state/dayplan). prop: the proposal on the card while it's open — items
  // in the user's order, the ids they deleted, the Rethink box.
  let dayPlan, planKnown = false;
  // touched: the user changed the items (drop, drag, shorten, rethink);
  // sig: the day they were laid against (proposal.daySig); askOpts: the ask
  // they came from (the lighter plan's), so a fresh take keeps it.
  const prop = { open: false, items: [], exclude: [], ask: false, text: "", busy: false, note: "", auto: null, touched: false, sig: null, askOpts: null };
  let ppDragging = false, ppStale = false; // a plan-row drag is live (ppdrag.js)
  let holdAsk = false, holdText = ""; // "Waiting for reply" on the running card
  // The event you said you're free from, as its start time in ms (what
  // engine.freeWindow reports). Cleared on its own once that event is no
  // longer the one running.
  let freeFrom = null;
  let tripOpen = null; // the trip/laptop line showing its choices (answered())
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
  const reset = () => { state.chosen = null; state.showAlts = false; state.laterAsk = false; state.pendAsk = false; state.notNow = false; state.more = false; state.pendText = ""; state.pendCheck = ""; state.single = false; };
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
      weekDots(t),
      !main && t.nextStep && h("p", { className: "now-next" }, "Next: ", bdi(t.nextStep)),
      why && h("p", { className: "now-why" }, ...say(why)),
      !main && progressBar(t),
      ...extra);
  }
  const titleButton = (t) => h("button", { type: "button", className: "now-title", dir: "auto", textContent: t.title,
    ariaLabel: `Open ${t.title}`, onclick: () => onOpen(t) });
  // The main card's next step sits just under the card, not on it (Mor,
  // 2026-10-08: less on the card).
  const nextLine = (t) => t?.nextStep && h("p", { className: "now-next-out" }, "Next: ", bdi(t.nextStep));

  // The hero's top row, on ONE line: the area's dot, the project in the
  // area's colour (the area's name only when there's no project; Mor,
  // 2026-10-08), and on the far side the size (or whatever the card says
  // there). The project name opens its project screen.
  function heroTop(t, side){
    const area = areaName(t);
    const proj = projectShown(t) && h("button", { type: "button", className: "now-proj",
      title: `Open ${t.project}`, onclick: () => onProject?.(t.project) }, bdi(t.project));
    return h("div", { className: "hero-top" },
      h("span", { className: "hero-area" }, h("span", { className: "dot", ariaHidden: "true" }),
        h("span", { className: "hero-where" }, proj || area || "Inbox")),
      side && h("span", { className: "hero-side" }, side, progressBar(t)));
  }

  // The card. (Swiping it away is gone, Mor 2026-10-07: nobody could see it,
  // and Later / Something else do the same job.) It breathes while nothing
  // is asked of it (CSS; off under reduced motion).
  const deck = (card, still) => h("div", { className: `deck${still ? " still" : ""}` }, card);

  const asking = () => state.more || state.notNow || state.pendAsk || state.showAlts;

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
    // On the way, or the next thing is leaving (trips.js): say so, and let
    // today go another way.
    const leg = fw?.current?.trip ? fw.current : fw?.next?.trip?.dir === "to" ? fw.next : null;
    return h("div", { className: "now-top" },
      block && h("p", { className: "freeline" },
        ...(block.taskId ? [`Booked until ${clock(block.end)}`] : ["Working on ", bdi(block.project), ` until ${clock(block.end)}`]),
        " · ", freeNow(block.start, block.title || block.project)),
      leg && tripChips(leg, leg === fw.current ? `${TRIP_ON[leg.trip.mode]} until ${clock(leg.end)}` : `Leave ${clock(leg.start)} ${TRIP_BY[leg.trip.mode]}`));
  }
  const tripChips = (leg, text) => h("div", { className: "trip-chips" }, tripSwitch(leg, text), laptopLine(leg));

  // On a train, the laptop decides what fits (trips.js ridePlace): asked
  // once, then the last answer holds, one tap to change (settings.laptop).
  function laptopLine(leg){
    if (leg.trip.mode !== "train") return null;
    const has = settings.laptop;
    const set = (v) => { settings = { ...settings, laptop: v }; tripOpen = null; applyTrips(); render(); saveSettings(uid, { laptop: v }).catch(fail); };
    return answered(`laptop:${leg.start}`, has ? "Laptop with you" : "Phone only", "Laptop with you?", [
      { label: "Laptop", aria: "Yes, the laptop is with me", on: has === true, pick: () => set(true) },
      { label: "Phone only", aria: "No laptop, phone tasks only", on: has === false, pick: () => set(false) }]);
  }

  // An answered question is a chip: ✓, the answer, ▾ (Mor, 2026-10-08:
  // "unclear that I already answered"). Tapping it drops a menu under it; the
  // chip never moves (Mor, same day). An unanswered one is the question, no ✓.
  function answered(key, text, prompt, choices){
    const open = tripOpen === key, done = choices.some((c) => c.on);
    const close = () => { tripOpen = null; render(); };
    const chip = h("button", { className: "trip-chip" + (done ? "" : " ask"), type: "button", ariaLabel: done ? `${text}. Change` : prompt,
      ariaExpanded: String(open), ariaHasPopup: "menu", onclick: () => { tripOpen = open ? null : key; render(); } },
      done && h("span", { className: "trip-ok", ariaHidden: "true", textContent: "✓" }), h("span", { textContent: done ? text : prompt }),
      h("span", { className: "trip-caret", ariaHidden: "true", textContent: "▾" }));
    if (!open) return chip;
    wireTripMenu();
    const menu = h("div", { className: "trip-menu", role: "menu", ariaLabel: prompt },
      ...choices.map((c) => h("button", { className: "trip-opt" + (c.on ? " on" : "") + (c.danger ? " danger" : ""), type: "button",
        role: "menuitemradio", ariaChecked: String(!!c.on), ariaLabel: c.aria, onclick: c.on ? close : c.pick },
        h("span", { className: "trip-tick", ariaHidden: "true", textContent: c.on ? "✓" : "" }), c.label)));
    // Fixed under the chip (above it near the bottom of the screen), so no
    // card's overflow clips it.
    requestAnimationFrame(() => {
      if (!menu.isConnected) return;
      const r = chip.getBoundingClientRect(), m = menu.getBoundingClientRect();
      menu.style.top = `${r.bottom + 6 + m.height <= innerHeight ? r.bottom + 6 : Math.max(8, r.top - 6 - m.height)}px`;
      menu.style.left = `${Math.min(Math.max(8, r.left), innerWidth - m.width - 8)}px`;
      menu.style.visibility = "visible";
    });
    return h("span", { className: "trip-dd" }, chip, menu);
  }
  // One set of listeners for whichever menu is open: a tap outside it,
  // Escape, or a scroll closes it.
  let tripWired = false;
  function wireTripMenu(){
    if (tripWired) return;
    tripWired = true;
    const shut = () => { if (tripOpen) { tripOpen = null; render(); } };
    document.addEventListener("pointerdown", (e) => { if (tripOpen && !e.target.closest?.(".trip-dd, .trip-chip")) shut(); }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") shut(); });
    addEventListener("scroll", (e) => { if (tripOpen && !e.target.closest?.(".trip-menu")) shut(); }, true);
    addEventListener("resize", shut);
  }

  // Today by another way, or not going (settings.tripDay): the saved answer
  // stays for every other week.
  const TRIP_ON = { train: "On the train", bus: "On the bus", car: "Driving" };
  const TRIP_BY = { train: "by train", bus: "by bus", car: "driving" };
  const TRIP_INSTEAD = { train: "Train", bus: "Bus", car: "Driving" };
  const RIDE_ROW = { train: "on the train", bus: "on the bus", car: "while driving", passenger: "as a passenger" }; // a plan row on a ride
  function tripSwitch(leg, text){
    const t = leg.trip, date = localDate(new Date(leg.start).getTime());
    const put = (tripDay) => {
      settings = { ...settings, tripDay }; tripOpen = null;
      applyTrips(); render();
      saveSettings(uid, { tripDay }).catch(fail);
    };
    const set = (mode) => {
      const before = settings.tripDay || [];
      put(setTripDay(before, date, t.key, mode));
      // "Not going" takes the trip off the card with it: Undo puts it back.
      if (mode === "none") flash(`No trip to ${t.city} that day.`, null, { undo: () => put(before) });
    };
    return answered(`trip:${t.key}:${leg.start}`, text, `To ${t.city}`, [
      ...MODES.map((m) => ({ label: TRIP_INSTEAD[m], aria: m === t.mode ? `Keep: ${TRIP_INSTEAD[m]}` : `${TRIP_INSTEAD[m]} to ${t.city} instead, that day only`,
        on: m === t.mode, pick: () => set(m) })),
      { label: "Not going", aria: `Not going to ${t.city} that day`, danger: true, pick: () => set("none") }]);
  }

  // The card has three shapes (Mor, 2026-10-07: "too many states"): a TASK
  // (taskCard, bookedCard, the running card), an EVENT (what the calendar
  // says is happening or next) and a QUIET one (nothing to pick). Event and
  // quiet cards share this layout: a small line, a big title, one sentence,
  // optional extras, and at most one action.
  function plainCard(cls, { meta, title, open, why, extras = [], action, color }){
    return h("div", { className: `now-card main hero ${cls}`, style: color ? `--ev:${color}` : "" },
      h("div", { className: "now-meta", textContent: meta }),
      open ? h("button", { type: "button", className: "now-title", dir: "auto", textContent: title, ariaLabel: `Open ${title}`, onclick: open })
        : h("div", { className: "now-title", dir: "auto", textContent: title }),
      why && h("p", { className: "now-why", textContent: why }),
      ...extras, action);
  }
  const eventCard = (o) => plainCard("meeting event", o);
  const quietCard = (o) => plainCard("empty quiet", o);
  const freeNowButton = (ev, label) => h("button", { className: "btn quiet free-now", type: "button", textContent: "I'm free now",
    ariaLabel: `I'm free now: ignore ${label} and pick a task anyway`, onclick: () => { freeFrom = ev.start; render(); } });

  // Driving and no call to make (hands-free calls are the one thing that
  // fits, Mor 2026-10-05): just this. "I'm a passenger" counts as a bus
  // ride (sitting, phone in hand), held by hand: a car trip on the calendar
  // or a lost location would otherwise put the driving card straight back.
  function drivingCard(){
    return quietCard({ meta: "Driving", title: "Eyes on the road", why: "I'll have something ready when you stop.",
      action: h("button", { className: "btn quiet", type: "button", textContent: "I'm a passenger", onclick: () => setManual("bus") }) });
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
    return eventCard({ meta: `Now · until ${clock(end)}`, title: ev.title, color: ev.color,
      why: left ? `${dur(left)} left. Daisey picks a task again when it ends.` : "Just about done.",
      // With someone a Pending task waits on: worth raising while you're there.
      extras: waitingFor(ev.title, tasks || []).slice(0, 3).map((t) => h("p", { className: "now-wait" },
        `Waiting on ${personOf(t.waitingOn)}: `, bdi(t.title))),
      action: freeNowButton(ev, ev.title) });
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
  const finishRun = (task, minutes, end, pct = 100) => {
    if (!run) return; // the hold finished after the run moved on
    if (!task) return finishRunNow(task, minutes, end);
    // Under 100% (the hold let go early) the minutes are kept and the task
    // stays open with that much progress, off the card for a while.
    if (pct >= 100) return finishRunNow(task, minutes, end);
    cancelRun(uid, task, minutes).catch(fail);
    run = null; render();
    partDone(task, pct);
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
      onDone: (pct) => finishRun(task, bookedMinutes(run, task), undefined, pct), // capped: a forgotten timer doesn't book the night
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
    setTimeout(() => focusField(input));
    return box;
  }

  function setToast(t){
    clearTimeout(toastTimer);
    toast = t;
    if (t) t.at = Date.now();
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
    // A re-render rebuilds this node, so start its fade where the last left off.
    const pop = h("div", { className: "toast timed", role: "status" },
      h("div", { className: "toast-row" },
        h("span", { className: "toast-text" }, toast.label, bdi(task.title)),
        h("button", { className: "toast-undo", type: "button", textContent: "Undo",
          ariaLabel: `Undo: put ${task.title} back on the card`, onclick: undo })),
      toast.lesson && (toast.taught
        ? h("div", { className: "toast-why-row" }, h("span", { className: "toast-thanks", textContent: "Got it" }))
        : h("div", { className: "toast-why-row", role: "group", ariaLabel: "Why? (optional)" },
          why("toobig", "Too big", "Too big: offer it in pieces"),
          why("nothere", "Not here", "Not here: don't offer it where I am now"))));
    pop.style.setProperty("--age", `${Math.min(Date.now() - (toast.at || Date.now()), UNDO_MS)}ms`);
    return pop;
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
    if (!fw?.current || fw.current.trip) return null; // a trip leg is travel, not a project
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
  // Routine sessions the user put on the calendar themselves (routine.js).
  const routineCal = (at) => (cal.status === "ok" ? routineCalendar(tasks || [], cal.events, at) : {});
  // A routine's session that happened on the calendar (Gym, 07:00-08:00) is
  // logged as done once it's over — exercise done outside Daisey still counts.
  // Deduped by event id and by day (routine.eventsToLog), so the phone and the
  // laptop writing it at once is harmless.
  function logRoutineEvents(){
    if (cal.status !== "ok" || !tasks) return;
    for (const t of tasks) {
      if (t.status !== "ready" || !isRoutine(t) || run?.taskId === t.id) continue;
      let cur = t;
      for (const ev of eventsToLog(t, cal.events)) {
        const patch = sessionPatch(cur, { ev });
        cur = { ...cur, ...patch };
        restoreTask(uid, t.id, patch).catch(fail);
      }
    }
  }

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
    // On the way (trips.js): the ride is the window; the place (feel) says
    // what fits in it.
    const leg = fw?.current?.trip ? fw.current : null;
    return {
      ...(!fw ? { realWindow: false }
        : block ? { window: Math.floor((block.end - now) / 60000), blockProject: block.project }
        : leg ? { window: Math.floor((leg.end - now) / 60000) }
        : { window: fw.window, nextEvent: fw.next?.title ?? null }),
      ...(said ? { window: Math.min(said, !fw ? 60 : block ? Math.floor((block.end - now) / 60000) : fw.window), realWindow: true } : {}),
      ...workBase(tasks || [], now),
      sessionSkips: hidden(now),
      skipsToday: skipCounts(),
      place: f.place.value,
      spot: f.place.spot,
      learnStats,
      booked: Object.fromEntries([...booked()].map(([id, b]) => [id, b.start])),
      routineCal: routineCal(now),
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
      routineCal: routineCal(morning),
    });
    const p = r.pick;
    const day = localDate(morning);
    const first = evs.filter((e) => localDate(Date.parse(e.start)) === day)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    // The first thing and whatever runs on from it: the trip there, the
    // event, the trip back (trips.js chainFrom).
    const chain = first ? chainFrom(first, evs) : null, main = chain?.main;
    const leave = chain?.parts.find((e) => e.trip?.dir === "to"), back = chain?.parts.find((e) => e.trip?.dir === "back");
    const leaveLine = leave && tripChips(leave, `Leave ${clock(Date.parse(leave.start))} ${TRIP_BY[leave.trip.mode]}`);
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
          // Before the first event if it fits there (counting the trip
          // there, trips.js), else when it's over, the trip back included. The
          // title is its own <bdi>, or a Hebrew name drags the times after it
          // into RTL and prints the range backwards.
          chain ? (() => {
            const before = morning + (p.task.size || 0) * 60000 <= chain.start;
            const at = before ? minText(hrs.start) : clock(Math.max(morning, chain.end));
            return h("p", { className: "now-why" }, ...(!before && back ? [`${at}, back from `, bdi(main.title)]
              : [`${at}, ${before ? "before" : "after"} `, bdi(main.title), ` (${clock(Date.parse(main.start))}–${clock(Date.parse(main.end))})`]));
          })() : h("p", { className: "now-why", textContent: `Starts ${minText(hrs.start)}` }),
          leaveLine,
        ] : [
          main && h("p", { className: "now-why" }, `${clock(Date.parse(main.start))}–${clock(Date.parse(main.end))} `, bdi(main.title)),
          leaveLine,
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
    return eventCard({ meta: `Coming up · ${clock(ev.start)}`, title: ev.title, color: ev.color,
      open: onEvent ? () => onEvent({ ...ev, start: new Date(ev.start).toISOString(), end: new Date(ev.end).toISOString() }) : null,
      why: mins ? `In ${dur(mins)}. Nothing else fits before it.` : "Starting now.",
      extras: [outLine(r), putOffButton(r)] });
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
    // Done, More, then Start at the row's far end (Mor, 2026-10-08: two
    // buttons and Start). Later, Pending and Something else live behind
    // More; a second tap on More closes whatever it opened.
    const open = state.more || state.notNow || state.pendAsk || state.showAlts;
    const only = (key) => () => { state.more = state.notNow = state.pendAsk = state.showAlts = false; state[key] = true; render(); };
    const chip = (text, onclick) => h("button", { className: "chip", type: "button", textContent: text, onclick });
    return [
      h("div", { className: "now-actions now-row" },
        doneHold(action("check", "Done", `hold to show how much of ${card.task.title} is done`, {}), card.task),
        action("more", "More", `Later, Pending or something else instead of ${card.task.title}`,
          { ariaExpanded: String(open), onclick: () => { state.more = state.notNow = state.pendAsk = state.showAlts = false; state.more = !open; render(); } }),
        start),
      state.more && h("div", { className: "later-ask more-ask", role: "group", ariaLabel: "More" },
        chip("Later", only("notNow")),
        chip("Pending", only("pendAsk")),
        // Never a dead end while Not now holds tasks (DAISEY_SPEC "Someday comes back").
        (alts.length || someN) && chip("Something else", only("showAlts"))),
      state.notNow && h("div", { className: "later-ask", role: "group", ariaLabel: "When instead?" },
        ...[["today", "Later today"], ["tomorrow", "Tomorrow"], ["week", "This week"], ["someday", "Not now"]].map(([w, text]) =>
          chip(text, () => later(card.task, w)))),
      state.pendAsk && pendingAsk(card.task),
    ];
  }

  // Done is a hold (focus.js bloomHold). Less than all of it: that much
  // progress, off the card for a while, with Undo (not a skip).
  const partDone = (task, p) => stepAside(task, { label: `${p}% done: `, write: () => Promise.all([skipNow(uid, task), restoreTask(uid, task.id, progressPatch(p))]) });
  // A routine's Done is one tap: a session is always whole.
  const doneHold = (btn, task) => (isRoutine(task)
    ? (btn.onclick = () => quickDoneNow(task), btn.ariaLabel = `Done: one session of ${task.title}`, btn)
    : bloomHold(btn, (p) => (p >= 100 ? quickDoneNow(task) : partDone(task, p)),
      { hint: () => flash("Hold Done: the daisy opens. Let go at how much you did.") }));

  // Done on a task that was never started here (already finished, or done
  // elsewhere): finished with no time booked, with an Undo.
  function quickDoneNow(task){
    const before = doneSnapshot(task);
    handoff = { title: task.title, skip: task.id, minutes: 0, ids: [task.id] };
    const p = finishTask(uid, task, { tasks: tasks || [], events: cal.status === "ok" ? cal.events : [] });
    p.catch(fail);
    reset(); render();
    flash("Done: ", task.title, { undo: () => { handoff = null; restoreTask(uid, task.id, before).catch(fail); render(); },
      adjust: p.counted.minutes ? { minutes: p.counted.minutes, set: (m) => setDoneMinutes(uid, task.id, m) } : undefined });
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
    const hold = holdButton(`inline:${runKey()}`, `Hold to finish ${what}`, !task, (pct) => finishRun(task, bookedMinutes(run, task), undefined, pct), { tap: isRoutine(task) });
    // Waiting for a reply (Mor, 2026-10-07): on hold, but the timer keeps
    // going — the wait is part of the task. "Got the reply" takes it off hold.
    const onHold = task?.onHold;
    const waitLine = onHold && h("p", { className: "hold-line", role: "status" }, icon("pending"),
      h("span", {}, ...(onHold.who ? ["Waiting on ", bdi(onHold.who)] : ["Waiting for a reply"]), ` · since ${clock(onHold.since)} · timer running`));
    const setHold = () => { const who = holdText; holdAsk = false; holdText = ""; render(); holdTask(uid, task, who).catch(fail); };
    const holdBox = holdAsk && !onHold && (() => {
      const input = h("input", { id: "holdWho", dir: "auto", autocomplete: "off", value: holdText, oninput: (e) => { holdText = e.target.value; } });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); setHold(); } });
      setTimeout(() => focusField(input));
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
  // Today's answers to the meal question (meals.js): { [name]: "HH:MM" | "there" }.
  const mealAnswers = () => { const m = settings.mealToday; if (m?.date !== localDate()) return {}; const { date, ...rest } = m; return rest; };
  // The day a plan on screen is laid against, taken when it's laid: taken
  // later, at the first render, a change made in between went unnoticed.
  const daySigNow = () => (cal.status === "ok" ? daySig(cal.events, dayHours(settings)) : null);
  const planCtx = () => ({ tasks: tasks || [], events: cal.status === "ok" ? cal.events : [], now: Date.now(), hours: dayHours(settings), settings, run });
  const todaysPlan = () => (dayPlan?.date === localDate() ? dayPlan : null);
  const approvedPlan = () => (todaysPlan()?.status === "approved" ? dayPlan : null);
  function openProposal(){
    const saved = todaysPlan(), ctx = planCtx(), reuse = saved?.items?.length && saved.status !== "dismissed";
    const re = reuse ? relayMeals(stillOpen(saved.items), ctx, saved.mealsLaid || {}) : null;
    prop.items = withBreaks(reuse ? re.items : proposeDay({ ...ctx, exclude: prop.exclude }), ctx);
    prop.mealsLaid = reuse ? re.laid : mealAnswers();
    prop.touched = false; prop.sig = daySigNow(); prop.askOpts = null;
    const hadHandoff = !!handoff;
    prop.open = true; prop.ask = false; prop.note = ""; handoff = null;
    // The Now card doesn't change with the plan, so leave it be (a rebuild
    // nudged its text, Mor 2026-10-08); only a handoff behind it must go.
    hadHandoff ? render() : paintPlanScreen();
  }
  // A saved plan's open tasks, and its breaks (a break whose work before it
  // is all finished was had, so it goes too).
  function stillOpen(items){
    const open = (it) => (tasks || []).some((t) => t.id === it.taskId && t.status === "ready");
    let any = false, cut = false;
    return items.filter((it) => {
      if (isBreak(it)) return any || !cut;
      if (open(it)) { any = true; return true; }
      cut = true; return false;
    });
  }
  const closeProposal = () => { prop.open = false; prop.ask = false; prop.note = ""; paintPlanScreen(); }; // the Now card stays as is
  // extra: the refit's record ({ kept, cut }), kept until the plan is saved again.
  // approvedAt: when the user last approved it (miss.js counts that as
  // activity; a refit saving the plan isn't), kept across later saves.
  // declined: ids taken off with the top-up's Undo, never added again today.
  // sig: the day the plan was saved against (proposal.daySig); topUpLater
  // compares it with the calendar now. mealsLaid: the meal answers already
  // laid into it (proposal.relayMeals), kept across later saves.
  const savePlan = (status, items, extra = {}) => {
    const was = todaysPlan();
    const approvedAt = was?.approvedAt ?? null, declined = was?.declined || [], mealsLaid = was?.mealsLaid || {};
    const sig = cal.status === "ok" ? daySig(cal.events, dayHours(settings)) : null;
    dayPlan = { date: localDate(), status, items, approvedAt, declined, mealsLaid, sig, ...extra, at: Date.now() };
    saveDayPlan(uid, { date: dayPlan.date, status, items, approvedAt, declined, mealsLaid, sig, ...extra }).catch(fail);
  };
  // An unseen notice survives a save made for another reason.
  const unseen = (p, key) => (p?.[key] && !p[key].seen ? { [key]: p[key] } : {});
  // The approved plan no longer fits the day (an event added, running late):
  // Daisey cuts what matters least itself (proposal.refit) and says so under
  // the card, with Undo (Mor, 2026-10-08). Cut tasks are just back in the
  // list. cut: { ids, why, before } until seen; kept: after Undo, every task
  // in the plan, so Daisey leaves that plan alone (cutting something else to
  // make room for the ones put back would undo the Undo).
  function refitPlan(){
    const p = approvedPlan();
    if (!p || !tasks || cal.status !== "ok" || prop.open || ppDragging) return;
    const { items, cut } = refit(p.items || [], planCtx(), p.kept || []);
    if (!cut.length) return;
    const prev = p.cut && !p.cut.seen ? p.cut : null;
    savePlan("approved", items, { kept: p.kept || [], ...unseen(p, "added"),
      cut: { ids: [...(prev?.ids || []), ...cut], why: prev?.why || squeezedBy(p), before: prev?.before || p.items, asked: prev?.asked || [] } });
  }
  // What shrank the day: a busy event added or moved since the plan was saved.
  function squeezedBy(p){
    const now = Date.now(), ev = cal.events.filter((e) => !e.allDay && e.busy !== false && e.updated
      && Date.parse(e.updated) > (p.at || 0) && Date.parse(e.end) > now && localDate(Date.parse(e.start)) === localDate())
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    return ev ? { title: ev.title, minutes: Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 60000) } : { late: true };
  }
  const cutSaved = (cut) => savePlan("approved", dayPlan.items, { kept: dayPlan.kept || [], ...unseen(dayPlan, "added"), cut });

  // The other way round (Mor, 2026-10-09): the day opened up — a meeting
  // gone or shorter, the day made longer — so a minute after the calendar
  // or the hours change (a burst of edits is one change), Daisey adds what
  // fits on the end of the approved plan (proposal.topUp) and says so under
  // the card, with Undo. Never the running task or the next one: those stay
  // where they are. A plan saved before this just takes today's sig quietly.
  // Day hours changed in Settings (Mor, 2026-10-09: "it doesn't adapt right
  // away"): one deliberate change, so no settling, the plan follows at once.
  const SETTLE = 60000;
  let upTimer = null, upFor = null, lastHours = null;
  const markSig = (sig) => { dayPlan = { ...dayPlan, sig }; const { at, ...doc } = dayPlan; saveDayPlan(uid, doc).catch(fail); };
  // Today's meal answer (Needs you, meals.js) moves the plan's meal right
  // away, no settling: the user asked for it.
  function topUpLater(){
    let p = approvedPlan();
    if (!p || !tasks || cal.status !== "ok") return;
    if (!prop.open && !ppDragging) {
      const re = relayMeals(p.items || [], planCtx(), p.mealsLaid || {});
      if (re.items !== p.items || JSON.stringify(re.laid) !== JSON.stringify(p.mealsLaid || {})) {
        savePlan("approved", re.items, { kept: p.kept || [], ...unseen(p, "cut"), ...unseen(p, "added"), mealsLaid: re.laid });
        p = approvedPlan();
      }
    }
    const sig = daySig(cal.events, dayHours(settings));
    const hk = JSON.stringify(dayHours(settings)), hoursMoved = lastHours != null && hk !== lastHours;
    if (!prop.open) lastHours = hk; // the plan screen follows by itself (freshenProposal); the saved plan catches up once it closes
    if (!p.sig) { markSig(sig); return; }
    if (p.sig === sig) { clearTimeout(upTimer); upTimer = upFor = null; return; }
    if (hoursMoved) { clearTimeout(upTimer); upTimer = upFor = null; topUpNow(false); return; }
    if (upFor === sig) return;
    clearTimeout(upTimer); upFor = sig;
    upTimer = setTimeout(() => { upTimer = upFor = null; topUpNow(); }, SETTLE);
  }
  function topUpNow(redraw = true){
    const p = approvedPlan();
    if (!p || !tasks || cal.status !== "ok" || prop.open || ppDragging) return; // the next render asks again
    const ctx = planCtx(), sig = daySig(ctx.events, ctx.hours);
    if (p.sig === sig) return;
    const { items, added } = topUp(p.items || [], ctx, p.declined || []);
    if (!added.length) { markSig(sig); return; }
    const prev = p.added && !p.added.seen ? p.added.ids : [];
    savePlan("approved", items, { kept: p.kept || [], ...unseen(p, "cut"), added: { ids: [...prev, ...added] } });
    if (redraw) render();
  }
  function addedView(){
    const p = approvedPlan(), a = p?.added;
    if (!a || a.seen) return null;
    const inPlan = new Set((p.items || []).map((it) => it.taskId));
    const got = a.ids.filter((id) => inPlan.has(id)).map((id) => (tasks || []).find((t) => t.id === id)).filter(Boolean);
    if (!got.length) return null;
    const keep = { kept: p.kept || [], ...unseen(p, "cut") };
    const undo = () => {
      const ids = got.map((t) => t.id);
      savePlan("approved", trimBreaks((p.items || []).filter((it) => !ids.includes(it.taskId))), { ...keep, declined: [...(p.declined || []), ...ids] });
      render();
    };
    return h("div", { className: "toast plan-cut", role: "status" },
      h("div", { className: "toast-row" },
        h("span", { className: "toast-text" }, "Your day opened up, so I added ",
          ...got.flatMap((t, i) => [i ? (i === got.length - 1 ? " and " : ", ") : "", bdi(t.title)]), " to today's plan."),
        h("span", { className: "toast-acts" },
          h("button", { className: "toast-undo", type: "button", textContent: "Undo", ariaLabel: "Undo: take them off today's plan", onclick: undo }),
          h("button", { className: "toast-undo", type: "button", textContent: "OK", ariaLabel: "OK, got it",
            onclick: () => { savePlan("approved", p.items, { ...keep, added: { ...a, seen: true } }); render(); } }))));
  }
  // The proposal on screen, not yet approved, follows the day too: when the
  // calendar or the hours change, a fresh take if the user hasn't touched
  // it; if they have, what no longer fits comes off and new time is filled
  // on the end, their order and drops kept. The approved plan open on the
  // plan screen follows too (it used to stay frozen until closed, since the
  // saved plan's refit and top-up wait while the screen is open): never a
  // fresh take for it, only the same cut and top-up.
  function freshenProposal(){
    if (!prop.open || prop.busy || ppDragging || !tasks || cal.status !== "ok") return;
    const ctx = { ...planCtx(), ask: prop.askOpts || {} }, sig = daySig(ctx.events, ctx.hours);
    if (prop.sig == null || prop.sig === sig) { prop.sig = sig; return; }
    prop.sig = sig;
    const ids = () => prop.items.filter((it) => it.taskId).map((it) => it.taskId).join();
    const before = ids();
    prop.items = prop.touched || approvedPlan()
      ? topUp(refit(relayMeals(prop.items, ctx, prop.mealsLaid || {}).items, ctx).items, ctx, prop.exclude).items
      : withBreaks(proposeDay({ ...ctx, exclude: prop.exclude }), ctx);
    prop.mealsLaid = mealAnswers(); // a fresh take already lays them
    if (ids() !== before) prop.note = "Your day changed, so I updated the plan.";
  }
  function cutView(){
    const c = approvedPlan()?.cut;
    if (!c || c.seen) return null;
    const gone = c.ids.map((id) => (tasks || []).find((t) => t.id === id)).filter(Boolean);
    if (!gone.length) return null;
    const n = gone.length;
    const cause = c.why?.title ? [bdi(c.why.title), ` takes ${dur(c.why.minutes)}, so I took`] : ["The day's running behind, so I took"];
    // The follow-up: a real deadline today that no longer fits.
    const ask = gone.find((t) => t.status === "ready" && t.dateKind === "deadline" && t.due && t.due <= localDate() && !(c.asked || []).includes(t.id));
    const answer = (patch) => { if (patch) restoreTask(uid, ask.id, patch).catch(fail); cutSaved({ ...c, asked: [...(c.asked || []), ask.id] }); render(); };
    return h("div", { className: "toast plan-cut", role: "status" },
      h("div", { className: "toast-row" },
        h("span", { className: "toast-text" }, ...cause, ` ${n === 1 ? "one task" : `${n} tasks`} off today's plan: `,
          ...gone.flatMap((t, i) => [i ? ", " : "", bdi(t.title)]), ". They're back in your list."),
        h("span", { className: "toast-acts" },
          h("button", { className: "toast-undo", type: "button", textContent: "Undo", ariaLabel: "Undo: put them back in today's plan",
            onclick: () => { savePlan("approved", c.before, { kept: c.before.filter((it) => it.taskId).map((it) => it.taskId) }); render(); } }),
          h("button", { className: "toast-undo", type: "button", textContent: "OK", ariaLabel: "OK, got it",
            onclick: () => { cutSaved({ ...c, seen: true }); render(); } }))),
      ask && h("div", { className: "toast-why-row", role: "group", ariaLabel: `${ask.title} is due today` },
        h("span", { className: "toast-text" }, bdi(ask.title), " is due today. Move the deadline?"),
        h("button", { className: "toast-why", type: "button", textContent: "To tomorrow", onclick: () => answer(pushedTo(ask, { due: dayAfter(1) })) }),
        h("button", { className: "toast-why", type: "button", textContent: "Keep today", onclick: () => answer(null) })));
  }
  function approve(){
    const n = prop.items.filter((it) => !isBreak(it)).length;
    savePlan("approved", trimBreaks(prop.items).map(({ taskId, brk, minutes, name }) => (brk ? { brk, minutes, ...(name ? { name } : {}) } : { taskId, minutes })), { approvedAt: Date.now(), mealsLaid: mealAnswers() });
    prop.open = false; prop.ask = false; prop.note = ""; reset();
    render();
    flash(`Plan set: ${n} ${n === 1 ? "task" : "tasks"}. The card follows it.`);
  }
  function dismiss(){ savePlan("dismissed", []); closeProposal(); }

  // ---------- Missed slot and the silence check (miss.js, 2026-10-08) ----------
  // While Daisey is open, a banner over the card asks; closed, the server
  // sends the same as a notification (notify.js "miss").
  function missNow(){
    if (!tasks || cal.status !== "ok" || prop.open || handoff) return null;
    return missState({ tasks, events: cal.events, run, now: Date.now(), hours: dayHours(settings),
      planAt: todaysPlan()?.approvedAt || 0, silenceOn: settings.silenceOn || null });
  }
  const silenced = (date = localDate()) => { settings = { ...settings, silenceOn: date }; saveSettings(uid, { silenceOn: date }).catch(fail); };
  // Half the time, on the card's own buckets (model.shrunk); counts as an answer.
  function shortenNow(task){
    const to = shrunk(task.size);
    restoreTask(uid, task.id, shrinkPatch(task)).catch(fail);
    flash(`${task.title}: now ${dur(to)}.`);
  }
  // A few small tasks for the rest of today, as a proposal to approve.
  function lighterPlan(){
    silenced();
    if (run) { flash("Finish or stop the running task first."); return; }
    const items = proposeDay({ ...planCtx(), ask: { fewer: true, quickFirst: true, maxEach: LIGHTER.each } });
    if (!items.length) { flash("Nothing small left for today. Take the rest of the day."); render(); return; }
    prop.items = withBreaks(items, planCtx()); prop.exclude = [];
    prop.touched = false; prop.sig = daySigNow(); prop.askOpts = { fewer: true, quickFirst: true, maxEach: LIGHTER.each };
    prop.open = true; prop.ask = false; prop.note = ""; handoff = null; reset();
    render();
  }
  // Both take the main card's place, never a box pushing it down (Mor,
  // 2026-10-08). A miss is the task's own card saying so, with Shorten and
  // Move under its line; the silence check is a card of its own.
  const missWhy = (card, st) => ({ ...card, whyParts: [`up since ${clock(st.start)} and not started`] });
  function missRow(task){
    const chip = (text, onclick) => h("button", { className: "chip", type: "button", textContent: text, onclick });
    return h("div", { className: "later-ask miss-row", role: "group", ariaLabel: "Missed" },
      leftMinutes(task) > 5 && chip("Shorten", () => shortenNow(task)),
      chip("Move", () => { state.more = state.pendAsk = state.showAlts = false; state.notNow = true; render(); }));
  }
  function roughCard(st){
    return plainCard("empty quiet rough", { meta: "Rough day?", title: "Want a lighter plan?", why: silenceText(st, clock).replace(/ Want a lighter plan.*$/, ""),
      action: h("div", { className: "now-actions now-row" },
        h("button", { className: "btn quiet", type: "button", textContent: "Not today", onclick: () => { silenced(); render(); } }),
        h("button", { className: "btn primary start", type: "button", onclick: lighterPlan }, h("span", { textContent: "Lighter plan" }))) });
  }

  // A plan item that no longer fits (it's late) can be cut to what's left.
  function shorten(i, minutes){
    prop.items = prop.items.map((it, k) => (k === i ? { ...it, minutes } : it));
    prop.touched = true; render();
  }
  function dropItem(i){
    const items = [...prop.items];
    const [gone] = items.splice(i, 1);
    if (gone?.taskId) prop.exclude = [...prop.exclude, gone.taskId];
    prop.items = trimBreaks(items); prop.touched = true; render();
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
      const before = prop.items.filter((i) => i.taskId).map((i) => i.taskId);
      prop.items = withBreaks(r.items, ctx); prop.touched = true;
      const after = r.items.filter((i) => i.taskId).map((i) => i.taskId);
      // Say what actually changed, so a near-identical plan doesn't read as a second copy of the first.
      const name = (id) => { const t = ctx.tasks.find((x) => x.id === id); return t ? `“${t.title}”` : ""; };
      const list = (ids) => ids.slice(0, 2).map(name).filter(Boolean).join(", ") + (ids.length > 2 ? ` +${ids.length - 2}` : "");
      const added = after.filter((id) => !before.includes(id)), gone = before.filter((id) => !after.includes(id));
      const diff = !after.length ? ""
        : before.join() === after.join() ? "Same plan. Tell me what to change, like “lighter” or “start with …”."
        : [added.length && `Added ${list(added)}.`, gone.length && `Removed ${list(gone)}.`,
           !added.length && !gone.length && "Same tasks, new order."].filter(Boolean).join(" ");
      prop.note = r.note || diff || (r.items.length ? "" : "Nothing fits what's left of today.");
      prop.text = ""; prop.ask = false;
    } catch (e) { fail(e); prop.note = "Couldn't rethink it. Try again."; }
    prop.busy = false; render();
  }
  // Rethink takes the action row's slot, one set of controls at a time
  // (2026-10-08): what to change | Fewer | More | Go | ✕. Blank Go = a fresh take.
  function rethinkRow(){
    const close = () => { prop.ask = false; render(); };
    const input = h("input", { id: "rethinkText", dir: "auto", autocomplete: "off", placeholder: "Other…", ariaLabel: "What should change? Blank for a fresh take", value: prop.text, oninput: (e) => { prop.text = e.target.value; } });
    const go = () => doRethink(input.value);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } else if (e.key === "Escape") close(); });
    setTimeout(() => focusField(input));
    return h("div", { className: "pp-actions pp-ask" }, input,
      ...[["Fewer", "Fewer tasks"], ["More", "More tasks"]].map(([label, ask]) => h("button", { type: "button", className: "chip", textContent: label, ariaLabel: ask, disabled: prop.busy, onclick: () => doRethink(ask) })),
      h("button", { className: "btn primary", type: "button", disabled: prop.busy, textContent: prop.busy ? "…" : "Go", ariaLabel: prop.busy ? "Thinking" : "Rethink", onclick: go }),
      h("button", { className: "pp-ctl", type: "button", textContent: "✕", title: "Never mind", ariaLabel: "Never mind", onclick: close }));
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
  // Drag a row to reorder the plan (ppdrag.js, same drag as the Schedule's).
  const dragRows = (ol) => { sortable(ol, {
    busy: (on) => { ppDragging = on; if (!on && ppStale) { ppStale = false; render(); } },
    onMove: (el, before) => { // each row's _i: its index in prop.items
      const it = prop.items[el._i], at = before ? prop.items[before._i] : null;
      const items = prop.items.filter((x) => x !== it);
      items.splice(at ? items.indexOf(at) : items.length, 0, it);
      prop.items = trimBreaks(items); prop.touched = true; render();
    } }); return ol; };
  function proposalCard(){
    const { rows, over, breaks } = timeline(prop.items, planCtx());
    const approved = !!approvedPlan();
    const total = rows.reduce((t, r) => t + r.minutes, 0);
    const last = rows[rows.length - 1];
    const row = (r, isOver) => {
      const i = r.i, t = r.task;
      const ctl = (text, label, disabled, onclick) => h("button", { type: "button", className: "pp-ctl", textContent: text, title: label, ariaLabel: `${label}: ${t.title}`, disabled, onclick });
      return h("li", { className: "pp-row pp-drag" + areaClass(t) + (isOver ? " over" : ""), _i: i },
        isOver ? h("span", { className: "pp-time", textContent: "No room" })
          : h("span", { className: "pp-time", ariaLabel: `${clock(r.start)} to ${clock(r.end)}` }, clock(r.start), h("small", { textContent: clock(r.end) })),
        h("button", { type: "button", className: "pp-task", ariaLabel: `Edit ${t.title}`, onclick: () => onOpen?.(t) },
          h("span", { className: "pp-title", dir: "auto", textContent: t.title }),
          h("span", { className: "pp-meta" }, ...pieces(projectShown(t) ? t.project : "", dur(r.minutes), r.ride ? RIDE_ROW[r.ride] : ""))),
        h("span", { className: "pp-ctls" },
          ctl("✕", "Take off today's plan", false, () => dropItem(i))),
        isOver && r.room > 0 && h("button", { type: "button", className: "pp-fit", ariaLabel: `Shorten ${t.title} to ${dur(r.room)}`, onclick: () => shorten(i, r.room) },
          `Shorten to ${dur(r.room)}`));
    };
    // A break is the plan's own item: it drags and comes off like a task.
    const breakRow = (b) => {
      const name = b.type === "meal" ? b.name || "Meal" : "Break", own = b.i != null;
      return h("li", { className: "pp-row pp-break" + (own ? " pp-drag" : ""), _i: b.i },
        h("span", { className: "pp-time", ariaLabel: `${clock(b.start)} to ${clock(b.end)}` }, clock(b.start), h("small", { textContent: clock(b.end) })),
        h("span", { className: "pp-task" }, h("span", { className: "pp-title", textContent: name }),
          h("span", { className: "pp-meta", textContent: dur(b.minutes) })),
        own && h("span", { className: "pp-ctls" },
          h("button", { type: "button", className: "pp-ctl", textContent: "✕", title: `Take the ${name.toLowerCase()} off`, ariaLabel: `Take the ${name.toLowerCase()} off`, onclick: () => dropItem(b.i) })));
    };
    const plural = (n) => (n === 1 ? ["One doesn't", "it"] : [`${n} don't`, "them"]);
    return h("section", { className: "now-card main hero proposal", ariaLabel: approved ? "Today's plan" : "Proposed schedule" },
      h("div", { className: "hero-top" },
        h("span", { className: "hero-area", textContent: approved ? "Today's plan" : "Proposed for today" }),
        rows.length > 0 && h("span", { className: "hero-side", textContent: `${dur(total)} · until ${clock(last.end)}` })),
      rows.length || over.length
        ? dragRows(h("ol", { className: "pp-list" },
          ...[...rows.map((r) => ({ r, s: r.start })), ...breaks.map((b) => ({ b, s: b.start }))]
            .sort((a, b) => a.s - b.s).map((x) => (x.b ? breakRow(x.b) : row(x.r, false))),
          ...over.map((r) => row(r, true))))
        : h("p", { className: "now-empty", textContent: "No open task fits the free time left today." }),
      // Overflow is cut by refitPlan (2026-10-08); what's left here is what
      // the user put back with Undo. Late in the
      // day it says so and offers a fresh take on what's left.
      over.length > 0 && approved && !prop.busy && h("p", { className: "pp-note pp-late" }, "Running late. ",
        h("button", { type: "button", className: "linkish", textContent: "Rethink for what's left?", onclick: () => doRethink("") })),
      over.length > 0 && !approved && h("p", { className: "muted pp-note", textContent: `${plural(over.length)[0]} fit today. ${over.some((o) => o.room) ? `Shorten ${plural(over.length)[1]}, move` : "Move"} ${plural(over.length)[1]} up, or take ${plural(over.length)[1]} off.` }),
      prop.note && h("p", { className: "pp-note", role: "status", textContent: prop.note }),
      prop.ask ? rethinkRow() : h("div", { className: "pp-actions" },
        h("button", { className: "btn primary start", type: "button", disabled: !prop.items.some((it) => !isBreak(it)) || prop.busy, onclick: approve },
          icon("check"), h("span", { textContent: approved ? "Save plan" : "Approve" })),
        h("button", { className: "btn line", type: "button", ariaExpanded: "false", disabled: prop.busy,
          textContent: prop.busy ? "Thinking…" : "Rethink", onclick: () => { prop.ask = true; render(); } }),
        h("button", { className: "btn quiet", type: "button", textContent: approved ? "Close" : "Not today", onclick: approved ? closeProposal : dismiss })));
  }
  // Once a plan is approved, how far along it is goes to the header chip
  // (next to Needs you); tapping it reopens the plan to change it.
  function planProgressNow(){
    const p = approvedPlan();
    if (!p || !tasks) return null;
    const { done, total } = planProgress(p, tasks);
    // Done today outside the plan counts too, so the chip never reads 0/8 with a task finished.
    const inPlan = new Set(p.items.map((it) => it.taskId));
    const extra = doneToday(tasks).filter((t) => !inPlan.has(t.id)).length;
    return total ? { done: done + extra, total: total + extra } : null;
  }

  // Done today, for the header's daisy: what the snapshot says, plus what was
  // just finished and hasn't come back from Firestore yet.
  function doneCount(){
    const ids = new Set(doneToday(tasks || []).map((t) => t.id));
    for (const id of handoff?.ids || []) ids.add(id);
    return ids.size;
  }
  let reported = null, reportedNeeds = null, reportedPlan = "";

  // The plan is its own full screen (Mor, 2026-10-08): proposalCard paints into
  // planRoot, and the Now card behind it renders as usual.
  let planShown = false;
  function paintPlanScreen(){
    if (!planRoot || ppDragging) return;
    const open = prop.open;
    if (open) planRoot.replaceChildren(...[proposalCard(), doneCard()].filter(Boolean));
    else if (planShown) planRoot.replaceChildren();
    if (open !== planShown) { planShown = open; onPlanScreen?.(open); }
  }
  // onReady(): once, the first time the card is drawn from real tasks, plan
  // and calendar, so main.js can lift the opening daisy.
  let ready = false;
  function render(){
    if (noticeLighter && tasks != null && planKnown && cal.status !== "loading") { noticeLighter = false; lighterPlan(); }
    freshenProposal(); topUpLater();
    renderCard(); paintPlanScreen();
    if (!ready && tasks != null && planKnown && cal.status !== "loading") { ready = true; onReady?.(); }
  }
  function renderCard(){
    if (ppDragging) { ppStale = true; return; } // a redraw mid-drag would drop the dragged row
    const live = !!run; // paused or not
    const deepOn = focusing();
    if (!deepOn) deep.leave();
    else if (!deep.isOn()) deep.enter(runKey()); // a reload or the other device: no tap, so no full screen, but awake and counting
    document.body.classList.toggle("focus", deepOn || !!handoff);
    refitPlan();
    const hrs = dayHours(settings);
    if (!isNight(Date.now(), hrs)) nightFree = false;
    // On the way somewhere (trips.js) the day has started, whatever the hours say.
    const riding = cal.status === "ok" && cal.events.some((e) => e.trip && Date.parse(e.start) <= Date.now() && Date.now() < Date.parse(e.end));
    const night = !live && !handoff && tasks != null && isNight(Date.now(), hrs) && !nightFree && !riding;
    document.documentElement.classList.toggle("night", night);
    const n = doneCount();
    if (n !== reported) { reported = n; onDone?.(n); }
    const pp = planProgressNow(), ppKey = pp ? `${pp.done}/${pp.total}` : "";
    if (ppKey !== reportedPlan) { reportedPlan = ppKey; onPlanProgress?.(pp); }
    if (!live && tasks) {
      const nn = collectNeeds({ tasks, events: cal.events || [], calOk: cal.status === "ok", settings, home: homeAt() }).length + (whereAsk() ? 1 : 0);
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
      const again = finished && !isRoutine(finished) && {
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
        onDone: (task, p) => { handoff = null; if (p >= 100) quickDoneNow(task); else partDone(task, p); },
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

    // The start of the day: once per day, until it's approved or turned
    // down, the card opens as the proposal (when there's something to plan).
    if (!prop.open && planKnown && cal.status !== "loading" && prop.auto !== localDate() && !todaysPlan()) {
      prop.auto = localDate();
      const items = proposeDay({ ...planCtx() });
      if (items.length >= 2) { prop.items = withBreaks(items, planCtx()); prop.exclude = []; prop.touched = false; prop.sig = daySigNow(); prop.askOpts = null; prop.open = true; }
    }

    const r = rank(tasks, momentInput(fw));
    const planned = blockOf(fw)?.taskId;
    const planNext = nextPlanned(approvedPlan(), tasks, localDate());
    const card = (state.chosen && r.ranked.find((s) => s.task.id === state.chosen))
      || (planned && r.ranked.find((s) => s.task.id === planned))
      || (planNext && r.ranked.find((s) => s.task.id === planNext)) || r.pick;
    showing(card?.task.id ?? null);
    // One ask under the card at a time, the most asked-for first.
    // (The calendar offer and the weekly Someday pick moved to Needs you.)
    const tip = (toast && toastView()) || cutView() || addedView() || (sd.open && somedayAsk());
    // In a meeting, the meeting IS what's happening now, so the card says
    // which one and how much of it is left (Mor, 2026-10-04) instead of
    // "nothing to pick until it ends", which named nothing and read as if
    // Daisey had simply given up. "I'm free now" still overrides it.
    // Driving with no call to make: the driving card, not "nothing fits".
    if (!card && feel().place.value === "car") { day(...head, drivingCard(), toast && toastView()); return; }
    const block = blockOf(fw);
    if (!card && block) {
      day(...head, eventCard({ meta: `Now · until ${clock(fw.current.end)}`, title: fw.current.title, color: fw.current.color,
        why: `Nothing in ${block.project} fits right now.`, action: freeNowButton({ start: block.start }, `the ${block.project} block`) }), tip);
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
      day(...head, quietCard(r.empty === "none"
        ? { meta: "Nothing to pick", title: "No tasks yet", why: "Add a few and Daisey will pick." }
        : { meta: "Nothing fits", title: `Nothing fits the next ${dur(r.moment.window)}`, why: "Take the break.",
          extras: [outLine(r), putOffButton(r)] }), tip);
      return;
    }

    const ms = missNow();
    if (ms?.kind === "silence") { day(...head, roughCard(ms), tip); return; }
    const missed = ms?.kind === "miss" ? ms : null;
    if (card === r.pick && r.pick.batch && !state.chosen && !state.single) { day(...head, batchCard(r, r.pick.batch), tip); return; }
    const alts = r.ranked.length > 1 ? [r.pick, ...r.alternatives].filter((s) => s !== card).slice(0, 3) : [];
    // Start is the one loud thing on the tab; the other two stay quiet under it.
    day(...head, deck(taskCard(missed ? missWhy(card, missed) : card, true,
      missed && !asking() && missRow(card.task),
      ...cardActions(card.task, alts, startButton("Start", `Start: ${card.task.title}`, () => begin(card.task)))), asking()),
      nextLine(card.task), ...altsFor(alts), tip);
    // One slide-in per step-aside: later snapshots must not replay it.
    if (slideIn) { slideIn = false; if (motionOK()) { const c = root.querySelector(".now-card.main"); if (c) { c.style.animationDelay = ""; c.classList.add("in"); } } }
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
    // A rebuilt card would restart its idle bob (breathe, 5s) from the top and
    // jump; keep the phase on the wall clock so every rebuild carries on.
    root.querySelectorAll(".deck > .now-card.main").forEach((c) => { c.style.animationDelay = `${-(Date.now() % 5000)}ms`; });
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
  let noticeStart = null, runKnown = false, noticeShorten = null, noticeLighter = false;
  const tryNoticeStart = () => {
    if (noticeShorten && tasks !== null) {
      const t = tasks.find((x) => x.id === noticeShorten);
      noticeShorten = null;
      if (t && t.status === "ready") shortenNow(t);
    }
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
    watchWhere((v) => { located = v; applyTrips(); render(); }),
    watchProjectColors(() => render()),
    watchProjectTiers(() => render()),
    watchTasks(uid, (ts) => { tasks = ts; render(); tryNoticeStart(); logRoutineEvents(); }, fail),
    watchCalendar((c) => { rawCal = c; applyTrips(); render(); logRoutineEvents(); }),
    watchRun(uid, (r) => { run = r; runKnown = true; if (r) handoff = null; render(); tryNoticeStart(); }, fail),
    watchSkips(uid, (s) => { skipDoc = s; render(); }, fail),
    watchSettings(uid, (s) => { settings = s || {}; applyTrips(); render(); }, fail),
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
    else if (Date.now() - missAt > 15000) { missAt = Date.now(); const k = missNow()?.key ?? ""; if (k !== missKey) { missKey = k; render(); } }
  }, 1000);
  let missAt = 0, missKey = "";
  // "Not today" on the silence check's notification (sw.js), saved here.
  const quietCheck = () => takeQuiet().then((d) => { if (d === localDate()) { silenced(d); render(); } });
  quietCheck();
  const onVisible = () => { if (!document.hidden) { quietCheck(); render(); } };
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
    // The missed-slot notification's Shorten, and the silence check's two (sw.js).
    shortenFromNotice(id){ noticeShorten = id; tryNoticeStart(); },
    lighter(){ noticeLighter = true; render(); },
    quiet: quietCheck,
    // Tasks finished today, newest first, for the header's done chip.
    doneList(){ return doneToday(tasks || []).sort((a, b) => b.doneAt - a.doneAt); },
    // "Plan my day" from the Schedule: the proposal on the card.
    closePlan(){ if (prop.open) closeProposal(); },
    plan(){ if (prop.open) { closeProposal(); return; } if (run) { flash("Finish or stop the running task first."); return; } openProposal(); },
    unmount(){ deep.leave(); deep.watch(() => {}); showing(null); clearTimeout(toastTimer); clearTimeout(upTimer); document.body.classList.remove("focus"); document.documentElement.classList.remove("night"); unsubs.forEach((u) => u()); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); planRoot?.replaceChildren(); root.hidden = true; },
  };
}
