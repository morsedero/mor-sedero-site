// Daisey v1 task model. Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/js/model.js";

const NOW = Date.UTC(2026, 9, 5, 9);
const opts = { now: NOW };

test("title only: Inbox, guessed size, ready, counters zeroed", () => {
  const t = M.createTask({ title: "  Something   vague " }, opts);
  assert.equal(t.title, "Something vague");
  assert.equal(t.project, "Inbox");
  assert.equal(t.size, 30);
  assert.equal("energy" in t, false);
  assert.equal(t.status, "ready");
  assert.equal(t.waitingOn, null);
  assert.equal(t.canSplit, false);
  assert.deepEqual(t.guessed, ["size", "canSplit"]);
  assert.equal(t.due, null);
  assert.equal(t.createdAt, NOW);
  assert.equal(t.touchedAt, NOW);
  assert.equal(t.skipCount, 0);
  assert.deepEqual(t.skipReasons, { tired: 0, notime: 0, mood: 0, blocked: 0 });
  assert.equal(t.spentMinutes, 0);
  assert.equal(t.starts, 0);
  assert.equal(t.stopsUnfinished, 0);
  // Firestore rejects undefined; every field must be a value or null.
  for (const [k, v] of Object.entries(t)) assert.notEqual(v, undefined, k);
});

test("project comes first in the stored task", () => {
  assert.deepEqual(Object.keys(M.createTask({ title: "x" }, opts)).slice(0, 2), ["project", "title"]);
});

test("title is required", () => {
  assert.throws(() => M.createTask({ title: "   " }, opts));
  assert.throws(() => M.createTask({}, opts));
});

test("given fields are kept, not marked as guesses", () => {
  const t = M.createTask({ title: "Mix review", project: "Reprise", size: 120, due: "2026-10-08" }, opts);
  assert.equal(t.project, "Reprise");
  assert.equal(t.size, 120);
  assert.equal(t.due, "2026-10-08");
  assert.equal(t.canSplit, true); // 60+ default
  assert.deepEqual(t.guessed, ["canSplit"]);
});

test("adding never takes energy, status, waiting on, hard due or repeat", () => {
  const t = M.createTask({ title: "email Dana", energy: "high", status: "waiting", waitingOn: "Yuval",
    hardDue: true, due: "2026-10-08", repeat: { every: 7 } }, opts);
  assert.equal("energy" in t, false); // no energy at all
  assert.equal(t.status, "ready");
  assert.equal(t.waitingOn, null);
  assert.equal("hardDue" in t, false);
  assert.equal("repeat" in t, false);
});

test("size guesses from words, English and Hebrew", () => {
  assert.equal(M.guessSize("Call Uri"), 15);
  assert.equal(M.guessSize("send invoices"), 15);
  assert.equal(M.guessSize("Lesson prep"), 60);
  assert.equal(M.guessSize("reply to Dana"), 5);
  assert.equal(M.guessSize("compose theme"), 90);
  assert.equal(M.guessSize("ולהתקשר לאורי"), 15); // prefix letter
  assert.equal(M.guessSize("הכנה לשיעור"), 60);
  assert.equal(M.guessSize("call about the mix"), 60); // bigger hint wins
  assert.equal(M.guessSize("something"), 30);
});

test("size guess prefers similar past tasks over words", () => {
  const history = [
    { title: "Lesson prep week 3", status: "done", spentMinutes: 25, size: 60, guessed: ["size"] },
    { title: "Lesson prep week 4", status: "done", spentMinutes: 35, size: 60, guessed: ["size"] },
    { title: "Unrelated", status: "done", spentMinutes: 200 },
  ];
  assert.equal(M.guessSize("Lesson prep", history), 30);
  // A guessed size that never finished teaches nothing.
  assert.equal(M.guessSize("Lesson prep", [{ title: "Lesson prep", size: 5, guessed: ["size"] }]), 60);
  // A size the user set does.
  assert.equal(M.guessSize("Lesson prep", [{ title: "Lesson prep", size: 15, guessed: [] }]), 15);
});

test("snapSize: nearest bucket, ties go up, 90+ stays 90", () => {
  assert.equal(M.snapSize(1), 5);
  assert.equal(M.snapSize(10), 15);
  assert.equal(M.snapSize(45), 60);
  assert.equal(M.snapSize(300), 90);
});

test("cleaning rejects junk without throwing", () => {
  const t = M.createTask({ title: "x", size: "lots", due: "2026-02-30", dueTime: "25:00" }, opts);
  assert.equal(t.size, 30);
  assert.equal(t.due, null);
  assert.equal(t.dueTime, null);
  assert.equal(M.toMinutes("90+"), 90);
});

test("due time kept only with a due date", () => {
  assert.equal(M.createTask({ title: "x", dueTime: "14:30" }, opts).dueTime, null);
  assert.equal(M.createTask({ title: "x", due: "2026-10-06", dueTime: "14:30" }, opts).dueTime, "14:30");
});

test("done goes to Done and leaves the available list", () => {
  const t = M.createTask({ title: "x" }, opts);
  const p = M.completeTask(t, opts);
  assert.equal(p.status, "done");
  assert.equal(p.doneAt, NOW);
  assert.equal(M.isAvailable(t), true);
  assert.equal(M.isAvailable({ ...t, ...p }), false);
});

test("durations always carry their unit: no decimal hours, no bare trailing number", () => {
  assert.equal(M.durText(45), "45 min");
  assert.equal(M.durText(60), "1 h");
  assert.equal(M.durText(90), "1 h 30 min");
  assert.equal(M.durText(245), "4 h 5 min"); // never "4 h 5"
  assert.equal(M.durText(0), "0 min");
  assert.equal(M.durText(-5), "0 min");
});

test("not now: the skip counts; the reason is a second patch; blocked waits", () => {
  const t = { ...M.createTask({ title: "x" }, opts), skipCount: 2, skipsSinceStart: 1 };
  assert.deepEqual(M.skipTask(t, opts), { skipCount: 3, skipsSinceStart: 2, touchedAt: NOW });
  const tired = M.skipReason(t, "tired", opts);
  assert.equal(tired.skipReasons.tired, 1);
  assert.equal(tired.status, undefined); // only "blocked" changes the task
  assert.equal(M.skipReason(t, "blocked", opts).status, "waiting");
  assert.deepEqual(M.skipReason(t, "nonsense", opts), {});
});

test("not now: Undo puts back exactly what the skip touched", () => {
  const t = { ...M.createTask({ title: "x" }, opts), skipCount: 2, skipsSinceStart: 1, touchedAt: NOW - 5 };
  const before = M.skipSnapshot(t);
  const after = { ...t, ...M.skipTask(t, opts), ...M.skipReason(t, "blocked", opts) };
  assert.equal(after.status, "waiting");
  assert.deepEqual({ ...after, ...before }, t);
});

test("focus mode: starting counts a start and clears the stale-skip count", () => {
  const t = { ...M.createTask({ title: "x" }, opts), starts: 1, skipsSinceStart: 3 };
  assert.deepEqual(M.startedTask(t, opts), { starts: 2, skipsSinceStart: 0, touchedAt: NOW });
});

test("focus mode: real minutes always count; finishing completes, stopping is recorded", () => {
  const t = { ...M.createTask({ title: "x" }, opts), spentMinutes: 10, stopsUnfinished: 1 };
  const more = M.workedTask(t, 12.4, opts);
  assert.deepEqual(more, { spentMinutes: 22, stopsUnfinished: 2, touchedAt: NOW });
  const done = M.workedTask(t, 12.6, { ...opts, finished: true });
  assert.equal(done.spentMinutes, 23);
  assert.equal(done.status, "done");
  assert.equal(done.stopsUnfinished, undefined); // finishing isn't a stop
  assert.equal(M.workedTask(t, -5, opts).spentMinutes, 10); // a clock skew never takes time away
});

test("edit: only changed fields, user values stop being guesses", () => {
  const t = { id: "a", ...M.createTask({ title: "thing" }, opts) };
  assert.deepEqual(M.editTask(t, { title: "thing" }, opts), {});
  const p = M.editTask(t, { size: 90 }, { now: NOW + 1 });
  assert.equal(p.size, 90);
  assert.equal(p.canSplit, true); // still a default, follows size
  assert.deepEqual(p.guessed, ["canSplit"]);
  assert.equal(p.touchedAt, NOW + 1);
});

test("edit: clearing size hands it back to the guess", () => {
  const t = { id: "a", ...M.createTask({ title: "Call Uri", size: 60 }, opts) };
  const p = M.editTask(t, { size: "" }, opts);
  assert.equal(p.size, 15);
  assert.ok(p.guessed.includes("size"));
});

test("edit: waiting on an existing task, then back to ready", () => {
  const t = { id: "a", ...M.createTask({ title: "cue" }, opts) };
  const w = M.editTask(t, { waitingOn: "Yuval" }, opts);
  assert.equal(w.status, "waiting");
  assert.equal(w.waitingOn, "Yuval");
  const r = M.editTask({ ...t, ...w }, { status: "ready" }, opts);
  assert.equal(r.waitingOn, null);
});

test("edit: clearing due clears due time", () => {
  const t = { id: "a", ...M.createTask({ title: "x", due: "2026-10-06", dueTime: "10:00" }, opts) };
  const p = M.editTask(t, { due: null }, opts);
  assert.equal(p.due, null);
  assert.equal(p.dueTime, null);
});

test("reopening a done task clears doneAt", () => {
  const t = { id: "a", ...M.createTask({ title: "x" }, opts) };
  const d = { ...t, ...M.completeTask(t, opts) };
  const p = M.editTask(d, { status: "ready" }, opts);
  assert.equal(p.status, "ready");
  assert.equal(p.doneAt, null);
  assert.equal(M.isAvailable({ ...d, ...p }), true);
});
