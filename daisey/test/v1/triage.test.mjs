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
  // A passed deadline done "today" becomes a target (2026-10-06); a move is a push.
  assert.deepEqual(T.answer("today", t, { now: NOW }), { due: "2026-10-07", touchedAt: NOW, dateKind: "target" });
  assert.deepEqual(T.answer("today", tg("2026-10-01"), { now: NOW }), { due: "2026-10-07", touchedAt: NOW });
  assert.deepEqual(T.answer("week", t, { now: NOW, week: "2026-10-09" }), { due: "2026-10-09", touchedAt: NOW, pushes: 1 });
  assert.equal(T.answer("someday", t, { now: NOW }).status, "someday");
  const dropped = { ...t, ...T.answer("drop", t, { now: NOW }) };
  assert.equal(dropped.status, "dropped");
  assert.deepEqual({ ...dropped, ...T.answerSnapshot(t) }, { ...t, droppedAt: null, pushes: 0 });
});

test("engine: someday and dropped never reach the card; a passed target isn't overdue", () => {
  const r = E.rank([task({ status: "someday" }), task({ status: "dropped" })], { now: NOW });
  assert.equal(r.pick, null);
  const late = E.rank([tg("2026-10-01")], { now: NOW }).pick;
  assert.equal(late.parts.deadline, 0);
  assert.equal(late.details.target.days, 0);
  assert.equal(E.rank([dl("2026-10-01")], { now: NOW }).pick.details.deadline.passed, true);
});

test("pickWeekDay: the user's day hours and Israeli holidays (2026-10-06)", () => {
  // 2027-04-22 is Pesach (Nisan 15, a Thursday): an office call that week skips it.
  const call = task({ openHours: "office" });
  const days = new Set();
  const mon = new Date(2027, 3, 18, 10).getTime(); // Sunday 18 Apr 2027
  for (let i = 0; i < 3; i++) days.add(T.pickWeekDay(call, { now: mon, events: [], tasks: [] }));
  assert.ok(![...days].includes("2027-04-22"));
  // Day hours: a busy 10–18 on the earliest day leaves no room in a 10–18 day.
  const ev = { start: new Date(2026, 9, 8, 10).toISOString(), end: new Date(2026, 9, 8, 18).toISOString() };
  assert.equal(T.roomOn(new Date(2026, 9, 8), { events: [ev], hours: { start: 600, end: 1080 } }), 0);
});

// ---- user test 2026-10-11, part B ----
test("13: an old date tied to an event today, or overdue with money at stake, is suggested for today", async () => {
  const prep = tg("2026-10-05", { title: "Prep questions for interview" });
  const interview = { title: "Interview at Acme", start: iso(7, 11), end: iso(7, 12), busy: true };
  const a = T.sweepAdvice(prep, { events: [interview], tasks: [prep], now: at(7, 9) });
  assert.equal(a.kind, "today");
  assert.equal(a.why, "event");
  assert.equal(a.event.title, "Interview at Acme");
  // Once the interview is over, it's an ordinary old date again.
  assert.equal(T.sweepAdvice(prep, { events: [interview], tasks: [prep], now: at(7, 13) }).kind, "week");
  // An unrelated event doesn't count.
  assert.equal(T.sweepAdvice(prep, { events: [{ ...interview, title: "Dentist" }], tasks: [prep], now: at(7, 9) }).kind, "week");
  const invoice = dl("2026-10-05", { title: "Pay arnona", stakes: "money" });
  assert.deepEqual(T.sweepAdvice(invoice, { tasks: [invoice], now: NOW }), { kind: "today", why: "stakes" });
  const plain = dl("2026-10-05", { title: "Tidy drive" });
  assert.equal(T.sweepAdvice(plain, { tasks: [plain], now: NOW }).kind, "week");
  // In today's plan: kept today.
  assert.equal(T.sweepAdvice(plain, { tasks: [plain], now: NOW, planned: new Set([plain.id]) }).why, "plan");
  assert.equal(T.daysLate(invoice, NOW), 2);
});

test("14: back after 2+ days away, every old date is asked, first", async () => {
  const { collectNeeds, awayDays } = await import("../../app/js/needs-list.js");
  const old = tg("2026-10-05", { touchedAt: at(4) }), late = dl("2026-10-05", { touchedAt: at(4) });
  const stale = task({ skipsSinceStart: 9, touchedAt: at(4) });
  assert.equal(awayDays([old, late, stale], NOW), 3);
  const list = collectNeeds({ tasks: [old, late, stale], now: NOW });
  assert.deepEqual(list.slice(0, 2).map((x) => x.id), [late.id, old.id]); // a passed target too, while away
  assert.equal(list[2].kind, "stale");
  // Here yesterday: a lone passed target sits quietly, the sweep comes last.
  const here = [tg("2026-10-05", { touchedAt: at(6) }), dl("2026-10-05", { touchedAt: at(6) }), task({ skipsSinceStart: 9, touchedAt: at(6) })];
  const l2 = collectNeeds({ tasks: here, now: NOW });
  assert.equal(awayDays(here, NOW), 1);
  assert.deepEqual(l2.map((x) => x.kind), ["stale", "sweep"]);
});
