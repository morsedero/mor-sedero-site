// Days off (day.js daysOff, Mor 2026-11-21): weekdays with no day at all.
// Saturday by default; Settings picks any set. Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../../app/js/day.js";
import { pickWeekDay } from "../../app/js/triage.js";

const at = (d, h = 10, m = 0) => new Date(2026, 10, d, h, m).getTime(); // Nov 2026; the 21st is a Saturday

test("days off: Saturday by default, any set from settings, nonsense dropped, all seven means none", () => {
  assert.deepEqual(D.daysOff({}), [6]);
  assert.deepEqual(D.daysOff({ daysOff: [] }), []);
  assert.deepEqual(D.daysOff({ daysOff: [5, 6, 6, 9, "x", -1] }), [5, 6]);
  assert.deepEqual(D.daysOff({ daysOff: [0, 1, 2, 3, 4, 5, 6] }), []);
  assert.equal(D.isDayOff({}, at(21)), true);
  assert.equal(D.isDayOff({}, "2026-11-22"), false);
  assert.equal(D.isDayOff({ daysOff: [0] }, "2026-11-22"), true);
});

test("a day off is blocked whole: no hours, night all day, no free time", () => {
  const h = D.dayHours({}, at(21, 12));
  assert.equal(h.off, true);
  assert.equal(h.start, h.end);
  assert.equal(D.isNight(at(21, 12), h), true);
  assert.equal(D.minutesLeft(at(21, 12), h), 0);
  assert.deepEqual(D.gapsToday([], at(21, 12), h), []);
  assert.deepEqual(h.meals, []);
  // An ordinary day is untouched, and the usual day ignores today's off.
  const fri = D.dayHours({}, at(20, 12));
  assert.deepEqual([fri.start, fri.end, !!fri.off], [480, 1320, false]);
  const u = D.dayHours({}, at(21, 12), { ignoreOff: true });
  assert.deepEqual([u.start, u.end, !!u.off], [480, 1320, false]);
  // Turned off in settings: Saturday is a day like any other.
  assert.equal(!!D.dayHours({ daysOff: [] }, at(21, 12)).off, false);
});

test("the night before a day off still runs to its own late end", () => {
  const s = { dayStart: "10:00", dayEnd: "02:00" };
  const h = D.dayHours(s, at(21, 1)); // Friday's day, 01:00 Saturday
  assert.equal(h.late, true);
  assert.equal(D.isNight(at(21, 1), h), false);
});

test("the next morning steps over days off", () => {
  const fri = D.dayHours({ daysOff: [6, 0] }, at(20, 23));
  assert.equal(D.nextMorning(at(20, 23), fri), at(23, 8)); // Friday night → Monday
  const sat = { ...D.dayHours({}, at(21, 12), { ignoreOff: true }), off: true };
  assert.equal(D.nextMorning(at(21, 6), sat), at(22, 8)); // before 08:00 on the day off: not today
});

test("'this week' never lands on a day off", () => {
  const task = { id: "t", size: 30, openHours: "anytime", status: "ready" };
  const hours = { start: 480, end: 1320, daysOff: [0, 1, 2, 3, 4, 5] };
  const day = pickWeekDay(task, { now: at(16), hours }); // Monday; only Saturday left on
  assert.equal(new Date(`${day}T12:00`).getDay(), 6);
  const off = pickWeekDay(task, { now: at(16), hours: { start: 480, end: 1320, daysOff: [6] } });
  assert.notEqual(new Date(`${off}T12:00`).getDay(), 6);
});
