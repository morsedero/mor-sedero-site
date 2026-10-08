// A routine's set days on the calendar (routine.js, Mor 2026-10-08): keeps
// the weekly event in the "Daisey" calendar matching the routine. Called when
// the task sheet closes, after a new routine is added, and before a task is
// deleted. The days, time, end, title and length make its `sig`; when they
// change the old event is deleted and a fresh one written, so Google never
// holds a half-updated series. No set days → no event.
import { createSeries, deleteSeries } from "./calendar.js";
import { restoreTask } from "./store.js";
import { cleanRoutine, seriesSig } from "./routine.js";

let busy = Promise.resolve(); // one sync at a time: two quick closes mustn't write two events

export function syncSeries(uid, task){
  busy = busy.then(() => sync(uid, task)).catch((e) => console.error("[daisey] routine slots", e));
  return busy;
}

async function sync(uid, task){
  const r = cleanRoutine(task.routine);
  // The event there now: read from the raw field, since a routine just
  // turned off (no per, no days) still has one to delete.
  const want = seriesSig(task), have = task.routine?.series?.id ? task.routine.series : null;
  if ((have?.sig || null) === want) return;
  if (have?.id) await deleteSeries(have.id);
  let series = null;
  if (want) {
    const made = await createSeries({ title: task.title, taskId: task.id, days: r.days, at: r.at, minutes: Number(task.size) || 30, until: r.until });
    if (made?.id) series = { id: made.id, sig: want };
  }
  if (r) await restoreTask(uid, task.id, { routine: { ...r, ...(series ? { series } : { series: null }) } });
}

// Before a task is deleted: its weekly event goes with it.
export const dropSeries = (task) => (task?.routine?.series?.id ? deleteSeries(task.routine.series.id).catch((e) => console.error("[daisey] routine slots", e)) : Promise.resolve());
