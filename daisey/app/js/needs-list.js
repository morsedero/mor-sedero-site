// Needs you's question list, apart from its screen (needs.js): PURE, so the
// header count, the day brief and the server's notifications (functions/
// daisey-now-morning.js) all count the same questions. Moved out of needs.js
// unchanged, 2026-10-06.
import { nextOffer } from "./caltask.js";
import { sweepList, isOverdue, shouldOffer } from "./triage.js";
import { localDate, logicalDate, notYet } from "./model.js";
import { deadlineWithin } from "./engine.js";
import { STALE_SKIPS, SOMEDAY_DEADLINE_DAYS, PUSHES_ASK } from "./weights.js";
import { slotClashes } from "./clash.js";
import { slotsToAsk } from "./routine.js";
import { tripAsks, withTrips } from "./trips.js";
import { mealAsks } from "./meals.js";

const STAKES_FIRST = { penalty: 0, money: 1, someone: 2, low: 3 };
const DAY = 86400000;

// Away catch-up (Mor approved 2026-10-08; user test 2026-10-11): after
// AWAY_DAYS or more with nothing done in Daisey, Needs you opens with a
// welcome back and goes through every old date first, passed targets too.
export const AWAY_DAYS = 2;
// Whole days since the user last did anything Daisey can see (as
// miss.lastActivity, tasks only); 0 for a new user with no history.
export function awayDays(tasks = [], now = Date.now()){
  let last = 0;
  for (const t of tasks) last = Math.max(last, t.touchedAt || 0, t.workedAt || 0, t.doneAt || 0, t.createdAt || 0);
  if (!last) return 0;
  return Math.max(0, Math.round((Date.parse(`${logicalDate(now)}T12:00`) - Date.parse(`${logicalDate(last)}T12:00`)) / DAY));
}

// The Someday pick's rule (DAISEY_SPEC "Someday comes back"): Sunday
// morning, or whenever fewer than 3 tasks are active, at most once a day.
export function somedayDue(tasks = [], settings = {}, now = Date.now()){
  if (!tasks.some((t) => t.status === "someday")) return false;
  if (settings.somedayAsked === logicalDate(now)) return false;
  const d = new Date(now);
  const active = tasks.filter((t) => t.status === "ready" && !notYet(t, now)).length;
  return (d.getDay() === 0 && d.getHours() < 12) || active < 3;
}
const somedayTop = (tasks) => tasks.filter((t) => t.status === "someday")
  .sort((a, b) => (STAKES_FIRST[a.stakes] ?? 3) - (STAKES_FIRST[b.stakes] ?? 3) || (a.createdAt || 0) - (b.createdAt || 0))[0];

// Everything waiting on an answer right now, as { key, kind, … }. PURE apart
// from reading the clock: now.js calls it for the count on the home screen.
export function collectNeeds({ tasks = [], events = [], calOk = false, settings = {}, now = Date.now(), home = null } = {}){
  const later = settings.needsLater?.date === logicalDate(now) ? new Set(settings.needsLater.keys || []) : new Set();
  const out = [];
  const add = (item) => { if (!later.has(item.key)) out.push(item); };
  const parked = tasks.filter((t) => t.status === "someday" && deadlineWithin(t, now, SOMEDAY_DEADLINE_DAYS))
    .sort((a, b) => a.due.localeCompare(b.due));
  parked.forEach((t) => add({ key: `parked:${t.id}`, kind: "parked", id: t.id }));
  // An event in another city (trips.js): how do you get there? Once per
  // series. home: this device's Home, to skip a city next door (the server
  // has none, so it may count one the phone won't ask).
  if (calOk) tripAsks(events, settings.trips || {}, { now, home }).forEach((a) => add({ key: `trip:${a.key}`, kind: "trip", ...a }));
  // A meal the day's events leave no room for (meals.js): eat there, or
  // move it? With the trips' ways there and back (now.js's events have them
  // already; Needs you's and the server's don't).
  if (calOk) {
    const evs = events.some((e) => e.trip) ? events : withTrips(events, settings.trips || {}, settings.tripDay || [], settings.laptop ?? null);
    mealAsks(evs, settings, now).forEach((a) => add({ key: a.key, kind: "meal", meal: a }));
  }
  if (calOk) {
    const offered = [...(settings.calOffered || [])];
    for (let i = 0; i < 5; i++) {
      const ev = nextOffer(events, tasks, offered);
      if (!ev) break;
      offered.push(ev.id);
      add({ key: `cal:${ev.id}`, kind: "cal", ev });
    }
  }
  // A booked slot a meeting ran into, for a real deadline (clash.js): asked once, with the move ready.
  if (calOk) slotClashes(tasks, events, now).forEach((c) => add({ key: c.key, kind: "clash", id: c.task.id, clash: c }));
  // A routine's set-days slot that's over (routine.js): "Did it?" — a booked
  // slot isn't counted until the user says so.
  if (calOk) for (const t of tasks) slotsToAsk(t, events, now).forEach((e) => add({ key: `slot:${e.id}`, kind: "slot", id: t.id, slot: e }));
  const today = logicalDate(now);
  tasks.filter((t) => t.status === "waiting" && t.checkOn && t.checkOn <= today)
    .sort((a, b) => a.checkOn.localeCompare(b.checkOn))
    .forEach((t) => add({ key: `pend:${t.id}`, kind: "pending", id: t.id }));
  tasks.filter((t) => t.status === "ready" && (t.skipsSinceStart || 0) >= STALE_SKIPS)
    .forEach((t) => add({ key: `stale:${t.id}`, kind: "stale", id: t.id }));
  // Pushed to a later day PUSHES_ASK times without a start (2026-10-06).
  tasks.filter((t) => t.status === "ready" && (t.pushes || 0) >= PUSHES_ASK && (t.skipsSinceStart || 0) < STALE_SKIPS)
    .forEach((t) => add({ key: `pushed:${t.id}`, kind: "pushed", id: t.id }));
  if (somedayDue(tasks, settings, now)) {
    const t = somedayTop(tasks.filter((x) => !parked.includes(x))); // a parked deadline is already asked about
    if (t) add({ key: "someday", kind: "someday", id: t.id });
  }
  // Passed deadlines always; passed targets only once they pile up (the
  // sweep's old threshold) — a target that slipped sits quietly under today.
  // Back after days away: all of them, and first.
  const away = awayDays(tasks, now) >= AWAY_DAYS;
  const targets = away || shouldOffer(tasks, now, {});
  const sweeps = sweepList(tasks, now).filter((t) => isOverdue(t, now) || targets)
    .map((t) => ({ key: `sweep:${t.id}`, kind: "sweep", id: t.id })).filter((item) => !later.has(item.key));
  return away ? [...sweeps, ...out] : [...out, ...sweeps];
}
