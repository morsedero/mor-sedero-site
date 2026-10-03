// The capture bar's local parser. Run: node --test "daisey/test/v1/*.test.mjs"
// Hebrew cases are the point of several of these: JS \b does not work on
// Hebrew letters, and the first version silently parsed nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { parseTask } from "../../app/js/parse.js";

const NOW = new Date(2026, 9, 5, 10).getTime(); // Monday 5 Oct 2026, local
const projects = ["Reprise", "Monster Punk", "חתונה"];
const p = (text) => parseTask(text, { projects, now: NOW });

test("a plain line is just a title", () => {
  assert.deepEqual(p("call Uri"), { title: "call Uri", project: null, size: null, due: null, found: [] });
  assert.equal(p("").title, "");
});

test("how long: minutes, hours, decimals, Hebrew — kept exactly as said", () => {
  assert.equal(p("invoice 5m").size, 5);
  assert.equal(p("invoice 45 minutes").size, 45);
  assert.equal(p("mix 2h").size, 120);
  assert.equal(p("mix 1.5h").size, 90);
  assert.equal(p("שיעור 45 דקות").size, 45);
  assert.equal(p("לסדר מוזיקה שעתיים").size, 120);
  assert.equal(p("mix 2h").title, "mix"); // the words are cut out of the title
});

test("when: today, tomorrow, weekday — next one coming, Hebrew too", () => {
  assert.equal(p("invoice today").due, "2026-10-05");
  assert.equal(p("invoice tomorrow").due, "2026-10-06");
  assert.equal(p("להתקשר מחר").due, "2026-10-06");
  assert.equal(p("mix thursday").due, "2026-10-08");
  assert.equal(p("שיעור ביום חמישי").due, "2026-10-08");
  assert.equal(p("mix on monday").due, "2026-10-12"); // today doesn't count
});

test("project: only names Daisey already knows, longest match first", () => {
  assert.equal(p("fix boss loop in Monster Punk").project, "Monster Punk");
  assert.equal(p("חתונה: לסדר מוזיקה").project, "חתונה");
  assert.equal(p("#Reprise mix review").project, "Reprise");
  assert.equal(p("mix review for Repriseish").project, null); // not a word on its own
  assert.equal(p("call the reprise people").project, "Reprise"); // case-insensitive
});

test("everything at once, and the title keeps only what's left", () => {
  assert.deepEqual(p("mix review for Reprise 2h thursday"),
    { title: "mix review", project: "Reprise", size: 120, due: "2026-10-08", found: ["size", "due", "project"] });
  assert.deepEqual(p("להתקשר לדי ג'יי מחר 30 דק"),
    { title: "להתקשר לדי ג'יי", project: null, size: 30, due: "2026-10-06", found: ["size", "due"] });
});

test("a line that is only a length or a day stays the title, not an empty task", () => {
  assert.equal(p("30 min").title, "30 min");
  assert.equal(p("tomorrow").title, "tomorrow");
  assert.equal(p("30 min").size, null); // nothing was really understood
});
