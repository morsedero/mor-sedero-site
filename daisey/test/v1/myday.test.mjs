// "My day" start drives Plan, Rethink and the Week grid - no leftover 09:00.
// Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { proposeDay, timeline, parseAsk, fewerOf, moreOf } from "../../app/js/proposal.js";
import { dayHours, gridSpan } from "../../app/js/day.js";
import { createTask } from "../../app/js/model.js";

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const NOW = at(18, 2, 0); // night: the plan waits for My day's start
const mk = (id, title, size = 30) => ({ ...createTask({ title, project: "Work", size }, { now: NOW }), id });
const tasks = [mk("a", "Mix"), mk("b", "Master"), mk("c", "Invoice")];
const first = (items, hours, now = NOW) => timeline(items, { tasks, events: [], now, hours }).rows[0]?.start;

for (const [dayStart, min] of [["05:00", 300], ["08:00", 480], ["09:00", 540]]) {
  test(`My day ${dayStart}: Plan, Rethink (fresh, start-with, fewer, more) and the Week grid all start at ${dayStart}`, () => {
    const settings = { dayStart, dayEnd: "22:00" }, hours = dayHours(settings, NOW);
    assert.equal(hours.start, min);
    const want = at(18, min / 60);
    const plan = proposeDay({ tasks, events: [], now: NOW, hours, settings });
    assert.equal(first(plan, hours), want, "Plan");
    const ctx = { tasks, events: [], now: NOW, hours, settings };
    assert.equal(first(proposeDay({ ...ctx, ask: parseAsk("start with Invoice", tasks) }), hours), want, "Rethink: start with");
    assert.equal(first(fewerOf(plan, ctx), hours), want, "Rethink: fewer");
    assert.equal(first(moreOf(plan, ctx), hours), want, "Rethink: more");
    // Week grid: the top row is My day's start (and is labelled - gridSpan.h0).
    assert.equal(gridSpan(hours, []).h0, min / 60, "Week grid");
    assert.equal(gridSpan(hours, [{ s: (min - 120), e: min }]).h0, min / 60 - 2, "an earlier event stretches it");
  });
}
