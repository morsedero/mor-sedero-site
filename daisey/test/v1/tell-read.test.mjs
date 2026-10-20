// Tell Daisey's request: the Now card and the last tasks go with the message,
// so "done" and "no, make it 30" have a task to point at (phrase bank
// 2026-10-19). Run: node --test "daisey/test/v1/*.test.mjs"
process.env.TZ = "Asia/Jerusalem";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { requestBody } from "../../app/js/tell-read.js";
const { tidy } = createRequire(import.meta.url)("../../functions/daisey-now-chat.js");

const tasks = [
  { id: "a", title: "Old", status: "ready", createdAt: 1 },
  { id: "b", title: "Edited", status: "ready", createdAt: 2, editedAt: 50 },
  { id: "c", title: "New", status: "ready", createdAt: 40 },
  { id: "d", title: "Finished", status: "done", createdAt: 99 },
  { id: "e", title: "No stamp", status: "ready" },
];

test("recent: open tasks, newest add or edit first, at most 3", () => {
  assert.deepEqual(requestBody("x", tasks).recent, ["b", "c", "a"]);
});

test("now: only an open task on the card is sent", () => {
  assert.equal(requestBody("x", tasks, { now: "c" }).now, "c");
  assert.equal(requestBody("x", tasks, { now: "d" }).now, undefined);
  assert.equal(requestBody("x", tasks).now, undefined);
});

test("waiting keeps a check-in day, drops one that isn't a date", () => {
  const ids = new Set(["a"]);
  assert.equal(tidy({ actions: [{ kind: "waiting", taskId: "a", waitingFor: "Dana", checkOn: "2026-10-22" }] }, ids).actions[0].checkOn, "2026-10-22");
  assert.equal(tidy({ actions: [{ kind: "waiting", taskId: "a", waitingFor: "Dana", checkOn: "Thursday" }] }, ids).actions[0].checkOn, undefined);
});

// readAnswer: days from the user's words, a night fork as a question, no Done on "didn't".
import { readAnswer } from "../../app/js/tell-read.js";
const RealDate = Date;
const at = (ms, fn) => { globalThis.Date = class extends RealDate { constructor(...a){ if (a.length) super(...a); else super(ms); } static now(){ return ms; } }; try { return fn(); } finally { globalThis.Date = RealDate; } };
const MON = new Date(2026, 9, 19, 10).getTime();

test("the words set the day, over the helper's own sum", () => {
  const r = at(new Date(2026, 9, 26, 10).getTime(), () => readAnswer({ actions: [{ kind: "update", taskId: "a", when: "on the 25th", due: "2026-10-25" }] }, "on the 25th"));
  assert.equal(r.actions[0].due, "2026-11-25");
  assert.equal(r.actions[0].when, undefined);
  const s = at(MON, () => readAnswer({ actions: [{ kind: "update", taskId: "a", when: "in 3 days" }] }, "in 3 days"));
  assert.equal(s.actions[0].due, "2026-10-22", "no date from the helper: due");
});

test("tomorrow at 8, said at 03:44: a question, then the chip's answer settles it", () => {
  const night = new Date(2026, 9, 20, 3, 44).getTime();
  const ev = { kind: "event", title: "Call Dana", date: "2026-10-20", time: "08:00", minutes: 60, when: "tomorrow" };
  const q = at(night, () => readAnswer({ reply: "Add?", actions: [ev] }, "call Dana tomorrow at 8"));
  assert.equal(q.actions.length, 0);
  assert.equal(q.choices.length, 2);
  const a = at(night, () => readAnswer({ actions: [ev] }, `call Dana tomorrow at 8\n(${q.question} → ${q.choices[1]})`));
  assert.equal(a.actions[0].date, "2026-10-21");
  assert.equal(a.question, undefined);
});

test("\"I didn't do it\" is never a Done", () => {
  assert.equal(at(MON, () => readAnswer({ actions: [{ kind: "done", taskId: "a" }] }, "I didn't do it")).actions.length, 0);
  assert.equal(at(MON, () => readAnswer({ actions: [{ kind: "done", taskId: "a" }] }, "לא סיימתי")).actions.length, 0);
  assert.equal(at(MON, () => readAnswer({ actions: [{ kind: "done", taskId: "a" }] }, "finished it")).actions.length, 1);
});

// Exits from words: switch, later, hold, resume, undo (the card's own buttons, now.js).
test("tidy keeps the exit kinds; hold and resume need a real task, later may lean on the Now card", () => {
  const ids = new Set(["a"]);
  const kinds = (actions) => tidy({ actions }, ids).actions.map((x) => x.kind);
  assert.deepEqual(kinds([{ kind: "switch" }, { kind: "undo" }, { kind: "later" }]), ["switch", "undo", "later"]);
  assert.deepEqual(kinds([{ kind: "hold" }, { kind: "resume", taskId: "zz" }, { kind: "hold", taskId: "a" }, { kind: "resume", taskId: "a" }]), ["hold", "resume"]);
  const [l] = tidy({ actions: [{ kind: "later", taskId: "a", until: "tomorrow" }] }, ids).actions;
  assert.deepEqual(l, { kind: "later", taskId: "a", until: "tomorrow" });
  assert.equal(tidy({ actions: [{ kind: "later", until: "someday" }] }, ids).actions[0].until, undefined, "only today, tomorrow, week");
  assert.equal(tidy({ actions: [{ kind: "later", dateWords: "tomorrow" }] }, ids).actions[0].when, undefined, "no date field on a later");
});

test("later with no task named is the Now card's", () => {
  const r = at(MON, () => readAnswer({ actions: [{ kind: "later", until: "today" }] }, "later today", {}, { now: "a" }));
  assert.deepEqual(r.actions[0], { kind: "later", until: "today", taskId: "a" });
  assert.equal(at(MON, () => readAnswer({ actions: [{ kind: "later" }] }, "later", {})).actions[0].taskId, undefined, "no card: stays open");
});
