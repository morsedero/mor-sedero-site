// Task read/write and live sync for users/{uid}/tasks/{taskId}.
// All shaping (defaults, guesses, repeats) happens in model.js; this file
// only moves documents. `tasks` arguments are the current list from
// watchTasks, used as history for "similar past tasks" guesses.
import * as fb from "./firebase.js";
import { worthChecking, checkOnline } from "./research.js";
import { createTask, editTask, completeTask, startedTask, workedTask, keptTime, skipTask, skipReason, migrateTask, toDate } from "./model.js";

const GUEST_UID = "guest-local";
const GUEST_KEY = "daisey.guest.data.v1";
const guestTaskListeners = new Set();
const guestStateListeners = new Map();

function isGuest(uid){ return uid === GUEST_UID; }
function readGuestData(){
  let raw;
  try { raw = localStorage.getItem(GUEST_KEY); }
  catch (error) { throw new Error(`Guest storage is unavailable: ${error.message || error}`); }
  if(!raw) return { tasks: [], state: {} };
  try {
    const data = JSON.parse(raw);
    if(!data || !Array.isArray(data.tasks) || !data.state || typeof data.state !== "object") throw new Error("invalid shape");
    return data;
  } catch (error) {
    throw new Error(`Guest data could not be read: ${error.message || error}`);
  }
}
function writeGuestData(data){
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(data)); }
  catch (error) { throw new Error(`Guest data could not be saved: ${error.message || error}`); }
  for(const cb of guestTaskListeners){
    try { cb(data.tasks.map((task) => ({ ...task })), { fromCache: true, pending: false }); }
    catch(error){ console.error("[daisey] guest task listener", error); }
  }
  for(const [key, listeners] of guestStateListeners){
    for(const listener of listeners){
      try { listener(data.state[key] ?? null); }
      catch(error){ console.error("[daisey] guest state listener", error); }
    }
  }
}
function watchGuestTasks(cb){
  guestTaskListeners.add(cb);
  cb(readGuestData().tasks.map((task) => ({ ...task })), { fromCache: true, pending: false });
  return () => guestTaskListeners.delete(cb);
}
function updateGuestTask(uid, id, patch){
  if(!isGuest(uid)) return fb.updateDoc(taskDoc(uid, id), patch);
  try {
    const data = readGuestData();
    const index = data.tasks.findIndex((task) => task.id === id);
    if(index < 0) throw new Error("Guest task no longer exists.");
    data.tasks[index] = { ...data.tasks[index], ...patch };
    writeGuestData(data);
    return Promise.resolve();
  }
  catch(error){ return Promise.reject(error); }
}
function removeGuestTask(uid, id){
  if(!isGuest(uid)) return fb.deleteDoc(taskDoc(uid, id));
  try {
    const data = readGuestData();
    data.tasks = data.tasks.filter((task) => task.id !== id);
    writeGuestData(data);
    return Promise.resolve();
  }
  catch(error){ return Promise.reject(error); }
}
function watchGuestState(uid, key, cb, onError){
  if(!isGuest(uid)) return null;
  try {
    const listeners = guestStateListeners.get(key) || new Set();
    listeners.add(cb);
    guestStateListeners.set(key, listeners);
    cb(readGuestData().state[key] ?? null);
    return () => {
      listeners.delete(cb);
      if(!listeners.size) guestStateListeners.delete(key);
    };
  } catch(error){
    onError?.(error);
    return () => {};
  }
}
function saveGuestState(uid, key, value, merge = false){
  if(!isGuest(uid)) return fb.setDoc(fb.doc(fb.db, "users", uid, "state", key), value, merge ? { merge: true } : undefined);
  try {
    const data = readGuestData();
    data.state[key] = merge ? { ...(data.state[key] || {}), ...value } : value;
    writeGuestData(data);
    return Promise.resolve();
  }
  catch(error){ return Promise.reject(error); }
}
function removeGuestState(uid, key){
  if(!isGuest(uid)) return fb.deleteDoc(fb.doc(fb.db, "users", uid, "state", key));
  try {
    const data = readGuestData();
    delete data.state[key];
    writeGuestData(data);
    return Promise.resolve();
  }
  catch(error){ return Promise.reject(error); }
}

const tasksCol = (uid) => fb.collection(fb.db, "users", uid, "tasks");
const taskDoc = (uid, id) => fb.doc(fb.db, "users", uid, "tasks", id);

// cb(tasks, { fromCache, pending }) on every change, local or remote.
export function watchTasks(uid, cb, onError){
  if(isGuest(uid)){
    try { return watchGuestTasks(cb); }
    catch(error){ onError?.(error); return () => {}; }
  }
  return fb.onSnapshot(tasksCol(uid), { includeMetadataChanges: true }, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
  }, onError);
}

// Write promises resolve on server ack, which never comes offline; the local
// listener already shows the change, so callers needn't wait on them.
export function addTask(uid, input, tasks = []){
  const task = createTask(input, { history: tasks });
  if(isGuest(uid)){
    try {
      task.id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const data = readGuestData();
      data.tasks.push(task);
      writeGuestData(data);
      return Promise.resolve({ id: task.id });
    }
    catch(error){ return Promise.reject(error); }
  }
  const added = fb.addDoc(tasksCol(uid), task);
  // A guessed "Office hours": check the web once, quietly (research.js).
  if (worthChecking(task)) added.then((ref) => checkOnline(task).then((patch) => patch && fb.updateDoc(ref, patch)))
    .catch((e) => console.warn("[daisey] online check", e.message || e));
  return added;
}

export function updateTask(uid, task, changes, tasks = []){
  const patch = editTask(task, changes, { history: tasks });
  return Object.keys(patch).length ? updateGuestTask(uid, task.id, patch) : Promise.resolve();
}

// Brings every task up to the current fields (model.migrateTask), once per
// sign-in, on the first snapshot that came from the server: a cached one may
// be stale, and patching from it could undo another device's change.
// Idempotent — a current task yields an empty patch — so two devices
// migrating at once is harmless.
export function migrateTasks(uid){
  if(isGuest(uid)) return () => {};
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
  return updateGuestTask(uid, task.id, completeTask(task));
}

export function removeTask(uid, id){
  return removeGuestTask(uid, id);
}

// Later, Pending, and Undo putting either back (model.skipSnapshot).
export function skipNow(uid, task){
  return updateGuestTask(uid, task.id, skipTask(task));
}

// Pending: the card's third action. Sets it Waiting. Not a skip: waiting on
// someone isn't refusing the task, and five of them made it "stale".
// `waitingOn`: the reason the user typed ("Yuval sends the stems"), if any.
// `checkOn`: when to ask "still pending?" (default: PENDING_CHECK_DAYS on).
export function blockTask(uid, task, waitingOn = "", checkOn = ""){
  const why = String(waitingOn || "").trim();
  return updateGuestTask(uid, task.id, { ...skipReason(task, "blocked"), ...(why ? { waitingOn: why } : {}),
    ...(toDate(checkOn) ? { checkOn } : {}) });
}

export function restoreTask(uid, id, fields){
  return updateGuestTask(uid, id, fields);
}

// Today's skips, users/{uid}/state/skips: { date, items: { id: { count, until } } }.
// Later writes here, so a reload — or the other device — still knows the
// task was pushed off, and the engine can charge its skip penalty.
const skipsDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "skips");

export function watchSkips(uid, cb, onError){
  const guestUnsub = watchGuestState(uid, "skips", cb, onError);
  if(guestUnsub) return guestUnsub;
  return fb.onSnapshot(skipsDoc(uid), (snap) => cb(snap.exists() ? snap.data() : null), onError);
}

export function saveSkips(uid, state){
  return saveGuestState(uid, "skips", state);
}

// The running task, users/{uid}/state/now: { taskId, startedAt, extra }.
// One doc, so a reload — or the other device — finds the same timer running.
// `extra` is minutes added by "+15 min" past the estimate.
const runDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "now");

export function watchRun(uid, cb, onError){
  const guestUnsub = watchGuestState(uid, "now", cb, onError);
  if(guestUnsub) return guestUnsub;
  return fb.onSnapshot(runDoc(uid), (snap) => cb(snap.exists() ? snap.data() : null), onError);
}

// mode: "inline" (the dashboard stays) or "focus" (Deep Focus, the whole screen).
export function startRun(uid, task, mode = "inline"){
  return Promise.all([
    saveGuestState(uid, "now", { taskId: task.id, startedAt: Date.now(), extra: 0, mode }),
    updateGuestTask(uid, task.id, startedTask(task)),
  ]);
}

// A batch run (DAISEY_SPEC "Batches"): several calls / admin bits / errands
// as one checklist. state/now gains batch (ids, in order), done (ids ticked)
// and mark (when the last one was ticked): each tick books the minutes since
// the mark to that task and finishes it.
export function startBatch(uid, tasks){
  const now = Date.now(), ids = tasks.map((t) => t.id);
  return Promise.all([
    saveGuestState(uid, "now", { taskId: ids[0], batch: ids, done: [], mark: now, startedAt: now, extra: 0 }),
    ...tasks.map((t) => updateGuestTask(uid, t.id, startedTask(t))),
  ]);
}

export function tickBatch(uid, run, task, minutes){
  const now = Date.now();
  return Promise.all([
    saveGuestState(uid, "now", { ...run, done: [...(run.done || []), task.id], mark: now }),
    updateGuestTask(uid, task.id, workedTask(task, minutes, { finished: true })),
  ]);
}

// Ends a batch. The minutes since the last tick are shared by the ones left
// unticked; they stay open, and it isn't counted as a stop — a batch ending
// early is the batch's doing, not a sign any one task is too big.
export function endBatch(uid, left, minutes){
  const each = left.length ? Math.round(minutes / left.length) : 0;
  return Promise.all([
    removeGuestState(uid, "now"),
    ...left.map((t) => updateGuestTask(uid, t.id, { spentMinutes: (t.spentMinutes || 0) + each, touchedAt: Date.now(), workedAt: Date.now() })),
  ]);
}

// Pause and Resume write the whole doc (focus.js paused/resumed). Cancel
// drops it; `minutes` > 0 are kept on the task without counting a stop.
export const saveRun = (uid, run) => saveGuestState(uid, "now", run);
export const cancelRun = (uid, task = null, minutes = 0) => Promise.all([
  removeGuestState(uid, "now"),
  task && minutes > 0 ? updateGuestTask(uid, task.id, keptTime(task, minutes)) : null,
]);

export function extendRun(uid, run, minutes){
  return saveGuestState(uid, "now", { ...run, extra: (run.extra || 0) + minutes });
}

// Ends the run and books the time against the task.
export function endRun(uid, task, minutes, { finished = false } = {}){
  return Promise.all([
    removeGuestState(uid, "now"),
    task ? updateGuestTask(uid, task.id, workedTask(task, minutes, { finished })) : null,
  ]);
}

// The day's proposed schedule (proposal.js), users/{uid}/state/dayplan:
// { date, status: "proposed" | "approved" | "dismissed", items: [{ taskId,
// minutes }], at }. One doc, so the phone and the laptop show the same plan.
export function watchDayPlan(uid, cb, onError){
  const guestUnsub = watchGuestState(uid, "dayplan", cb, onError);
  if(guestUnsub) return guestUnsub;
  return fb.onSnapshot(fb.doc(fb.db, "users", uid, "state", "dayplan"), (snap) => cb(snap.exists() ? snap.data() : null), onError);
}
export const saveDayPlan = (uid, plan) => saveGuestState(uid, "dayplan", { ...plan, at: Date.now() });

// Waiting for a reply on a started task (model.holdValue): the run goes on.
export const holdTask = (uid, task, who = "") => updateGuestTask(uid, task.id, { onHold: { who: String(who || "").trim().slice(0, 80), since: Date.now() }, touchedAt: Date.now() });
export const releaseTask = (uid, task) => updateGuestTask(uid, task.id, { onHold: null, touchedAt: Date.now() });

// Reset Daisey (Settings, 2026-10-07): every task and every state doc of this
// user, so everything is read and learned from scratch. Guests: the device's
// local copy. Calendar and Trello themselves are never touched; their stored
// connections are dropped separately (reset.js → daisey-now-disconnect).
const STATE_DOCS = ["now", "skips", "settings", "moment", "learn", "projects", "dayplan"];
export async function resetAll(uid){
  if(isGuest(uid)){
    try { localStorage.removeItem(GUEST_KEY); localStorage.removeItem("daisey.guest.events.v1"); }
    catch(error){ throw new Error(`Guest data could not be cleared: ${error.message || error}`); }
    return;
  }
  const tasks = await fb.getDocs(tasksCol(uid));
  await Promise.all([
    ...tasks.docs.map((d) => fb.deleteDoc(d.ref)),
    ...STATE_DOCS.map((k) => fb.deleteDoc(fb.doc(fb.db, "users", uid, "state", k))),
  ]);
}

// Projects made by name before they have a task, users/{uid}/state/projects:
// { names: [...], ranges: { name: { start, due } | null } }. A project is
// otherwise just the tasks that carry its name, so without this an empty one
// couldn't exist. ranges (Mor, 2026-10-07): the dates a project runs between;
// its tasks' dates have to stay inside.
const projectsDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "projects");

export function watchProjectNames(uid, cb, onError){
  if(isGuest(uid)){
    try { return watchGuestState(uid, "projects", (value) => cb(value?.names || [], value?.ranges || {}, value?.order || []), onError); }
    catch(error){ onError?.(error); return () => {}; }
  }
  return fb.onSnapshot(projectsDoc(uid), (snap) => cb((snap.exists() && snap.data().names) || [], (snap.exists() && snap.data().ranges) || {}, (snap.exists() && snap.data().order) || []), onError);
}

// Merged, so saving names never wipes the ranges (and the reverse).
export function saveProjectNames(uid, names){
  return saveGuestState(uid, "projects", { names }, true);
}
// The order Mor dragged the projects into (names, first to last).
export function saveProjectOrder(uid, order){
  return saveGuestState(uid, "projects", { order }, true);
}
export function saveProjectRanges(uid, ranges){
  return saveGuestState(uid, "projects", { ranges }, true);
}

// Settings, users/{uid}/state/settings: { deadlinesAsked, ... }. Merged on
// write, so one feature's key never clobbers another's.
const settingsDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "settings");

export function watchSettings(uid, cb, onError){
  const guestUnsub = watchGuestState(uid, "settings", (value) => cb({ ...(value || {}), logDone: false }, { fromCache: true }), onError);
  if(guestUnsub) return guestUnsub;
  return fb.onSnapshot(settingsDoc(uid), (snap) => cb(snap.exists() ? snap.data() : {}, { fromCache: snap.metadata.fromCache }), onError);
}

export function saveSettings(uid, fields){
  return saveGuestState(uid, "settings", fields, true);
}

// The card's two chips, users/{uid}/state/moment:
// { place: { value, at }, free: { minutes, at } }.
// A correction holds 3 hours (context.js).
const momentDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "moment");

export function watchMoment(uid, cb, onError){
  const guestUnsub = watchGuestState(uid, "moment", (value) => cb(value || {}), onError);
  if(guestUnsub) return guestUnsub;
  return fb.onSnapshot(momentDoc(uid), (snap) => cb(snap.exists() ? snap.data() : {}), onError);
}

export function saveMoment(uid, fields){
  return saveGuestState(uid, "moment", fields, true);
}

// Learned fit, users/{uid}/state/learn: { "<type>|<time of day>": { starts, skips } }.
const learnDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "learn");

export function watchLearn(uid, cb, onError){
  const guestUnsub = watchGuestState(uid, "learn", (value) => cb(value || {}), onError);
  if(guestUnsub) return guestUnsub;
  return fb.onSnapshot(learnDoc(uid), (snap) => cb(snap.exists() ? snap.data() : {}), onError);
}

// field: "starts" | "skips"
export function bumpLearn(uid, type, part, field){
  if(isGuest(uid)){
    const data = readGuestData();
    const key = `${type || "deep"}|${part}`;
    data.state.learn ||= {};
    data.state.learn[key] ||= { starts: 0, skips: 0 };
    data.state.learn[key][field] = (data.state.learn[key][field] || 0) + 1;
    try { writeGuestData(data); return Promise.resolve(); }
    catch(error){ return Promise.reject(error); }
  }
  return fb.setDoc(learnDoc(uid), { [`${type || "deep"}|${part}`]: { [field]: fb.increment(1) } }, { merge: true });
}
