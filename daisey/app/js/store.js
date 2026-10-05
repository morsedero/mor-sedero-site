// Task read/write and live sync for users/{uid}/tasks/{taskId}.
// All shaping (defaults, guesses, repeats) happens in model.js; this file
// only moves documents. `tasks` arguments are the current list from
// watchTasks, used as history for "similar past tasks" guesses.
import * as fb from "./firebase.js";
import { createTask, editTask, completeTask, startedTask, workedTask, keptTime, skipTask, skipReason, migrateTask } from "./model.js";

const tasksCol = (uid) => fb.collection(fb.db, "users", uid, "tasks");
const taskDoc = (uid, id) => fb.doc(fb.db, "users", uid, "tasks", id);

// cb(tasks, { fromCache, pending }) on every change, local or remote.
export function watchTasks(uid, cb, onError){
  return fb.onSnapshot(tasksCol(uid), { includeMetadataChanges: true }, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
  }, onError);
}

// Write promises resolve on server ack, which never comes offline; the local
// listener already shows the change, so callers needn't wait on them.
export function addTask(uid, input, tasks = []){
  return fb.addDoc(tasksCol(uid), createTask(input, { history: tasks }));
}

export function updateTask(uid, task, changes, tasks = []){
  const patch = editTask(task, changes, { history: tasks });
  return Object.keys(patch).length ? fb.updateDoc(taskDoc(uid, task.id), patch) : Promise.resolve();
}

// Brings every task up to the current fields (model.migrateTask), once per
// sign-in, on the first snapshot that came from the server: a cached one may
// be stale, and patching from it could undo another device's change.
// Idempotent — a current task yields an empty patch — so two devices
// migrating at once is harmless.
export function migrateTasks(uid){
  let done = false, unsub = null;
  unsub = watchTasks(uid, (tasks, { fromCache }) => {
    if (done || fromCache) return;
    done = true;
    setTimeout(() => unsub?.());
    for (const t of tasks) {
      const patch = migrateTask(t, tasks);
      if (Object.keys(patch).length) fb.updateDoc(taskDoc(uid, t.id), patch).catch((e) => console.error("[daisey] migrate", e));
    }
  }, (e) => console.error("[daisey] migrate", e));
  return () => unsub?.();
}

export function finishTask(uid, task){
  return fb.updateDoc(taskDoc(uid, task.id), completeTask(task));
}

export function removeTask(uid, id){
  return fb.deleteDoc(taskDoc(uid, id));
}

// Later, Pending, and Undo putting either back (model.skipSnapshot).
export function skipNow(uid, task){
  return fb.updateDoc(taskDoc(uid, task.id), skipTask(task));
}

// Pending: the card's third action. Counts as a skip and sets it Waiting.
// `waitingOn`: the reason the user typed ("Yuval sends the stems"), if any.
export function blockTask(uid, task, waitingOn = ""){
  const why = String(waitingOn || "").trim();
  return fb.updateDoc(taskDoc(uid, task.id), { ...skipTask(task), ...skipReason(task, "blocked"), ...(why ? { waitingOn: why } : {}) });
}

export function restoreTask(uid, id, fields){
  return fb.updateDoc(taskDoc(uid, id), fields);
}

// Today's skips, users/{uid}/state/skips: { date, items: { id: { count, until } } }.
// Later writes here, so a reload — or the other device — still knows the
// task was pushed off, and the engine can charge its skip penalty.
const skipsDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "skips");

export function watchSkips(uid, cb, onError){
  return fb.onSnapshot(skipsDoc(uid), (snap) => cb(snap.exists() ? snap.data() : null), onError);
}

export function saveSkips(uid, state){
  return fb.setDoc(skipsDoc(uid), state);
}

// The running task, users/{uid}/state/now: { taskId, startedAt, extra }.
// One doc, so a reload — or the other device — finds the same timer running.
// `extra` is minutes added by "+15 min" past the estimate.
const runDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "now");

export function watchRun(uid, cb, onError){
  return fb.onSnapshot(runDoc(uid), (snap) => cb(snap.exists() ? snap.data() : null), onError);
}

export function startRun(uid, task){
  return Promise.all([
    fb.setDoc(runDoc(uid), { taskId: task.id, startedAt: Date.now(), extra: 0 }),
    fb.updateDoc(taskDoc(uid, task.id), startedTask(task)),
  ]);
}

// A batch run (DAISEY_SPEC "Batches"): several calls / admin bits / errands
// as one checklist. state/now gains batch (ids, in order), done (ids ticked)
// and mark (when the last one was ticked): each tick books the minutes since
// the mark to that task and finishes it.
export function startBatch(uid, tasks){
  const now = Date.now(), ids = tasks.map((t) => t.id);
  return Promise.all([
    fb.setDoc(runDoc(uid), { taskId: ids[0], batch: ids, done: [], mark: now, startedAt: now, extra: 0 }),
    ...tasks.map((t) => fb.updateDoc(taskDoc(uid, t.id), startedTask(t))),
  ]);
}

export function tickBatch(uid, run, task, minutes){
  const now = Date.now();
  return Promise.all([
    fb.setDoc(runDoc(uid), { ...run, done: [...(run.done || []), task.id], mark: now }),
    fb.updateDoc(taskDoc(uid, task.id), workedTask(task, minutes, { finished: true })),
  ]);
}

// Ends a batch. The minutes since the last tick are shared by the ones left
// unticked; they stay open, and it isn't counted as a stop — a batch ending
// early is the batch's doing, not a sign any one task is too big.
export function endBatch(uid, left, minutes){
  const each = left.length ? Math.round(minutes / left.length) : 0;
  return Promise.all([
    fb.deleteDoc(runDoc(uid)),
    ...left.map((t) => fb.updateDoc(taskDoc(uid, t.id), { spentMinutes: (t.spentMinutes || 0) + each, touchedAt: Date.now(), workedAt: Date.now() })),
  ]);
}

// Pause and Resume write the whole doc (focus.js paused/resumed). Cancel
// drops it; `minutes` > 0 are kept on the task without counting a stop.
export const saveRun = (uid, run) => fb.setDoc(runDoc(uid), run);
export const cancelRun = (uid, task = null, minutes = 0) => Promise.all([
  fb.deleteDoc(runDoc(uid)),
  task && minutes > 0 ? fb.updateDoc(taskDoc(uid, task.id), keptTime(task, minutes)) : null,
]);

export function extendRun(uid, run, minutes){
  return fb.setDoc(runDoc(uid), { ...run, extra: (run.extra || 0) + minutes });
}

// Ends the run and books the time against the task.
export function endRun(uid, task, minutes, { finished = false } = {}){
  return Promise.all([
    fb.deleteDoc(runDoc(uid)),
    task ? fb.updateDoc(taskDoc(uid, task.id), workedTask(task, minutes, { finished })) : null,
  ]);
}

// Settings, users/{uid}/state/settings: { deadlinesAsked, ... }. Merged on
// write, so one feature's key never clobbers another's.
const settingsDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "settings");

export function watchSettings(uid, cb, onError){
  return fb.onSnapshot(settingsDoc(uid), (snap) => cb(snap.exists() ? snap.data() : {}, { fromCache: snap.metadata.fromCache }), onError);
}

export function saveSettings(uid, fields){
  return fb.setDoc(settingsDoc(uid), fields, { merge: true });
}

// The card's two chips, users/{uid}/state/moment:
// { energy: { value, at }, place: { value, at }, history: [{ part, weekend, value }] }.
// A correction holds 3 hours (context.js); history feeds the energy pattern.
const momentDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "moment");

export function watchMoment(uid, cb, onError){
  return fb.onSnapshot(momentDoc(uid), (snap) => cb(snap.exists() ? snap.data() : {}), onError);
}

export function saveMoment(uid, fields){
  return fb.setDoc(momentDoc(uid), fields, { merge: true });
}

// Learned fit, users/{uid}/state/learn: { "<type>|<time of day>": { starts, skips } }.
const learnDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "learn");

export function watchLearn(uid, cb, onError){
  return fb.onSnapshot(learnDoc(uid), (snap) => cb(snap.exists() ? snap.data() : {}), onError);
}

// field: "starts" | "skips"
export function bumpLearn(uid, type, part, field){
  return fb.setDoc(learnDoc(uid), { [`${type || "deep"}|${part}`]: { [field]: fb.increment(1) } }, { merge: true });
}
