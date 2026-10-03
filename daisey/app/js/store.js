// Task read/write and live sync for users/{uid}/tasks/{taskId}.
// All shaping (defaults, guesses, repeats) happens in model.js; this file
// only moves documents. `tasks` arguments are the current list from
// watchTasks, used as history for "similar past tasks" guesses.
import * as fb from "./firebase.js";
import { createTask, editTask, completeTask } from "./model.js";

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

// Free time you told Daisey, users/{uid}/state/context: { minutes, setAt }.
// It counts down from setAt (now.js); once it runs out Daisey is back to its
// default guess. The calendar replaces this in session 8.
const contextDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "context");

export function watchContext(uid, cb, onError){
  return fb.onSnapshot(contextDoc(uid), (snap) => cb(snap.exists() ? snap.data() : null), onError);
}

export function saveContext(uid, ctx){
  return fb.setDoc(contextDoc(uid), ctx);
}
