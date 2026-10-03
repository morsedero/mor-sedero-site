// Daisey v1 task model. Run: node --test daisey/test/v1/
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/js/model.js";

const NOW = Date.UTC(2026, 9, 5, 9); // ms value only stamps createdAt/touchedAt
const TODAY = "2026-10-05"; // a Monday
const opts = { now: NOW, today: TODAY };

test("title only: Inbox, guessed size and energy, ready, counters zeroed", () => {
  const t = M.createTask({ title: "  Something   vague " }, opts);
  assert.equal(t.title, "Something vague");
  assert.equal(t.project, "Inbox");
  assert.equal(t.size, 30);
  assert.equal(t.energy, "medium");
  assert.equal(t.status, "ready");
  assert.equal(t.canSplit, false);
  assert.deepEqual(t.guessed, ["size", "energy", "canSplit"]);
  assert.equal(t.due, null);
  assert.equal(t.hardDue, false);
  assert.equal(t.repeat, null);
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

test("title is required", () => {
  assert.throws(() => M.createTask({ title: "   " }, opts));
  assert.throws(() => M.createTask({}, opts));
});

test("given fields are kept, not marked as guesses", () => {
  const t = M.createTask({ title: "Mix review", project: "Reprise", size: 120, energy: "High", due: "2026-10-08", hardDue: true }, opts);
  assert.equal(t.project, "Reprise");
  assert.equal(t.size, 120);
  assert.equal(t.energy, "high");
  assert.equal(t.due, "2026-10-08");
  assert.equal(t.hardDue, true);
  assert.equal(t.canSplit, true); // 60+ default
  assert.deepEqual(t.guessed, ["canSplit"]);
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
    { title: "Lesson prep week 3", status: "done", doneCount: 1, spentMinutes: 25, size: 60, guessed: ["size"] },
    { title: "Lesson prep week 4", status: "done", doneCount: 1, spentMinutes: 35, size: 60, guessed: ["size"] },
    { title: "Unrelated", status: "done", doneCount: 1, spentMinutes: 200 },
  ];
  assert.equal(M.guessSize("Lesson prep", history), 30);
  // A guessed size that never finished teaches nothing.
  assert.equal(M.guessSize("Lesson prep", [{ title: "Lesson prep", size: 5, guessed: ["size"] }]), 60);
  // A size the user set does.
  assert.equal(M.guessSize("Lesson prep", [{ title: "Lesson prep", size: 15, guessed: [] }]), 15);
  // Repeats: real minutes per finish.
  assert.equal(M.guessSize("Invoices", [{ title: "Invoices", doneCount: 4, spentMinutes: 240, status: "ready" }]), 60);
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
  const t = M.createTask({ title: "x", size: "lots", energy: "huge", due: "2026-02-30", dueTime: "25:00", status: "nope" }, opts);
  assert.equal(t.size, 30);
  assert.equal(t.energy, "medium");
  assert.equal(t.due, null);
  assert.equal(t.dueTime, null);
  assert.equal(t.status, "ready");
  assert.equal(M.toMinutes("90+"), 90);
  assert.equal(M.toEnergy("med"), "medium");
});

test("hard due needs a due date; due time kept with one", () => {
  assert.equal(M.createTask({ title: "x", hardDue: true }, opts).hardDue, false);
  const t = M.createTask({ title: "x", due: "2026-10-06", dueTime: "14:30" }, opts);
  assert.equal(t.dueTime, "14:30");
});

test("waiting on someone makes the task Waiting", () => {
  const t = M.createTask({ title: "pre-attack cue", waitingOn: "Yuval" }, opts);
  assert.equal(t.status, "waiting");
  assert.equal(t.waitingOn, "Yuval");
});

test("weekly repeat with no due starts today", () => {
  const t = M.createTask({ title: "Lesson prep", repeat: { every: 7 } }, opts);
  assert.deepEqual(t.repeat, { every: 7, anchor: TODAY });
  assert.equal(t.due, TODAY);
});

test("weekday repeat: due is the next listed weekday", () => {
  const t = M.createTask({ title: "Invoices", repeat: { weekdays: [4] } }, opts); // Thursday
  assert.deepEqual(t.repeat, { weekdays: [4] });
  assert.equal(t.due, "2026-10-08");
  assert.equal(M.toRepeat({ weekdays: [] }), null);
  assert.equal(M.toRepeat({ every: 0 }), null);
});

test("nextOccurrence", () => {
  const every = { every: 14, anchor: "2026-10-05" };
  assert.equal(M.nextOccurrence(every, "2026-10-01"), "2026-10-05");
  assert.equal(M.nextOccurrence(every, "2026-10-05"), "2026-10-19");
  assert.equal(M.nextOccurrence(every, "2026-10-18"), "2026-10-19");
  assert.equal(M.nextOccurrence(every, "2026-10-19"), "2026-11-02");
  const days = { weekdays: [1, 4] }; // Mon, Thu
  assert.equal(M.nextOccurrence(days, "2026-10-05"), "2026-10-08");
  assert.equal(M.nextOccurrence(days, "2026-10-08"), "2026-10-12");
  // Across a month and a DST change (EU ends 2026-10-25).
  assert.equal(M.nextOccurrence({ every: 1, anchor: "2026-10-24" }, "2026-10-25"), "2026-10-26");
});

test("one-off done becomes Done", () => {
  const t = M.createTask({ title: "x" }, opts);
  const p = M.completeTask(t, opts);
  assert.equal(p.status, "done");
  assert.equal(p.doneCount, 1);
  assert.equal(M.isAvailable({ ...t, ...p }, TODAY), false);
});

test("repeat done early: hidden until the next cycle, then once", () => {
  const t = M.createTask({ title: "Invoices", repeat: { weekdays: [4] } }, opts); // due Thu 10-08
  const p = M.completeTask(t, opts); // done Mon 10-05
  const after = { ...t, ...p };
  assert.equal(after.status, "ready");
  assert.equal(after.due, "2026-10-15");
  assert.equal(after.availableFrom, "2026-10-09");
  assert.equal(M.isAvailable(after, "2026-10-08"), false);
  assert.equal(M.isAvailable(after, "2026-10-09"), true);
});

test("repeat missed for weeks: still one task, done once moves it past today", () => {
  const t = { ...M.createTask({ title: "Lesson prep", repeat: { every: 7, anchor: "2026-09-07" }, due: "2026-09-07" }, opts) };
  assert.equal(M.isAvailable(t, TODAY), true); // overdue, single doc
  const p = M.completeTask(t, { now: NOW, today: "2026-10-10" }); // Saturday
  assert.equal(p.due, "2026-10-12"); // next anchor-aligned Monday, not 09-14
  assert.equal(p.availableFrom, "2026-10-11"); // not right back the same day
});

test("repeat done on its day: next cycle starts tomorrow", () => {
  const t = M.createTask({ title: "Daily stretch", repeat: { every: 1 } }, opts);
  const p = M.completeTask(t, opts);
  assert.equal(p.due, "2026-10-06");
  assert.equal(p.availableFrom, "2026-10-06");
});

test("edit: only changed fields, user values stop being guesses", () => {
  const t = { id: "a", ...M.createTask({ title: "thing" }, opts) };
  assert.deepEqual(M.editTask(t, { title: "thing" }, opts), {});
  const p = M.editTask(t, { size: 90 }, { ...opts, now: NOW + 1 });
  assert.equal(p.size, 90);
  assert.equal(p.energy, "high"); // still a guess, re-guessed from new size
  assert.equal(p.canSplit, true); // still a default, follows size
  assert.deepEqual(p.guessed, ["canSplit", "energy"]);
  assert.equal(p.touchedAt, NOW + 1);
});

test("edit: retitle re-guesses guessed fields only", () => {
  const t = { id: "a", ...M.createTask({ title: "thing", energy: "low" }, opts) };
  const p = M.editTask(t, { title: "Call Uri" }, opts);
  assert.equal(p.size, 15);
  assert.equal(p.energy, undefined); // user's own, untouched
});

test("edit: clearing size hands it back to the guess", () => {
  const t = { id: "a", ...M.createTask({ title: "Call Uri", size: 60 }, opts) };
  const p = M.editTask(t, { size: "" }, opts);
  assert.equal(p.size, 15);
  assert.ok(p.guessed.includes("size"));
});

test("edit: status and waiting on", () => {
  const t = { id: "a", ...M.createTask({ title: "cue" }, opts) };
  const w = M.editTask(t, { waitingOn: "Yuval" }, opts);
  assert.equal(w.status, "waiting");
  const r = M.editTask({ ...t, ...w }, { status: "ready" }, opts);
  assert.equal(r.waitingOn, null);
});

test("edit: clearing due clears hard due and time", () => {
  const t = { id: "a", ...M.createTask({ title: "x", due: "2026-10-06", dueTime: "10:00", hardDue: true }, opts) };
  const p = M.editTask(t, { due: null }, opts);
  assert.equal(p.due, null);
  assert.equal(p.dueTime, null);
  assert.equal(p.hardDue, false);
});

test("edit: adding a repeat sets a due", () => {
  const t = { id: "a", ...M.createTask({ title: "x" }, opts) };
  const p = M.editTask(t, { repeat: { weekdays: [3] } }, opts);
  assert.deepEqual(p.repeat, { weekdays: [3] });
  assert.equal(p.due, "2026-10-07");
});
