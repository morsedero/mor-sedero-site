// Day hours, booked tasks, calendar events that are tasks, and the why-line
// fixes. Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../../app/js/day.js";
import * as C from "../../app/js/caltask.js";
import { rank, freeWindow } from "../../app/js/engine.js";
import { workBase } from "../../app/js/context.js";
import { migrateTask, TASK_VERSION } from "../../app/js/model.js";

const at = (d, h = 10, m = 0) => new Date(2026, 9, d, h, m).getTime(); // Oct 2026; the 5th is a Monday
const NOW = at(5, 10);
const iso = (ms) => new Date(ms).toISOString();
const ev = (title, s, e, o = {}) => ({ title, start: iso(s), end: iso(e), ...o });
let seq = 0;
const task = (o = {}) => ({ id: `t${++seq}`, project: "P", title: "Task", size: 30, area: "work", type: "deep", where: "computer",
  openHours: "anytime", stakes: "low", status: "ready", canSplit: false, createdAt: 1, touchedAt: NOW, ...o });

test("day hours: default 08–22, settings override, nonsense falls back", () => {
  { const { start, end } = D.dayHours({}); assert.deepEqual({ start, end }, { start: 480, end: 1320 }); }
  { const { start, end } = D.dayHours({ dayStart: "07:30", dayEnd: "23:00" }); assert.deepEqual({ start, end }, { start: 450, end: 1380 }); }
  { const { start, end } = D.dayHours({ dayStart: "23:00", dayEnd: "07:00" }); assert.deepEqual({ start, end }, { start: 480, end: 1320 }); }
  assert.equal(D.isNight(at(5, 1, 19)), true);
  assert.equal(D.isNight(at(5, 8)), false);
  assert.equal(D.isNight(at(5, 22)), true);
  assert.equal(D.nextMorning(at(5, 1, 19)), at(5, 8));
  assert.equal(D.nextMorning(at(5, 23)), at(6, 8));
});

test("free today at 01:19 counts from 08:00 to 22:00, not from now", () => {
  const g = D.gapsToday([], at(5, 1, 19));
  assert.equal(g.reduce((s, x) => s + x.minutes, 0), 14 * 60);
  assert.equal(D.capacity([], [], at(5, 1, 19)).free, 14 * 60);
  assert.equal(D.capacity([], [], at(5, 23)).free, 0);
  const busy = [ev("Teaching", at(5, 11), at(5, 13)), ev("Late gig", at(5, 21), at(5, 23, 30))];
  assert.equal(D.capacity([], busy, NOW).free, 60 + 8 * 60); // 10–11, 13–21
});

test("capacity: open dated tasks, how many fit, and the rest", () => {
  const events = [ev("Busy", at(5, 10), at(5, 20))]; // 2 h free: 20–22
  const ts = [
    task({ due: "2026-10-05", dateKind: "deadline", size: 60 }),
    task({ due: "2026-10-01", dateKind: "target", size: 45 }),
    task({ due: "2026-10-05", size: 90 }),
    task({ due: "2026-10-09", size: 5 }),
    task({ size: 5 }),
  ];
  const c = D.capacity(ts, events, NOW);
  assert.deepEqual([c.free, c.open, c.realistic, c.rest.length], [120, 3, 2, 1]);
});

test("free window stops at the end of the day", () => {
  assert.equal(freeWindow([], at(5, 21), at(5, 22)).window, 60);
  assert.equal(freeWindow([], NOW, at(5, 22)).window, 180);
});

test("booked: linked by taskId or exact title; off the card until the slot, then not", () => {
  const a = task({ title: "Mix the trailer", stakes: "money" }), b = task({ title: "Other" });
  const events = [ev("mix the  trailer", at(5, 19), at(5, 20)), ev("Planned", at(5, 15), at(5, 16), { taskId: b.id })];
  const bk = D.bookings([a, b], events, NOW);
  assert.equal(bk.get(a.id).start, at(5, 19));
  assert.equal(bk.get(b.id).start, at(5, 15));
  const booked = Object.fromEntries([...bk].map(([id, s]) => [id, s.start]));
  const r = rank([a, b], { now: NOW, window: 120, booked });
  assert.equal(r.pick, null);
  assert.deepEqual(r.out.map((o) => o.reason), ["booked", "booked"]);
  assert.equal(rank([a], { now: at(5, 19, 5), window: 55, booked }).pick.task.id, a.id); // slot started
  assert.equal(D.bookings([a], events, at(5, 21)).size, 0); // slot over
});

test("calendar task: the LinkedIn example", () => {
  const t = "לבטל עד ה20 בחודש את הלינקדאין פרמיום";
  assert.equal(C.looksLikeTask(t), true);
  assert.equal(C.parseDeadline(t, NOW), "2026-10-20");
  assert.equal(C.taskTitle(t), "לבטל את הלינקדאין פרמיום");
  const d = C.draftFrom({ title: t, start: iso(NOW) });
  assert.deepEqual(d.input, { title: "לבטל את הלינקדאין פרמיום", project: "Inbox", due: "2026-10-20", dateKind: "deadline" });
  assert.deepEqual([d.guess.type, d.guess.size, d.guess.stakes], ["admin", 15, "money"]);
});

test("calendar task: what reads like a task, and the deadline forms", () => {
  for (const s of ["Call mom", "להתקשר לבנק", "Pay rent by the 3rd", "לשלם ארנונה"]) assert.equal(C.looksLikeTask(s), true, s);
  for (const s of ["Team call", "Call with Dana", "שיעור גיטרה", "Rehearsal", "Studio session"]) assert.equal(C.looksLikeTask(s), false, s);
  assert.equal(C.parseDeadline("pay by the 3rd", NOW), "2026-11-03"); // already past this month
  assert.equal(C.parseDeadline("עד 31/11", NOW), null);
  assert.equal(C.parseDeadline("להגיש עד 1/2", NOW), "2027-02-01");
  assert.equal(C.parseDeadline("no date here", NOW), null);
});

test("calendar task: offered once, never for Daisey's own events or existing tasks", () => {
  const e1 = { id: "e1", title: "לבטל עד ה20 בחודש את הלינקדאין פרמיום", start: iso(NOW) };
  const e2 = { id: "e2", title: "Call mom", start: iso(NOW), taskId: "x" };
  const e3 = { id: "e3", title: "Pay rent", start: iso(NOW) };
  assert.equal(C.nextOffer([e1, e2, e3], [], []).id, "e1");
  assert.equal(C.nextOffer([e1, e2, e3], [], ["e1"]).id, "e3");
  assert.equal(C.nextOffer([e1, e3], [task({ title: "לבטל את הלינקדאין פרמיום" }), task({ title: "pay rent" })], []), null);
});

test("quick win only up to 15 min", () => {
  const small = task({ size: 15, title: "Small" }), mid = task({ size: 30, title: "Mid" });
  assert.match(rank([small], { now: NOW, window: 180 }).pick.why, /quick win/);
  assert.doesNotMatch(rank([mid], { now: NOW, window: 180 }).pick.why || "", /quick win/);
});

test("momentum: real work today or in 2 days, not a skip or an edit", () => {
  const skipped = task({ project: "A", starts: 1, touchedAt: NOW, workedAt: NOW - 9 * 864e5 });
  const worked = task({ project: "B", starts: 1, touchedAt: NOW - 864e5, workedAt: NOW - 3600e3 });
  const recent = task({ project: "C", starts: 1, workedAt: NOW - 1.5 * 864e5 });
  const b = workBase([skipped, worked, recent], NOW);
  assert.equal(b.lastProject, "B");
  assert.deepEqual(b.recentProjects.sort(), ["B", "C"]);
});

test("migration v3: a flat-30 size is guessed again", () => {
  const p = migrateTask({ title: "Call the bank", project: "Admin", size: 30, type: "call", v: 2, guessed: [] });
  assert.equal(p.size, 15);
  assert.equal(p.v, TASK_VERSION);
  assert.equal(migrateTask({ title: "Write the essay", size: 60, v: 2, guessed: [] }).size, undefined);
});

test("dayEndToday stretches today's end only", async () => {
  const { dayHours } = await import("../../app/js/day.js");
  const { localDate } = await import("../../app/js/model.js");
  assert.equal(dayHours({ dayEndToday: { date: localDate(), end: "23:00" } }).end, 23 * 60);
  assert.equal(dayHours({ dayEndToday: { date: "2020-01-01", end: "23:00" } }).end, 22 * 60); // yesterday's is gone
  assert.equal(dayHours({ dayEndToday: { date: localDate(), end: "06:00" } }).end, 22 * 60); // before the start: ignored
});

test("dayEndToday past midnight: 'until 1am' runs on, then it's night (BEHAVIOR_REVIEW #4)", async () => {
  const { dayHours, isNight, dayEndAt, minText } = await import("../../app/js/day.js");
  const { logicalDate } = await import("../../app/js/model.js");
  const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
  const s = { dayEndToday: { date: "2026-10-10", end: "01:00" } };
  // 23:30 on the 10th: the day ends 01:00 on the 11th.
  const eve = dayHours(s, at(10, 23, 30));
  assert.equal(eve.end, 25 * 60); assert.equal(minText(eve.end), "01:00");
  assert.equal(isNight(at(10, 23, 30), eve), false);
  assert.equal(dayEndAt(at(10, 23, 30), eve), at(11, 1));
  // 00:30 on the 11th: still the 10th's day, until 01:00.
  assert.equal(logicalDate(at(11, 0, 30)), "2026-10-10");
  const late = dayHours(s, at(11, 0, 30));
  assert.equal(late.late, true); assert.equal(isNight(at(11, 0, 30), late), false);
  assert.equal(dayEndAt(at(11, 0, 30), late), at(11, 1));
  // 01:30: over, night. 09:00 on the 11th: the usual day, no stretch.
  assert.equal(isNight(at(11, 1, 30), dayHours(s, at(11, 1, 30))), true);
  const next = dayHours(s, at(11, 9));
  assert.equal(next.end, 22 * 60); assert.equal(next.late, undefined);
  // Said after midnight (date = the logical day): same.
  assert.equal(dayHours({ dayEndToday: { date: "2026-10-10", end: "02:00" } }, at(11, 1)).late, true);
});

test("meals: Breakfast, Lunch, Dinner; only Lunch on by default, 13-14; one time each, saved ones override", async () => {
  const { mealsOf, mealPrefs, dayHours } = await import("../../app/js/day.js");
  assert.deepEqual(mealPrefs({}).map((m) => [m.name, m.on]), [["Breakfast", false], ["Lunch", true], ["Dinner", false]]);
  assert.deepEqual(mealsOf({}), [{ name: "Lunch", from: 780, to: 840, minutes: 45 }]);
  const s = { meals: [{ name: "Lunch", on: false, at: "13:00", minutes: 45 }, { name: "Dinner", on: true, at: "19:30", minutes: 999 }, { name: "Breakfast", on: true, at: "nope", minutes: 20 }, { name: "Snack", on: true, at: "16:00", minutes: 10 }] };
  assert.deepEqual(mealsOf(s), [{ name: "Breakfast", from: 480, to: 540, minutes: 20 }, { name: "Dinner", from: 1170, to: 1230, minutes: 180 }]); // bad time → default; no other names
  assert.deepEqual(dayHours(s).meals, mealsOf(s));
});
