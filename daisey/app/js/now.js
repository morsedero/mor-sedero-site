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
import { sortable } from "./ppdrag.js";
import { addTask, updateTask, watchTasks, watchRun, watchSkips, saveSkips, endBatch, skipNow, blockTask, restoreTask, finishTask, undoDone, watchSettings, saveSettings, watchMoment, saveMoment, watchLearn, bumpLearn, cancelRun, watchDayPlan, saveDayPlan, logWork, watchProjectNames, removeTask } from "./store.js";
import { proposeDay, timeline, withBreaks, trimBreaks, isBreak, planProgress, planStatus, unfitOf, refit, topUp, daySig, relayMeals } from "./proposal.js";
import { rethink } from "./rethink.js";
import { breakText } from "./schedule.js";
import { placeNow, workBase, watchProjectTiers } from "./context.js";
import { watchWhere, setManual, setStill, saveSpot, whereAsk, homeAt } from "./where.js";
import { withTrips, ridingAs, stillRiding, asPassenger, chainFrom, setTripDay, MODES, tripAsks, answer as tripAnswer, noTrip } from "./trips.js";
import { pickWeekDay } from "./triage.js";
import { sinceMark, runCap, bookedMinutes, celebrate, dropAway, PUSH_MS } from "./focus.js";
import { watchCalendar } from "./calendar.js";
import { LATER_MINUTES, DRAIN, CANCEL_KEEP_MINUTES, LIGHTER } from "./weights.js";
import { missState, silenceText, lastActivity } from "./miss.js";
import { takeQuiet } from "./push.js";
import { findPhoneTasks, phoneOkIds, searching } from "./phone.js";
import { rank, freeWindow, timeBucket, matchProject, dueAt, keepsCard, passedOver } from "./engine.js";
import { leftMinutes, toMinutes, progressOf, leftPatch, localDate, logicalDate, skipSnapshot, skipLesson, pendingCheck, notYet, pushedTo, bringBack, dayAfter, doneSnapshot, isGuess, estText, needsLaptop } from "./model.js";
import { isRoutine, routineCalendar, eventsToLog, sessionPatch } from "./routine.js";
import { waitingFor, personOf } from "./nudge.js";
import { dayHours, isNight, nextMorning, dayEndAt, bookings, sameTitle, minText, gapsToday, planDate, usualHours, dayWord, answerDate } from "./day.js";
import { collectNeeds, wrapList } from "./needs.js";
import { h, icon, bdi, pieces, sizeText, sizeChip, heroChip, progressBar, progressPct, dur, say, nightDivider, flash, weekDots, focusField, dragScroll } from "./ui.js";
import { areaClass, areaName, projectShown, doneToday, moonDaisy, watchProjectColors } from "./look.js";

const LATER_MS = LATER_MINUTES * 60000;
const UNDO_MS = 3500;
const SLIDE_MS = 140; // matches the card-out animation in app.css
const IN_MS = 300; // and card-in
const WON_MS = 560; // Done's shine on the card (.won in app.css) before it slides out
const motionOK = () => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// onCard(id | null) fires whenever the task on the card changes (the project
// screen marks it NOW). onProject(name)
// opens that project's screen. onOpen(task) opens the task sheet — the
// card's title is the way in. onEvent(ev): an event's details. name: the first name for the night screen. onDone(n):
// how many tasks are done today, for the header's chip. onNeedsCount(n):
// how many decisions Needs you holds, for the amber chip.
// onWrap(): the evening wrap (Needs you: each task still open for today).
export function mountNow(root, uid, { onCard, onProject, onOpen, onEvent, onWrap, name = "", onDone, onNeedsCount, onPlanProgress, onPlanNext, onPlanReady, onPlanApproved, planRoot, onPlanScreen, onReady, onFocusMode, missDialog = null, guest = false } = {}){
  let tasks = null; // null until the first snapshot
  let settings = {}; // state/settings: when the sweep was last offered
  let momentDoc = {}, momentKnown = false; // state/moment: place corrections, cardSeen
  let learnStats = {}; // state/learn: starts and skips per type and time of day
  let located = null; // "home" | "out" from the phone's location (where.js), null = unknown
  let cal = { status: "loading", events: [] };
  // The calendar as fetched; cal is it with the travel legs added (trips.js),
  // so every read below — the window, the place, the plan — sees the trips.
  // The leg under way takes the ride you're on (ridingAs); the way back
  // runs on while you're still moving (stillRiding).
  let rawCal = cal;
  const applyTrips = () => {
    cal = rawCal.status === "ok" ? { ...rawCal, events: ridingAs(stillRiding(withTrips(rawCal.events, settings.trips || {}, settings.tripDay || [], settings.laptop ?? null), located), located) } : rawCal;
  };
  let lastWindow;
  let run = null; // the state/now doc while a task is running
  // The day's proposed schedule (proposal.js). dayPlan: today's saved doc
  // (state/dayplan). prop: the proposal on the card while it's open — items
  // in the user's order, the ids they deleted, the Rethink box.
  let dayPlan, planKnown = false;
  // touched: the user changed the items (drop, drag, shorten, rethink);
  // sig: the day they were laid against (proposal.daySig); askOpts: the ask
  // they came from (the lighter plan's), so a fresh take keeps it.
  const prop = { open: false, items: [], exclude: [], ask: false, text: "", busy: false, note: "", auto: null, touched: false, sig: null, askOpts: null };
  let ppDragging = false, ppStale = false; // a plan-row drag is live (ppdrag.js)
  // The event you said you're free from, as its start time in ms (what
  // engine.freeWindow reports). Cleared on its own once that event is no
  // longer the one running.
  // Kept in state/moment, so a reload (iOS drops a backgrounded PWA) or the
  // other device still ignores the event.
  let freeFrom = null;
  const setFree = (v) => { freeFrom = v; render(); saveMoment(uid, { freeFrom: v }).catch(fail); };
  let tripOpen = null; // the trip/laptop line showing its choices (answered())
  // "I'm free now" at night: plan as if it were day until the night is over.
  let nightFree = false;
  // The Someday pick (DAISEY_SPEC "Someday comes back"). open: Switch asked
  // for it; picked: ids moved to this week this round; all: show every one.
  // sel: the empty state's picks, not yet brought back.
  const sd = { open: false, picked: [], all: false, sel: [] };
  let toast = null; // { text, task, before } for 5 s after Later or Pending
  let slideIn = false; // one slide per step-aside, not one per snapshot
  let tapped = null; // which quiet action was just pressed: its key pops once, after the render that rebuilt it
  // After Done the next card pushes in (focus.js dropAway); a snapshot that
  // rebuilds it mid-push picks the push up where it is, and the idle bob
  // then starts from rest at the push's end rather than jumping to the
  // wall clock's phase.
  let pushAt = 0, breathEpoch = 0, inAt = 0;
  const pushIn = (c, since) => {
    c.classList.add("push-in"); c.style.setProperty("--push-at", `${-since}ms`);
    c.addEventListener("animationend", (e) => {
      if (e.target !== c || !e.animationName.startsWith("card-push-in")) return;
      breathEpoch = Date.now(); c.classList.remove("push-in"); c.style.animationDelay = "0ms";
    });
  };
  // Same for Later's slide-in: the write it follows fires a snapshot that
  // rebuilt the card a few ms in, so it snapped into place instead of sliding
  // (and .in, never taken off, kept the bob off until the next rebuild).
  const slideCardIn = (c, since) => {
    c.classList.add("in"); c.style.animationDelay = `${-since}ms`;
    c.addEventListener("animationend", (e) => {
      if (e.target !== c || !e.animationName.startsWith("card-in")) return;
      breathEpoch = Date.now(); c.classList.remove("in"); c.style.animationDelay = "0ms";
    });
  };
  // While the card slides out or shines, renders leave it be (a rebuild
  // brought the card back mid-slide, or dropped the shine); the step's own
  // render follows straight after.
  let holdCard = false;
  let toastTimer = null;
  // laterAsk: Later was tapped and the card is asking "when?"
  // pendAsk: Pending was tapped and the card asks what it's waiting on.
  const state = { chosen: null, showAlts: false, asking: false, laterAsk: false, pendAsk: false, notNow: false };
  // { date, items: { id: { count, until } } } — today's Laters, from Firestore.
  let skipDoc = null;
  // The day the plan and today's Laters belong to: yesterday's, after midnight
  // while a day stretched past it is still on (day.js dayHours late).
  const dayKey = () => planDate(Date.now(), dayHours(settings));
  // What the plan's day is called (night owls, Mor 2026-10-12): its date
  // counted from the day you're in (day.js dayWord), so after midnight and
  // before the 04:00 switch the plan is for the morning the card calls
  // Tomorrow first, and every label in the plan flow says tomorrow too.
  // "I'm free now" plans as day: today.
  const planWord = () => (!nightFree && dayWord(dayKey()) === "tomorrow" ? "tomorrow" : "today");
  const PlanWord = () => (planWord() === "today" ? "Today" : "Tomorrow");
  const skipItems = () => (skipDoc?.date === dayKey() ? skipDoc.items || {} : {});
  const hidden = (now = Date.now()) => Object.entries(skipItems()).filter(([, v]) => v.until > now).map(([id]) => id);
  const skipCounts = () => Object.fromEntries(Object.entries(skipItems()).map(([id, v]) => [id, v.count]));
  const skips = {
    add(id){
      const items = { ...skipItems() };
      items[id] = { count: (items[id]?.count || 0) + 1, until: Date.now() + LATER_MS };
      skipDoc = { date: dayKey(), items };
      saveSkips(uid, skipDoc).catch(fail);
    },
    delete(id){
      const items = { ...skipItems() };
      delete items[id];
      skipDoc = { date: dayKey(), items };
      saveSkips(uid, skipDoc).catch(fail);
    },
    // Several at once, one write: "Show the 2 you put off".
    drop(ids){
      const items = { ...skipItems() };
      for (const id of ids) delete items[id];
      skipDoc = { date: dayKey(), items };
      saveSkips(uid, skipDoc).catch(fail);
    },
    get size(){ return hidden().length; },
  };
  let seenAt = new Map(); // task id → when it came up (heldAnchors, below)
  const reset = () => { state.chosen = null; state.showAlts = false; state.laterAsk = false; state.pendAsk = false; state.notNow = false; state.more = false; state.pendText = ""; state.pendCheck = ""; state.single = false; kept = null; seenAt = new Map(); };
  let shown, kept = null; // kept: keptCard
  let chosenOut = null; // { id, why }: why state.chosen was out when picked (renderCard)
  let projectDue = {}; // { project: "YYYY-MM-DD" }, from Projects' dates
  // A new task on the card shuts the rows opened under the last one.
  const showing = (id) => { if (id !== shown) { if (shown !== undefined) state.showAlts = state.notNow = state.pendAsk = state.more = false; shown = id; onCard?.(id); } };
  // Escape shuts an open row under the card (Switch, Later, Pending), unless a dialog has it.
  function escRow(e){
    if (e.key !== "Escape" || !asking() || document.querySelector("dialog[open]")) return;
    state.showAlts = state.notNow = state.pendAsk = state.more = false; render();
  }

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
    // read as a contradiction (Mor, 2026-10-07). The bar runs along the
    // card's bottom, the main card's too (Mor, 2026-10-12).
    const sizeLbl = sizeChip(t);
    return h("div", { className: "now-card" + (main ? " main hero" : "") + areaClass(t) },
      main && dueTag(t),
      main ? heroTop(t, heroChip(t))
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
  // A guessed area isn't named (user test #8: an Inbox task said "Work"):
  // only one the user set, else the project, else Inbox.
  const ownArea = (t) => ((t.guessed || []).includes("area") ? "" : areaName(t));
  function heroTop(t, side){
    const area = ownArea(t);
    const proj = projectShown(t) && h("button", { type: "button", className: "now-proj",
      title: `Open ${t.project}`, onclick: () => onProject?.(t.project) }, bdi(t.project));
    return h("div", { className: "hero-top" },
      h("span", { className: "hero-area" }, h("span", { className: "dot", ariaHidden: "true" }),
        h("span", { className: "hero-where" }, proj || area || "Inbox")),
      side && h("span", { className: "hero-side" }, side));
  }

  // A date the card has to say (Mor, 2026-10-12): due today or tomorrow, or a
  // deadline already passed (red). Further off, the why line covers it. A
  // passed target isn't late (triage.js), so it says nothing. A tab on the
  // card's top edge, not in the top row, where it hid the project on a phone.
  function dueTag(t){
    if (!t.due || t.status === "done") return null;
    const d = Math.round((new Date(`${t.due}T12:00`) - new Date(`${logicalDate()}T12:00`)) / 864e5);
    const dl = t.dateKind === "deadline", late = dl && (d < 0 || (d === 0 && t.dueTime && Date.now() >= dueAt(t)));
    if (!late && (d < 0 || d > 1)) return null;
    const day = d === 0 ? (t.dueTime || "today") : d === 1 ? `tomorrow${t.dueTime ? ` ${t.dueTime}` : ""}` : d === -1 ? "yesterday"
      : new Date(`${t.due}T12:00`).toLocaleDateString(undefined, d >= -6 ? { weekday: "short" } : { day: "numeric", month: "short" });
    const text = `${late ? "Was due" : dl ? "Due" : "By"} ${day}`;
    return h("span", { className: `hero-due${late ? " over" : ""}`, textContent: text });
  }

  // The card. (Swiping it away is gone, Mor 2026-10-07: nobody could see it,
  // and Later / Something else do the same job.) It breathes while nothing
  // is asked of it (CSS; off under reduced motion).
  const deck = (card, still) => h("div", { className: `deck${still ? " still" : ""}` }, card);

  const asking = () => state.more || state.notNow || state.pendAsk || state.showAlts;


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
      ariaLabel: `I'm free now: ignore ${title} and pick any task`, onclick: () => setFree(start) });
  }
  function topOf(fw){
    const block = blockOf(fw);
    // On the way, or the next thing is leaving (trips.js): say so, and let
    // today go another way.
    const leg = fw?.current?.trip ? fw.current : fw?.next?.trip?.dir === "to" ? fw.next : null;
    return h("div", { className: "now-top" },
      // The way back running past its planned end (trips.stillRiding): one
      // tap says you're there, before the location catches up.
      leg?.trip.late && h("p", { className: "freeline" }, `Still on the way, past ${clock(leg.trip.late)} · `,
        h("button", { className: "linkish", type: "button", textContent: "I've arrived", onclick: () => setStill() })),
      block && h("p", { className: "freeline" },
        ...(block.taskId ? [`Booked until ${clock(block.end)}`] : ["Working on ", bdi(block.project), ` until ${clock(block.end)}`]),
        " · ", freeNow(block.start, block.title || block.project)),
      // Once under way, how you go is settled (Mor, 2026-10-09): only the
      // train's laptop question stays.
      leg && (leg === fw.current ? laptopLine(leg) && h("div", { className: "trip-chips" }, laptopLine(leg))
        : tripChips(leg, `Leave ${clock(leg.start)} ${TRIP_BY[howOf(leg.trip)]}`)));
  }
  // How you get to a city nobody answered for yet (the Needs you trip
  // question, needs.js), as a trip chip. No estimate from Home: the minutes
  // field is in Needs you.
  function tripAskChip(a){
    const save = (mode) => {
      const ans = mode === "none" ? noTrip(a.city) : tripAnswer(a.city, mode, { home: homeAt(), minutes: null });
      if (!ans) { tripOpen = null; flash("How many minutes each way? Answer it in Needs you."); render(); return; }
      const trips = { ...(settings.trips || {}), [a.key]: ans };
      settings = { ...settings, trips }; tripOpen = null;
      applyTrips(); render();
      saveSettings(uid, { trips }).catch(fail);
    };
    return answered(`tripask:${a.key}`, "", `How do you get to ${a.city.name}?`, [
      ...MODES.map((m) => ({ label: TRIP_INSTEAD[m], aria: `${TRIP_INSTEAD[m]} to ${a.city.name}, every time`, on: false, pick: () => save(m) })),
      { label: "It's not a trip", aria: `${a.city.name} isn't a trip`, on: false, pick: () => save("none") }]);
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
  const TRIP_ON = { train: "On the train", bus: "On the bus", car: "Driving", passenger: "Riding" };
  const TRIP_BY = { train: "by train", bus: "by bus", car: "driving", passenger: "as a passenger" };
  const howOf = (t) => (t.passenger ? "passenger" : t.mode);
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
  // Busy and empty cards wear the task card's top line (Mor, 2026-10-10:
  // one layout for every card): dot and label, the time on the far side.
  // `span` (a running event's start/end, epoch ms): the time gone fills in
  // like its schedule row, and its light runs round the edge (Mor, 2026-10-11;
  // app.css .going, sc-prog, sc-orbit phased off the wall clock).
  function plainCard(cls, { meta, side, title, open, why, extras = [], action, color, span }){
    const going = span ? `--dur:${span.end - span.start}ms;--el:-${Date.now() - span.start}ms;--orbit:-${Date.now() % 9000}ms;` : "";
    return h("div", { className: `now-card main hero ${cls}` + (span ? " going" : ""), style: (color ? `--ev:${color};` : "") + going },
      h("div", { className: "hero-top" },
        h("span", { className: "hero-area" }, h("span", { className: "dot", ariaHidden: "true" }), h("span", { className: "hero-where", textContent: meta })),
        side && h("span", { className: "hero-side", textContent: side })),
      open ? h("button", { type: "button", className: "now-title", dir: "auto", textContent: title, ariaLabel: `Open ${title}`, onclick: open })
        : h("div", { className: "now-title", dir: "auto", textContent: title }),
      why && h("p", { className: "now-why", textContent: why }),
      ...extras, action);
  }
  const eventCard = (o) => plainCard("meeting event", o);
  const quietCard = (o) => plainCard("empty quiet", o);
  const freeNowButton = (ev, label) => h("button", { className: "btn quiet free-now", type: "button", textContent: "I'm free now",
    ariaLabel: `I'm free now: ignore ${label} and pick a task anyway`, onclick: () => setFree(ev.start) });

  // Driving and no call to make (hands-free calls are the one thing that
  // fits, Mor 2026-10-05): just this. "I'm a passenger" counts as a bus
  // ride (sitting, phone in hand), held by hand: a car trip on the calendar
  // or a lost location would otherwise put the driving card straight back.
  // The drive on the calendar becomes "Riding back from…" for the day
  // (trips.asPassenger), so the plan puts phone tasks on it.
  function passenger(){
    setManual("bus");
    const tripDay = cal.status === "ok" && asPassenger(cal.events, settings.tripDay || []);
    if (!tripDay) return;
    settings = { ...settings, tripDay }; applyTrips(); render();
    saveSettings(uid, { tripDay }).catch(fail);
  }
  // On a ride with nothing that fits it. The ride is already the free time
  // (momentInput), so no "I'm free now": that only ignored the ride and asked
  // again (Mor, 2026-10-09: passenger → free now → "Ignoring Drive back…").
  const riderOf = (leg) => leg.trip.mode === "car" && leg.trip.place !== "car" ? "passenger" : howOf(leg.trip);
  // "None of these": the ride is a rest, and the card stops asking (this
  // ride only; Mor, 2026-10-09: there was no answer for "nothing").
  let restRide = null;
  function rideCard(leg, r){
    const meta = TRIP_ON[riderOf(leg)], side = leg.trip.late ? `past ${clock(leg.trip.late)}` : `until ${clock(leg.end)}`;
    if (restRide === leg.id) return eventCard({ meta, side, title: leg.title, span: leg, why: "Rest. Daisey picks again when you arrive.",
      action: h("button", { className: "btn quiet", type: "button", textContent: "Show tasks again", onclick: () => { restRide = null; render(); } }) });
    // What's left after the phone search (phoneNow) found nothing that fits:
    // one tap says this one works on the phone, and it's offered. Minimal
    // (Mor, 2026-10-12): the question is the card's one sentence, the tasks
    // are title-only small cards, resting is the one quiet button.
    const looking = searching();
    const can = looking ? [] : r.out.filter((o) => o.reason === "place" && needsLaptop(o.task)).slice(0, 3);
    const why = leg.trip.late ? "Still on the way. The plan waits until you're there."
      : looking ? "Looking for phone tasks…" : can.length ? "Any of these doable on the phone?" : "Nothing fits the rest of the ride.";
    return eventCard({ meta, side, title: leg.title, span: leg, why,
      // No "Out right now" / "You seem to be…" here: the ride already says
      // where you are and why nothing fits (Mor, 2026-10-11: five stacked asks).
      extras: [can.length ? switchRow(can.map((o) => ({ task: o.task })), (t) => updateTask(uid, t, { laptop: false }, tasks || []).catch(fail),
        (t) => `${t.title} works on the phone`, true) : null, putOffButton(r)],
      action: looking ? null : h("button", { type: "button", className: "btn quiet", textContent: can.length ? "None of these" : "Just rest",
        onclick: () => { restRide = leg.id; render(); } }) });
  }
  // Wears its schedule row's look (Mor, 2026-10-11): the trip colour and the
  // light round its edge, and on a running trip leg the time gone filling in.
  function drivingCard(leg){
    return eventCard({ meta: "Driving", title: "Eyes on the road", why: "I'll have something ready when you stop.", color: "#8c8574", span: leg || undefined,
      action: h("button", { className: "btn quiet", type: "button", textContent: "I'm a passenger", onclick: passenger }) });
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
    return eventCard({ meta: "Now", side: `until ${clock(end)}`, title: ev.title, color: ev.color, span: ev,
      why: left ? `${dur(left)} left. Daisey picks a task again when it ends.` : "Just about done.",
      // With someone a Pending task waits on: worth raising while you're there.
      extras: waitingFor(ev.title, tasks || []).slice(0, 3).map((t) => h("p", { className: "now-wait" },
        `Waiting on ${personOf(t.waitingOn)}: `, bdi(t.title))),
      action: freeNowButton(ev, ev.title) });
  }

  // No running card, no clock and no Deep Focus (Mor, 2026-10-10): a task is
  // on the card until Done, Later, Pending or Switch moves it. A run left
  // from before (state/now: a reload, the other device on an old copy) is
  // ended on sight, its minutes kept, as Stop did. A batch keeps the ones
  // already ticked.
  // Focus mode: in settings, so it holds across a reload and the other device.
  const focusOn = () => settings.focusMode === true;
  const setFocus = (on) => { if (on) workingFrom = Date.now(); if (on === focusOn()) return; settings = { ...settings, focusMode: on }; render(); saveSettings(uid, { focusMode: on }).catch(fail); };
  // Picking a task, or Focus on one, is work starting (user test #16: "Rough
  // day?" came 90 min into a task picked via Focus). It counts as activity
  // until the task's time left has run from the pick.
  let workingFrom = 0;
  const workingUntil = () => {
    const t = workingFrom && (tasks || []).find((x) => x.id === (state.chosen || (focusOn() ? shown : null)));
    return t ? Math.min(Date.now(), workingFrom + leftMinutes(t) * 60000) : 0;
  };
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

  // The running task was deleted (the sheet, a project's Delete, the other
  // device): end the run, or focus mode stays on a task that's gone. Only on a
  // server snapshot (guests have no server), and not for a run just started,
  // whose task can lag behind the run doc on another device. Its minutes
  // still count for the project (the work log), from the last list it was in.
  const dropGhostRun = (meta, was) => {
    if (!run || !tasks || (meta?.fromCache && !guest) || Date.now() - run.startedAt < 120000) return;
    if ((run.batch || [run.taskId]).some((id) => tasks.some((t) => t.id === id))) return;
    const gone = !run.batch && (was || []).find((t) => t.id === run.taskId), m = gone ? bookedMinutes(run, gone) : 0;
    if (gone && m >= CANCEL_KEEP_MINUTES) logWork(uid, gone, m).catch(fail);
    run = null; cancelRun(uid).catch(fail);
  };

  // Later and Pending both move the card on: it slides out, the next slides
  // in, and for 5 seconds a toast offers Undo. Nothing waits on the write.
  function stepAside(task, { label, write, lesson = false }){
    const before = skipSnapshot(task);
    const go = () => {
      skips.add(task.id);
      reset();
      slideIn = true;
      setToast({ task, before, label, lesson, asking: !isRoutine(task) });
      write().catch(fail);
      render();
    };
    // Only the card's own task slides it out (a missed row's sheet asks too).
    const el = task.id === shown && root.querySelector(".now-card.main");
    if (el && motionOK()) { el.classList.remove("in", "push-in"); el.classList.add("out"); holdCard = true; setTimeout(() => { holdCard = false; go(); }, SLIDE_MS); } else go();
  }

  // Later asks when (Mor, 2026-10-04). Every answer is a "not now" to
  // learn from; only "later today" counts toward the stale rule, since the
  // other two are a plan, not a refusal.
  //   today    off the card for LATER_MINUTES, back the same day
  //   tomorrow not before tomorrow (Mor, 2026-10-05)
  //   week     not before the roomiest day this week (triage.pickWeekDay)
  //   someday  parked until moved back
  const declined = (task) => bumpLearn(uid, task.type, timeBucket().part, "skips");
  // Later today on a planned task moves it on the plan too (proposal.lay
  // it.hold): the Today list and the card both lay the rest first. null: Undo.
  function holdInPlan(task, until){
    const p = approvedPlan();
    if (!p?.items?.some((it) => it.taskId === task.id && (until || it.hold))) return;
    savePlan("approved", p.items.map((it) => (it.taskId !== task.id ? it : until ? { ...it, hold: until } : (({ hold, ...rest }) => rest)(it))),
      { kept: p.kept || [], ...unseen(p, "cut"), ...unseen(p, "added") });
  }
  function later(task, when, extra = null){
    if (when === "today") {
      holdInPlan(task, Date.now() + LATER_MINUTES * 60000);
      stepAside(task, { label: `Later (${dur(LATER_MINUTES)}): `, lesson: true, write: () => Promise.all([skipNow(uid, task), declined(task), extra ? restoreTask(uid, task.id, extra) : null]) });
    } else if (when === "tomorrow") {
      // Still up past midnight (before 04:00): tomorrow is the day you wake into.
      let day = dayAfter(1);
      if (task.dateKind === "deadline" && task.due && task.due < day) day = task.due; // never hide it past its deadline
      stepAside(task, { label: "Tomorrow: ", lesson: true, write: () => Promise.all([restoreTask(uid, task.id, { ...pushedTo(task, { notBefore: day }), ...extra }), declined(task)]) });
    } else if (when === "week") {
      let day = pickWeekDay(task, { events: cal.status === "ok" ? cal.events : [], tasks: tasks || [], hours: usualHours(settings) }); // other days: no stretch
      if (task.dateKind === "deadline" && task.due && task.due < day) day = task.due; // never hide it past its deadline
      const label = new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      stepAside(task, { label: `This week (${label}): `, lesson: true, write: () => Promise.all([restoreTask(uid, task.id, { ...pushedTo(task, { notBefore: day }), ...extra }), declined(task)]) });
    } else if (when === "someday") {
      stepAside(task, { label: "On hold: ", lesson: true, write: () => Promise.all([restoreTask(uid, task.id, { status: "someday", touchedAt: Date.now(), ...extra }), declined(task)]) });
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
    const check = h("input", { id: "pendCheck", type: "date", value: state.pendCheck || pendingCheck(task), min: logicalDate(),
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
    // While it asks how much is left it stays, until answered (Mor, 2026-10-11).
    if (t && !t.asking) toastTimer = setTimeout(() => { toast = null; render(); }, UNDO_MS);
  }

  function undo(){
    const { task, before } = toast;
    holdInPlan(task, null);
    skips.delete(task.id);
    state.chosen = task.id;
    setToast(null);
    // skipSnapshot holds the skip counts and the progress / size "Left" wrote.
    restoreTask(uid, task.id, before).catch(fail);
    render();
  }

  // "How much is left?": the answer writes progress (model.leftPatch), and
  // only then does the toast start its 5 seconds. null: Not sure, keep the guess.
  const LEFT_OPTIONS = [[15, "15 min"], [30, "30 min"], [60, "1 h"], [120, "2 h+"]];
  function setLeft(m){
    if (!toast?.asking) return;
    const { task } = toast;
    toast.asking = false; toast.left = m;
    if (m) restoreTask(uid, task.id, leftPatch(task, m)).catch(fail);
    setToast(toast);
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
    const pop = h("div", { className: toast.asking ? "toast" : "toast timed", role: "status" },
      h("div", { className: "toast-row" },
        h("span", { className: "toast-text" }, toast.label, bdi(task.title)),
        h("button", { className: "toast-undo", type: "button", textContent: "Undo",
          ariaLabel: `Undo: put ${task.title} back on the card`, onclick: undo })),
      // Not finished, so how much is left? Asked plainly, and the toast
      // waits for it; a routine's session is always whole, so it never asks.
      toast.asking && h("div", { className: "toast-why-row toast-ask", role: "group", ariaLabel: "How much is left?" },
        h("span", { className: "toast-ask-q", textContent: "How much is left?" }),
        ...LEFT_OPTIONS.map(([m, text]) => h("button", { className: "toast-why", type: "button", textContent: text, ariaLabel: `${text} left`, onclick: () => setLeft(m) })),
        h("button", { className: "toast-why quiet", type: "button", textContent: "Not sure", ariaLabel: "Not sure: keep Daisey's guess", onclick: () => setLeft(null) })),
      toast.left && h("div", { className: "toast-why-row" }, h("span", { className: "toast-thanks", textContent: `Left: ${dur(toast.left)}` })),
      // Why? only once Left is answered: one row of buttons at a time.
      toast.lesson && !toast.asking && (toast.taught
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
    className: `iconbtn act-${name}`, type: "button", title: `${label} — ${hint}`, ariaLabel: `${label}: ${hint}`, ...props,
    onclick: (e) => { tapped = name; props.onclick?.(e); },
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
    if (freeFrom && !cal.events.some((e) => Date.parse(e.start) === freeFrom && Date.parse(e.end) > Date.now())) { freeFrom = null; saveMoment(uid, { freeFrom: null }).catch(fail); }
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
  // When each task on screen came up (round 2, 2026-10-11): its reason's
  // window starts there and holds, so "now · 20:35–20:50" doesn't tick with
  // the clock. Re-anchored after WHY_HOLD (the stated start would read as
  // late), and dropped once the task is off the screen or an action moves on.
  // (seenAt is declared up by reset.)
  const WHY_HOLD = 15 * 60000;
  function heldAnchors(now = Date.now()){
    for (const [id, at] of seenAt) if (now - at >= WHY_HOLD) seenAt.set(id, now);
    return Object.fromEntries(seenAt);
  }
  function seenOnScreen(ids){
    const now = Date.now();
    seenAt = new Map(ids.map((id) => [id, seenAt.get(id) ?? now]));
  }
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
        : block ? { window: Math.floor((block.end - now) / 60000), windowEnd: block.end, blockProject: block.project }
        : leg ? { window: Math.floor((leg.end - now) / 60000), windowEnd: leg.end }
        : { window: fw.window, windowEnd: fw.end, nextEvent: fw.next?.title ?? null }),
      ...(said ? { window: Math.min(said, !fw ? 60 : block ? Math.floor((block.end - now) / 60000) : fw.window), realWindow: true,
        windowEnd: Math.min(momentDoc.free.at + momentDoc.free.minutes * 60000, (block || leg)?.end ?? fw?.end ?? Infinity) } : {}),
      anchors: heldAnchors(now),
      ...workBase(tasks || [], now),
      projectDue,
      sessionSkips: hidden(now),
      skipsToday: skipCounts(),
      place: f.place.value,
      spot: f.place.spot,
      learnStats,
      booked: Object.fromEntries([...booked()].map(([id, b]) => [id, b.start])),
      routineCal: routineCal(now),
      phoneOk: phoneNow(f.place.value),
    };
  }
  // On a bus or in the passenger seat, the Computer tasks a phone can do
  // count too (phone.js): asked about once, then read from memory.
  function phoneNow(place){
    if (!["bus", "ride"].includes(place) || !tasks) return [];
    findPhoneTasks(tasks, { guest }).then((changed) => changed && render()).catch(fail);
    return [...phoneOkIds(tasks)];
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
    // Before the day starts it's still "tonight" until 04:00 (model.js
    // LATE_HOUR, day.js dayWord); after that the morning's
    // plan is today's, not tomorrow's.
    const early = dayWord(localDate(morning), now) === "today";
    // A real deadline that's today and still open (2026-10-06): the night
    // screen said "Nothing needs you tonight" over it, and by morning it read
    // "deadline passed". It gets named, with a Start — the one thing night
    // mode lets through.
    const today = logicalDate(now);
    const dueTonight = early ? [] : (tasks || []).filter((t) => t.status === "ready" && t.dateKind === "deadline"
      && t.due === today && !notYet(t, now) && !(t.dueTime && now >= dueAt(t)));
    // Already named under "Due today" — don't offer it again as tomorrow's pick.
    const dueIds = new Set(dueTonight.map((t) => t.id));
    const r = rank((tasks || []).filter((t) => !dueIds.has(t.id)), {
      now: morning,
      ...(!fw ? { realWindow: false } : { window: fw.current ? 60 : fw.window, nextEvent: fw.next?.title ?? null }),
      ...workBase(tasks || [], now),
      flowProject: null, // tonight's last task isn't warm by morning
      projectDue,
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
    // The first thing is in another city nobody has said how to reach yet
    // (trips.tripAsks): asked right here. It was only in Needs you, under
    // "Nothing needs you yet", the morning you'd have to leave (2026-10-10).
    const ask = !leave && first && cal.status === "ok"
      && tripAsks(cal.events, settings.trips || {}, { now, home: homeAt(), days: 2 }).find((a) => localDate(Date.parse(a.ev.start)) === day);
    const leaveLine = leave ? tripChips(leave, `Leave ${clock(Date.parse(leave.start))} ${TRIP_BY[howOf(leave.trip)]}`)
      : ask && h("div", { className: "trip-chips" }, tripAskChip(ask));
    const who = name ? `, ${name}` : "";
    // The day behind you (Mor, 2026-10-10): what got done, and what's still
    // open for today with one way to sort it — the evening wrap (needs.js),
    // the same one the end-of-day notification opens. Nothing done and
    // nothing open: no section, and never a "0 done".
    const done = early ? [] : doneToday(tasks || []), loose = early ? [] : wrapList(tasks || []);
    const todayView = (done.length > 0 || (loose.length > 0 && onWrap)) && h("section", { className: "night-today", ariaLabel: "Today" },
      done.length > 0 && h("div", { className: "night-label", textContent: `Done today · ${done.length}` }),
      done.length > 0 && h("ul", { className: "night-done" }, ...done.slice(0, 4).map((t) => h("li", {}, bdi(t.title))),
        done.length > 4 && h("li", { className: "more", textContent: `and ${done.length - 4} more` })),
      loose.length > 0 && onWrap && h("div", { className: "night-loose" },
        h("span", { textContent: loose.length === 1 ? "1 still open for today" : `${loose.length} still open for today` }),
        h("button", { className: "pill-btn", type: "button", textContent: "Sort them", ariaLabel: "Sort what's still open for today", onclick: () => onWrap() })));
    const lead = dueTonight.length === 1 ? "One deadline is still open today." : `${dueTonight.length} deadlines are still open today.`;
    return [
      h("div", { className: "stars", ariaHidden: "true" }, ...[0, 1, 2, 3].map(() => h("span"))),
      h("div", { className: "night-hero" }, moonDaisy(), h("div", { className: "night-txt" },
        h("h2", { className: "night-h", textContent: early ? `Early${who}.` : `Late${who}.` }),
        h("p", { className: "night-p", textContent: ask ? `One question about ${early ? "today" : "tomorrow"}.`
          : early ? "Nothing needs you yet. Here's your day."
          : dueTonight.length ? lead : "Nothing needs you tonight. Here's tomorrow." }))),
      todayView,
      // Both cards wear the main card's design (Mor, 2026-10-07): hero top row,
      // big title, why line, the same actions. The label is the eyebrow above.
      dueTonight.length > 0 && h("section", { className: "now-card main hero night" + areaClass(dueTonight[0]), ariaLabel: "Due today" },
        h("div", { className: "night-label", textContent: "Due today" }),
        heroTop(dueTonight[0], dueTonight[0].dueTime ? `Due ${dueTonight[0].dueTime}` : "Today"),
        onOpen ? titleButton(dueTonight[0]) : h("div", { className: "now-title", dir: "auto", textContent: dueTonight[0].title }),
        h("p", { className: "now-why", textContent: dur(Math.max(5, (dueTonight[0].size || 0) - (dueTonight[0].spentMinutes || 0))) + " left" }),
        dueTonight.length > 1 && h("p", { className: "now-why", textContent: "Also due: " + dueTonight.slice(1).map((t) => t.title).join(", ") }),
        ...cardActions(dueTonight[0], [])),
      h("section", { className: "now-card main hero night" + (p ? areaClass(p.task) : ""), ariaLabel: early ? "First today" : "Tomorrow first" },
        h("div", { className: "night-label", textContent: early ? "First today" : "Tomorrow first" }),
        ...(p ? [
          heroTop(p.task, [heroChip(p.task), mark(p.task)].filter(Boolean).join(" · ")),
          onOpen ? titleButton(p.task) : h("div", { className: "now-title", dir: "auto", textContent: p.task.title }),
          progressBar(p.task),
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
        ] : [
          main && h("p", { className: "now-why" }, `${clock(Date.parse(main.start))}–${clock(Date.parse(main.end))} `, bdi(main.title)),
          leaveLine,
          h("p", { className: "now-empty", textContent: "Nothing lined up yet." }),
        ])),
      // The ride is for the event, not the task above: its own card.
      p && leaveLine && h("section", { className: "now-card main hero night ride", ariaLabel: "Getting there" },
        h("div", { className: "night-label" }, "Getting to ", bdi(main.title)),
        leaveLine),
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
      ...cardActions(b.task, []), outLine(r), putOffButton(r));
  }

  // Nothing fits before the next calendar event: the event is the card —
  // when it starts, how long until then — and it opens like any event.
  // ev: freeWindow's next (start/end already epoch ms).
  function upcomingCard(ev, r){
    const mins = Math.max(0, Math.round((ev.start - Date.now()) / 60000));
    return eventCard({ meta: "Coming up", side: clock(ev.start), title: ev.title, color: ev.color,
      open: onEvent ? () => onEvent({ ...ev, start: new Date(ev.start).toISOString(), end: new Date(ev.end).toISOString() }) : null,
      why: mins ? `In ${dur(mins)}. Nothing else fits before it.` : "Starting now.",
      extras: [outLine(r), putOffButton(r)] });
  }
  // Why the open tasks can't come up now, counted: "Out right now: 3 put
  // off today · 2 need offices open." Parked, waiting and future-dated tasks
  // aren't news, so they aren't counted.
  // [one, more]: "1 needs offices open", "2 need offices open".
  const OUT_SAID = {
    skipped: "put off today", office: ["needs offices open", "need offices open"], place: "can't be done where you are",
    size: "too long for the time you have", evening: ["is for the evening", "are for the evening"],
    block: ["belongs to another project", "belong to another project"], booked: "booked later",
  };
  const outSaid = (k, c) => (Array.isArray(OUT_SAID[k]) ? OUT_SAID[k][c === 1 ? 0 : 1] : OUT_SAID[k]);
  function outLine(r){
    const n = {};
    for (const o of r.out) if (OUT_SAID[o.reason]) n[o.reason] = (n[o.reason] || 0) + 1;
    delete n.booked; // the card itself is the booked one
    const parts = Object.entries(n).map(([k, c]) => `${c} ${outSaid(k, c)}`);
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
    // In the car, not driving: "a passenger", not the bus it counts as.
    const now = Date.now(), rider = m.place === "bus" && cal.status === "ok"
      && cal.events.some((e) => e.trip?.mode === "car" && e.trip.place === "bus" && Date.parse(e.start) <= now && now < Date.parse(e.end));
    const where = rider ? "a passenger" : m.place === "spot" ? `at ${m.spot}` : PLACE_SAID[m.place] || m.place;
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
  // "Nothing fits" isn't a dead end (user test #9: a guessed "office hours"
  // hid the one 2 h deadline task with 13 h free): what the moment filtered
  // out is still yours to pick, in Switch's row. A pick is "your pick".
  function anywayButton(r){
    const alts = r.out.filter((o) => SWITCH_TOO.has(o.reason)).map((o) => ({ task: o.task }));
    return alts.length > 0 && h("div", { className: "now-anyway" },
      h("button", { className: "btn quiet", type: "button", textContent: "Show me anyway", ariaExpanded: String(state.showAlts),
        onclick: () => { state.showAlts = !state.showAlts; render(); } }),
      state.showAlts && switchRow(alts));
  }
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
  // Only stakes the user set are said (engine PHRASES.stakes), never a guess.
  const MARKS = { penalty: "penalty if late", money: "costs money", someone: "affects someone" };
  const mark = (t) => (isGuess(t, "stakes") ? "" : MARKS[t.stakes] || "");
  const somedaySorted = () => somedayTasks().sort((a, b) => (STAKES_FIRST[a.stakes] ?? 3) - (STAKES_FIRST[b.stakes] ?? 3)
    || String(a.due || "~").localeCompare(String(b.due || "~")) || (a.createdAt || 0) - (b.createdAt || 0));

  // The empty state when nothing is active — every open task is waiting,
  // parked in Someday or dated later (Mor, 2026-10-05: "Nothing fits the next
  // 3 h. Take the break." was wrong there; it isn't about time). Up to 3 from
  // Someday, stakes first; tap to select, then bring them back in one go.
  // "Just rest" closes it for the day, the same as the Someday ask's Not now.
  const QUIET = new Set(["waiting", "someday", "notyet", "stale"]);
  const SWITCH_TOO = new Set(["size", "block", "place", "office", "evening", "booked"]);
  // Out for good right now: another place, the office shut, not evening yet.
  // A card holding a task that turns one of these lets go of it (keptCard,
  // and a Switch pick in renderCard) rather than waiting for a refresh.
  const CANT_NOW = new Set(["place", "office", "evening"]);
  function restState(){
    const list = somedaySorted().slice(0, 3);
    const rested = settings.somedayAsked === logicalDate();
    const offer = list.length > 0 && !rested;
    sd.sel = sd.sel.filter((id) => list.some((t) => t.id === id));
    const card = quietCard({ meta: "Nothing active", title: rested ? "Rest it is" : "You have time",
      why: offer ? "Everything open is waiting or set for later. Bring 1–2 back from On hold?" : "Everything open is waiting or set for later." });
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
      settings = { ...settings, somedayAsked: logicalDate() };
      render();
      saveSettings(uid, { somedayAsked: logicalDate() }).catch(fail);
    };
    return [card,
      h("h3", { className: "sd-head", textContent: "From On hold" }),
      h("ul", { className: "sd-pick" }, ...list.map((t) => {
        const on = sd.sel.includes(t.id);
        const meta = [projectShown(t) || ownArea(t), estText(t, t.size)].filter(Boolean).join(" · ");
        return h("li", {}, h("button", { type: "button", className: "sd-row" + (on ? " on" : ""),
          ariaPressed: String(on), ariaLabel: `Bring back ${t.title}${mark(t) ? ` (${mark(t)})` : ""}`,
          onclick: () => { sd.sel = on ? sd.sel.filter((id) => id !== t.id) : [...sd.sel, t.id]; render(); } },
        h("span", { className: "sd-text" },
          h("span", { className: "sd-title", textContent: t.title }),
          h("span", { className: "sd-meta", dir: "ltr" }, mark(t) && h("span", { className: "tag", textContent: mark(t) }),
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
      settings = { ...settings, somedayAsked: logicalDate() };
      render();
      saveSettings(uid, { somedayAsked: logicalDate() }).catch(fail);
    };
    const pick = (t) => {
      sd.picked.push(t.id);
      restoreTask(uid, t.id, bringBack(t)).catch(fail);
      if (sd.picked.length >= 2) close(); else render();
    };
    return h("div", { className: "learn-ask someday-ask", role: "group", ariaLabel: "Pick from On hold" },
      h("p", { className: "muted", textContent: sd.picked.length ? "One more, or that's the week?" : "Pick 1–2 from On hold for this week." }),
      h("div", { className: "someday-list" }, ...shownList.map((t) => h("button", { type: "button", className: "someday-item",
        ariaLabel: `Move ${t.title} to this week${mark(t) ? ` (${mark(t)})` : ""}`, onclick: () => pick(t) },
        bdi(t.title), mark(t) && h("span", { className: "someday-mark", textContent: mark(t) })))),
      h("div", { className: "learn-row" },
        list.length > shownList.length && h("button", { className: "chip quiet", type: "button", textContent: `Show all ${list.length}`,
          onclick: () => { sd.all = true; render(); } }),
        h("button", { className: "chip quiet", type: "button", textContent: sd.picked.length ? "Done" : "Not now", onclick: close })));
  }

  // Switch · Not now, then Done at the row's far end: the one loud
  // button (Mor, 2026-10-10: no Start on the card. The plan already says
  // what's on, so the loop is Done, Done, Later; Focus lives in the task
  // sheet). Each opens its own row under the card; a second tap shuts it.
  function cardActions(task, alts){
    const someN = somedayTasks().length;
    const toggle = (key) => () => { const was = state[key]; state.more = state.notNow = state.pendAsk = state.showAlts = false; state[key] = !was; state.altX = 0; render(); };
    const chip = (text, onclick) => h("button", { className: "chip", type: "button", textContent: text, onclick });
    const done = h("button", { className: "btn primary start", type: "button", ariaLabel: `Done: ${task.title}`,
      onclick: () => quickDoneNow(task) }, icon("check"), h("span", { textContent: "Done" }));
    return [
      h("div", { className: "now-actions now-row" },
        // Never a dead end while On hold holds tasks (DAISEY_SPEC "Someday comes back").
        (alts.length > 0 || someN > 0) && action("switch", "Switch", `something else instead of ${task.title}`, { ariaExpanded: String(state.showAlts), onclick: toggle("showAlts") }),
        // Not now: Later and Pending as one key (Mor, 2026-10-12: the card
        // was crowded on a phone); Pending is the row's first choice.
        action("later", "Not now", `later, or ${task.title} is waiting on something`, { ariaExpanded: String(state.notNow || state.pendAsk),
          onclick: () => { if (state.pendAsk) { state.pendAsk = false; render(); } else toggle("notNow")(); } }),
        // The progress bar sits under Done, as wide as it (Mor, 2026-10-12).
        h("div", { className: "done-col" }, done, progressBar(task), progressPct(task))),
      // Not now: Waiting on…, three times, then On hold set apart under them,
      // quieter and dashed, since it isn't a time: no date, into the
      // project's On hold list (Mor, 2026-10-10: In 10 min went).
      state.notNow && h("div", { className: "later-ask", role: "group", ariaLabel: "Not now: why, or when?" },
        h("button", { className: "chip pend-opt", type: "button", ariaLabel: `Pending: ${task.title} is waiting on something`,
          onclick: () => { state.notNow = false; state.pendAsk = true; render(); } }, icon("pending"), h("span", { textContent: "Waiting on…" })),
        ...[["today", "Later today"], ["tomorrow", "Tomorrow"], ["week", "This week"]].map(([w, text]) =>
          chip(text, () => later(task, w))),
        h("button", { className: "hold-opt", type: "button", ariaLabel: `Put ${task.title} on hold: no date, in the project's On hold list`, onclick: () => later(task, "someday") },
          icon("someday"), h("span", { textContent: "Put on hold" }), h("span", { className: "hold-opt-s", textContent: "· no date" }))),
      state.pendAsk && pendingAsk(task),
      state.showAlts && switchRow(alts),
    ];
  }

  // Done is one tap (Mor, 2026-10-11: the "how much is done" hold went; the
  // toast's Undo covers a mis-tap). A routine's tap is one whole session.
  // Done on a task that was never started here (already finished, or done
  // elsewhere): finished with no time booked, with an Undo.
  function quickDoneNow(task){
    // Done on the card itself (Mor, 2026-10-11): the card shines, confetti
    // and sparkles go up round it, then it slides out and the next card
    // slides into its spot. The write waits for the slide, as Later's does,
    // so the snapshot it fires can't redraw the card mid-shine.
    const el = task.id === shown && root.querySelector(".now-card.main");
    if (el?.classList.contains("won")) return; // a second tap mid-shine
    if (el && Date.now() - pushAt < PUSH_MS) return; // …or while the next card is still pushing in
    navigator.vibrate?.(15);
    const go = () => {
      const before = doneSnapshot(task);
      finishTask(uid, task).catch(fail);
      // No Done screen (Mor, 2026-10-11: "confusing, not doing anything good"):
      // the card moves straight on to the next task, and the toast holds Undo.
      reset(); slideIn = el ? "push" : false; render();
      flash("Done: ", task.title, { undo: () => { undoDone(uid, task.id, before).catch(fail); render(); } });
    };
    if (!el || !motionOK()) return go();
    el.style.animationDelay = "";
    el.classList.add("won");
    el.append(h("span", { className: "won-shine", ariaHidden: "true" }));
    celebrate(el);
    holdCard = true;
    setTimeout(() => { holdCard = false; dropAway(el); go(); }, WON_MS);
  }

  // Why an alternative, said as the Now card would say it (round 2,
  // 2026-10-11: Switch showed only how long and the area): its slot in the
  // approved plan, else the engine's reasons (held window and all), else
  // what keeps it off the card right now. Only facts: what the user typed,
  // the calendar, the plan. → pieces, or null.
  // planned: the approved plan's rows (planRowsNow), worked out once a render.
  function altWhy(s, r, fw, planned){
    const t = s.task, now = Date.now();
    const row = planned.find((x) => x.taskId === t.id);
    if (row) return [row.missed ? `planned for ${clock(row.start)}, not started`
      : row.start > now + 2 * 60000 ? `in your plan, ${clock(row.start)}–${clock(row.end)}` : `in your plan until ${clock(row.end)}`];
    if (s.whyParts?.length) return s.whyParts;
    const end = r.moment.windowEnd;
    switch (s.reason) {
      case "size": return [`${estText(t, leftMinutes(t))}${end ? `, free until ${clock(end)}` : ""}`];
      case "block": return blockOf(fw) ? ["not part of the ", { name: blockOf(fw).project }, " block"] : null;
      case "office": return isGuess(t, "openHours") ? null : ["offices are closed now"];
      case "evening": return isGuess(t, "openHours") ? null : ["for the evening"];
      case "booked": { const b = booked().get(t.id); return b?.start ? [`on your calendar at ${clock(b.start)}`] : null; }
      case "place": return ["not for where you are now"];
      default: return null;
    }
  }

  const planRowsNow = () => { const p = approvedPlan(); return p && tasks ? timeline(p.items || [], { ...planCtx(), since: planSince() }).rows : []; };

  // Switch's row, under the card like Later's and Pending's (Mor,
  // 2026-10-10): the other tasks as small cards in the main card's look
  // (area colour, how long it takes, project, title), one row as tall
  // as Later's open row that scrolls and drags sideways (ui.js dragScroll),
  // keeping its place across redraws; or the way into On hold when there
  // are none.
  // onPick: what tapping one does; aria: its label, when it isn't a switch;
  // mini: title only (the ride card's phone ask).
  function switchRow(alts, onPick = (t) => { switchTo(t.id); state.altX = 0; }, aria = null, mini = false){
    if (!alts.length) return h("div", { className: "later-ask", role: "group", ariaLabel: "Other tasks" },
      h("span", { className: "muted", textContent: "Nothing else is active." }),
      h("button", { className: "chip", type: "button", textContent: "Pick from On hold", onclick: () => { sd.open = true; state.showAlts = false; render(); } }));
    const row = dragScroll(h("div", { className: "later-ask switch-ask", role: "group", ariaLabel: "Other tasks" }, ...alts.map(({ task: t, why }) => h("button", {
      type: "button", className: "alt-card" + (mini ? " mini" : "") + areaClass(t), ariaLabel: aria ? aria(t) : `Put ${t.title} on the card instead, ${howLong(t)}${why ? `, ${why.map((p) => (typeof p === "string" ? p : p.name)).join("")}` : ""}`,
      onclick: () => onPick(t),
    }, !mini && h("span", { className: "hero-top" },
        h("span", { className: "hero-area" },
          // How long first, so a long project name is what gets cut short.
          h("span", { className: "alt-at", textContent: howLong(t) }),
          h("span", { className: "hero-where" }, projectShown(t) ? bdi(t.project) : ownArea(t) || "Inbox"))),
      h("span", { className: "alt-t", dir: "auto", textContent: t.title }),
      why && h("span", { className: "alt-why" }, ...say(sentence(why)))))));
    row.addEventListener("scroll", () => { state.altX = row.scrollLeft; }, { passive: true });
    if (state.altX) requestAnimationFrame(() => { row.scrollLeft = state.altX; });
    return row;
  }
  // Switch moves the plan too (Mor, 2026-10-10: "switch doesn't affect the
  // schedule"): the picked task goes in just before the one on the card, in
  // the approved plan or the open proposal, so the schedule shows the swap
  // and everything after shifts. Not in the plan yet: it joins there.
  function switchTo(id){
    const task = (tasks || []).find((t) => t.id === id);
    const reorder = (items) => {
      const was = items.find((it) => it.taskId === id);
      const rest = items.filter((it) => it !== was);
      const { at, ...moved } = was || { taskId: id, minutes: task ? leftMinutes(task) : 30 }; // its old fixed time goes with the old slot
      const i = rest.findIndex((it) => it.taskId === shown);
      rest.splice(i < 0 ? 0 : i, 0, moved);
      return trimBreaks(rest);
    };
    const ap = approvedPlan();
    if (prop.open && prop.items.length && (!ap || prop.touched)) { prop.items = reorder(prop.items); prop.touched = true; }
    else if (ap) savePlan("approved", reorder(ap.items || []), { kept: ap.kept || [], ...unseen(ap, "cut"), ...unseen(ap, "added") });
    // A switch is activity: the approved plan is laid from the last one
    // (proposal.js timeline since), so without this the moved task landed in
    // the old head's past slot, "didn't happen", while Now pointed elsewhere.
    if (task) { task.touchedAt = Date.now(); restoreTask(uid, id, { touchedAt: task.touchedAt }).catch(fail); }
    state.chosen = id; state.showAlts = false; workingFrom = Date.now();
    render();
  }

  // A planned task that didn't happen (the schedule's "?", Mor 2026-10-10):
  // what now? Done after all, now (Switch), the Later times, or On hold set
  // apart as in Later. Answering clears the "?" and the Needs you ask with it.
  function missedSheet(id, start){
    const task = (tasks || []).find((t) => t.id === id), dlg = missDialog;
    if (!task || !dlg) return;
    const act = (fn) => () => { dlg.close(); fn(); };
    const chip = (text, fn) => h("button", { className: "chip", type: "button", textContent: text, onclick: act(fn) });
    dlg.replaceChildren(
      h("div", { className: "now-head" }, h("h2", { id: "missTitle", textContent: start ? `Didn't happen at ${clock(start)}` : "Didn't happen" }),
        h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dlg.close() })),
      h("p", { className: "miss-task", dir: "auto", textContent: task.title }),
      h("div", { className: "miss-acts" },
        // Yellow with a check is Done, as on the card (Mor, 2026-10-10).
        h("button", { className: "btn primary", type: "button", onclick: act(() => quickDoneNow(task)) }, icon("check"), h("span", { textContent: "I did it" })),
        h("button", { className: "btn line", type: "button", onclick: act(() => switchTo(id)) }, icon("play"), h("span", { textContent: "Do it now" }))),
      h("div", { className: "later-ask", role: "group", ariaLabel: "Or later" },
        ...[["today", "Later today"], ["tomorrow", "Tomorrow"], ["week", "This week"]].map(([w, text]) => chip(text, () => later(task, w))),
        h("button", { className: "hold-opt", type: "button", ariaLabel: `Put ${task.title} on hold: no date, in the project's On hold list`, onclick: act(() => later(task, "someday")) },
          icon("someday"), h("span", { textContent: "Put on hold" }), h("span", { className: "hold-opt-s", textContent: "· no date" }))));
    dlg.showModal();
  }

  // How long a Switch card's task takes: what's left once some is done
  // (Mor, 2026-10-10: not its time in the plan).
  function howLong(t){
    const left = leftMinutes(t), size = toMinutes(t.size) ?? left;
    return left < size ? `${dur(left)} left` : dur(size);
  }

  // ---------- The day's proposed schedule (proposal.js, 2026-10-07) ----------
  // At the start of the day the card is Daisey's proposal for the rest of
  // today: approve it, reorder it, drop items, open one to edit it, or ask
  // for a rethink. On demand from the plan line, the Free row or Schedule's
  // "Plan my day". Approved, the card follows it in order.
  // Today's answers to the meal question (meals.js): { [name]: "HH:MM" | "there" }.
  const mealAnswers = () => { const m = settings.mealToday; if (m?.date !== answerDate(settings)) return {}; const { date, ...rest } = m; return rest; };
  // The day a plan on screen is laid against, taken when it's laid: taken
  // later, at the first render, a change made in between went unnoticed.
  const daySigNow = () => (cal.status === "ok" ? daySig(cal.events, dayHours(settings)) : null);
  const planCtx = () => { phoneAhead(); return { tasks: tasks || [], events: cal.status === "ok" ? cal.events : [], now: Date.now(), hours: dayHours(settings), settings, run }; };
  // A bus or passenger ride still to come today: look for phone tasks now
  // (phone.js), so the plan can put them on it. A proposal nobody has
  // touched yet is laid again with the answer.
  function phoneAhead(){
    const now = Date.now();
    if (!tasks || cal.status !== "ok" || !cal.events.some((e) => ["bus", "ride"].includes(e.trip?.place) && Date.parse(e.end) > now && localDate(Date.parse(e.start)) === localDate(now))) return;
    findPhoneTasks(tasks, { guest }).then((changed) => {
      if (!changed) return;
      if (prop.open && !prop.touched && !prop.busy && !todaysPlan()?.items?.length) prop.items = withBreaks(proposeDay({ ...planCtx(), exclude: prop.exclude }), planCtx());
      render();
    }).catch(fail);
  }
  const todaysPlan = () => (dayPlan?.date === dayKey() ? dayPlan : null);
  const approvedPlan = () => (todaysPlan()?.status === "approved" ? dayPlan : null);
  function openProposal(){
    const saved = todaysPlan(), ctx = planCtx(), reuse = saved?.items?.length && saved.status !== "dismissed";
    const re = reuse ? relayMeals(stillOpen(saved.items), ctx, saved.mealsLaid || {}) : null;
    // A proposal you changed and closed unanswered comes back as you left it.
    const parked = !reuse && prop.parked === dayKey() && prop.items.length > 0;
    if (!parked) {
      prop.items = withBreaks(reuse ? re.items : proposeDay({ ...ctx, exclude: prop.exclude }), ctx);
      prop.mealsLaid = reuse ? re.laid : mealAnswers();
    }
    prop.touched = parked; prop.parked = null; prop.sig = daySigNow(); prop.known = null; prop.askOpts = null;
    prop.open = true; prop.ask = false; prop.note = ""; nudgeDay = null;
    // The Now card doesn't change with the plan, so leave it be (a rebuild
    // nudged its text, Mor 2026-10-08).
    paintPlanScreen();
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
  // Closed with no answer (✕, or Projects / Week opened over it; user test
  // #11: it went silently, the card still saying "first in the plan
  // below"): a plan you changed is kept for Plan to bring back, the "Plan
  // ready" chip lights again, and the card stops pointing at it.
  const closeProposal = () => {
    const undecided = !todaysPlan();
    if (undecided && prop.touched) prop.parked = dayKey();
    prop.replan = false; prop.open = false; prop.ask = false; prop.note = "";
    if (undecided) { nudgeDay = dayKey(); render(); } else paintPlanScreen(); // a decided plan: the card stays as is
  };
  // extra: the refit's record ({ kept, cut }), kept until the plan is saved again.
  // unfit: what had No room when it was approved (proposal.unfitOf): never
  // late, never a slip, not counted on the Plan chip. Laid again on approval.
  // approvedAt: when the user last approved it (miss.js counts that as
  // activity; a refit saving the plan isn't), kept across later saves.
  // declined: ids taken off with the top-up's Undo, never added again today.
  // sig: the day the plan was saved against (proposal.daySig); topUpLater
  // compares it with the calendar now. mealsLaid: the meal answers already
  // laid into it (proposal.relayMeals), kept across later saves.
  // behindNo / offer: the behind ask's "Not now" and the top-up's open
  // question (planAsk, addedView), kept across later saves too.
  const savePlan = (status, items, extra = {}) => {
    const was = todaysPlan();
    const approvedAt = was?.approvedAt ?? null, declined = was?.declined || [], mealsLaid = was?.mealsLaid || {};
    extra = { ...(was?.behindNo ? { behindNo: was.behindNo } : {}), ...(was?.offer ? { offer: was.offer } : {}),
      ...(Array.isArray(was?.unfit) ? { unfit: was.unfit } : {}), ...extra };
    const sig = cal.status === "ok" ? daySig(cal.events, dayHours(settings)) : null;
    dayPlan = { date: dayKey(), status, items, approvedAt, declined, mealsLaid, sig, ...extra, at: Date.now() };
    saveDayPlan(uid, { date: dayPlan.date, status, items, approvedAt, declined, mealsLaid, sig, ...extra }).catch(fail);
  };
  // What has No room in these items, laid from now.
  const overIds = (items) => timeline(items, planCtx()).over.map((o) => o.taskId);
  // An unseen notice survives a save made for another reason.
  const unseen = (p, key) => (p?.[key] && !p[key].seen ? { [key]: p[key] } : {});
  // The approved plan no longer fits the day (an event added, running late),
  // or planned tasks' time came and went with nothing started: Daisey says
  // so under the card and ASKS (Mor, 2026-10-10: "it needs to always ask and
  // get approval"; supersedes 2026-10-08's cut-it-myself-and-say-so). What it
  // would take off is still proposal.refit's pick, what matters least.
  // Re-plan: that cut, and the rest laid from now. Review: the plan screen,
  // laid from now, to change by hand. Not now: quiet until what's missed or
  // what it would cut changes (behindNo). cut { ids, ok, before, asked }: an
  // approved cut, kept for the deadline question (cutView).
  function behindNow(){
    const p = approvedPlan();
    if (!p || !tasks || cal.status !== "ok" || prop.open || ppDragging) return null;
    const st = planStatus(p, planCtx(), planSince());
    if (st.late && !st.missed.length) return null; // the card is asking about the next task
    const { items, cut } = st;
    const missed = st.missed.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
    if (!missed.length && !cut.length) return null;
    const key = [...missed.map((t) => t.id), "|", ...cut].join(",");
    if (p.behindNo === key) return null;
    return { p, missed, cut, items, key, why: squeezedBy(p) };
  }
  // The plan slipped (Mor, 2026-10-10: the pop-up under the card was "in
  // your face"): still a question, but one in Needs you, counted on its chip.
  // needsAsks() hands it to needs.js (main.js passes it in); "Ask me later"
  // there hides it for the day like any other (settings.needsLater), and
  // what's missed or cut changing makes it a new question.
  function replanFrom(b){
    const { p } = b, gone = b.cut.length;
    savePlan("approved", b.items, { kept: p.kept || [], ...unseen(p, "added"), approvedAt: Date.now(), behindNo: null, unfit: overIds(b.items),
      ...(gone ? { cut: { ids: b.cut, ok: true, before: p.items, asked: [] } } : {}) });
    // The card lets go of the old plan's task, as approving does (Mor,
    // 2026-10-12: it stayed on the slipped one instead of the new next).
    reset();
    flash(gone ? `Re-planned from now. ${gone === 1 ? "One task" : `${gone} tasks`} back in your list.` : "Re-planned from now.");
    render();
  }
  function planAsk(){
    const b = behindNow();
    if (!b) return null;
    const key = `plan:${b.key}`, nl = settings.needsLater;
    if (nl?.date === logicalDate() && (nl.keys || []).includes(key)) return null;
    return { key, kind: "ext", ask: ({ next, close }) => {
      const c = behindNow();
      if (!c || `plan:${c.key}` !== key) return null; // answered or changed since
      const { missed } = c, gone = c.cut.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
      const sub = missed.length && gone.length ? `${missed.length} didn't happen, ${gone.length} won't fit.`
        : missed.length === 1 ? "It didn't happen."
        : missed.length ? `${missed.length} planned tasks didn't happen.`
        : `Running behind: ${gone.length} won't fit.`;
      return { tone: "area-work", ico: "later", q: "Your plan slipped", sub,
        item: (missed.length ? missed : gone).map((t) => t.title).join(", "),
        say: `Re-plan lays the rest of ${planWord()} from now${gone.length ? ", and what won't fit goes back in your list" : ""}.`,
        yes: ["Re-plan from now", () => { replanFrom(c); next(); }],
        no: ["Edit the plan", () => close(() => { prop.replan = true; openProposal(); })] };
    } };
  }
  // A meal the approved plan carried past its time (proposal.js lateMeals,
  // Mor 2026-10-12: "what if Daisey asks you if you ate?"). Ate → it's off
  // today's plan; not yet → it moves to now, next in the plan (relayMeals).
  function mealLateAsk(){
    const p = approvedPlan();
    if (!p || !tasks || cal.status !== "ok") return null;
    const said = mealAnswers(), name = timeline(p.items || [], planCtx()).lateMeals?.find((n) => !said[n]);
    if (!name) return null;
    const key = `mealate:${answerDate(settings)}:${name}`, nl = settings.needsLater;
    if (nl?.date === logicalDate() && (nl.keys || []).includes(key)) return null;
    const low = name.toLowerCase();
    return { key, kind: "ext", ask: ({ next }) => {
      if (mealAnswers()[name]) return null; // answered since
      const setMeal = (v) => {
        const today = answerDate(settings);
        const mealToday = { ...(settings.mealToday?.date === today ? settings.mealToday : {}), date: today, [name]: v };
        settings = { ...settings, mealToday };
        saveSettings(uid, { mealToday }).catch(fail);
        topUpLater(); render(); next();
      };
      // Right after the task on the card (relayMeals puts it before the first
      // row starting then; a plan never starts on a break, so not before it).
      const after = () => {
        const r = timeline(approvedPlan()?.items || [], planCtx()).rows.filter((x) => !x.ride).sort((a, b) => a.start - b.start)[0];
        const d = new Date(r ? r.end : Date.now());
        return minText(Math.min(d.getHours() * 60 + d.getMinutes(), 1435));
      };
      return { tone: "area-home", ico: "check", q: `Did you have ${low}?`,
        sub: "Its time passed while the plan ran late.", item: "",
        say: `If not, ${low} goes right after this task.`,
        yes: ["I ate", () => setMeal("there")],
        no: [`${name} next`, () => setMeal(after())] };
    } };
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
    // Asked, not added (Mor, 2026-10-10: always ask): addedView. One task
    // just goes in, said with Undo (Mor, same day: "it's just one task").
    if (added.length === 1) savePlan("approved", items, { kept: p.kept || [], ...unseen(p, "cut"), added: { ids: added } });
    else savePlan("approved", p.items || [], { kept: p.kept || [], ...unseen(p, "cut"), ...unseen(p, "added"), offer: { ids: added, add: items.slice((p.items || []).length) } });
    if (redraw) render();
  }
  function addedView(){
    const p = approvedPlan(), o = p?.offer;
    const offered = (o?.add || []).filter((it) => (tasks || []).some((t) => t.id === it.taskId && t.status === "ready") && !(p.items || []).some((x) => x.taskId === it.taskId));
    if (offered.length) {
      const got = offered.map((it) => tasks.find((t) => t.id === it.taskId));
      const keep = { kept: p.kept || [], ...unseen(p, "cut") };
      return h("div", { className: "toast plan-cut", role: "status" },
        h("div", { className: "toast-row" },
          h("span", { className: "toast-text" }, ...(got.length === 1 ? ["Time opened up. Add ", bdi(got[0].title), "?"] : [`Time opened up. Add ${got.length} tasks?`])),
          h("span", { className: "toast-acts" },
            h("button", { className: "toast-undo", type: "button", textContent: "Add", ariaLabel: `Add them to ${planWord()}'s plan`,
              // Said back (Mor, 2026-10-10: "I approved and nothing happened"):
              // they go on the plan's end, out of sight of the card.
              onclick: () => {
                savePlan("approved", [...(p.items || []), ...offered], { ...keep, offer: null });
                const undo = () => { savePlan("approved", p.items || [], { ...keep, offer: null, declined: [...(p.declined || []), ...o.ids] }); render(); };
                got.length === 1 ? flash("Added to the end of your plan: ", got[0].title, { undo }) : flash(`Added ${got.length} tasks to the end of your plan.`, null, { undo });
                render();
              } }),
            h("button", { className: "toast-undo", type: "button", textContent: "No", ariaLabel: "No, leave the plan as it is",
              onclick: () => { savePlan("approved", p.items || [], { ...keep, offer: null, declined: [...(p.declined || []), ...o.ids] }); render(); } }))));
    }
    const a = p?.added;
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
        h("span", { className: "toast-text" }, ...(got.length === 1 ? ["Time opened up: added ", bdi(got[0].title), " to the end of your plan."] : [`Added ${got.length} tasks to the end of your plan.`])),
        h("span", { className: "toast-acts" },
          h("button", { className: "toast-undo", type: "button", textContent: "Undo", ariaLabel: `Undo: take them off ${planWord()}'s plan`, onclick: undo }),
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
  // Tasks added while it's open join it too (user test #11: six deadline
  // tasks added in the morning never reached the plan): untouched, it's
  // laid again from scratch so they're weighed with the rest; changed by
  // you, they top up what's free. prop.known: the open tasks it has seen.
  function freshenProposal(){
    if (!prop.open || prop.busy || ppDragging || !tasks || cal.status !== "ok") return;
    const ctx = { ...planCtx(), ask: prop.askOpts || {} }, sig = daySig(ctx.events, ctx.hours);
    const open = tasks.filter((t) => t.status === "ready").map((t) => t.id);
    const added = prop.known ? open.filter((id) => !prop.known.has(id) && !prop.exclude.includes(id)) : [];
    prop.known = new Set(open);
    if ((prop.sig == null || prop.sig === sig) && !added.length) { prop.sig = sig; return; }
    prop.sig = sig;
    const ids = () => prop.items.filter((it) => it.taskId).map((it) => it.taskId).join();
    const before = ids();
    prop.items = prop.touched || approvedPlan()
      ? topUp(refit(relayMeals(prop.items, ctx, prop.mealsLaid || {}).items, ctx).items, ctx, prop.exclude).items
      : withBreaks(proposeDay({ ...ctx, exclude: prop.exclude }), ctx);
    prop.mealsLaid = mealAnswers(); // a fresh take already lays them
    if (ids() !== before) prop.note = added.length ? "Added what you just put in." : "Your day changed, so I updated the plan.";
  }
  function cutView(){
    const c = approvedPlan()?.cut;
    if (!c || c.seen) return null;
    const gone = c.ids.map((id) => (tasks || []).find((t) => t.id === id)).filter(Boolean);
    if (!gone.length) return null;
    const n = gone.length;
    // The follow-up: a real deadline today that no longer fits.
    const ask = gone.find((t) => t.status === "ready" && t.dateKind === "deadline" && t.due && t.due <= logicalDate() && !(c.asked || []).includes(t.id));
    const answer = (patch) => { if (patch) restoreTask(uid, ask.id, patch).catch(fail); cutSaved({ ...c, asked: [...(c.asked || []), ask.id] }); render(); };
    // A cut the user approved (planAsk): only the deadline question is left.
    if (c.ok) return ask ? h("div", { className: "toast plan-cut", role: "status" },
      h("div", { className: "toast-why-row", role: "group", ariaLabel: `${ask.title} is due today` },
        h("span", { className: "toast-text" }, bdi(ask.title), " is due today. Move it?"),
        h("button", { className: "toast-why", type: "button", textContent: "Tomorrow", onclick: () => answer(pushedTo(ask, { due: dayAfter(1) })) }),
        h("button", { className: "toast-why", type: "button", textContent: "Keep today", onclick: () => answer(null) }))) : null;
    return h("div", { className: "toast plan-cut", role: "status" },
      h("div", { className: "toast-row" },
        h("span", { className: "toast-text" }, ...(n === 1 ? ["Took ", bdi(gone[0].title), " off the plan."] : [`Took ${n} tasks off the plan.`])),
        h("span", { className: "toast-acts" },
          h("button", { className: "toast-undo", type: "button", textContent: "Undo", ariaLabel: `Undo: put them back in ${planWord()}'s plan`,
            onclick: () => { savePlan("approved", c.before, { kept: c.before.filter((it) => it.taskId).map((it) => it.taskId) }); render(); } }),
          h("button", { className: "toast-undo", type: "button", textContent: "OK", ariaLabel: "OK, got it",
            onclick: () => { cutSaved({ ...c, seen: true }); render(); } }))),
      ask && h("div", { className: "toast-why-row", role: "group", ariaLabel: `${ask.title} is due today` },
        h("span", { className: "toast-text" }, bdi(ask.title), " is due today. Move it?"),
        h("button", { className: "toast-why", type: "button", textContent: "Tomorrow", onclick: () => answer(pushedTo(ask, { due: dayAfter(1) })) }),
        h("button", { className: "toast-why", type: "button", textContent: "Keep today", onclick: () => answer(null) })));
  }
  // A Later today hold (it.hold) and an "In 10 min" (it.at) survive Save plan:
  // dropped, the Today list put a Later'd task back at its old time while the
  // card, honouring the Later, skipped it (2026-10-11).
  function approve(){
    const items = trimBreaks(prop.items).map(({ taskId, brk, minutes, name, at, hold }) => (brk ? { brk, minutes, ...(name ? { name } : {}) } : { taskId, minutes, ...(at ? { at } : {}), ...(hold ? { hold } : {}) }));
    const unfit = overIds(items), n = items.filter((it) => !isBreak(it) && !unfit.includes(it.taskId)).length;
    savePlan("approved", items, { approvedAt: Date.now(), mealsLaid: mealAnswers(), behindNo: null, offer: null, unfit });
    prop.open = false; prop.replan = false; prop.ask = false; prop.note = ""; reset();
    render();
    onPlanApproved?.();
    flash(`Plan set: ${n} ${n === 1 ? "task" : "tasks"}. The card follows it.`);
  }
  function dismiss(){ savePlan("dismissed", []); closeProposal(); }
  // Take an approved plan off today (Mor, 2026-10-10): the Schedule goes back
  // to just the calendar, which isn't touched. Undo puts the same plan back.
  function removePlan(){
    const was = approvedPlan();
    savePlan("dismissed", []); prop.open = false; prop.replan = false; prop.ask = false; prop.note = ""; reset();
    render();
    flash(`Removed ${planWord()}'s plan. Your calendar is untouched.`, null, was ? { undo: () => {
      const { at, ...doc } = was; dayPlan = { ...was, at: Date.now() }; saveDayPlan(uid, doc).catch(fail); render(); } } : {});
  }

  // ---------- Missed slot and the silence check (miss.js, 2026-10-08) ----------
  // While Daisey is open, a banner over the card asks; closed, the server
  // sends the same as a notification (notify.js "miss").
  // With an approved plan, its own timeline says what's late (planDue,
  // planAsk): one voice, not two (Mor, 2026-10-10).
  function missNow(){
    if (!tasks || cal.status !== "ok" || prop.open || approvedPlan()) return null;
    return missState({ tasks, events: cal.events, run, now: Date.now(), hours: dayHours(settings),
      planAt: Math.max(todaysPlan()?.approvedAt || 0, workingUntil()), silenceOn: settings.silenceOn || null });
  }
  const silenced = (date = localDate()) => { settings = { ...settings, silenceOn: date }; saveSettings(uid, { silenceOn: date }).catch(fail); };
  // A few small tasks for the rest of today, as a proposal to approve.
  function lighterPlan(){
    silenced();
    if (run) { flash("Finish or stop the running task first."); return; }
    const items = proposeDay({ ...planCtx(), ask: { fewer: true, quickFirst: true, maxEach: LIGHTER.each } });
    if (!items.length) { flash("Nothing small left for today. Take the rest of the day."); render(); return; }
    prop.items = withBreaks(items, planCtx()); prop.exclude = [];
    prop.touched = false; prop.sig = daySigNow(); prop.askOpts = { fewer: true, quickFirst: true, maxEach: LIGHTER.each };
    prop.open = true; prop.ask = false; prop.note = ""; reset();
    render();
  }
  // Both take the main card's place, never a box pushing it down (Mor,
  // 2026-10-08). A miss is the task's own card saying so, with its usual
  // actions; the silence check is a card of its own. No Shorten (Mor,
  // 2026-10-11): being late doesn't make the task any smaller.
  const missWhy = (card, st) => ({ ...card, whyParts: [`up since ${clock(st.start)} and not started`] });
  // The approved plan holds its times (proposal.timeline, 2026-10-10): when
  // the next task's start comes with nothing started, the card asks right
  // then (Mor: "more proactive"), before any miss would. → { taskId, start }
  // or null. In 10 min: that item's at, and a touch (an answer).
  const planSince = () => lastActivity(tasks || [], run, todaysPlan()?.approvedAt || 0);
  function planDue(){
    const p = approvedPlan();
    if (!p || !tasks || cal.status !== "ok" || prop.open) return null;
    return timeline(p.items || [], { ...planCtx(), since: planSince() }).late || null;
  }
  // The approved plan, now: { row } its next task in time (late or not),
  // { brk, next } inside one of its breaks,
  // null when nothing's left for now (done, or all put off): the engine picks.
  // skip: ids not to offer.
  function planNow(skip = []){
    const p = approvedPlan();
    if (!p || !tasks) return null;
    const now = Date.now(), tl = timeline(p.items || [], { ...planCtx(), since: planSince() });
    const off = new Set([...hidden(now), ...skip]);
    // A missed row (its whole time passed, nothing started) isn't "now": the
    // card showed it "until" a time already gone while Now sat on the next
    // (2026-10-10). The missed note under the card asks about it instead.
    const rows = tl.rows.filter((x) => !off.has(x.taskId) && !x.task.onHold && !x.missed);
    const brk = !run && tl.breaks.find((b) => b.start <= now && now < b.end);
    // The break's "Next" is the Today list's next row, a missed one too (user
    // test: "Next: Call mom 12:15" while the list showed Arnona at 11:30).
    const listNext = tl.rows.find((x) => !off.has(x.taskId) && !x.task.onHold) || null;
    if (brk && (!rows[0] || rows[0].start >= brk.end - 60000)) return { brk, next: listNext };
    if (rows[0]) return { row: rows[0] };
    return null;
  }
  // The card keeps its task until you act on it (engine.keepsCard, user
  // test #6). Done, Later, Pending, Switch, and a plan approved, dropped or
  // made lighter all let go (reset). kept: { id, why, until, day }.
  function keptCard(card, { r, fw, asCard, picked, planRow }){
    const k = kept, t = k && (tasks || []).find((x) => x.id === k.id);
    if (keepsCard(k, t, { nextId: card?.task.id, today: dayKey(), chosen: state.chosen, proposing: prop.open,
      meeting: !!fw?.current && !fw.current.trip && blockOf(fw)?.taskId !== k?.id, skipped: !!k && hidden().includes(k.id),
      ranked: !!k && r.ranked.some((s) => s.task.id === k.id), switchable: !!k && !!picked(k.id),
      cantNow: !!k && CANT_NOW.has(picked(k.id)?.reason),
      turn: !!planRow && planRow.taskId !== k?.id && planRow.start <= Date.now() }))
      return asCard(t.id, t, k.until && Date.now() > k.until ? [`still on it? Planned until ${clock(k.until)}`] : k.why);
    // Only a plan row, once everything has loaded (a first pick made before
    // the plan arrived isn't one): the card and the Today list agree otherwise.
    const until = card && (card.task.id === planRow?.taskId ? planRow.end : k?.id === card.task.id ? k.until : null);
    kept = until && planKnown && cal.status !== "loading" ? { id: card.task.id, why: card.whyParts, day: dayKey(), until } : null;
    return card;
  }
  // The engine's own pick, left on the card: when it came on (moment doc
  // cardSeen, so a reload doesn't restart the clock), and after 2 h with
  // nothing done to it, passed over for today (engine.passedOver).
  function noteSeen(task){
    if (!momentKnown) return;
    const s = momentDoc.cardSeen, now = Date.now(), day = dayKey();
    if (s?.id !== task.id || s.day !== day) {
      momentDoc = { ...momentDoc, cardSeen: { id: task.id, at: now, day } };
      saveMoment(uid, { cardSeen: momentDoc.cardSeen }).catch(fail);
      return;
    }
    const p = passedOver(task, s, { now, today: day });
    if (p) { Object.assign(task, p); restoreTask(uid, task.id, p).catch(fail); }
  }
  const planWhy = (row) => [row.start > Date.now() + 2 * 60000 ? `next in your plan, ${clock(row.start)}–${clock(row.end)}` : `until ${clock(row.end)}`];
  function breakCard(b, next){
    const name = b.name || (b.type === "meal" ? "Meal" : "Breather"); // the Today list's words
    return quietCard({ meta: "Break", side: `until ${clock(b.end)}`, title: name,
      extras: [next && h("p", { className: "now-why" }, "Next: ", bdi(next.task.title), ` at ${clock(Math.max(next.start, b.end))}.`)],
      action: next && h("button", { className: "btn quiet", type: "button", textContent: "Start it now",
        ariaLabel: `Skip the rest of the break: start ${next.task.title}`, onclick: () => switchTo(next.task.id) }) });
  }
  const dueWhy = (card, due) => ({ ...card, whyParts: [Date.now() - due.start < 2 * 60000 ? `planned for ${clock(due.start)}` : `planned for ${clock(due.start)}, not started`] });
  function roughCard(st){
    // Nothing done yet today (a late start): a warm offer to plan what's left,
    // not "Rough day?" (Mor, 2026-10-12). Lighter plan stays, as a quiet link.
    if (st.since == null) {
      return plainCard("empty quiet", { meta: "Good morning", title: "Here's your day from now",
        why: st.free >= 15 ? `${dur(st.free)} free today. Want me to fit things in?` : "Want me to fit things in?",
        action: h("div", { className: "now-actions now-row" },
          h("button", { className: "btn quiet", type: "button", textContent: "Not now", onclick: () => { silenced(); render(); } }),
          h("button", { className: "btn primary start", type: "button", onclick: openProposal }, h("span", { textContent: "Plan the rest of today" }))),
        extras: [h("button", { className: "btn quiet", type: "button", textContent: "Or a lighter plan", onclick: lighterPlan })] });
    }
    return plainCard("empty quiet rough", { meta: "Rough day?", title: "Want a lighter plan?", why: silenceText(st, clock).replace(/ Want a lighter plan.*$/, ""),
      action: h("div", { className: "now-actions now-row" },
        h("button", { className: "btn quiet", type: "button", textContent: "Not today", onclick: () => { silenced(); render(); } }),
        h("button", { className: "btn primary start", type: "button", onclick: lighterPlan }, h("span", { textContent: "Lighter plan" }))) });
  }

  // No room for it: ↑ puts it first in the plan, and what's last then falls
  // out instead (Mor, 2026-10-11; the plan doesn't drag).
  function toFront(i){
    const items = [...prop.items];
    const [it] = items.splice(i, 1);
    prop.items = trimBreaks([it, ...items]); prop.touched = true; render();
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
  // (2026-10-08). Two ways in, each finished on its own (Mor, 2026-10-10:
  // white Fewer/More chips beside Go read as options to pick, then Go):
  // one-tap Fewer tasks / More tasks that act at once, and under them a
  // field with its own send arrow that needs words (a blank Go laid the same
  // plan again and read as broken).
  function rethinkRow(){
    const close = () => { prop.ask = false; render(); };
    const blank = () => !String(prop.text || "").trim();
    const input = h("input", { id: "rethinkText", dir: "auto", autocomplete: "off", placeholder: "Or tell Daisey what to change…", ariaLabel: "What should change?", value: prop.text,
      oninput: (e) => { prop.text = e.target.value; send.disabled = prop.busy || blank(); } });
    const go = () => { if (!blank()) doRethink(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } else if (e.key === "Escape") close(); });
    const send = h("button", { className: "pp-send", type: "button", disabled: prop.busy || blank(), ariaLabel: prop.busy ? "Thinking" : "Rethink with this", title: "Rethink with this", onclick: go },
      prop.busy ? h("span", { textContent: "…" }) : icon("chev"));
    return h("div", { className: "pp-actions pp-ask" },
      h("div", { className: "pp-ask-quick" },
        h("button", { type: "button", className: "btn line", disabled: prop.busy, onclick: () => doRethink("Fewer tasks") }, icon("lighter"), h("span", { textContent: "Fewer tasks" })),
        h("button", { type: "button", className: "btn line", disabled: prop.busy, onclick: () => doRethink("More tasks") }, icon("plus"), h("span", { textContent: "More tasks" })),
        h("button", { className: "pp-ctl", type: "button", textContent: "✕", title: "Never mind", ariaLabel: "Never mind", onclick: close })),
      h("div", { className: "pp-ask-field" }, input, send));
  }
  // Ready tasks, open today, that aren't in the plan on screen.
  function notInPlan(){
    const inPlan = new Set(prop.items.map((it) => it.taskId)), now = Date.now();
    return (tasks || []).filter((t) => t.status === "ready" && !t.onHold && !notYet(t, now) && !inPlan.has(t.id)).length;
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
    const approved = !!approvedPlan();
    const { rows, over, breaks, late } = timeline(prop.items, { ...planCtx(), ...(approved && !prop.touched && !prop.replan ? { since: planSince() } : {}) });
    const total = rows.reduce((t, r) => t + r.minutes, 0);
    const last = rows[rows.length - 1];
    const row = (r, isOver) => {
      const i = r.i, t = r.task;
      const ctl = (text, label, disabled, onclick) => h("button", { type: "button", className: "pp-ctl", textContent: text, title: label, ariaLabel: `${label}: ${t.title}`, disabled, onclick });
      return h("li", { className: "pp-row pp-drag" + areaClass(t) + (isOver ? " over" : r.missed ? " missed" : ""), _i: i },
        isOver ? h("span", { className: "pp-time", textContent: "No room" })
          : h("span", { className: "pp-time", ariaLabel: `${clock(r.start)} to ${clock(r.end)}` }, clock(r.start), h("small", { textContent: clock(r.end) })),
        h("button", { type: "button", className: "pp-task", ariaLabel: `Edit ${t.title}`, onclick: () => onOpen?.(t) },
          h("span", { className: "pp-title", dir: "auto", textContent: t.title }),
          // The slot's times already say how long; "not started" is Rethink's
          // job; No room says only the first clause of why (Mor, 2026-10-12).
          h("span", { className: "pp-meta" }, ...pieces(projectShown(t) ? t.project : "", isOver ? (r.why || "").split(",")[0].replace(/\btoday\b/, planWord()) || estText(t, r.minutes) : r.of ? `shortened from ${dur(r.of)}` : "", r.ride ? RIDE_ROW[r.ride] : "", !isOver && r.missed ? "did it happen?" : ""))),
        h("span", { className: "pp-ctls" },
          isOver && !r.never && ctl("↑", "Do first", false, () => toFront(i)),
          ctl("✕", `Take off ${planWord()}'s plan`, false, () => dropItem(i))));
    };
    // A break is the plan's own item: it drags and comes off like a task.
    const breakRow = (b) => {
      const name = b.type === "meal" ? b.name || "Meal" : "Break", own = b.i != null;
      return h("li", { className: "pp-row pp-break" + (own ? " pp-drag" : ""), _i: b.i },
        h("span", { className: "pp-time", ariaLabel: `${clock(b.start)} to ${clock(b.end)}` }, clock(b.start), h("small", { textContent: clock(b.end) })),
        h("span", { className: "pp-task" }, h("span", { className: "pp-title", textContent: breakText(b, dur(Math.round((b.end - b.start) / 60000))) })),
        own && h("span", { className: "pp-ctls" },
          h("button", { type: "button", className: "pp-ctl", textContent: "✕", title: `Take the ${name.toLowerCase()} off`, ariaLabel: `Take the ${name.toLowerCase()} off`, onclick: () => dropItem(b.i) })));
    };
    // Today's events still to come, as the Schedule draws them (Mor,
    // 2026-10-10): the plan is laid around them. A tap opens the event like
    // on the Schedule; they're not the plan's, so they don't drag or come off.
    const evRow = (ev) => {
      const s = Date.parse(ev.start), e = Date.parse(ev.end), t = ev.taskId && tasks?.find((x) => x.id === ev.taskId);
      const tone = t ? areaClass(t) : "", time = h("span", { className: "pp-time", ariaLabel: `${clock(s)} to ${clock(e)}` }, clock(s), h("small", { textContent: clock(e) }));
      if (ev.trip) return h("li", { className: "pp-row pp-event" }, time,
        h("span", { className: "sc-ev sc-trip", ariaLabel: `${ev.title}, ${clock(s)} to ${clock(e)}` }, h("span", { className: "sc-evi" }, icon("later")), ev.title));
      return h("li", { className: "pp-row pp-event" }, time,
        h("button", { type: "button", className: "sc-ev" + tone, style: ev.color ? `--ev:${ev.color}` : "", ariaLabel: `${ev.title}, ${clock(s)} to ${clock(e)}`,
          onclick: () => onEvent?.(ev) }, h("span", { className: "sc-evi" }, icon("calendar")), bdi(ev.title)));
    };
    // Until midnight, or the day's end when it runs past it; after midnight in
    // a late day only until that end, not into the calendar's new day (Mor, 2026-10-11).
    const ph = dayHours(settings), midnight = new Date().setHours(24, 0, 0, 0);
    const night = ph.late ? dayEndAt(Date.now(), ph) : Math.max(midnight, dayEndAt(Date.now(), ph));
    const evs = cal.status !== "ok" ? [] : cal.events.filter((e) => !e.allDay && !/^✓\s*/u.test(e.title || "")
      && Date.parse(e.end) > Date.now() && Date.parse(e.start) < night);
    const plural = (n) => (n === 1 ? ["One doesn't", "it"] : [`${n} don't`, "them"]);
    // Past midnight on the night page the plan is the day you wake into,
    // which that page calls tomorrow (Mor, 2026-10-11), so this says so too.
    const day = PlanWord();
    return h("section", { className: "now-card main hero proposal", ariaLabel: approved ? `${day}'s plan` : "Proposed schedule" },
      h("div", { className: "hero-top" },
        h("span", { className: "hero-area", textContent: approved ? `${day}'s plan` : `Proposed for ${day.toLowerCase()}` }),
        rows.length > 0 && h("span", { className: "hero-side", textContent: `${dur(total)} · until ${clock(last.end)}` }),
        ),
      (rows.length || over.length || evs.length) > 0 && dragRows(h("ol", { className: "pp-list" },
          ...[...rows.map((r) => ({ r, s: r.start })), ...breaks.map((b) => ({ b, s: b.start })), ...evs.map((ev) => ({ ev, s: Date.parse(ev.start) }))]
            .sort((a, b) => a.s - b.s).map((x) => (x.ev ? evRow(x.ev) : x.b ? breakRow(x.b) : row(x.r, false))),
          ...over.map((r) => row(r, true)))),
      !rows.length && !over.length && h("p", { className: "now-empty", textContent: "No open task fits the free time left today." }),
      // Overflow: Daisey asks before cutting anything (planAsk,
      // 2026-10-10), so until it's answered, what doesn't fit shows here.
      over.length > 0 && !approved && h("p", { className: "muted pp-note", textContent: `${plural(over.length)[0]} fit today. ↑ does one first, ✕ takes it off.` }),
      // Open tasks the plan didn't take (it holds a day's worth, MAX_ITEMS):
      // counted, not listed, so nothing sits out of sight unsaid (2026-10-11).
      notInPlan() > 0 && !prop.ask && h("p", { className: "muted pp-note" },
        `+${notInPlan()} more · `,
        h("button", { className: "linkish", type: "button", textContent: "Add", ariaLabel: `Add more of the ${notInPlan()} open tasks not in the plan`, disabled: prop.busy, onclick: () => doRethink("More tasks") })),
      prop.note && h("p", { className: "pp-note", role: "status", textContent: prop.note }),
      prop.ask ? rethinkRow() : h("div", { className: "pp-actions" },
        h("button", { className: "btn primary start", type: "button", disabled: !prop.items.some((it) => !isBreak(it)) || prop.busy, onclick: approve },
          icon("check"), h("span", { textContent: approved ? "Save" : "Approve" })),
        // Running late (a slot's time came or went with nothing started; No
        // room alone isn't late): Rethink lights up instead of a line saying so.
        h("button", { className: "btn line" + (approved && (late || rows.some((r) => r.missed)) ? " late" : ""), type: "button", ariaExpanded: "false", disabled: prop.busy,
          title: approved && (late || rows.some((r) => r.missed)) ? "Running late: rethink for what's left" : undefined,
          textContent: prop.busy ? "Thinking…" : "Rethink", onclick: () => { prop.ask = true; render(); } }),
        // Approved: Save, Rethink, Remove, Cancel (Mor, 2026-10-12); no ✕ in the header.
        approved ? h("button", { className: "btn no-plan", type: "button", textContent: "Remove", ariaLabel: `Remove ${planWord()}'s plan`, disabled: prop.busy, onclick: removePlan })
          : h("button", { className: "btn no-plan", type: "button", textContent: "No plan", onclick: dismiss }),
        approved && h("button", { className: "btn line", type: "button", textContent: "Cancel", disabled: prop.busy, onclick: closeProposal })));
  }
  // Once a plan is approved, how far along it is goes to the header chip
  // (next to Needs you); tapping it reopens the plan to change it.
  function planProgressNow(){
    const p = approvedPlan();
    if (!p || !tasks) return null;
    const { done, total } = planProgress(p, tasks, unfitOf(p, planCtx()));
    // Done today outside the plan counts too, so the chip never reads 0/8 with a task finished.
    const inPlan = new Set(p.items.map((it) => it.taskId));
    const extra = doneToday(tasks).filter((t) => !inPlan.has(t.id)).length;
    return total ? { done: done + extra, total: total + extra } : null;
  }

  // Done today, for the header's daisy: what the snapshot says, plus what was
  // just finished and hasn't come back from Firestore yet.
  function doneCount(){
    const ids = new Set(doneToday(tasks || []).map((t) => t.id));
    return ids.size;
  }
  let reported = null, reportedNeeds = null, reportedPlan = "", reportedNext = null, reportedFocus = null;
  // nudgeDay: the day the morning's "Plan ready" chip is up for (onPlanReady).
  let nudgeDay = null, reportedNudge = false;

  // The plan is its own full screen (Mor, 2026-10-08): proposalCard paints into
  // planRoot, and the Now card behind it renders as usual.
  let planShown = false;
  function paintPlanScreen(){
    if (!planRoot || ppDragging) return;
    const open = prop.open;
    if (open) planRoot.replaceChildren(proposalCard());
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
    const nudge = nudgeDay === dayKey() && !prop.open && !todaysPlan() && !document.documentElement.classList.contains("night");
    if (nudge !== reportedNudge) { reportedNudge = nudge; onPlanReady?.(nudge); }
    if (!ready && tasks != null && planKnown && cal.status !== "loading") { ready = true; onReady?.(); }
  }
  function renderCard(){
    if (ppDragging) { ppStale = true; return; } // a redraw mid-drag would drop the dragged row
    if (run && tasks != null) endSession({ quiet: true }); // a run from before the clock went
    // Focus mode (Mor, 2026-10-10): the same card and actions, nothing
    // around it (CSS body.focus-mode). Done goes straight to the next card.
    const fm = focusOn();
    if (fm !== reportedFocus) { reportedFocus = fm; onFocusMode?.(fm); }
    const hrs = dayHours(settings);
    const dark = isNight(Date.now(), hrs);
    if (!dark) nightFree = false;
    // On the way somewhere (trips.js) the day has started, whatever the hours say.
    const riding = cal.status === "ok" && cal.events.some((e) => e.trip && Date.parse(e.start) <= Date.now() && Date.now() < Date.parse(e.end));
    const night = tasks != null && dark && !nightFree && !riding;
    document.documentElement.classList.toggle("night", night);
    // Not on the late/early pages (Mor, 2026-10-11): no card to focus on, so
    // the mode waits (the setting stays) and its chip hides (CSS :root.night).
    document.body.classList.toggle("focus-mode", fm && !night);
    const n = doneCount();
    if (n !== reported) { reported = n; onDone?.(n); }
    const pp = planProgressNow(), ppKey = pp ? `${pp.done}/${pp.total}` : "";
    if (ppKey !== reportedPlan) { reportedPlan = ppKey; onPlanProgress?.(pp); }
    // The phone's Today tile says what's next in the approved plan (Mor,
    // 2026-10-12): the first planned task still to start, not the card's own.
    const ahead = planRowsNow().filter((r) => r.taskId && r.taskId !== shown && r.end > Date.now());
    const nx = ahead[0] ? { task: ahead[0].task, start: ahead[0].start, more: ahead.length - 1 } : null;
    const nxKey = nx ? `${nx.task.id}@${nx.start}+${nx.more}` : "";
    if (nxKey !== reportedNext) { reportedNext = nxKey; onPlanNext?.(nx); }
    if (tasks) {
      const nn = collectNeeds({ tasks, events: cal.events || [], calOk: cal.status === "ok", settings, home: homeAt() }).length + (whereAsk() ? 1 : 0) + (planAsk() ? 1 : 0) + (mealLateAsk() ? 1 : 0);
      if (nn !== reportedNeeds) { reportedNeeds = nn; onNeedsCount?.(nn); }
    }

    const busy = cal.status === "ok" // the event being ignored, before any override
      ? freeWindow(cal.events.filter((e) => e.busy !== false && !e.allDay)).current : null;
    const fw = calendarNow();
    lastWindow = windowMark(fw);
    // The sample day (sample.js): say they're examples, one tap clears them.
    const samples = (tasks || []).filter((t) => t.sample && t.status !== "dropped");
    const sampleNote = samples.length > 0 && h("p", { className: "sample-note" },
      "Example day: these tasks are samples to try Daisey with. ",
      h("button", { className: "linkish", type: "button", textContent: "Clear examples", onclick: () => {
        Promise.all(samples.map((t) => removeTask(uid, t.id))).catch(fail);
        if (todaysPlan()?.items?.some((it) => samples.some((t) => t.id === it.taskId))) savePlan("dismissed", []);
        reset(); render();
      } }));
    const greet = h("div", { className: "now-greet" }, sampleNote,
      // Said you're free during an event that is still on the calendar.
      freeFrom && busy && h("p", { className: "muted" }, "Ignoring ", bdi(busy.title), " ",
        h("button", { className: "linkish", type: "button", textContent: "put it back",
          ariaLabel: `Stop ignoring ${busy.title}`, onclick: () => setFree(null) })));

    const head = night ? [greet] : [topOf(fw), greet];
    if (tasks == null) { fill(...head, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }

    if (night) { fill(...head, ...nightView(hrs), toast && toastView()); return; }

    // The start of the day: once per day, when there's something to plan, a
    // "Plan ready" chip lights in the header like a notification (Mor,
    // 2026-10-11: the plan opening by itself each morning was too much). It
    // goes once the plan is opened, approved or turned down (render reports it).
    if (!prop.open && planKnown && cal.status !== "loading" && prop.auto !== dayKey() && !todaysPlan()) {
      prop.auto = dayKey();
      if (proposeDay({ ...planCtx() }).length >= 2) nudgeDay = dayKey();
    }

    const r = rank(tasks, momentInput(fw));
    const planned = blockOf(fw)?.taskId;
    // An approved plan owns the card (Mor, 2026-10-10: the card and the
    // Today list never disagree): its next row, in time, said in its times;
    // a break while it runs; the meeting while one runs. The engine picks
    // only once the plan has nothing left for today. A plan still waiting
    // for approval: its first task.
    const pn = planNow();
    // A later row waits out a running event, a trip leg too unless the row
    // sits on the ride itself (Mor, 2026-10-11: on the drive back the card
    // said "Next in your plan, 21:50" instead of the drive).
    const later = fw?.current && pn?.row && pn.row.start > Date.now()
      && (!fw.current.trip || pn.row.start >= fw.current.end);
    const planRow = pn?.row && !later ? pn.row : null;
    const asCard = (id, task, whyParts) => ({ ...(r.ranked.find((s) => s.task.id === id) || { task }), whyParts });
    // The first row the plan below actually fits in, by time: never one it
    // says has No room (Mor, 2026-10-11).
    const firstProposed = !pn && prop.open && !approvedPlan()
      ? [...timeline(prop.items, planCtx()).rows].sort((a, b) => a.start - b.start)
        .find((it) => (tasks || []).some((t) => t.id === it.taskId && t.status === "ready")) : null;
    // Switch offers the rest of what's open too (Mor, 2026-10-10: not only
    // On hold when nothing else fits): what the moment filters out (too long
    // for the gap, office hours, another place, its own slot later) is still
    // yours to pick. Put off today (skipped) and the quiet ones stay out.
    const picked = (id) => r.out.find((o) => o.task.id === id && SWITCH_TOO.has(o.reason));
    // A pick holds until acted on, but not once it can't be done after it
    // was picked (moved, or set to another place: Mor, 2026-10-12). One
    // picked knowingly from another place stays.
    if (state.chosen) {
      const why = picked(state.chosen)?.reason ?? null;
      if (chosenOut?.id !== state.chosen) chosenOut = { id: state.chosen, why };
      else if (!CANT_NOW.has(why)) chosenOut.why = why;
      else if (why !== chosenOut.why) state.chosen = null;
    }
    let card = (state.chosen && (r.ranked.find((s) => s.task.id === state.chosen) || (picked(state.chosen) && asCard(state.chosen, picked(state.chosen).task, ["your pick"]))))
      || (planned && r.ranked.find((s) => s.task.id === planned))
      || (planRow && asCard(planRow.taskId, planRow.task, planWhy(planRow)))
      || (firstProposed && asCard(firstProposed.taskId, tasks.find((t) => t.id === firstProposed.taskId), [focusOn() ? "first in your plan" : "first in the plan below"]))
      || (pn ? null : r.pick);
    card = keptCard(card, { r, fw, asCard, picked, planRow });
    showing(card?.task.id ?? null);
    if (card && card === r.pick) noteSeen(card.task);
    // One ask under the card at a time, the most asked-for first.
    // (The calendar offer and the weekly Someday pick moved to Needs you.)
    let behind = null;
    // The plan slipping asks in Needs you now (planAsk), not here.
    behind = behindNow();
    const tip = (toast && toastView()) || cutView() || addedView() || (sd.open && somedayAsk());
    if (!card && pn?.brk && !fw?.current) { day(...head, breakCard(pn.brk, pn.next), tip); return; }
    // In a meeting, the meeting IS what's happening now, so the card says
    // which one and how much of it is left (Mor, 2026-10-04) instead of
    // "nothing to pick until it ends", which named nothing and read as if
    // Daisey had simply given up. "I'm free now" still overrides it.
    // Driving with no call to make: the driving card, not "nothing fits".
    if (!card && feel().place.value === "car") { day(...head, drivingCard(fw?.current?.trip && fw.current), toast && toastView()); return; }
    const block = blockOf(fw);
    if (!card && block) {
      day(...head, eventCard({ meta: "Now", side: `until ${clock(fw.current.end)}`, title: fw.current.title, color: fw.current.color, span: fw.current,
        why: `Nothing in ${block.project} fits right now.`, action: freeNowButton({ start: block.start }, `the ${block.project} block`) }), tip);
      return;
    }
    if (!card && fw?.current?.trip) { day(...head, rideCard(fw.current, r), tip); return; }
    if (!card && fw?.current) { day(...head, meetingCard(fw.current), tip); return; }
    const bk = !card && r.out.filter((o) => o.reason === "booked").map((o) => ({ task: o.task, ...booked().get(o.task.id) }))
      .filter((b) => b.start).sort((a, b) => a.start - b.start)[0];
    if (bk) { day(...head, bookedCard(bk, r), tip); return; }
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
          extras: [outLine(r), putOffButton(r), anywayButton(r)] }), tip);
      return;
    }

    const ms = missNow();
    // A late start's offer stays until answered: leaving the plan unapproved
    // brings it back (Mor, 2026-10-12); "No plan" there is an answer.
    if (ms?.kind === "silence" && !(ms.since == null && todaysPlan()?.status === "dismissed")) { day(...head, roughCard(ms), tip); return; }
    // Needs you is already asking about the slipped plan: the card doesn't too.
    const due = !behind && planDue(), dueNow = due?.taskId === card.task.id ? due : null;
    const missed = !dueNow && ms?.kind === "miss" ? ms : null;
    const planRows = planRowsNow();
    const alts = [...new Map([r.pick, ...r.alternatives, ...r.ranked, ...r.out.filter((o) => SWITCH_TOO.has(o.reason))]
      .filter((s) => s && s.task.id !== card.task.id).map((s) => [s.task.id, { task: s.task, why: altWhy(s, r, fw, planRows) }])).values()].slice(0, 5);
    seenOnScreen([card.task.id, ...alts.map((a) => a.task.id)]);
    // Done is the one loud thing on the tab; Switch, Pending and Later stay quiet beside it.
    day(...head, deck(taskCard(dueNow ? dueWhy(card, dueNow) : missed ? missWhy(card, missed) : card, true,
      ...cardActions(card.task, alts)), asking()),
      nextLine(card.task), tip);
    // One slide-in per step-aside: later snapshots must not replay it.
    if (slideIn) { const push = slideIn === "push"; slideIn = false; if (motionOK()) { const c = root.querySelector(".now-card.main"); if (c) { c.style.animationDelay = ""; if (push) { pushAt = Date.now(); pushIn(c, 0); } else { inAt = Date.now(); slideCardIn(c, 0); } } } }
    // The render rebuilt the key just pressed, so its press pops here, once.
    if (tapped) { const k = tapped; tapped = null; if (motionOK()) root.querySelector(`.now-row .act-${k}`)?.classList.add("tap"); }
  }

  // (The "Skipped five times. Still want it?" line that lived here moved to
  // Needs you, 2026-10-06: under the card a toast could crowd it out and a
  // reload forgot it had been answered.)

  // Focus mode hands back the same node every second (focus.js); an
  // unchanged screen is left be rather than taken out and put back.
  const fill = (...kids) => {
    if (holdCard) return;
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
    // Same for the light round its edge (app.css sc-orbit, 9s).
    root.querySelectorAll(".deck > .now-card.main").forEach((c) => {
      c.style.animationDelay = `${-((Date.now() - breathEpoch) % 5000)}ms`;
      c.style.setProperty("--orbit", `${-(Date.now() % 9000)}ms`);
    });
    const since = Date.now() - pushAt;
    if (since < PUSH_MS && motionOK()) root.querySelectorAll(".now-card.main").forEach((c) => pushIn(c, since));
    const sinceIn = Date.now() - inAt;
    if (sinceIn < IN_MS && motionOK()) root.querySelectorAll(".deck > .now-card.main").forEach((c) => slideCardIn(c, sinceIn));
  };
  // The day screens: the card and what's under it. (After this and the
  // Needs you row went with round 3: the panel's Schedule page and the
  // header's chip hold them now.)
  const day = (...kids) => fill(...kids);
  // (settings.restDay, a day closed early by the old "Done for today" pill,
  // is no longer read: the pill went 2026-10-10 as a "bad button", and a day
  // closed with it then had no way back open, so Daisey slept from 18:31
  // with the day running to 20:00.)
  const fail = (e) => console.error("[daisey] now", e);
  // "Start task" on a notification (sw.js → ?start=<id>): that task on the
  // card. The suggestion was made minutes ago; what happened since wins
  // (reality.js): a task done, parked or set Pending since isn't put up. A
  // cold start from the notification has neither the tasks nor the run yet,
  // so it waits for both.
  let noticeStart = null, runKnown = false, noticeLighter = false;
  const tryNoticeStart = () => {
    if (!noticeStart || tasks === null || !runKnown) return;
    const id = noticeStart;
    noticeStart = null;
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status !== "ready" || notYet(task)) return;
    skips.delete(id);
    switchTo(id);
  };
  const unsubs = [
    watchWhere((v) => { located = v; applyTrips(); render(); }),
    (document.addEventListener("keydown", escRow), () => document.removeEventListener("keydown", escRow)),
    watchProjectColors(() => render()),
    watchProjectTiers(() => render()),
    // Projects' own due dates: a project due Friday pulls its tasks up (engine.deadlineOf).
    watchProjectNames(uid, (_n, ranges) => { projectDue = Object.fromEntries(Object.entries(ranges || {}).filter(([, r]) => r?.due).map(([p, r]) => [p, r.due])); render(); }, fail),
    watchTasks(uid, (ts, meta) => { const was = tasks; tasks = ts; dropGhostRun(meta, was); render(); tryNoticeStart(); logRoutineEvents(); }, fail),
    watchCalendar((c) => { rawCal = c; applyTrips(); render(); logRoutineEvents(); }),
    watchRun(uid, (r) => { run = r; runKnown = true; render(); tryNoticeStart(); }, fail),
    watchSkips(uid, (s) => { skipDoc = s; render(); }, fail),
    watchSettings(uid, (s) => { settings = s || {}; applyTrips(); render(); }, fail),
    watchMoment(uid, (d) => { momentDoc = d || {}; momentKnown = true; freeFrom = Number.isFinite(momentDoc.freeFrom) ? momentDoc.freeFrom : null; render(); }, fail),
    watchLearn(uid, (d) => { learnStats = d || {}; render(); }, fail),
    watchDayPlan(uid, (d) => { dayPlan = d || null; planKnown = true; render(); }, fail),
  ];
  // Re-renders when the free window's minute changes.
  const tick = setInterval(() => {
    if (document.hidden) return;
    // A way back still running (trips.stillRiding) is stretched from now:
    // lay it again each minute so it keeps ahead of the clock.
    const m = Math.floor(Date.now() / 60000);
    const turned = m !== tripMin;
    if (turned) { tripMin = m; applyTrips(); }
    // Each minute as well: past WINDOW_CAP the window holds at 180, so the
    // office shutting, evening opening or a start time passing changed
    // nothing above and the card waited for a refresh (2026-10-12).
    if (turned || windowMark(calendarNow()) !== lastWindow) render();
    else if (Date.now() - missAt > 15000) { missAt = Date.now(); const d = planDue(), pr = planNow()?.row, k = `${missNow()?.key ?? ""}|${d ? `${d.taskId}|${d.start}` : ""}|${pr && pr.start <= Date.now() ? pr.taskId : ""}`; if (k !== missKey) { missKey = k; render(); } }
  }, 1000);
  let missAt = 0, missKey = "", tripMin = 0;
  // "Not today" on the silence check's notification (sw.js), saved here.
  const quietCheck = () => takeQuiet().then((d) => { if (d === localDate()) { silenced(d); render(); } });
  quietCheck();
  const onVisible = () => { if (!document.hidden) { quietCheck(); render(); } };
  document.addEventListener("visibilitychange", onVisible);
  root.hidden = false;
  render();

  return {
    refresh: render,
    // Needs you's questions that only the Now screen can work out (planAsk).
    needsAsks: () => [planAsk(), mealLateAsk()].filter(Boolean),
    // The schedule's "?" on a planned task that didn't happen.
    missed: (id, start) => missedSheet(id, start),
    // "Do this now" from the task sheet: the same thing Switch does, driven
    // from the list. A task put off today is un-put-off, or the card would
    // ignore the choice.
    put(id){
      skips.delete(id);
      switchTo(id);
    },
    // The task sheet's Focus (Mor, 2026-10-10): that task on the card, and
    // Focus mode on. A parked or pending task is back in play.
    start(id){
      const task = (tasks || []).find((t) => t.id === id);
      if (!task) return;
      if (task.status !== "ready") restoreTask(uid, id, { status: "ready", waitingOn: null, checkOn: null, notBefore: null, touchedAt: Date.now() }).catch(fail);
      skips.delete(id);
      // Started at night (wrap's Do it now, the sheet's Focus): past the Late page.
      nightFree = true;
      setFocus(true); switchTo(id);
    },
    // The header's Focus toggle (main.js).
    focus(on = !focusOn()){ setFocus(on); },
    startFromNotice(id){ noticeStart = id; tryNoticeStart(); },
    // The silence check's two buttons (sw.js).
    lighter(){ noticeLighter = true; render(); },
    quiet: quietCheck,
    // Tasks finished today, newest first, for the header's done chip.
    doneList(){ return doneToday(tasks || []).sort((a, b) => b.doneAt - a.doneAt); },
    // "Plan my day" from the Schedule: the proposal on the card.
    closePlan(){ if (prop.open) closeProposal(); },
    // Focus mode's slide rested the bob (main.js): it starts again from rest,
    // and rebuilds carry on from there.
    breatheFromRest(){ breathEpoch = Date.now(); root.querySelectorAll(".deck > .now-card.main").forEach((c) => { c.style.animationDelay = "0ms"; }); },
    plan(){ if (prop.open) { closeProposal(); return; } if (run) { flash("Finish or stop the running task first."); return; } openProposal(); },
    unmount(){ showing(null); clearTimeout(toastTimer); clearTimeout(upTimer); document.body.classList.remove("focus", "focus-mode"); document.documentElement.classList.remove("night"); unsubs.forEach((u) => u()); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); planRoot?.replaceChildren(); root.hidden = true; },
  };
}
