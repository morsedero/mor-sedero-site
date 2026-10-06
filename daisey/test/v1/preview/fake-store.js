// Stand-in for app/js/store.js in the preview: same exports, tasks held in
// memory instead of Firestore. Seeded from window.__FAKE (set by preview.js).
import { createTask, editTask, completeTask, startedTask, workedTask, keptTime, skipTask, skipReason } from "./model.js";

const seed = window.__FAKE || {};
let n = 0;
let tasks = (seed.tasks || []).map((t) => ({ id: "t" + ++n, ...createTask(t), ...(t.over || {}) }));
// seed.run: { task: <title>, minutes: <elapsed>, extra } — a run already going.
const run = seed.run && (() => { const t = tasks.find((x) => x.title === seed.run.task) || tasks[0];
  return { taskId: t.id, startedAt: Date.now() - (seed.run.minutes || 0) * 60000, extra: seed.run.extra || 0 }; })();
const docs = { now: run || null, skips: seed.skips ?? null, settings: seed.settings ?? { deadlinesAsked: true }, moment: seed.moment ?? {}, learn: seed.learn ?? {}, projects: seed.projects ?? [] };
const subs = { tasks: new Set(), now: new Set(), skips: new Set(), settings: new Set(), moment: new Set(), learn: new Set(), projects: new Set() };

const emit = (k) => setTimeout(() => { for (const cb of subs[k]) cb(k === "tasks" ? tasks.map((t) => ({ ...t })) : docs[k], {}); });
const watch = (k) => (uid, cb) => { subs[k].add(cb); setTimeout(() => cb(k === "tasks" ? tasks.map((t) => ({ ...t })) : docs[k], {})); return () => subs[k].delete(cb); };
const ok = (k) => { emit(k); return Promise.resolve(); };

export const watchTasks = watch("tasks");
export const skipNow = (uid, task) => patchTask(uid, task.id, skipTask(task));
export const blockTask = (uid, task, waitingOn = "", checkOn = "") => patchTask(uid, task.id, { ...skipReason(task, "blocked"), ...(waitingOn.trim() ? { waitingOn: waitingOn.trim() } : {}), ...(checkOn ? { checkOn } : {}) });
export const restoreTask = (uid, id, fields) => patchTask(uid, id, fields);
export const watchRun = watch("now");
export const watchSkips = watch("skips");
export const saveSkips = (uid, state) => { docs.skips = state; return ok("skips"); };
export const startRun = (uid, task) => { docs.now = { taskId: task.id, startedAt: Date.now(), extra: 0 }; patchTask(uid, task.id, startedTask(task)); return ok("now"); };
export const startBatch = (uid, ts) => { const now = Date.now(); docs.now = { taskId: ts[0].id, batch: ts.map((t) => t.id), done: [], mark: now, startedAt: now, extra: 0 }; ts.forEach((t) => patchTask(uid, t.id, startedTask(t))); return ok("now"); };
export const tickBatch = (uid, run, task, m) => { docs.now = { ...run, done: [...(run.done || []), task.id], mark: Date.now() }; patchTask(uid, task.id, workedTask(task, m, { finished: true })); return ok("now"); };
export const endBatch = (uid, left, m) => { docs.now = null; left.forEach((t) => patchTask(uid, t.id, { spentMinutes: (t.spentMinutes || 0) + Math.round(m / left.length) })); return ok("now"); };
export const saveRun = (uid, run) => { docs.now = run; return ok("now"); };
export const cancelRun = (uid, task, m = 0) => { docs.now = null; if (task && m > 0) patchTask(uid, task.id, keptTime(task, m)); return ok("now"); };
export const extendRun = (uid, run, m) => { docs.now = { ...run, extra: (run.extra || 0) + m }; return ok("now"); };
export const endRun = (uid, task, minutes, o = {}) => { docs.now = null; if (task) patchTask(uid, task.id, workedTask(task, minutes, o)); return ok("now"); };
export const addTask = (uid, input) => { tasks.push({ id: "t" + ++n, ...createTask(input, { history: tasks }) }); return ok("tasks"); };
export const updateTask = (uid, task, changes) => {
  const i = tasks.findIndex((t) => t.id === task.id);
  tasks[i] = { ...tasks[i], ...editTask(tasks[i], changes, { history: tasks }) };
  return ok("tasks");
};
export const patchTask = (uid, id, patch) => { const i = tasks.findIndex((t) => t.id === id); tasks[i] = { ...tasks[i], ...patch }; return ok("tasks"); };
export const finishTask = (uid, task) => patchTask(uid, task.id, completeTask(task));
export const removeTask = (uid, id) => { tasks = tasks.filter((t) => t.id !== id); return ok("tasks"); };
export const saveNow = (uid, state) => { docs.now = state; return ok("now"); };

export const migrateTasks = () => () => {};
export const watchSettings = watch("settings");
export const watchProjectNames = watch("projects");
export const saveProjectNames = (uid, names) => { docs.projects = names; return ok("projects"); };
export const watchMoment = watch("moment");
export const saveMoment = (uid, f) => { docs.moment = { ...docs.moment, ...f }; return ok("moment"); };
export const watchLearn = watch("learn");
export const bumpLearn = (uid, type, part, field) => { const k = `${type}|${part}`; docs.learn = { ...docs.learn, [k]: { ...docs.learn[k], [field]: (docs.learn[k]?.[field] || 0) + 1 } }; return ok("learn"); };
export const saveSettings = (uid, fields) => { docs.settings = { ...docs.settings, ...fields }; return ok("settings"); };

window.__store = { get tasks(){ return tasks; }, docs };
