// Stand-in for app/js/store.js in the preview: same exports, tasks held in
// memory instead of Firestore. Seeded from window.__FAKE (set by preview.js).
import { createTask, editTask, completeTask, skipTask, skipReason, leftMinutes } from "./model.js";

const seed = window.__FAKE || {};
let n = 0;
let tasks = (seed.tasks || []).map((t) => ({ id: "t" + ++n, ...createTask(t), ...(t.over || {}) }));
const docs = { skips: seed.skips ?? null, settings: seed.settings ?? { deadlinesAsked: true }, moment: seed.moment ?? {}, learn: seed.learn ?? {}, projects: seed.projects ?? [], dayplan: seed.dayplan ?? null };
const subs = { tasks: new Set(), now: new Set(), skips: new Set(), settings: new Set(), moment: new Set(), learn: new Set(), projects: new Set(), dayplan: new Set() };

const emit = (k) => setTimeout(() => { for (const cb of subs[k]) cb(k === "tasks" ? tasks.map((t) => ({ ...t })) : docs[k], {}); });
const watch = (k) => (uid, cb) => { subs[k].add(cb); setTimeout(() => cb(k === "tasks" ? tasks.map((t) => ({ ...t })) : docs[k], {})); return () => subs[k].delete(cb); };
const ok = (k) => { emit(k); return Promise.resolve(); };

export const watchTasks = watch("tasks");
export const skipNow = (uid, task) => patchTask(uid, task.id, skipTask(task));
export const blockTask = (uid, task, waitingOn = "", checkOn = "") => patchTask(uid, task.id, { ...skipReason(task, "blocked"), ...(waitingOn.trim() ? { waitingOn: waitingOn.trim() } : {}), ...(checkOn ? { checkOn } : {}) });
export const restoreTask = (uid, id, fields) => patchTask(uid, id, fields);
export const undoDone = (uid, id, before) => patchTask(uid, id, before);
export const watchSkips = watch("skips");
export const saveSkips = (uid, state) => { docs.skips = state; return ok("skips"); };
export const addTask = (uid, input) => { tasks.push({ id: "t" + ++n, ...createTask(input, { history: tasks }) }); return ok("tasks"); };
export const addTaskAt = (uid, id, input) => { tasks.push({ id, ...createTask(input, { history: tasks }) }); return ok("tasks"); };
export const updateTask = (uid, task, changes) => {
  const i = tasks.findIndex((t) => t.id === task.id);
  tasks[i] = { ...tasks[i], ...editTask(tasks[i], changes, { history: tasks }) };
  return ok("tasks");
};
export const patchTask = (uid, id, patch) => { const i = tasks.findIndex((t) => t.id === id); tasks[i] = { ...tasks[i], ...patch }; return ok("tasks"); };
// As store.js: the finish in the log, 0 min worked, the task's length beside it.
export const finishTask = (uid, task) => { const p = patchTask(uid, task.id, completeTask(task)); logWork(uid, task, 0, { done: true, size: leftMinutes(task) }); return p; };
export const logWork = (uid, task, minutes) => { (window.__logged ||= []).push({ t: task.id, p: task.project, m: Math.round(minutes) }); return Promise.resolve(null); };
export const unlogReopened = () => Promise.resolve();
export const renameInLog = () => Promise.resolve();
// Bloom: a few entries over the last days so the page has something to draw.
export const watchLog = (uid, keys, cb) => {
  const t = Date.now(), d = 864e5;
  const rich = [["Band", 90, 0, 1], ["Band", 45, 1], ["Band", 60, 2, 1], ["Band", 30, 3, 1], ["Reprise", 120, 1, 1], ["Reprise", 50, 4],
    ["Work", 30, 3, 1, 1], ["Work", 25, 0], ["Home", 20, 2, 1], ["Admin", 10, 5, 1]];
  const few = [["Band", 90, 1, 1], ["Band", 45, 2], ["Work", 30, 3, 1, 1]];
  setTimeout(() => cb((seed.bloomLog ? rich : few).map(([p, m, ago, done, g], i) => ({ id: "e" + i, t: "x" + i, p, m, at: t - ago * d - 3600000, ...(done ? { d: 1 } : {}), ...(g ? { g: 1 } : {}) }))));
  return () => {};
};
export const removeTask = (uid, id) => { tasks = tasks.filter((t) => t.id !== id); return ok("tasks"); };

export const migrateTasks = () => () => {};
export const watchSettings = watch("settings");
export const watchProjectNames = (uid, cb) => { setTimeout(() => cb(docs.projects, {}, [], seed.tiers || {})); return () => {}; };
export const saveProjectNames = (uid, names) => { docs.projects = names; return ok("projects"); };
export const saveProjectRanges = (uid, ranges) => { docs.ranges = ranges; return Promise.resolve(); };
export const saveProjectOrder = (uid, order) => { docs.projectOrder = order; return Promise.resolve(); };
export const saveProjectTiers = (uid, tiers) => { docs.projectTiers = tiers; return Promise.resolve(); };
export const watchMoment = watch("moment");
export const saveMoment = (uid, f) => { docs.moment = { ...docs.moment, ...f }; return ok("moment"); };
export const watchLearn = watch("learn");
export const watchDayPlan = watch("dayplan");
export const resetAll = async () => { tasks = []; Object.keys(docs).forEach((k) => { docs[k] = null; }); window.__RESET = true; emit("tasks"); };
export const seedAccountOnce = async () => false; // the preview seeds from its scenario, never the sample day
export const saveDayPlan = (uid, plan) => { docs.dayplan = { ...plan, at: Date.now() }; return ok("dayplan"); };
export const holdTask = (uid, task, who = "") => patchTask(uid, task.id, { onHold: { who, since: Date.now() } });
export const releaseTask = (uid, task) => patchTask(uid, task.id, { onHold: null });
export const bumpLearn = (uid, type, part, field) => { const k = `${type}|${part}`; docs.learn = { ...docs.learn, [k]: { ...docs.learn[k], [field]: (docs.learn[k]?.[field] || 0) + 1 } }; return ok("learn"); };
export const saveSettings = (uid, fields) => { docs.settings = { ...docs.settings, ...fields }; return ok("settings"); };

window.__store = { get tasks(){ return tasks; }, docs };
