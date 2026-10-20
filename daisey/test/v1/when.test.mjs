// Date words → days, in code (when.js), counted from the 04:00 day key.
// Run: node --test "daisey/test/v1/*.test.mjs"
process.env.TZ = "Asia/Jerusalem";
import test from "node:test";
import assert from "node:assert/strict";
import { dateFrom } from "../../app/js/when.js";

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime(); // October 2026; the 19th is a Monday
const day = (w, now, o) => dateFrom(w, now, o)?.date;
const MON = at(19, 10);

test("day words count from the day key", () => {
  assert.equal(day("tomorrow", MON), "2026-10-20");
  assert.equal(day("מחר", MON), "2026-10-20");
  assert.equal(day("מחרתיים", MON), "2026-10-21");
  assert.equal(day("day after tomorrow", MON), "2026-10-21");
  assert.equal(day("today", MON), "2026-10-19");
  assert.equal(day("tomorrow", at(20, 1, 30)), "2026-10-20", "01:30 Tue: still Monday, tomorrow is Tuesday");
  assert.equal(day("yesterday", at(24, 1, 51)), "2026-10-22", "01:51 Sat: today is Friday");
  assert.equal(day("tonight", at(19, 20)), "2026-10-19");
});

test("tomorrow with a time, after midnight: asks which morning", () => {
  assert.deepEqual(dateFrom("tomorrow", at(20, 3, 44), { timed: true }), { ask: ["2026-10-20", "2026-10-21"] });
  assert.equal(day("tomorrow", at(20, 3, 44)), "2026-10-20", "no time: the day key's next day");
  assert.equal(day("tomorrow", at(19, 15), { timed: true }), "2026-10-20", "in the day: no question");
});

test("in N days / weeks", () => {
  assert.equal(day("in 3 days", MON), "2026-10-22");
  assert.equal(day("in four days", MON), "2026-10-23");
  assert.equal(day("in two weeks", MON), "2026-11-02");
  assert.equal(day("a week from today", MON), "2026-10-26");
  assert.equal(day("בעוד 3 ימים", MON), "2026-10-22");
  assert.equal(day("בעוד שבועיים", MON), "2026-11-02");
});

test("weekdays: the coming one; next asks unless it's today's", () => {
  assert.equal(day("Thursday", MON), "2026-10-22");
  assert.equal(day("by Friday 5pm", MON), "2026-10-23");
  assert.equal(day("ביום חמישי", MON), "2026-10-22");
  assert.equal(day("next Sunday", at(18, 10)), "2026-10-25");
  assert.deepEqual(dateFrom("next Friday", MON), { ask: ["2026-10-23", "2026-10-30"] });
  assert.deepEqual(dateFrom("ביום חמישי הבא", MON), { ask: ["2026-10-22", "2026-10-29"] });
});

test("ends and next week", () => {
  assert.equal(day("end of the week", MON), "2026-10-24", "the week ends Saturday");
  assert.equal(day("סוף השבוע", MON), "2026-10-24");
  assert.equal(day("בסוף היום", MON), "2026-10-19");
  assert.equal(day("end of the month", MON), "2026-10-31");
  assert.equal(day("next week", MON), "2026-10-25");
});

test("days of the month: gone this month means next month", () => {
  assert.equal(day("on the 25th", at(26, 10)), "2026-11-25");
  assert.equal(day("on the 3rd", MON), "2026-11-03");
  assert.equal(day("the 25th", MON), "2026-10-25");
  assert.equal(day("Oct 25", at(26, 10)), "2027-10-25");
  assert.equal(day("25/12", MON), "2026-12-25");
});

test("counted: only the counted kinds, never a weekday or tomorrow", () => {
  const c = (w, now = MON) => dateFrom(w, now, { counted: true })?.date ?? null;
  assert.equal(c("in three days"), "2026-10-22");
  assert.equal(c("end of the month"), "2026-10-31");
  assert.equal(c("on the 25th", at(26, 10)), "2026-11-25");
  assert.equal(c("tomorrow"), null);
  assert.equal(c("by Friday"), null);
  assert.equal(c("end of the day"), null);
  assert.equal(c("on the 25th of October"), null);
  assert.equal(c("25 December"), null);
});

test("not a day: null", () => {
  for (const w of ["", "soon", "at 7", "later", "אחרי חצות"]) assert.equal(dateFrom(w, MON), null, w);
});
