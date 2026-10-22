// Task read/write and live sync for users/{uid}/tasks/{taskId}.
// All shaping (defaults, guesses, repeats) happens in model.js; this file
// only moves documents. `tasks` arguments are the current list from
// watchTasks, used as history for "similar past tasks" guesses.
import * as fb from "./firebase.js";
import { worthChecking, checkOnline } from "./research.js";
import { createTask, editTask, completeTask, skipTask, skipReason, migrateTask, toDate, INBOX, leftMinutes } from "./model.js";
import { logDocKey } from "./bloom-data.js";
import { emitTask } from "./task-events.js";

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
  notifyGuest(data);
}
function notifyGuest(data){
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
// Another tab of this guest wrote: show it here too, or this tab acts on a
// stale list (BEHAVIOR_REVIEW #9). `storage` only fires in the other tabs.
globalThis.addEventListener?.("storage", (e) => {
  if (e.key !== GUEST_KEY && e.key !== null) return; // null: storage cleared
  if (!guestTaskListeners.size && !guestStateListeners.size) return;
  try { notifyGuest(readGuestData()); }
  catch(error){ console.error("[daisey] guest sync", error); }
});
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
// merge: the given top-level fields replace theirs whole, the rest stay. On
// Firestore that's mergeFields, not merge: true, which merges maps DEEP, so a
// key dropped from tiers / ranges / mealToday stayed on the server and came
// back on the next snapshot (BEHAVIOR_REVIEW #2, #3). Same as the guest path.
function saveGuestState(uid, key, value, merge = false){
  if(!isGuest(uid)) return fb.setDoc(fb.doc(fb.db, "users", uid, "state", key), value, merge ? { mergeFields: Object.keys(value) } : undefined);
  try {
    const data = readGuestData();
    data.state[key] = merge ? { ...(data.state[key] || {}), ...value } : value;
    writeGuestData(data);
    return Promise.resolve();
  }
  catch(error){ return Promise.reject(error); }
}

// A guest who has never stored anything on this device: main.js lays the
// sample day (sample.js) for them, so the first screen isn't empty.
export const guestFresh = () => { try { return localStorage.getItem(GUEST_KEY) == null; } catch { return false; } };
// The sample day, replacing everything this guest had ("Reset sample" too).
export function seedGuest({ tasks, plan }){
  try { localStorage.removeItem("daisey.guest.events.v1"); } catch { /* private window */ }
  writeGuestData({ tasks, state: plan ? { dayplan: plan } : {} });
}

// A Google account's first open (2026-10-11): the same sample day as a new
// guest, once ever. Only when the server says the account has no tasks and
// no work log, and settings carry no `sampled` mark (set first, so a second
// device or a Reset doesn't lay it again). make() → sample.sampleDay's
// { tasks, plan }; fixed ids, so a race writes the same three docs twice.
export async function seedAccountOnce(uid, make){
  if(isGuest(uid)) return false;
  const settingsRef = fb.doc(fb.db, "users", uid, "state", "settings");
  if((await fb.getDoc(settingsRef)).data()?.sampled) return false; // the usual load: one read
  const [tasks, state] = await Promise.all([fb.getDocs(tasksCol(uid)), fb.getDocs(fb.collection(fb.db, "users", uid, "state"))]);
  if(tasks.metadata.fromCache) return false; // offline: can't tell a new account from an empty cache
  const mark = () => fb.setDoc(settingsRef, { sampled: true }, { mergeFields: ["sampled"] });
  // An account already in use is marked too, so it's never read like this again.
  if(!tasks.empty || state.docs.some((d) => d.id.startsWith("log-"))) { await mark(); return false; }
  const { tasks: ts, plan } = make();
  await mark();
  await Promise.all([...ts.map(({ id, ...t }) => fb.setDoc(taskDoc(uid, id), t)),
    ...(plan ? [fb.setDoc(fb.doc(fb.db, "users", uid, "state", "dayplan"), plan)] : [])]);
  return true;
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

// Job Hunt (jobs-sync.js): a task at a fixed doc id, so two devices syncing at
// once write one task. patchTask is a raw field patch — not a user edit, so
// touchedAt/editedAt stay put. Signed-in only: Drive needs a Google account.
export function addTaskAt(uid, id, input, tasks = []){
  return fb.setDoc(taskDoc(uid, id), createTask(input, { history: tasks }));
}
export const patchTask = (uid, id, patch) => updateGuestTask(uid, id, patch);

// Job Hunt write-back (jobs-sync.js), users/{uid}/state/jobstatus:
// { fileId, queue: { cardId: { status, at, note? } }, moves: { cardId: { fileId, event } } }.
// fileId is Drive's id of daisey-status.json; queue is what Mor tapped that Drive
// hasn't confirmed yet, so a tap survives a failed write, a reload, an offline
// phone; moves is a job's CV move that Drive hasn't confirmed (jobs-sync.js).
// Saved merged, each field whole.
export function watchJobStatus(uid, cb, onError){
  return fb.onSnapshot(fb.doc(fb.db, "users", uid, "state", "jobstatus"), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    cb({ fileId: d.fileId || "", queue: d.queue && typeof d.queue === "object" ? d.queue : {}, moves: d.moves && typeof d.moves === "object" ? d.moves : {} });
  }, onError);
}
export const saveJobStatus = (uid, fields) => saveGuestState(uid, "jobstatus", fields, true);

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

// Done with no timer. Nothing is credited (round 2, 2026-10-11: a Done
// seconds after the card came up logged the whole hour): the time between
// the card showing and Done holds waiting, interruptions and time away, so
// it isn't work. The log gets the finish with 0 minutes worked, and beside
// them `s`, the task's own length (what was left of it), which the Week page
// counts it at (Mor, 2026-10-12, when the toast's time counter went). The
// task's size stays the estimate, and nothing reaches the size learning.
export function finishTask(uid, task){
  const p = updateGuestTask(uid, task.id, completeTask(task));
  logWork(uid, task, 0, { done: true, size: leftMinutes(task) }).catch(logFail);
  emitTask("task.done", task);
  return p;
}

// `task` (the one being removed) is optional: pass it and connections hear task.deleted.
export function removeTask(uid, id, task){
  if (task) emitTask("task.deleted", task);
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

// Writes the fields as-is. Doesn't touch the work log: Later, On hold or a
// Needs answer on a task Done earlier must keep that Done's time.
export function restoreTask(uid, id, fields){
  return updateGuestTask(uid, id, fields);
}
// Undo of a Done (or a routine's Did it): the snapshot back, and the time it
// logged taken back out.
export function undoDone(uid, id, before){
  unlogDone(uid, id);
  return updateGuestTask(uid, id, before);
}

// ---------- the work log (bloom-data.js) ----------
// users/{uid}/state/log-YYYY-MM, { e: { entryId: entry } }: one doc a month,
// entries merged in by id so two devices never overwrite each other. A removed
// entry is a null (Firestore merges can't delete a map key without a sentinel).
const logFail = (e) => console.warn("[daisey] work log", e.message || e);
const logDoc = (uid, key) => fb.doc(fb.db, "users", uid, "state", key);
const doneLogged = new Map(); // taskId → { key, id, entry }: this session's Done, for Undo and the −/+ fix

function writeLog(uid, key, id, entry){
  if (isGuest(uid)) {
    try {
      const data = readGuestData(), e = { ...(data.state[key]?.e || {}) };
      if (entry) e[id] = entry; else delete e[id];
      data.state[key] = { e };
      writeGuestData(data);
      return Promise.resolve(id);
    } catch (error) { return Promise.reject(error); }
  }
  return fb.setDoc(logDoc(uid, key), { e: { [id]: entry } }, { merge: true }).then(() => id);
}

// `minutes` of real (or guessed) work on a task, ending at `at`. `done`: it
// finished the task. A 0-minute entry is only kept when it marks a finish.
// `size`: a finish's length (finishTask), kept apart from minutes worked.
export function logWork(uid, task, minutes, { at = Date.now(), done = false, guess = false, size = 0 } = {}){
  const m = Math.max(0, Math.round(minutes));
  if (!m && !done) return Promise.resolve(null);
  const id = `${at}-${task.id}`, key = logDocKey(at);
  const entry = { t: task.id, p: task.project || INBOX, m, at, ...(done ? { d: 1 } : {}), ...(guess ? { g: 1 } : {}), ...(size > 0 ? { s: Math.round(size) } : {}) };
  if (done) doneLogged.set(task.id, { key, id, entry });
  return writeLog(uid, key, id, entry);
}
export function unlogDone(uid, taskId){
  const d = doneLogged.get(taskId);
  if (!d) return Promise.resolve();
  doneLogged.delete(taskId);
  return writeLog(uid, d.key, d.id, null).catch(logFail);
}
// Reopen in the task sheet (BEHAVIOR_REVIEW #5): the Done may be from another
// session or device, so not in doneLogged. Its entry is the newest d:1 one for
// this task in the month of doneAt (a Done from before 2026-10-11 logged a guessed time, a bit
// before doneAt, so the month before is read too). Done again then logs once.
export async function unlogReopened(uid, task){
  if (doneLogged.has(task.id)) return unlogDone(uid, task.id);
  const at = task.doneAt || Date.now();
  const keys = [...new Set([logDocKey(at), logDocKey(at - 36 * 3600000)])];
  try {
    let best = null;
    for (const key of keys) {
      const e = isGuest(uid) ? readGuestData().state[key]?.e
        : await fb.getDoc(logDoc(uid, key)).then((s) => (s.exists() ? s.data().e : null));
      for (const [id, x] of Object.entries(e || {}))
        if (x && x.t === task.id && x.d && (!best || x.at > best.at)) best = { key, id, at: x.at };
    }
    if (best) await writeLog(uid, best.key, best.id, null);
  } catch (e) { logFail(e); }
}
// A project renamed (projects.js askRename): its work-log entries carry the
// name (entry.p), so they move to the new one, or stats split one project
// into two (BEHAVIOR_REVIEW #6). Every month doc; merged per entry.
export async function renameInLog(uid, from, to){
  for (const d of doneLogged.values()) if (d.entry.p === from) d.entry = { ...d.entry, p: to };
  try {
    const months = isGuest(uid)
      ? Object.entries(readGuestData().state).filter(([k]) => k.startsWith("log-")).map(([key, v]) => ({ key, e: v?.e }))
      : (await fb.getDocs(fb.collection(fb.db, "users", uid, "state"))).docs
        .filter((d) => d.id.startsWith("log-")).map((d) => ({ key: d.id, e: d.data().e }));
    for (const { key, e } of months)
      for (const [id, x] of Object.entries(e || {}))
        if (x && x.p === from) await writeLog(uid, key, id, { ...x, p: to });
  } catch (e) { logFail(e); }
}

// cb(entries) with every entry of the given month docs, on every change.
export function watchLog(uid, keys, cb, onError){
  const by = new Map();
  const subs = keys.map((key) => {
    const got = (v) => {
      by.set(key, Object.entries(v?.e || {}).filter(([, x]) => x).map(([id, x]) => ({ id, ...x })));
      cb([...by.values()].flat());
    };
    return watchGuestState(uid, key, got, onError) || fb.onSnapshot(logDoc(uid, key), (snap) => got(snap.exists() ? snap.data() : null), onError);
  });
  return () => subs.forEach((u) => u?.());
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
const STATE_DOCS = ["now", "skips", "settings", "moment", "learn", "projects", "dayplan", "jobstatus"];
// The work log's month docs (log-YYYY-MM) go too.
export async function resetAll(uid){
  if(isGuest(uid)){
    // Emptied, not removed: a removed key reads as a new guest, who gets the sample day again.
    try { localStorage.setItem(GUEST_KEY, JSON.stringify({ tasks: [], state: {} })); localStorage.removeItem("daisey.guest.events.v1"); }
    catch(error){ throw new Error(`Guest data could not be cleared: ${error.message || error}`); }
    return;
  }
  const tasks = await fb.getDocs(tasksCol(uid));
  const logs = await fb.getDocs(fb.collection(fb.db, "users", uid, "state"));
  await Promise.all([
    ...tasks.docs.map((d) => fb.deleteDoc(d.ref)),
    ...logs.docs.filter((d) => d.id.startsWith("log-")).map((d) => fb.deleteDoc(d.ref)),
    ...STATE_DOCS.map((k) => fb.deleteDoc(fb.doc(fb.db, "users", uid, "state", k))),
  ]);
  // Erased stays erased: the sample day isn't laid again (seedAccountOnce).
  await fb.setDoc(fb.doc(fb.db, "users", uid, "state", "settings"), { sampled: true });
}

// Projects made by name before they have a task, users/{uid}/state/projects:
// { names: [...], ranges: { name: { start, due } | null } }. A project is
// otherwise just the tasks that carry its name, so without this an empty one
// couldn't exist. ranges (Mor, 2026-10-07): the dates a project runs between;
// its tasks' dates have to stay inside.
const projectsDoc = (uid) => fb.doc(fb.db, "users", uid, "state", "projects");

export function watchProjectNames(uid, cb, onError){
  if(isGuest(uid)){
    try { return watchGuestState(uid, "projects", (value) => cb(value?.names || [], value?.ranges || {}, value?.order || [], value?.tiers || {}, value?.caps || {}), onError); }
    catch(error){ onError?.(error); return () => {}; }
  }
  return fb.onSnapshot(projectsDoc(uid), (snap) => cb((snap.exists() && snap.data().names) || [], (snap.exists() && snap.data().ranges) || {}, (snap.exists() && snap.data().order) || [], (snap.exists() && snap.data().tiers) || {}, (snap.exists() && snap.data().caps) || {}), onError);
}

// Merged, so saving names never wipes the ranges (and the reverse).
export function saveProjectNames(uid, names){
  return saveGuestState(uid, "projects", { names }, true);
}
// The order Mor dragged the projects into (names, first to last).
export function saveProjectOrder(uid, order){
  return saveGuestState(uid, "projects", { order }, true);
}
// Each project's tier (Mor, 2026-10-08): { name: "focus" | "keep" |
// "background" }. A project with none is "keep".
export function saveProjectTiers(uid, tiers){
  return saveGuestState(uid, "projects", { tiers }, true);
}
// Each project's daily cap (Mor, 2026-10-21): { name: max tasks a day }. A
// project with none has no cap.
export function saveProjectCaps(uid, caps){
  return saveGuestState(uid, "projects", { caps }, true);
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
    data.state.learn[key].at = Date.now(); // engine fades counts from here
    try { writeGuestData(data); return Promise.resolve(); }
    catch(error){ return Promise.reject(error); }
  }
  return fb.setDoc(learnDoc(uid), { [`${type || "deep"}|${part}`]: { [field]: fb.increment(1), at: Date.now() } }, { merge: true });
}
