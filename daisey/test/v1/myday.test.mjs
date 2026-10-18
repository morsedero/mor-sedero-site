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

// ---------- "Plan set: N tasks" is the number the plan shows ----------
import { shownTaskCount } from "../../app/js/proposal.js";

test("plan set count: rows shown, not finished/deleted tasks, not No-room ones, not breaks", () => {
  const now = at(18, 10, 0), hours = dayHours({ dayStart: "08:00", dayEnd: "12:00" }, now); // 2 h left
  const t = (id, title, size, o = {}) => ({ ...createTask({ title, project: "Work", size }, { now }), id, ...o });
  const all = [t("a", "A", 30), t("b", "B", 30), t("c", "C", 30, { status: "done", doneAt: now }), t("d", "D", 600)];
  const items = [{ taskId: "a", minutes: 30 }, { brk: "short", minutes: 10 }, { taskId: "b", minutes: 30 }, { taskId: "c", minutes: 30 }, { taskId: "gone", minutes: 30 }, { taskId: "d", minutes: 600 }];
  const ctx = { tasks: all, events: [], now, hours };
  const tl = timeline(items, ctx);
  assert.equal(shownTaskCount(items, ctx), tl.rows.length);
  assert.equal(shownTaskCount(items, ctx), 2, "A and B only");
  assert.ok(tl.over.some((o) => o.taskId === "d"), "D has no room");
  assert.equal(shownTaskCount([], ctx), 0);
});

// ---------- "+N more · Add" only when an unplanned task can fit ----------
import { addableCount } from "../../app/js/proposal.js";

test("add-more: 0 when the unplanned task can't fit, >0 when it can", () => {
  const now = at(18, 10, 0), mkT = (id, size) => ({ ...createTask({ title: id, project: "Work", size }, { now }), id });
  const all = [mkT("a", 60), mkT("b", 60), mkT("c", 90)];
  const items = [{ taskId: "a", minutes: 60 }, { taskId: "b", minutes: 60 }];
  // 10:00-12:30 free: A+B take 2 h, C (90 min) can't fit in the 30 min left.
  const tight = dayHours({ dayStart: "08:00", dayEnd: "12:30" }, now);
  assert.equal(addableCount(items, { tasks: all, events: [], now, hours: tight }), 0);
  // 10:00-16:00 free: C fits.
  const roomy = dayHours({ dayStart: "08:00", dayEnd: "16:00" }, now);
  assert.equal(addableCount(items, { tasks: all, events: [], now, hours: roomy }), 1);
  // Nothing unplanned at all.
  assert.equal(addableCount(items, { tasks: all.slice(0, 2), events: [], now, hours: roomy }), 0);
  // One the user took off the plan stays off.
  assert.equal(addableCount(items, { tasks: all, events: [], now, hours: roomy, exclude: ["c"] }), 0);
});
