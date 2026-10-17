// What a project IS right now, as data (Mor, 2026-10-18): so every screen that
// shows a project tells the same truth, and the UI only has to word it.
// PURE: no DOM, no Firebase. Works on projectsOf()'s shape
// ({ name, all, open, next, pending, someday, done }).
import { progressOf, notYet, getDayKey } from "./model.js";
import { isRoutine } from "./routine.js";

// A task counts as started once anything real happened to it: it's done, has
// a %, was started, or has time logged on it (old tasks).
export const isStarted = (t) => t.status === "done" || progressOf(t) > 0 || (t.starts || 0) > 0
  || (t.spentMinutes || 0) > 0 || !!t.workedAt;

// "How much is left?" after Pending / Later (2026-10-18): only for a task
// that was actually started or had time counted. An untouched one has all of
// it left, so asking is noise: it just moves. Routines have no "left".
export const asksLeft = (t) => !!t && t.status !== "done" && !isRoutine(t) && isStarted(t);

// Mean of the tasks' own % (done = 100), 0..1, so half-finished work counts.
// Routines have no %: they recur, so they'd hold the project at 0 forever.
export function projectProgress(p){
  const ts = p.all.filter((t) => !isRoutine(t) || t.status === "done");
  return ts.length ? ts.reduce((n, t) => n + progressOf(t), 0) / (100 * ts.length) : 0;
}

// The task a project offers next: the first ready one that can start now, in
// the order projectsOf already sorted (urgency, the card's task first). null
// when there isn't one, so the UI can say "pick one" instead of inventing it.
export const nextTaskOf = (p, now = Date.now()) => p.next.find((t) => !notYet(t, now)) ?? null;

// "empty" no tasks · "done" nothing open · "not started" 0% and nothing
// started · "in progress" the rest.
export function projectState(p, now = Date.now()){
  if (!p.all.length) return "empty";
  if (!p.open.length) return "done";
  return projectProgress(p) === 0 && !p.all.some(isStarted) ? "not started" : "in progress";
}

// Whole days a due date is behind the day you're in (getDayKey), 0 if it
// isn't. `item`: a task ({ due, status }) or a project's range ({ due }); a
// task that isn't open (done, dropped, on hold) is never overdue.
export function daysOverdue(item, now = Date.now()){
  if (!item?.due) return 0;
  if (item.status && item.status !== "ready" && item.status !== "waiting") return 0;
  const d = Math.round((Date.parse(`${getDayKey(now)}T12:00`) - Date.parse(`${item.due}T12:00`)) / 864e5);
  return d > 0 ? d : 0;
}

// Everything a screen needs to word a project. range: its { start, due } dates.
export function projectSummary(p, range = null, now = Date.now()){
  const over = p.open.length ? daysOverdue({ due: range?.due }, now) : 0;
  return { state: projectState(p, now), progress: projectProgress(p), nextTask: nextTaskOf(p, now),
    daysOverdue: over, overdue: over > 0 };
}
