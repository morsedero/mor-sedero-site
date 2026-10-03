// Daisey v1 task model. Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/js/model.js";

const NOW = Date.UTC(2026, 9, 5, 9);
const opts = { now: NOW };

test("title only: Inbox, guessed size and energy, ready, counters zeroed", () => {
  const t = M.createTask({ title: "  Something   vague " }, opts);
  assert.equal(t.title, "Something vague");
  assert.equal(t.project, "Inbox");
  assert.equal(t.size, 30);
  assert.equal(t.energy, "medium");
  assert.equal(t.status, "ready");
  assert.equal(t.waitingOn, null);
  assert.equal(t.canSplit, false);
  assert.deepEqual(t.guessed, ["size", "energy", "canSplit"]);
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
  assert.deepEqual(t.guessed, ["energy", "canSplit"]);
});

test("adding never takes energy, status, waiting on, hard due or repeat", () => {
  const t = M.createTask({ title: "email Dana", energy: "high", status: "waiting", waitingOn: "Yuval",
    hardDue: true, due: "2026-10-08", repeat: { every: 7 } }, opts);
  assert.equal(t.energy, "low"); // guessed from the title, input ignored
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

test("energy guesses from words, then size", () => {
  assert.equal(M.guessEnergy("Mix review", 60), "high");
  assert.equal(M.guessEnergy("email Dana", 15), "low");
  assert.equal(M.guessEnergy("לשלם ארנונה", 15), "low");
  assert.equal(M.guessEnergy("thing", 5), "low");
  assert.equal(M.guessEnergy("thing", 90), "high");
  assert.equal(M.guessEnergy("thing", 30), "medium");
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
  assert.equal(M.toEnergy("med"), "medium");
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

test("edit: only changed fields, user values stop being guesses", () => {
  const t = { id: "a", ...M.createTask({ title: "thing" }, opts) };
  assert.deepEqual(M.editTask(t, { title: "thing" }, opts), {});
  const p = M.editTask(t, { size: 90 }, { now: NOW + 1 });
  assert.equal(p.size, 90);
  assert.equal(p.energy, "high"); // still a guess, re-guessed from new size
  assert.equal(p.canSplit, true); // still a default, follows size
  assert.deepEqual(p.guessed, ["canSplit", "energy"]);
  assert.equal(p.touchedAt, NOW + 1);
});

test("edit: energy set later (when choosing) sticks through a retitle", () => {
  const t = { id: "a", ...M.createTask({ title: "thing" }, opts) };
  const e = M.editTask(t, { energy: "low" }, opts);
  assert.deepEqual(e.guessed, ["canSplit", "size"]);
  const p = M.editTask({ ...t, ...e }, { title: "Call Uri" }, opts);
  assert.equal(p.size, 15);
  assert.equal(p.energy, undefined);
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
