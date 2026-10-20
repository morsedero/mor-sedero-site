// store.js against both of its backends (BEHAVIOR_REVIEW #2 #3 #5 #9).
// Firestore's set-with-merge is DEEP and a guest's is shallow, so a bug can
// hide in one path: every case runs on both. firebase.js is swapped for an
// in-memory fake with Firestore's real merge rules; the rest is the real code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../app/js/", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "daisey-store-"));
cpSync(src, dir, { recursive: true });
writeFileSync(join(dir, "firebase.js"), `
const docs = globalThis.__docs = new Map(), subs = new Map();
const DEL = { __del: true };
export const db = {};
export const doc = (_db, ...p) => ({ path: p.join("/") });
export const collection = (_db, ...p) => ({ path: p.join("/") });
export const deleteField = () => DEL;
export const increment = (n) => ({ __inc: n });
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== DEL));
const deep = (a, b) => { const o = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) {
    if (v === DEL) delete o[k];
    else if (v && typeof v === "object" && !Array.isArray(v)) o[k] = deep(o[k], v);
    else o[k] = v;
  } return o; };
const put = (path, v) => { if (v == null) docs.delete(path); else docs.set(path, v); for (const cb of subs.get(path) || []) cb(snap(path)); };
const snap = (path) => ({ exists: () => docs.has(path), data: () => docs.get(path), metadata: {} });
export function setDoc(ref, data, opts){
  const cur = docs.get(ref.path);
  if (opts?.merge) put(ref.path, deep(cur, data));
  else if (opts?.mergeFields) { const o = { ...(cur || {}) };
    for (const f of opts.mergeFields) { if (data[f] === DEL) delete o[f]; else o[f] = data[f]; } put(ref.path, o); }
  else put(ref.path, clean(data));
  return Promise.resolve();
}
export function updateDoc(ref, data){
  const cur = docs.get(ref.path);
  if (!cur) return Promise.reject(Object.assign(new Error("No document to update"), { code: "not-found" }));
  const o = { ...cur }; for (const [k, v] of Object.entries(data)) { if (v === DEL) delete o[k]; else o[k] = v; }
  put(ref.path, o); return Promise.resolve();
}
export const deleteDoc = (ref) => { put(ref.path, null); return Promise.resolve(); };
export const getDoc = (ref) => Promise.resolve(snap(ref.path));
export function onSnapshot(ref, ...a){ const cb = a.find((x) => typeof x === "function");
  const s = subs.get(ref.path) || new Set(); s.add(cb); subs.set(ref.path, s); cb(snap(ref.path)); return () => s.delete(cb); }
export const addDoc = () => Promise.resolve({ id: "x" });
export const getDocs = (col) => Promise.resolve({ docs: [...docs].filter(([p]) => p.startsWith(col.path + "/") && !p.slice(col.path.length + 1).includes("/"))
  .map(([p, v]) => ({ id: p.split("/").pop(), data: () => v })) });
export const serverTimestamp = () => Date.now();
`);

const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
const store = await import(pathToFileURL(join(dir, "store.js")).href);
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

const GUEST = "guest-local", USER = "u1", KEY = "daisey.guest.data.v1";
const guest = () => JSON.parse(ls.get(KEY) || '{"tasks":[],"state":{}}');
const state = (uid, key) => (uid === GUEST ? guest().state[key] ?? null : globalThis.__docs.get(`users/${uid}/state/${key}`) ?? null);
const reset = () => { ls.clear(); globalThis.__docs.clear(); };

for (const uid of [USER, GUEST]) {
  const who = uid === GUEST ? "guest" : "Firestore";

  test(`${who}: a tier taken out of the map is gone (#2), names stay`, async () => {
    reset();
    await store.saveProjectNames(uid, ["Album"]);
    await store.saveProjectTiers(uid, { Album: "focus" });
    await store.saveProjectRanges(uid, { Album: { start: "2026-10-01", due: "2026-11-01" } });
    await store.saveProjectTiers(uid, {});              // Undo
    await store.saveProjectRanges(uid, { Single: null }); // rename Album → Single
    const p = state(uid, "projects");
    assert.deepEqual(p.tiers, {});
    assert.deepEqual(p.ranges, { Single: null });
    assert.deepEqual(p.names, ["Album"]);
  });

  test(`${who}: yesterday's meal answers don't leak into today (#3)`, async () => {
    reset();
    await store.saveSettings(uid, { dayStart: "09:00" });
    await store.saveSettings(uid, { mealToday: { date: "2026-10-09", Lunch: "14:00" } });
    await store.saveSettings(uid, { mealToday: { date: "2026-10-10", Dinner: "there" } });
    const s = state(uid, "settings");
    assert.deepEqual(s.mealToday, { date: "2026-10-10", Dinner: "there" });
    assert.equal(s.dayStart, "09:00");
  });

  test(`${who}: Reopen takes a Done from an earlier session out of the log (#5)`, async () => {
    reset();
    const at = Date.parse("2026-10-10T10:00:00"), key = `log-2026-10`;
    const entries = { e: { [`${at - 60000}-t1`]: { t: "t1", p: "Inbox", m: 30, at: at - 60000, d: 1 },
      [`${at - 999999}-t1`]: { t: "t1", p: "Inbox", m: 20, at: at - 999999 },   // a session, not the Done
      [`${at}-t2`]: { t: "t2", p: "Inbox", m: 10, at, d: 1 } } };
    if (uid === GUEST) ls.set(KEY, JSON.stringify({ tasks: [], state: { [key]: entries } }));
    else globalThis.__docs.set(`users/${uid}/state/${key}`, entries);
    await store.unlogReopened(uid, { id: "t1", doneAt: at });
    const left = Object.entries(state(uid, key).e).filter(([, x]) => x).map(([id]) => id).sort();
    assert.deepEqual(left, [`${at - 999999}-t1`, `${at}-t2`].sort());
  });

  // Round 2 #1 (2026-10-11): Done credits no time. The gap between the card
  // showing and Done is waiting, interruptions and time away, not work.
  const seed = (t) => { if (uid === GUEST) ls.set(KEY, JSON.stringify({ tasks: [t], state: {} })); else globalThis.__docs.set(`users/${uid}/tasks/${t.id}`, t); };
  const saved = (id) => (uid === GUEST ? guest().tasks.find((t) => t.id === id) : globalThis.__docs.get(`users/${uid}/tasks/${id}`));
  const logged = () => (uid === GUEST ? Object.entries(guest().state) : [...globalThis.__docs].filter(([p]) => p.startsWith(`users/${uid}/state/`)).map(([p, v]) => [p.split("/").pop(), v]))
    .filter(([k]) => k.startsWith("log-")).flatMap(([, v]) => Object.values(v?.e || {})).filter(Boolean);
  const hour = (o = {}) => ({ id: "t1", title: "Mix review", project: "Band", size: 60, status: "ready", spentMinutes: 0, createdAt: Date.now() - 5000, ...o });

  test(`${who}: Done seconds after a 60-min task shows records no 60 min (round 2 #1a)`, async () => {
    reset();
    seed(hour());
    const p = store.finishTask(uid, hour());
    await p; await new Promise((r) => setTimeout(r));
    const e = logged();
    assert.equal(e.length, 1);
    // The finish, no minutes worked; the task's length beside them (the Week page's count).
    assert.deepEqual({ m: e[0].m, d: e[0].d, g: e[0].g, s: e[0].s }, { m: 0, d: 1, g: undefined, s: 60 });
    const t = saved("t1");
    assert.equal(t.status, "done");
    assert.equal(t.size, 60);                              // the estimate stays the estimate
    assert.equal(t.spentMinutes || 0, 0);                  // nothing for the size learning (model.guessSize)
    await store.unlogDone(uid, "t1");                      // this session's Done map: not into the next test
  });

  test(`${who}: time in the background is not credited (round 2 #1b)`, async () => {
    reset();
    // Card up, other work finished just before it, then the app sits in the
    // background for 45 min: the old guess logged the gap as work.
    const t0 = Date.now(), real = Date.now;
    seed(hour({ createdAt: t0 - 3600000 }));
    Date.now = () => t0 + 45 * 60000;
    try {
      const p = store.finishTask(uid, hour({ createdAt: t0 - 3600000 }));
      await p; await new Promise((r) => setTimeout(r));
      assert.equal(logged().reduce((s, x) => s + (x.m || 0), 0), 0);
      assert.equal(saved("t1").spentMinutes || 0, 0);
      await store.unlogDone(uid, "t1");
    } finally { Date.now = real; }
  });

  test(`${who}: a renamed project's past work moves to the new name (#6)`, async () => {
    reset();
    const logs = { "log-2026-09": { e: { a: { t: "t1", p: "Album", m: 30, at: 1 }, b: { t: "t2", p: "Other", m: 5, at: 2 } } },
      "log-2026-10": { e: { c: { t: "t1", p: "Album", m: 10, at: 3, d: 1 }, z: null } } };
    if (uid === GUEST) ls.set(KEY, JSON.stringify({ tasks: [], state: logs }));
    else for (const [k, v] of Object.entries(logs)) globalThis.__docs.set(`users/${uid}/state/${k}`, v);
    await store.renameInLog(uid, "Album", "Single");
    assert.equal(state(uid, "log-2026-09").e.a.p, "Single");
    assert.equal(state(uid, "log-2026-09").e.b.p, "Other");
    assert.deepEqual(state(uid, "log-2026-10").e.c, { t: "t1", p: "Single", m: 10, at: 3, d: 1 });
  });
}

test("guest: another tab's write reaches this tab's listeners (#9)", () => {
  reset();
  const seen = [], plans = [];
  const off1 = store.watchTasks(GUEST, (ts) => seen.push(ts.map((t) => t.title)));
  const off2 = store.watchDayPlan(GUEST, (d) => plans.push(d?.date ?? null));
  ls.set(KEY, JSON.stringify({ tasks: [{ id: "a", title: "From tab B" }], state: { dayplan: { date: "2026-10-20" } } }));
  bus.dispatchEvent(Object.assign(new Event("storage"), { key: "something.else" }));
  assert.equal(seen.length, 1);
  bus.dispatchEvent(Object.assign(new Event("storage"), { key: KEY }));
  assert.deepEqual(seen.at(-1), ["From tab B"]);
  assert.equal(plans.at(-1), "2026-10-20");
  off1(); off2();
});
