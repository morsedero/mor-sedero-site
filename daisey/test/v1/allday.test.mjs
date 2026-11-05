// An all-day event today: Daisey asks if you're free (allday.js, 2026-11-05).
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const { allDayAsks, withAllDay } = await import("../../app/js/allday.js");
const { collectNeeds } = await import("../../app/js/needs-list.js");
const { freeWindow } = await import("../../app/js/engine.js");

const NOW = Date.UTC(2026, 10, 5, 7, 0); // Thu 5 Nov, 09:00 Jerusalem
const week = { id: "w", title: "ILLUSTRATION WEEK", allDay: true, busy: false, editable: true, start: "2026-11-02", end: "2026-11-07" };
const today = "2026-11-05";

test("an all-day event standing today is asked, once", () => {
  const [a] = allDayAsks([week], {}, NOW);
  assert.equal(a.id, "w");
  assert.equal(collectNeeds({ events: [week], calOk: true, now: NOW }).filter((n) => n.kind === "allday").length, 1);
  assert.equal(allDayAsks([week], { allDayToday: { date: today, w: "free" } }, NOW).length, 0);
});

test("not asked: other days, read-only calendars, done-marked", () => {
  assert.equal(allDayAsks([{ ...week, end: "2026-11-05" }], {}, NOW).length, 0); // ended yesterday
  assert.equal(allDayAsks([{ ...week, start: "2026-11-06" }], {}, NOW).length, 0);
  assert.equal(allDayAsks([{ ...week, editable: false }], {}, NOW).length, 0);
  assert.equal(allDayAsks([{ ...week, title: "✓ Week" }], {}, NOW).length, 0);
  assert.equal(allDayAsks([week], { allDayToday: { date: "2026-11-04", w: "busy" } }, NOW).length, 1); // yesterday's answer
});

test("free changes nothing; busy fills the day's hours", () => {
  const free = { allDayToday: { date: today, w: "free" } };
  assert.deepEqual(withAllDay([week], free, NOW), [week]);
  const out = withAllDay([week], { allDayToday: { date: today, w: "busy" } }, NOW);
  assert.equal(out.length, 2);
  const b = out[1];
  assert.equal(b.allDay, false);
  assert.equal(b.busy, true);
  assert.ok(Date.parse(b.start) <= NOW && Date.parse(b.end) > NOW);
  assert.equal(freeWindow(out.filter((e) => !e.allDay && e.busy !== false), NOW).current.id, "w:day"); // you are inside a busy block
});
