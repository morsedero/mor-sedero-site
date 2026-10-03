// Stand-in for app/js/store.js in the preview: same exports, tasks held in
// memory instead of Firestore. Seeded from window.__FAKE (set by preview.js).
import { createTask, editTask, completeTask } from "./model.js";

const seed = window.__FAKE || {};
let n = 0;
let tasks = (seed.tasks || []).map((t) => ({ id: "t" + ++n, ...createTask(t), ...(t.over || {}) }));
const docs = { context: seed.context ?? null, now: seed.now ?? null };
const subs = { tasks: new Set(), context: new Set(), now: new Set() };

const emit = (k) => setTimeout(() => { for (const cb of subs[k]) cb(k === "tasks" ? tasks.map((t) => ({ ...t })) : docs[k], {}); });
const watch = (k) => (uid, cb) => { subs[k].add(cb); setTimeout(() => cb(k === "tasks" ? tasks.map((t) => ({ ...t })) : docs[k], {})); return () => subs[k].delete(cb); };
const ok = (k) => { emit(k); return Promise.resolve(); };

export const watchTasks = watch("tasks");
export const watchContext = watch("context");
export const watchNow = watch("now");
export const addTask = (uid, input) => { tasks.push({ id: "t" + ++n, ...createTask(input, { history: tasks }) }); return ok("tasks"); };
export const updateTask = (uid, task, changes) => {
  const i = tasks.findIndex((t) => t.id === task.id);
  tasks[i] = { ...tasks[i], ...editTask(tasks[i], changes, { history: tasks }) };
  return ok("tasks");
};
export const patchTask = (uid, id, patch) => { const i = tasks.findIndex((t) => t.id === id); tasks[i] = { ...tasks[i], ...patch }; return ok("tasks"); };
export const finishTask = (uid, task) => patchTask(uid, task.id, completeTask(task));
export const removeTask = (uid, id) => { tasks = tasks.filter((t) => t.id !== id); return ok("tasks"); };
export const saveContext = (uid, ctx) => { docs.context = ctx; return ok("context"); };
export const saveNow = (uid, state) => { docs.now = state; return ok("now"); };

window.__store = { get tasks(){ return tasks; }, docs };
