// Overdue triage: which dates have passed, when to offer the sweep, and what
// each of its four answers does to a task.
// PURE: no Firebase, no DOM; the clock is only read as a default argument,
// so the node tests in daisey/test/v1/ drive it with fixed moments.
//
// Only a Deadline can be overdue. A Target that passes rolls forward
// quietly: it counts as due today (effectiveDue), is never shown as late,
// and never grows more urgent than a today-target (spec, "Overdue triage").
import * as W from "./weights.js";
import { localDate } from "./model.js";

const MIN = 60000;

export const isOpen = (t) => t.status === "ready" || t.status === "waiting";
const passed = (t, now) => !!t.due && t.due < localDate(now);
export const isOverdue = (t, now = Date.now()) => isOpen(t) && t.dateKind === "deadline" && passed(t, now);
export const isRolled = (t, now = Date.now()) => isOpen(t) && t.dateKind !== "deadline" && passed(t, now);

// The day a task counts as dated: a passed target is today's.
export const effectiveDue = (t, now = Date.now()) => (isRolled(t, now) ? localDate(now) : t.due);

// What the sweep goes through: passed deadlines first, then passed targets,
// oldest first in each.
export function sweepList(tasks, now = Date.now()){
  const old = (a, b) => a.due.localeCompare(b.due) || (a.createdAt || 0) - (b.createdAt || 0);
  return [...tasks.filter((t) => isOverdue(t, now)).sort(old), ...tasks.filter((t) => isRolled(t, now)).sort(old)];
}

// Offer the sweep? More than SWEEP.deadlines passed deadlines, or more than
// SWEEP.targets passed targets, and not already answered today.
export function shouldOffer(tasks, now = Date.now(), settings = {}){
  if (settings.sweepAnswered === localDate(now)) return false;
  const deadlines = tasks.filter((t) => isOverdue(t, now)).length;
  const targets = tasks.filter((t) => isRolled(t, now)).length;
  return deadlines > W.SWEEP.deadlines || targets > W.SWEEP.targets;
}

// ---------- "This week": the day with the most room ----------

const dayAt = (now, offset) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };

// The days "this week" can mean: tomorrow to Saturday. From Friday on, that
// leaves a day or none, so it means next week, Sunday to Saturday.
export function weekDays(now = Date.now()){
  const days = [];
  for (let i = 1; i <= 7; i++) {
    const d = dayAt(now, i);
    days.push(d);
    if (d.getDay() === W.WEEK_END_DAY) break;
  }
  if (days.length >= 2) return days;
  const sunday = dayAt(now, days.length + 1);
  return Array.from({ length: 7 }, (_, i) => dayAt(sunday.getTime(), i));
}

// Free minutes in a day's waking hours: minus busy calendar events, minus
// what other open tasks dated that day already need.
export function roomOn(day, { events = [], tasks = [], skip = null, now = Date.now() } = {}){
  const start = new Date(day).setHours(0, W.DAY_HOURS.start, 0, 0);
  const end = new Date(day).setHours(0, W.DAY_HOURS.end, 0, 0);
  let busy = 0;
  for (const e of events) {
    if (e.busy === false || e.allDay) continue;
    busy += Math.max(0, Math.min(end, Date.parse(e.end)) - Math.max(start, Date.parse(e.start)));
  }
  const date = localDate(day.getTime());
  const booked = tasks.filter((t) => t.id !== skip && isOpen(t) && effectiveDue(t, now) === date)
    .reduce((sum, t) => sum + Math.max(0, (t.size || 0) - (t.spentMinutes || 0)), 0);
  return (end - start - busy) / MIN - booked;
}

// "This week" for one task: the roomiest day, earliest on a tie. A task
// that needs office hours only looks at days offices open.
export function pickWeekDay(task, { events = [], tasks = [], now = Date.now(), officeDay = defaultOfficeDay } = {}){
  let days = weekDays(now);
  if (task.openHours === "office") {
    // Thursday's "this week" for a call is Friday–Saturday: all closed. Then
    // it means next week's office days.
    let open = days.filter((d) => officeDay(d));
    if (!open.length) {
      const after = days[days.length - 1].getTime();
      open = Array.from({ length: 7 }, (_, i) => dayAt(after, i + 1)).filter((d) => officeDay(d));
    }
    days = open;
  }
  let best = days[0], bestRoom = -Infinity;
  for (const d of days) {
    const room = roomOn(d, { events, tasks, skip: task.id, now });
    if (room > bestRoom) { best = d; bestRoom = room; }
  }
  return localDate(best.getTime());
}

// Sunday–Thursday until the three-gate engine brings the holiday list.
const defaultOfficeDay = (d) => d.getDay() <= 4;

// ---------- the four answers ----------

// Everything an answer can change, as it was, so Undo is exact.
export const answerSnapshot = (t) => ({ due: t.due ?? null, status: t.status, touchedAt: t.touchedAt ?? null, droppedAt: t.droppedAt ?? null });

// today / week / someday / drop → the patch. `week` is the picked date.
export function answer(kind, t, { now = Date.now(), week = null } = {}){
  switch (kind) {
    case "today": return { due: localDate(now), touchedAt: now };
    case "week": return { due: week, touchedAt: now };
    case "someday": return { status: "someday", touchedAt: now };
    case "drop": return { status: "dropped", droppedAt: now, touchedAt: now };
    default: return {};
  }
}
