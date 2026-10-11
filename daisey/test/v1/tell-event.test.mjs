// Tell Daisey offline: a time in the sentence makes it an event (tell-event.js, user test 2026-10-11).
import test from "node:test";
import assert from "node:assert/strict";
import { eventFrom } from "../../app/js/tell-event.js";

const NOW = new Date(2026, 9, 7, 10, 0).getTime(); // Wednesday

test("lunch with Dana at 13:00 for an hour → an event today, 13:00, an hour", () => {
  assert.deepEqual(eventFrom("lunch with Dana at 13:00 for an hour", NOW),
    { kind: "event", title: "Lunch with Dana", date: "2026-10-07", time: "13:00", minutes: 60 });
});

test("pm, a bare hour, lengths and days", () => {
  assert.deepEqual(eventFrom("Call Uri tomorrow at 3pm for 30 min", NOW), { kind: "event", title: "Call Uri", date: "2026-10-08", time: "15:00", minutes: 30 });
  assert.equal(eventFrom("dentist on Friday at 9", NOW).date, "2026-10-09");
  assert.equal(eventFrom("dentist on Friday at 9", NOW).time, "09:00");
  assert.equal(eventFrom("gym at 6 for 1.5 hours", NOW).time, "18:00");
  assert.equal(eventFrom("gym at 6 for 1.5 hours", NOW).minutes, 90);
});

test("no time: not an event", () => {
  assert.equal(eventFrom("mix review for Reprise, 2 h, by Thursday", NOW), null);
  assert.equal(eventFrom("buy 3 lemons", NOW), null);
});
