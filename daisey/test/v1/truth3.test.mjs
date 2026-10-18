// The Break card's pick, day words after midnight, "How much is left?" only
// for started tasks, and the day boundary locked (Mor, 2026-10-18). Run:
//   node --test "daisey/test/v1/truth3.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createTask, getDayKey, dateForWord, localDate } from "../../app/js/model.js";
import { dayHours, nightRange, dayWord } from "../../app/js/day.js";
import { holdPick, freshPick, pickedCard, offerable, CANT_NOW } from "../../app/js/pick.js";
import { asksLeft } from "../../app/js/project-state.js";
import { eventFrom } from "../../app/js/tell-event.js";
import { proposeDay, timeline } from "../../app/js/proposal.js";
const { upLateLine } = createRequire(import.meta.url)("../../functions/daisey-now-chat.js");

const at = (d, h = 12, m = 0) => new Date(2026, 9, d, h, m).getTime(); // Oct 2026; the 17th is a Saturday

// ---------- 1. "Put <task> on the card instead" on the Break card ----------

const bank = { id: "bank", title: "Call the bank", project: "Admin", status: "ready", size: 15 };
// The engine at 19:30: nothing to pick, the bank call out for office hours.
const breakR = { pick: null, ranked: [], out: [{ task: bank, reason: "office" }] };

test("1 tapping 'Put Call the bank on the card instead' puts it on the Now card", () => {
  // The tap, then the render that follows it.
  const after = holdPick(freshPick("bank"), "office");
  assert.equal(after.chosen, "bank");
  const card = pickedCard(breakR, after.chosen);
  assert.equal(card.task.id, "bank", "the Now card shows that task");
  assert.deepEqual(card.whyParts, ["your pick"]);
  // …and it stays there on the next render (the minute tick), so the Break card is gone.
  const next = holdPick(after, "office");
  assert.equal(next.chosen, "bank");
});

test("1 the dead button: a task picked earlier, before its office shut, is still put on the card when tapped again", () => {
  // Picked at 15:00 (nothing in its way), remembered; at 19:30 the office is
  // shut, the card lets it go and the Break card offers it.
  let st = holdPick({ chosen: "bank", chosenOut: null }, null);
  st = holdPick(st, "office");
  assert.equal(st.chosen, null, "it left the card when it couldn't be done");
  // The old tap only set chosen again; the stale memory let it go at once.
  assert.equal(holdPick({ chosen: "bank", chosenOut: st.chosenOut }, "office").chosen, null, "the bug, kept for the record");
  // The tap now starts a fresh, knowing pick.
  const tapped = holdPick(freshPick("bank"), "office");
  assert.equal(tapped.chosen, "bank");
  assert.equal(pickedCard(breakR, tapped.chosen).task.id, "bank");
});

test("1 the button is offered only for a task a tap really puts on the card", () => {
  assert.deepEqual(offerable(breakR).map((a) => a.task.id), ["bank"]);
  const r = { ranked: [], out: [
    { task: bank, reason: "office" },
    { task: { ...bank, id: "skipped" }, reason: "skipped" }, // put off today: not offered
    { task: { ...bank, id: "waiting", status: "waiting" }, reason: "booked" }, // not ready: can't go on the card
    { task: { ...bank, id: "far" }, reason: "place" },
  ] };
  assert.deepEqual(offerable(r).map((a) => a.task.id), ["bank", "far"]);
  for (const { task } of offerable(r)) assert.equal(pickedCard(r, task.id).task.id, task.id);
  assert.equal(pickedCard(r, "skipped"), null);
  assert.ok(CANT_NOW.has("office"));
});

// ---------- 2. Day words after midnight ----------

// Saturday night: the day that began Sat 17th 04:00 runs to Sun 18th 04:00.
const CASES = [
  // [label, now, today, yesterday, tomorrow]
  ["01:51 Sun", at(18, 1, 51), "2026-10-17", "2026-10-16", "2026-10-18"],
  ["03:59 Sun", at(18, 3, 59), "2026-10-17", "2026-10-16", "2026-10-18"],
  ["04:00 Sun", at(18, 4, 0), "2026-10-18", "2026-10-17", "2026-10-19"],
  ["04:01 Sun", at(18, 4, 1), "2026-10-18", "2026-10-17", "2026-10-19"],
  ["23:59 Sun", at(18, 23, 59), "2026-10-18", "2026-10-17", "2026-10-19"],
];

test("2 dateForWord: yesterday / today / tomorrow count from the day key at 01:51, 03:59, 04:00, 04:01, 23:59", () => {
  for (const [label, now, today, yesterday, tomorrow] of CASES) {
    assert.equal(dateForWord("today", now), today, `${label} today`);
    assert.equal(dateForWord("yesterday", now), yesterday, `${label} yesterday`);
    assert.equal(dateForWord("tomorrow", now), tomorrow, `${label} tomorrow`);
    assert.equal(dateForWord("today", now), getDayKey(now), `${label}: the cards' own key`);
    assert.equal(dayWord(dateForWord("tomorrow", now), now), "tomorrow");
    assert.equal(dayWord(dateForWord("yesterday", now), now), "yesterday");
    // Hebrew too.
    assert.equal(dateForWord("היום", now), today);
    assert.equal(dateForWord("אתמול", now), yesterday);
    assert.equal(dateForWord("מחר", now), tomorrow);
  }
  assert.equal(dateForWord("someday", at(18, 1, 51)), null);
});

test("2 the text parser: 'yesterday', 'today', 'tomorrow' at 01:51, 03:59, 04:00, 04:01, 23:59", () => {
  for (const [label, now, today, yesterday, tomorrow] of CASES) {
    assert.equal(eventFrom("dentist today at 10", now).date, today, `${label} today`);
    assert.equal(eventFrom("dentist yesterday at 10", now).date, yesterday, `${label} yesterday`);
    assert.equal(eventFrom("dentist tomorrow at 10", now).date, tomorrow, `${label} tomorrow`);
    assert.equal(eventFrom("dentist at 10 tomorrow", now).date, tomorrow, `${label} word after the time`);
  }
});

test("2 the helper is told the same dates the app uses (one source of truth)", () => {
  const now = at(18, 1, 51), key = getDayKey(now);
  assert.notEqual(key, localDate(now), "after midnight the key is still Saturday's");
  const line = upLateLine({ today: key, afterMidnight: true });
  assert.match(line, new RegExp(`"Today" \\(היום\\) and "tonight" \\(הלילה\\) mean ${dateForWord("today", now)}`));
  assert.match(line, new RegExp(`"yesterday" \\(אתמול\\) means ${dateForWord("yesterday", now)}`));
  assert.match(line, new RegExp(`"tomorrow" \\(מחר\\) and "this morning" mean ${dateForWord("tomorrow", now)}`));
  assert.equal(upLateLine({ today: getDayKey(at(18, 4, 1)) }), "", "after 04:00 nothing to explain");
});

// ---------- 3. "How much is left?" only for a started task ----------

const t3 = (o = {}) => ({ id: "x", title: "Write the report", status: "ready", size: 60, progress: 0, starts: 0, spentMinutes: 0, ...o });

test("3 an untouched task set to Pending isn't asked how much is left", () => {
  assert.equal(asksLeft(t3()), false);
  assert.equal(asksLeft(createTask({ title: "Brand new" })), false);
});

test("3 a started task, or one with time counted, is asked", () => {
  assert.equal(asksLeft(t3({ progress: 30 })), true);
  assert.equal(asksLeft(t3({ starts: 1 })), true);
  assert.equal(asksLeft(t3({ spentMinutes: 20 })), true);
  assert.equal(asksLeft(t3({ workedAt: at(17, 10) })), true);
  // Never for a routine or a finished task.
  assert.equal(asksLeft(t3({ progress: 30, routine: { per: 3 } })), false);
  assert.equal(asksLeft(t3({ status: "done", progress: 30 })), false);
  assert.equal(asksLeft(null), false);
});

// ---------- 4. Lock: fixed 04:00 day boundary; My day drives slots and the Night pill ----------

const workTask = (now) => ({ ...createTask({ title: "Mix review", project: "Work", size: 30 }, { now }), id: "w1" });
const firstSlot = (settings, now) => {
  const hours = dayHours(settings, now), tasks = [workTask(now)];
  return timeline(proposeDay({ tasks, events: [], now, hours }), { tasks, events: [], now, hours }).rows[0]?.start;
};

test("4 the day boundary is a fixed 04:00 whatever My day says", () => {
  for (const dayStart of ["04:00", "05:00", "08:00", "09:00", "10:30"]) {
    const s = { dayStart, dayEnd: "22:30" };
    for (const [h, m, key] of [[1, 51, "2026-10-17"], [3, 59, "2026-10-17"], [4, 0, "2026-10-18"], [4, 1, "2026-10-18"], [8, 30, "2026-10-18"]]) {
      const now = at(18, h, m);
      dayHours(s, now); // reading the hours never moves the key
      assert.equal(getDayKey(now), key, `My day ${dayStart} at ${h}:${m}`);
    }
  }
});

test("4 planning slots follow My day start, not the boundary", () => {
  const now = at(18, 8, 30); // the new day already, by the fixed boundary
  const at9 = firstSlot({ dayStart: "09:00", dayEnd: "22:30" }, now);
  assert.equal(new Date(at9).getHours(), 9, "My day 09:00: nothing before 09:00");
  assert.equal(new Date(at9).getMinutes(), 0);
  const at8 = firstSlot({ dayStart: "08:00", dayEnd: "22:30" }, now);
  assert.ok(at8 >= now && at8 < at(18, 9, 0), "My day 08:00: from now, 08:30");
  // At 01:51 the slots wait for My day's start the next morning.
  const night = firstSlot({ dayStart: "09:00", dayEnd: "22:30" }, at(18, 1, 51));
  assert.equal(localDate(night), "2026-10-18");
  assert.equal(new Date(night).getHours(), 9);
});

test("4 the Night pill follows My day, not the boundary", () => {
  assert.deepEqual(nightRange(dayHours({ dayStart: "09:00", dayEnd: "22:30" })), ["22:30", "09:00"]);
  assert.deepEqual(nightRange(dayHours({ dayStart: "07:00", dayEnd: "23:00" })), ["23:00", "07:00"]);
  assert.deepEqual(nightRange(dayHours({})), ["22:00", "08:00"]);
});
