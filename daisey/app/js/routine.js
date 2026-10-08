// Routines (Mor, 2026-10-08; supersedes "no repeating tasks" of 10-03): a
// task that comes back every week, so many times a week — "Exercise, 45 min,
// 3× a week", or "Practice, 1 h, 2× a week, in Band, until the show". It is an
// ordinary task with one more field, `routine: { per, until, log }`:
//
//   per    sessions a week, 1-7. A week is Sunday to Saturday, as everywhere
//          else in Daisey (context.js, schedule.js).
//   until  the last day it runs (the show), or null for open-ended. A routine
//          in a project with a due date gets that date when it's made.
//   log    the sessions done, oldest first: { day, min? , ev? }. `ev` is the
//          calendar event that counted as one (Gym on the calendar, done
//          outside Daisey). Kept to LOG_MAX.
//
// Done never closes it: it logs a session, clears the time spent on it, and
// keeps it off the card until tomorrow — or till Sunday once the week is met.
// A missed week isn't carried over: every Sunday starts again at 0 of per.
// Past `until` it is finished for good (status done).
//
// Daisey offers it the way it offers anything (engine.js, factor "routine"),
// leaning harder the further behind the week is. Sessions already on the
// calendar count as planned: the user scheduled ahead, Daisey only tracks.
//
// PURE and self-contained (model.js imports it, so it can't import model.js).
export const PER_MAX = 7;
const LOG_MAX = 60;

const pad = (n) => String(n).padStart(2, "0");
const validDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const dayOf = (ms = Date.now()) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const noon = (day) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (day, n) => { const d = noon(day); d.setDate(d.getDate() + n); return dayOf(d.getTime()); };
export const weekStart = (day) => addDays(day, -noon(day).getDay());

export function cleanRoutine(r){
  if (!r || typeof r !== "object") return null;
  const per = Math.round(Number(r.per));
  if (!(per >= 1)) return null;
  const log = (Array.isArray(r.log) ? r.log : []).filter((e) => e && validDay(e.day)).map((e) => ({
    day: e.day,
    ...(Number(e.min) > 0 ? { min: Math.round(Number(e.min)) } : {}),
    ...(e.ev ? { ev: String(e.ev) } : {}),
  }));
  return { per: Math.min(PER_MAX, per), until: validDay(r.until) ? r.until : null, log: log.slice(-LOG_MAX) };
}

export const isRoutine = (task) => !!cleanRoutine(task?.routine);

// Sessions logged in the week `day` falls in.
export function doneThisWeek(task, day = dayOf()){
  const from = weekStart(day), to = addDays(from, 6);
  return (task.routine?.log || []).filter((e) => e.day >= from && e.day <= to).length;
}

// Days left in this week, today included, cut short by `until`.
export function daysLeft(task, day = dayOf()){
  let end = addDays(weekStart(day), 6);
  const until = task.routine?.until;
  if (until && until < end) end = until;
  return end < day ? 0 : Math.round((noon(end) - noon(day)) / 86400000) + 1;
}

// ---------- the calendar ----------

const tokens = (s) => String(s || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
// Words that name the same routine, so "Gym" counts for Exercise and
// "Rehearsal" for Practice.
const ALIKE = [
  ["exercise", "workout", "gym", "run", "running", "training", "train", "yoga", "pilates", "swim", "swimming", "fitness", "crossfit", "spinning", "sport", "hike", "ספורט", "אימון", "חדר", "כושר", "ריצה", "יוגה", "פילאטיס", "שחייה"],
  ["practice", "practise", "rehearsal", "rehearse", "jam", "חזרה", "חזרות", "תרגול"],
];
const alikeOf = (w) => ALIKE.find((g) => g.includes(w)) || null;

// An event that is a session of this routine: its title holds every word of
// the routine's title, or a word that means the same. Daisey's own log
// entries ("✓ Exercise") and all-day events never count.
export function eventIsRoutine(ev, task){
  if (!ev || ev.allDay || /^\s*✓/.test(ev.title || "")) return false;
  const et = tokens(ev.title), tt = tokens(task.title);
  if (!et.length || !tt.length) return false;
  if (tt.every((w) => et.includes(w))) return true;
  return tt.some((w) => { const g = alikeOf(w); return !!g && et.some((x) => g.includes(x)); });
}

// This routine's events this week: `past` already over (sessions that
// happened, to log), `ahead` still to come (planned by the user), and
// `today` — one of the ahead ones is later today.
export function calendarWeek(task, events = [], now = Date.now()){
  const today = dayOf(now), from = weekStart(today), to = addDays(from, 6);
  const out = { past: [], ahead: 0, today: false };
  for (const ev of events) {
    if (!eventIsRoutine(ev, task)) continue;
    const start = Date.parse(ev.start), end = Date.parse(ev.end), day = dayOf(start);
    if (!(day >= from && day <= to)) continue;
    if (end <= now) out.past.push({ id: ev.id, day, min: Math.round((end - start) / 60000) });
    else { out.ahead++; if (day === today) out.today = true; }
  }
  return out;
}

// The calendar sessions not logged yet. One per day at most, and none on a
// day that already has a session — Gym on the calendar while the timer ran
// in Daisey is one workout, not two.
export function eventsToLog(task, events, now = Date.now()){
  const log = task.routine?.log || [];
  const days = new Set(log.map((e) => e.day)), seen = new Set(log.map((e) => e.ev).filter(Boolean));
  const out = [];
  for (const e of calendarWeek(task, events, now).past) {
    if (seen.has(e.id) || days.has(e.day)) continue;
    days.add(e.day);
    out.push(e);
  }
  return out;
}

// What engine.readMoment needs: { [taskId]: { ahead, today } }.
export function routineCalendar(tasks, events, now = Date.now()){
  const out = {};
  for (const t of tasks) if (isRoutine(t) && t.status === "ready") {
    const c = calendarWeek(t, events, now);
    if (c.ahead) out[t.id] = { ahead: c.ahead, today: c.today };
  }
  return out;
}

// Where the week stands: done, planned on the calendar, still needed, days left.
export function weekState(task, day = dayOf(), cal = null){
  const per = cleanRoutine(task.routine)?.per || 0;
  const done = doneThisWeek(task, day), ahead = cal?.ahead || 0;
  return { per, done, ahead, need: Math.max(0, per - done - ahead), daysLeft: daysLeft(task, day) };
}

// "1 of 3 this week", "3 of 3 this week ✓" — for the task sheet and the lists.
export function weekLine(task, day = dayOf()){
  const per = cleanRoutine(task.routine)?.per;
  if (!per) return "";
  const done = doneThisWeek(task, day);
  return `${done} of ${per} this week${done >= per ? " ✓" : ""}`;
}

// ---------- a session ----------

// The patch for one session done. `minutes`: the time it took, if timed.
// `ev`: { id, day, min } when a calendar event is what's being logged.
export function sessionPatch(task, { now = Date.now(), minutes = 0, ev = null } = {}){
  const r = cleanRoutine(task.routine);
  const today = dayOf(now);
  const min = ev ? ev.min : Math.round(minutes);
  const log = [...r.log, { day: ev?.day || today, ...(min > 0 ? { min } : {}), ...(ev ? { ev: ev.id } : {}) }].slice(-LOG_MAX);
  const next = doneThisWeek({ routine: { log } }, today) >= r.per ? addDays(weekStart(today), 7) : addDays(today, 1);
  // A session logged from the calendar never pulls the next one closer.
  const notBefore = task.notBefore && task.notBefore > next ? task.notBefore : next;
  const over = !!r.until && notBefore > r.until;
  return {
    routine: { ...r, log },
    status: over ? "done" : "ready",
    notBefore: over ? task.notBefore ?? null : notBefore,
    doneAt: now, spentMinutes: 0, progress: over ? 100 : 0,
    skipsSinceStart: 0, stopsUnfinished: 0, onHold: null, touchedAt: now,
    ...(task.steps ? { steps: task.steps.map((s) => ({ ...s, done: false })), nextStep: task.steps[0]?.text || null } : {}),
  };
}

// Making a task a routine, changing how often or till when: the log stays.
// null / false makes it a one-off task again.
export function routineChange(task, change){
  if (change == null || change === false) return { routine: null };
  const r = cleanRoutine({ ...(task.routine || {}), ...change, log: task.routine?.log || [] });
  return r ? { routine: r } : { routine: null };
}
