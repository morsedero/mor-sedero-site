// Reality over plan (2026-10-06): a running task and real work beat the
// calendar, on the Now card (reality.js) and in the notifications
// (notify.js). Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
process.env.TZ = "Asia/Jerusalem";
const R = await import("../../app/js/reality.js");
const N = require("../../functions/_daisey-lib/notify.js");

const at = (h, m = 0) => Date.UTC(2026, 9, 6, h - 3, m); // Israel wall clock, 6 Oct
const il = (h, m = 0) => new Date(at(h, m)).toISOString();
const t = (o) => ({ id: String(Math.random()), title: "Task", status: "ready", due: "2026-10-06", dateKind: "target", size: 30, spentMinutes: 0, ...o });
const rec = (o = {}) => ({ tz: "Asia/Jerusalem", dayStart: 480, dayEnd: 1320, subs: [{}], tasks: [], ...o });
const types = (out) => out.map((m) => m.type);

test("runState: running until the 'Still on it?' point, paused until it's stale", () => {
  const task = t({ id: "a", size: 30 });
  const run = { taskId: "a", startedAt: at(10), extra: 0 };
  assert.equal(R.runState(null, [task], at(10, 5)), null);
  assert.equal(R.runState(run, [task], at(10, 50)), "running");
  assert.equal(R.runState(run, [task], at(11, 1)), null); // past 2× / +30: a forgotten timer
  assert.equal(R.runState({ ...run, extra: 30 }, [task], at(11, 1)), "running"); // +15s move it
  assert.equal(R.runState({ ...run, pausedAt: at(10, 10) }, [task], at(12)), "paused");
  assert.equal(R.runState({ ...run, pausedAt: at(10, 10) }, [task], at(13, 15)), null);
  const batch = { taskId: "a", batch: ["a", "b"], done: [], startedAt: at(10), extra: 0 };
  assert.equal(R.runState(batch, [task, t({ id: "b", size: 30 })], at(11, 30)), "running"); // 60 min batch
});

test("overruled: work during an event beats the event; the future is never overruled", () => {
  const meet = { id: "m", title: "Meeting", start: il(14), end: il(15), busy: true };
  const later = { id: "l", title: "Dinner", start: il(19), end: il(20), busy: true };
  const now = at(14, 30);
  assert.equal(R.overruled([meet, later], { tasks: [t({ workedAt: at(13) })], now }).size, 0); // worked before it
  const worked = R.overruled([meet, later], { tasks: [t({ workedAt: at(14, 10) })], now });
  assert.deepEqual([...worked], [R.eventKey(meet)]);
  // A task running since before the meeting: you're on it, not in the meeting.
  const run = { taskId: "a", startedAt: at(13, 50), extra: 0 };
  assert.deepEqual([...R.overruled([meet, later], { tasks: [t({ id: "a", size: 60, workedAt: at(13, 50) })], run, now })], [R.eventKey(meet)]);
  assert.equal(R.overruled([{ ...meet, busy: false }], { tasks: [t({ workedAt: at(14, 10) })], now }).size, 0);
  // An event added after the work (2026-10-08): the newer statement wins.
  const added = { ...meet, updated: il(14, 20) };
  assert.equal(R.overruled([added], { tasks: [t({ workedAt: at(14, 10) })], now }).size, 0);
  assert.equal(R.overruled([added], { tasks: [t({ id: "a", size: 60, workedAt: at(13, 50) })], run, now }).size, 0);
  assert.equal(R.overruled([added], { tasks: [t({ workedAt: at(14, 25) })], now }).size, 1); // worked after adding it
});

test("decide: while a task runs, nothing competes with it", () => {
  const task = t({ id: "a", title: "SFX pass", size: 60 });
  const other = t({ id: "b", title: "Send invoice", size: 15 });
  const run = { taskId: "a", startedAt: at(11), extra: 0 };
  const teach = { id: "e1", title: "Teaching", start: il(9), end: il(11), busy: true };
  // Gap: none while running, and marked handled so it doesn't come late.
  const g = N.decide(rec({ sentOn: "2026-10-06", tasks: [task, other], run }), [teach], at(11, 5));
  assert.deepEqual(types(g.out), []);
  assert.ok(g.patch.gapFor);
  // Booked slot for another task: the plan yields.
  const slot = { id: "s", title: "Send invoice", start: il(11, 15), end: il(11, 45), busy: true, taskId: "b" };
  const b = N.decide(rec({ sentOn: "2026-10-06", tasks: [task, other], run }), [slot], at(11, 16));
  assert.deepEqual(types(b.out), []);
  assert.equal(b.patch.bookedSent.length, 1);
  // The brief and the wrap wait for the task to end.
  assert.deepEqual(types(N.decide(rec({ tasks: [task], run: { ...run, startedAt: at(8) } }), [], at(8, 5)).out), []);
  assert.ok(types(N.decide(rec({ tasks: [task] }), [], at(8, 5)).out).includes("brief"));
  const late = { ...run, startedAt: at(21) };
  assert.deepEqual(types(N.decide(rec({ sentOn: "2026-10-06", tasks: [task, t({ status: "done", doneAt: at(12) })], run: late }), [], at(21, 5)).out), []);
  // A forgotten timer isn't focus: the gap goes.
  const stale = { taskId: "a", startedAt: at(6), extra: 0 };
  assert.deepEqual(types(N.decide(rec({ sentOn: "2026-10-06", tasks: [task, other], run: stale }), [teach], at(11, 5)).out), ["gap"]);
});

test("decide: a people alert comes only close to the meeting while you're focused", () => {
  const run = { taskId: "a", startedAt: at(13), extra: 0 };
  const r = rec({ sentOn: "2026-10-06", run, tasks: [t({ id: "a", size: 120 }), t({ id: "c", title: "Pre-attack cue", status: "waiting", waitingOn: "Yuval" })] });
  const ev = { id: "m1", title: "Coffee with Yuval", start: il(14), end: il(15), busy: true };
  assert.equal(N.decide(r, [ev], at(13, 30)).out.length, 0);
  assert.deepEqual(types(N.decide(r, [ev], at(13, 50)).out), ["people"]);
});

test("decide: an event you worked through holds nothing back and isn't announced as over", () => {
  const meet = { id: "m", title: "Meeting", start: il(8), end: il(10), busy: true };
  const worked = [t({ title: "Lesson prep", workedAt: at(8, 20) })];
  // The brief waits for an event, unless you were plainly not in it.
  assert.deepEqual(types(N.decide(rec({ tasks: [t({})] }), [meet], at(8, 30)).out), []);
  assert.ok(types(N.decide(rec({ tasks: worked }), [meet], at(8, 30)).out).includes("brief"));
  // Its end isn't a gap.
  assert.deepEqual(types(N.decide(rec({ sentOn: "2026-10-06", tasks: [...worked, t({ title: "Invoice", size: 15 })] }), [meet], at(10, 5)).out), []);
});
