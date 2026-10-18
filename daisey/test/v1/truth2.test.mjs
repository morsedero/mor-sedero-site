// Plan label, durations, Done's day, night scroll (Mor, 2026-10-18). Run:
//   node --test "daisey/test/v1/truth2.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, localDate, getDayKey } from "../../app/js/model.js";
import { dayHours, nextMorning, dayWord, slotsWord, doneDayLabel } from "../../app/js/day.js";
import { proposeDay, timeline } from "../../app/js/proposal.js";
import { durationFrom, withSpoken } from "../../app/js/duration.js";
import { doneToday } from "../../app/js/look.js";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app");
const at = (d, h = 12, m = 0) => new Date(2026, 9, d, h, m).getTime(); // Oct 2026; the 18th is a Sunday

// ---------- 1. Plan label ----------

const taskAt = (now) => ({ ...createTask({ title: "Write the report", project: "Work", size: 30, due: localDate(now + 864e5) }, { now }), id: "t1" });

test("1 at 01:10 'Plan my day' lays 08:00 slots and the label says tomorrow, like Home", () => {
  const now = at(18, 1, 10), hours = dayHours({}, now), tasks = [taskAt(now)];
  const items = proposeDay({ tasks, events: [], now, hours });
  assert.ok(items.length > 0, "something is proposed");
  const { rows } = timeline(items, { tasks, events: [], now, hours });
  assert.ok(rows.length > 0);
  assert.equal(localDate(rows[0].start), "2026-10-18", "the slots fall on the calendar's 18th, 08:00");
  assert.equal(getDayKey(rows[0].start), "2026-10-18");
  assert.equal(getDayKey(now), "2026-10-17");
  assert.equal(slotsWord(rows[0].start, now), "tomorrow", "Proposed for tomorrow");
  // Home's "Tomorrow first" is the same word, from the same helper.
  assert.equal(dayWord(getDayKey(nextMorning(now, hours)), now), "tomorrow");
  assert.equal(slotsWord(rows[0].start, now), dayWord(getDayKey(nextMorning(now, hours)), now));
});

test("1 the label follows the slots: now-slots at 01:30 are tonight's (today), midday and evening plans too", () => {
  assert.equal(slotsWord(at(18, 1, 30), at(18, 1, 10)), "today"); // "I'm free now" at night
  assert.equal(slotsWord(at(18, 13, 0), at(18, 12, 0)), "today");
  assert.equal(slotsWord(at(19, 8, 0), at(18, 23, 0)), "tomorrow"); // laid in the evening for the morning
  assert.equal(slotsWord(at(18, 3, 59), at(18, 1, 10)), "today"); // still last night's day
  assert.equal(slotsWord(at(18, 8, 0), at(18, 3, 59)), "tomorrow");
});

// ---------- 3. Duration parsing ----------

const mins = (s) => durationFrom(s)?.minutes ?? null;

test("3 '20 min' and '20 minutes' read as 20", () => {
  assert.equal(mins("20 min"), 20);
  assert.equal(mins("20 minutes"), 20);
  assert.equal(mins("20min"), 20);
  assert.equal(mins("20m"), 20);
  assert.equal(mins("10 min"), 10);
});

test("3 '1 h', '2 hours', '1.5 h', '1 h 30 min', 'half an hour' read right", () => {
  assert.equal(mins("1 h"), 60);
  assert.equal(mins("1h"), 60);
  assert.equal(mins("2 hours"), 120);
  assert.equal(mins("1.5 h"), 90);
  assert.equal(mins("1 h 30 min"), 90);
  assert.equal(mins("half an hour"), 30);
  assert.equal(mins("an hour"), 60);
  assert.equal(mins("an hour and a half"), 90);
});

test("3 'Submit report yesterday 20 min' keeps 20 min, whatever date word sits before or after", () => {
  for (const s of ["Submit report yesterday 20 min", "Submit report 20 min yesterday", "yesterday Submit report 20 min",
    "20 min Submit report yesterday", "Submit report tomorrow 20 minutes", "Submit report by Friday, 20 min", "Submit report today for 20 min"]) {
    assert.equal(mins(s), 20, s);
  }
  assert.equal(mins("Submit report yesterday 1 h"), 60);
  assert.equal(mins("Submit report 1 h yesterday"), 60);
  assert.equal(mins("Submit report yesterday half an hour"), 30);
  assert.equal(mins("Submit report half an hour yesterday"), 30);
  assert.equal(mins("Submit report yesterday 20 minutes"), 20);
  // The words left over are the task, without the duration.
  assert.equal(durationFrom("Submit report yesterday 20 min").rest, "Submit report yesterday");
  assert.equal(durationFrom("Call Uri, 15 min.").rest, "Call Uri");
});

test("3 Hebrew durations, and no duration where none is said", () => {
  assert.equal(mins("להגיש דוח אתמול 20 דקות"), 20);
  assert.equal(mins("להגיש דוח חצי שעה"), 30);
  assert.equal(mins("להגיש דוח שעתיים"), 120);
  for (const s of ["Submit report yesterday", "Call at 3pm", "Admin tasks", "Room 5 m wide?".replace("5 m", "five")]) assert.equal(mins(s), null, s);
  assert.equal(mins("Submit 20 min report, call 10 min"), null, "two different durations: not guessed");
});

test("3 a duration typed in the sentence wins over the helper's silence or guess, for one lone add", () => {
  const add = { kind: "add", title: "Submit report", due: "2026-10-17" };
  assert.equal(withSpoken([add], "Submit report yesterday 20 min")[0].size, 20);
  assert.equal(withSpoken([{ ...add, size: 60 }], "Submit report yesterday 20 min")[0].size, 20, "not the 1 h guess");
  assert.equal(withSpoken([add], "Submit report yesterday")[0].size, undefined);
  // Several tasks, or a moment/event in the same breath: which duration is whose is the helper's call.
  const two = [add, { kind: "add", title: "Call Uri" }];
  assert.deepEqual(withSpoken(two, "Submit report 20 min and call Uri"), two);
  const moment = [{ kind: "moment", minutes: 30 }];
  assert.deepEqual(withSpoken(moment, "I have 30 minutes"), moment);
});

// ---------- 5. Done's day ----------

test("5 a task done at 01:11 on Sunday reads Saturday, matching Done today", () => {
  const doneAt = at(18, 1, 11);
  assert.equal(doneDayLabel(doneAt, "en-US"), "Sat, Oct 17");
  assert.equal(doneDayLabel(at(18, 8, 0), "en-US"), "Sun, Oct 18");
  assert.equal(doneDayLabel(null), "");
  // The same grouping the night screen's "Done today" uses.
  const t = { id: "d", status: "done", doneAt };
  assert.equal(doneToday([t], at(17, 23, 0)).length, 1, "Saturday's Done today holds it");
  assert.equal(doneToday([t], at(18, 12, 0)).length, 0, "Sunday's doesn't");
});

// ---------- 4. Night page overlap ----------

test("4 the night page scrolls its own row, so a tall Done today list pushes the cards down", () => {
  const css = fs.readFileSync(path.join(APP, "css", "app.css"), "utf8");
  assert.match(css, /:root\.night \.nowrow \{[^}]*overflow-y:\s*auto/);
});
