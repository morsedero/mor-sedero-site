// Day boundary: a FIXED 04:00 (Mor, 2026-10-18), whatever "My day" says.
// Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { getDayKey, DAY_BOUNDARY, dateForWord, dayAfter, localDate } from "../../app/js/model.js";
import { dayHours, dayWord, doneDayLabel, headerDay, slotsWord } from "../../app/js/day.js";

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();

test("boundary is 04:00", () => assert.equal(DAY_BOUNDARY, 240));

test("03:59 / 04:00 / 04:01 with My day 04:00, 05:00, 09:00: every surface reads the same key", () => {
  for (const dayStart of ["04:00", "05:00", "09:00"]) {
    const s = { dayStart, dayEnd: "22:00" };
    for (const [h, m, key] of [[3, 59, "2026-10-17"], [4, 0, "2026-10-18"], [4, 1, "2026-10-18"]]) {
      const now = at(18, h, m);
      dayHours(s, now);
      const label = `${h}:${m} My day ${dayStart}`;
      assert.equal(getDayKey(now), key, label);
      assert.equal(localDate(headerDay(now).getTime()), key, `${label} header`);
      assert.equal(dayWord(key, now), "today", `${label} day word`);
      assert.equal(dayWord(dayAfter(1, now), now), "tomorrow", `${label} tomorrow`);
      assert.equal(dateForWord("tomorrow", now), dayAfter(1, now), `${label} spoken tomorrow`);
      assert.equal(doneDayLabel(now, "en"), headerDay(now).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" }), `${label} done label`);
    }
  }
  // 00:00-04:00 is still tonight
  assert.equal(getDayKey(at(18, 0, 0)), "2026-10-17");
  assert.equal(slotsWord(at(18, 9, 0), at(18, 3, 59)), "tomorrow");
  assert.equal(slotsWord(at(18, 9, 0), at(18, 4, 0)), "today");
});

test("My day start never goes below 04:00 and never moves the boundary", () => {
  assert.equal(dayHours({ dayStart: "03:00", dayEnd: "22:00" }, at(18, 12)).start, 240);
  assert.equal(dayHours({ dayStart: "04:00", dayEnd: "22:00" }, at(18, 12)).start, 240);
  assert.equal(dayHours({ dayStart: "03:59", dayEnd: "22:00" }, at(18, 12)).start, 240);
  assert.equal(dayHours({}, at(18, 12)).start, 480, "default unchanged");
});

// ---------- Plan label when nothing fits ----------
import { planLabelDay } from "../../app/js/day.js";

test("plan label: at night with nothing fittable it says tomorrow, matching Home", () => {
  const hours = dayHours({}, at(18, 23));
  for (const now of [at(18, 22, 0), at(18, 23, 0), at(19, 1, 30), at(19, 3, 59)]) {
    assert.equal(planLabelDay({ rows: [], now, hours: dayHours({}, now) }), "tomorrow", `${new Date(now).toTimeString().slice(0, 5)}`);
  }
  // In the day it keeps the fallback (today); "I'm free now" at night is today's too.
  assert.equal(planLabelDay({ rows: [], now: at(18, 12), hours: dayHours({}, at(18, 12)) }), "today");
  assert.equal(planLabelDay({ rows: [], now: at(18, 23), hours, nightFree: true }), "today");
  // With slots it follows them (the Now card's word).
  assert.equal(planLabelDay({ rows: [{ start: at(19, 8) }], now: at(18, 23), hours }), "tomorrow");
  assert.equal(planLabelDay({ rows: [{ start: at(18, 13) }], now: at(18, 12), hours }), "today");
});

// ---------- Rethink coherence: one word for the plan's day ----------
import { planWords } from "../../app/js/day.js";

test("plan words: label, status, notes, reasons and the x all name the same day", () => {
  for (const word of ["today", "tomorrow"]) {
    const w = planWords(word), other = word === "today" ? "tomorrow" : "today";
    const all = [w.label, w.empty, w.nothingFits, w.over(1), w.over(3), w.takeOff, w.why("needs office hours, none left today")].join(" | ");
    assert.ok(all.includes(word), all);
    assert.ok(!all.includes(other), `${word}: no '${other}' anywhere: ${all}`);
  }
  assert.equal(planWords("tomorrow").label, "Proposed for tomorrow");
  assert.equal(planWords("tomorrow", true).label, "Tomorrow's plan");
  assert.equal(planWords("today", true).label, "Today's plan");
  assert.equal(planWords("tomorrow").over(1), "One doesn't fit tomorrow. ↑ does one first, ✕ takes it off.");
  assert.equal(planWords("today").over(2), "2 don't fit today. ↑ does one first, ✕ takes it off.");
  assert.equal(planWords("tomorrow").why("evening only, no evening time left"), "evening only, no evening time left");
  assert.equal(planWords("nonsense").word, "today");
});
