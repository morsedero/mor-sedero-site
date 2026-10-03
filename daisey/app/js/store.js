// Task read/write and live sync for users/{uid}/tasks/{taskId}.
// All shaping (defaults, guesses, repeats) happens in model.js; this file
// only moves documents. `tasks` arguments are the current list from
// watchTasks, used as history for "similar past tasks" guesses.
import * as fb from "./firebase.js";
import { createTask, editTask, completeTask, startedTask, workedTask, skipTask, skipReason } from "./model.js";

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
export function blockTask(uid, task){
  return fb.updateDoc(taskDoc(uid, task.id), { ...skipTask(task), ...skipReason(task, "blocked") });
}

export function restoreTask(uid, id, fields){
  return fb.updateDoc(taskDoc(uid, id), fields);
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
