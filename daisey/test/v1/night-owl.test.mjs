// One day model for night owls (Mor, 2026-10-12): the day switched at 04:00;
// since 2026-10-18 it switches at the day boundary (model.js getDayKey, default
// 08:00 = "My day" start), not midnight. Before it, it's still tonight and the
// coming morning is "tomorrow" — on the Now card, the Schedule, the plan and
// in Tell Daisey alike. The day hours themselves are the user's (Settings).
import test from "node:test";
import assert from "node:assert/strict";
import { dayHours, nextMorning, planDate, dayWord, answerDate } from "../../app/js/day.js";
import { localDate, logicalDate, dayAfter } from "../../app/js/model.js";
import { eventFrom } from "../../app/js/tell-event.js";
import { createRequire } from "node:module";
const { upLateLine } = createRequire(import.meta.url)("../../functions/daisey-now-chat.js");

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();

// The labels, as each surface works them out (now.js nightView / planWord,
// schedule.js dayName): all from dayWord against the date each one shows.
function names(now, settings = {}){
  const hrs = dayHours(settings, now);
  return {
    card: dayWord(localDate(nextMorning(now, hrs)), now), // "Tomorrow first" vs "First today"
    schedule: dayWord(localDate(now), now), // the calendar's today, the page the Schedule opens on
    plan: dayWord(planDate(now, hrs), now), // "Proposed for …", "Take off …'s plan"
    later: dayWord(dayAfter(1, now), now), // Later → Tomorrow
  };
}

test("(a) 00:00–07:59: card, schedule, plan and buttons all call the morning slot tomorrow", () => {
  for (const [h, m] of [[0, 30], [1, 0], [2, 30], [3, 59], [7, 59]]) {
    const now = at(13, h, m), hrs = dayHours({}, now);
    assert.equal(logicalDate(now), "2026-10-12", `${h}:${m} is still the 12th's night`);
    assert.deepEqual(names(now), { card: "tomorrow", schedule: "tomorrow", plan: "tomorrow", later: "tomorrow" }, `${h}:${m}`);
    // …and it's the same morning, the 13th.
    assert.equal(localDate(nextMorning(now, hrs)), "2026-10-13");
    assert.equal(planDate(now, hrs), "2026-10-13");
    assert.equal(dayAfter(1, now), "2026-10-13");
  }
  // Mor's own hours (09:00 to 03:59): the day key still switches at the fixed
  // 08:00, not at "My day" start. At 08:14 it is the 13th, but his day hasn't
  // begun, so the card's morning (09:00) is today's: "First today".
  const mor = { dayStart: "09:00", dayEnd: "03:59" };
  assert.equal(logicalDate(at(13, 7, 59)), "2026-10-12");
  assert.deepEqual(names(at(13, 7, 59), mor), { card: "tomorrow", schedule: "tomorrow", plan: "tomorrow", later: "tomorrow" });
  assert.equal(logicalDate(at(13, 8, 14)), "2026-10-13");
  assert.deepEqual(names(at(13, 8, 14), mor), { card: "today", schedule: "today", plan: "today", later: "tomorrow" });
  // 09:14: his day is on. Its morning is behind, the next one is tomorrow's.
  assert.deepEqual(names(at(13, 9, 14), mor), { card: "tomorrow", schedule: "today", plan: "today", later: "tomorrow" });
});

test("(b) 'tomorrow at 8am' at 03:44 is the morning the card calls Tomorrow first", () => {
  const now = at(13, 3, 44), morning = localDate(nextMorning(now, dayHours({}, now)));
  const ev = eventFrom("buy milk tomorrow at 8am", now);
  assert.deepEqual({ date: ev.date, time: ev.time }, { date: morning, time: "08:00" });
  assert.equal(morning, "2026-10-13");
  // "this morning" and "today" are that morning too; "tonight at 1am" the small hours after this evening.
  assert.equal(eventFrom("dentist this morning at 9", now).date, "2026-10-13");
  assert.equal(eventFrom("call mom today at 10", now).date, "2026-10-13");
  assert.equal(eventFrom("mix tonight at 1am", at(12, 23)).date, "2026-10-13");
  assert.equal(eventFrom("mix tonight at 23:00", at(12, 20)).date, "2026-10-12");
  assert.equal(eventFrom("mix tonight at 23:00", now).date, "2026-10-13"); // last night's 23:00 is over
  // The helper gets told: still up from the 12th, so tomorrow means the 13th (tell.js upLate).
  assert.notEqual(logicalDate(now), localDate(now));
  assert.match(upLateLine({ today: localDate(now), upLate: logicalDate(now) }), /"Tomorrow" \(מחר\) means 2026-10-13/);
  assert.match(upLateLine({ today: "2026-10-13", upLate: "2026-10-12" }), /"this morning" also mean 2026-10-13/);
});

test("(c) from 08:00 the day rolls over normally", () => {
  for (const [h, m] of [[8, 0], [9, 0], [14, 0], [23, 30]]) {
    const now = at(13, h, m);
    assert.equal(logicalDate(now), "2026-10-13");
    assert.equal(dayWord(localDate(now), now), "today");
    assert.equal(dayAfter(1, now), "2026-10-14");
    assert.equal(eventFrom("buy milk tomorrow at 8am", now).date, "2026-10-14");
    assert.equal(eventFrom("buy milk today at 22:00", now).date, "2026-10-13");
  }
  // 08:05, the day has started: its morning is behind (next one is tomorrow's); the plan is today's.
  assert.deepEqual(names(at(13, 8, 5)), { card: "tomorrow", schedule: "today", plan: "today", later: "tomorrow" });
  // In the evening the card's morning is tomorrow; the plan is still today's.
  const eve = at(13, 23, 30);
  assert.equal(names(eve).card, "tomorrow");
  assert.equal(names(eve).plan, "today");
});

test("a day stretched past midnight is still on, and today-only answers belong to the morning you wake into", () => {
  // "Until 1am" said on the 12th: on at 00:30, over at 01:30, gone by the morning.
  const s = { dayEndToday: { date: "2026-10-12", end: "01:00" } };
  assert.equal(dayHours(s, at(13, 0, 30)).late, true);
  assert.equal(names(at(13, 0, 30), s).plan, "today"); // still the 12th's plan
  assert.equal(dayHours(s, at(13, 1, 30)).end, 22 * 60);
  // "Until 23:00 today" said at 02:00 (after the day ended) is for the 13th, and still holds at 09:00.
  assert.equal(answerDate({}, at(13, 2)), "2026-10-13");
  const said = { dayEndToday: { date: answerDate({}, at(13, 2)), end: "23:00" } };
  assert.equal(dayHours(said, at(13, 9)).end, 23 * 60);
});
