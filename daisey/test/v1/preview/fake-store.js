// Stand-in for app/js/store.js in the preview: same exports, tasks held in
// memory instead of Firestore. Seeded from window.__FAKE (set by preview.js).
import { createTask, editTask, completeTask, startedTask, workedTask, skipTask, skipReason } from "./model.js";

const seed = window.__FAKE || {};
let n = 0;
let tasks = (seed.tasks || []).map((t) => ({ id: "t" + ++n, ...createTask(t), ...(t.over || {}) }));
// seed.run: { task: <title>, minutes: <elapsed>, extra } — a run already going.
const run = seed.run && (() => { const t = tasks.find((x) => x.title === seed.run.task) || tasks[0];
  return { taskId: t.id, startedAt: Date.now() - (seed.run.minutes || 0) * 60000, extra: seed.run.extra || 0 }; })();
const docs = { now: run || null, skips: seed.skips ?? null };
const subs = { tasks: new Set(), now: new Set(), skips: new Set() };

const emit = (k) => setTimeout(() => { for (const cb of subs[k]) cb(k === "tasks" ? tasks.map((t) => ({ ...t })) : docs[k], {}); });
const watch = (k) => (uid, cb) => { subs[k].add(cb); setTimeout(() => cb(k === "tasks" ? tasks.map((t) => ({ ...t })) : docs[k], {})); return () => subs[k].delete(cb); };
const ok = (k) => { emit(k); return Promise.resolve(); };

export const watchTasks = watch("tasks");
export const skipNow = (uid, task) => patchTask(uid, task.id, skipTask(task));
export const blockTask = (uid, task) => patchTask(uid, task.id, { ...skipTask(task), ...skipReason(task, "blocked") });
export const restoreTask = (uid, id, fields) => patchTask(uid, id, fields);
export const watchRun = watch("now");
export const watchSkips = watch("skips");
export const saveSkips = (uid, state) => { docs.skips = state; return ok("skips"); };
export const startRun = (uid, task) => { docs.now = { taskId: task.id, startedAt: Date.now(), extra: 0 }; patchTask(uid, task.id, startedTask(task)); return ok("now"); };
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

window.__store = { get tasks(){ return tasks; }, docs };
