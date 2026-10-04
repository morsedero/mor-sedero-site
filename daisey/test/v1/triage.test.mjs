// Daisey v1 overdue triage. Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../../app/js/triage.js";
import * as E from "../../app/js/engine.js";

const at = (d, h = 10, m = 0) => new Date(2026, 9, d, h, m).getTime(); // Oct 2026; the 4th is a Sunday
const NOW = at(7); // Wednesday
let seq = 0;
const task = (o = {}) => ({ id: `t${++seq}`, project: "P", title: "Task", size: 30, status: "ready",
  due: null, dateKind: null, createdAt: 1, touchedAt: 1, ...o });
const dl = (due, o) => task({ due, dateKind: "deadline", ...o });
const tg = (due, o) => task({ due, dateKind: "target", ...o });
const iso = (d, h, m = 0) => new Date(at(d, h, m)).toISOString();

test("only a passed deadline is overdue; a passed target rolls to today", () => {
  assert.equal(T.isOverdue(dl("2026-10-06"), NOW), true);
  assert.equal(T.isOverdue(tg("2026-10-06"), NOW), false);
  assert.equal(T.isRolled(tg("2026-10-06"), NOW), true);
  assert.equal(T.effectiveDue(tg("2026-10-01"), NOW), "2026-10-07");
  assert.equal(T.effectiveDue(dl("2026-10-01"), NOW), "2026-10-01");
  assert.equal(T.isOverdue(dl("2026-10-07"), NOW), false); // today isn't passed
  assert.equal(T.isOverdue(dl("2026-10-01", { status: "done" }), NOW), false);
  assert.equal(T.isOverdue(dl("2026-10-01", { status: "someday" }), NOW), false);
});

test("sweep list: deadlines first, then targets, oldest first", () => {
  const a = tg("2026-10-02"), b = dl("2026-10-05"), c = dl("2026-10-01"), d = tg("2026-10-08");
  assert.deepEqual(T.sweepList([a, b, c, d], NOW).map((t) => t.id), [c.id, b.id, a.id]);
});

test("offer: more than 3 deadlines or more than 5 targets, once a day", () => {
  const four = [1, 2, 3, 4].map((i) => dl(`2026-10-0${i}`));
  const three = four.slice(0, 3);
  const six = [1, 2, 3, 4, 5, 6].map((i) => tg(`2026-10-0${i}`));
  assert.equal(T.shouldOffer(four, NOW), true);
  assert.equal(T.shouldOffer(three, NOW), false);
  assert.equal(T.shouldOffer(six, NOW), true);
  assert.equal(T.shouldOffer(six.slice(1), NOW), false);
  assert.equal(T.shouldOffer(four, NOW, { sweepAnswered: "2026-10-07" }), false);
  assert.equal(T.shouldOffer(four, NOW, { sweepAnswered: "2026-10-06" }), true);
});

test("this week: tomorrow to Saturday; from Friday on, next week", () => {
  const days = (now) => T.weekDays(now).map((d) => d.getDate());
  assert.deepEqual(days(NOW), [8, 9, 10]); // Wed → Thu, Fri, Sat
  assert.deepEqual(days(at(9)), [11, 12, 13, 14, 15, 16, 17]); // Friday → next Sun–Sat
  assert.deepEqual(days(at(10)), [11, 12, 13, 14, 15, 16, 17]); // Saturday → next Sun–Sat
});

test("this week: the roomiest day, counting events and tasks already dated", () => {
  const events = [{ start: iso(8, 9), end: iso(8, 21) }]; // Thursday is nearly full
  const t = task();
  assert.equal(T.pickWeekDay(t, { events, now: NOW }), "2026-10-09"); // Friday
  const busyFri = [tg("2026-10-09", { size: 600 })];
  assert.equal(T.pickWeekDay(t, { events, tasks: busyFri, now: NOW }), "2026-10-10");
  // An all-day or free event takes no room.
  assert.equal(T.pickWeekDay(t, { events: [{ start: iso(8, 0), end: iso(9, 0), allDay: true }], now: NOW }), "2026-10-08");
});

test("this week: a task needing office hours only lands Sun–Thu", () => {
  const call = task({ openHours: "office" });
  assert.equal(T.pickWeekDay(call, { now: NOW }), "2026-10-08"); // Thursday, not Fri/Sat
  assert.equal(T.pickWeekDay(call, { now: at(8) }), "2026-10-11"); // Thursday's week is Fri–Sat: next Sunday
});

test("answers: today, week, someday, drop — and undo puts it back", () => {
  const t = dl("2026-10-01", { touchedAt: 5 });
  assert.deepEqual(T.answer("today", t, { now: NOW }), { due: "2026-10-07", touchedAt: NOW });
  assert.deepEqual(T.answer("week", t, { now: NOW, week: "2026-10-09" }), { due: "2026-10-09", touchedAt: NOW });
  assert.equal(T.answer("someday", t, { now: NOW }).status, "someday");
  const dropped = { ...t, ...T.answer("drop", t, { now: NOW }) };
  assert.equal(dropped.status, "dropped");
  assert.deepEqual({ ...dropped, ...T.answerSnapshot(t) }, { ...t, droppedAt: null });
});

test("engine: someday and dropped never reach the card; a passed target isn't overdue", () => {
  const r = E.rank([task({ status: "someday" }), task({ status: "dropped" })], { now: NOW });
  assert.equal(r.pick, null);
  const late = E.rank([tg("2026-10-01")], { now: NOW }).pick;
  assert.equal(late.parts.deadline, 0);
  assert.equal(late.details.target.days, 0);
  assert.equal(E.rank([dl("2026-10-01")], { now: NOW }).pick.details.deadline.passed, true);
});
