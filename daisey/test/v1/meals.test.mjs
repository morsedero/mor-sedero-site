// A meal the calendar leaves no room for (meals.js, 2026-10-09).
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const { mealAsks } = await import("../../app/js/meals.js");
const { mealsToday, dayHours } = await import("../../app/js/day.js");
const { collectNeeds } = await import("../../app/js/needs-list.js");

const at = (h, m = 0) => Date.UTC(2026, 9, 9, h - 3, m);
const il = (h, m = 0) => new Date(at(h, m)).toISOString();
const job = { id: "j", title: "Job", start: il(9), end: il(13), busy: true };
const drive = { id: "d", title: "Drive back", start: il(13), end: il(14, 20), busy: true };
const NOW = at(8);

test("job until 13:00, driving until 14:20, lunch at 13:00: ask, with 14:20 ready", () => {
  const [a] = mealAsks([job, drive], {}, NOW);
  assert.equal(a.name, "Lunch");
  assert.deepEqual(a.by.map((e) => e.id), ["j", "d"]);
  assert.equal(a.move, 14 * 60 + 20);
  assert.equal(collectNeeds({ events: [job, drive], calOk: true, now: NOW }).filter((n) => n.kind === "meal").length, 1);
});

test("no question when there's room in the window, it's answered today, or its time is over", () => {
  assert.equal(mealAsks([job, { ...drive, end: il(13, 10) }], {}, NOW).length, 0); // 13:10–14:00 holds 45 min
  assert.equal(mealAsks([job, drive], { mealToday: { date: "2026-10-09", Lunch: "there" } }, NOW).length, 0);
  assert.equal(mealAsks([job, drive], { mealToday: { date: "2026-10-08", Lunch: "there" } }, NOW).length, 1); // yesterday's answer is gone
  assert.equal(mealAsks([job, drive], {}, at(15)).length, 0);
  assert.equal(mealAsks([job, { ...drive, busy: false }], {}, NOW).length, 0); // free event
});

test("no free time near it: still asked, no move offered", () => {
  const [a] = mealAsks([{ ...job, end: il(18) }], {}, NOW);
  assert.equal(a.move, null);
});

test("the answer is today's only: moved → the plan's window moves; there → no meal today", () => {
  const moved = { mealToday: { date: "2026-10-09", Lunch: "14:20" } };
  assert.deepEqual(mealsToday(moved, NOW), [{ name: "Lunch", from: 860, to: 920, minutes: 45 }]);
  assert.deepEqual(mealsToday({ mealToday: { date: "2026-10-09", Lunch: "there" } }, NOW), []);
  assert.deepEqual(mealsToday({ mealToday: { date: "2026-10-08", Lunch: "14:20" } }, NOW), [{ name: "Lunch", from: 780, to: 840, minutes: 45 }]);
  assert.ok(Array.isArray(dayHours(moved).meals));
});

test("the answer rearranges a plan that already has its breaks: lunch moves to 14:20, or goes", async () => {
  const { timeline, relayMeals } = await import("../../app/js/proposal.js");
  const tasks = ["a", "b", "c"].map((id) => ({ id, title: id, status: "ready", size: 60 }));
  const now = at(7), events = [job, drive];
  // Laid before the answer: no room for lunch, so the plan has none, only a long break after the drive.
  const items = [{ taskId: "a", minutes: 30 }, { brk: "long", minutes: 30 }, { taskId: "b", minutes: 60 }, { brk: "short", minutes: 10 }, { taskId: "c", minutes: 60 }];
  const settings = { mealToday: { date: "2026-10-09", Lunch: "14:20" } };
  const ctx = { tasks, events, now, settings, hours: dayHours(settings) };
  const re = relayMeals(items, ctx);
  assert.deepEqual(re.items.map((it) => it.taskId || it.brk), ["a", "meal", "b", "short", "c"]); // the meal takes the long break's place
  const brk = timeline(re.items, ctx).breaks.find((b) => b.type === "meal");
  assert.equal(brk.start, at(14, 20));
  assert.deepEqual(re.laid, { Lunch: "14:20" });
  assert.equal(relayMeals(re.items, ctx, re.laid).items, re.items); // once per answer: a later drag stays
  const gone = { mealToday: { date: "2026-10-09", Lunch: "there" } };
  assert.ok(!relayMeals(re.items, { ...ctx, settings: gone, hours: dayHours(gone) }).items.some((it) => it.brk === "meal"));
});

test("a meal the plan carried past its time isn't laid there: lateMeals asks; 'Lunch next' lays it after the task", async () => {
  const { timeline, relayMeals } = await import("../../app/js/proposal.js");
  const tasks = ["a", "b"].map((id) => ({ id, title: id, status: "ready", size: 60 }));
  const items = [{ taskId: "a", minutes: 60 }, { brk: "meal", name: "Lunch", minutes: 45 }, { taskId: "b", minutes: 60 }];
  const hours = { start: 480, end: 1380, meals: mealsToday({}, at(19, 40)) };
  const tl = timeline(items, { tasks, events: [], now: at(19, 40), hours });
  assert.deepEqual(tl.lateMeals, ["Lunch"]);
  assert.ok(!tl.breaks.some((b) => b.type === "meal"));
  // Still in its hour after the window (breakDue's late lunch): laid, not asked.
  const ok = timeline(items, { tasks, events: [], now: at(13, 30), hours: { ...hours, meals: mealsToday({}, at(13, 30)) } });
  assert.deepEqual(ok.lateMeals, []);
  assert.equal(ok.breaks.find((b) => b.type === "meal").start, at(14, 30));
  // Not yet → today's answer is a time right after the task on the card.
  const settings = { dayStart: "08:00", dayEnd: "23:30", mealToday: { date: "2026-10-09", Lunch: "20:40" } };
  const ctx = { tasks, events: [], now: at(19, 40), settings, hours: dayHours(settings, at(19, 40)) };
  const re = relayMeals(items, ctx);
  const brk = timeline(re.items, ctx).breaks.find((b) => b.type === "meal");
  assert.equal(brk.start, at(20, 40));
});
