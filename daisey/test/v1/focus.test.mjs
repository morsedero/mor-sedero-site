// Focus mode's pure parts: elapsed, the target it's measured against, and
// when the "Still on it?" prompt appears. Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { elapsedMinutes, targetMinutes, isOver, sinceMark, batchName } from "../../app/js/focus.js";
import * as F from "../../app/js/focus.js";

const NOW = Date.UTC(2026, 9, 5, 10);
const run = (minsAgo, extra = 0) => ({ taskId: "t1", startedAt: NOW - minsAgo * 60000, extra });

test("elapsed comes from startedAt, so a reload or the other device agrees", () => {
  assert.equal(elapsedMinutes(run(12), NOW), 12);
  assert.equal(elapsedMinutes(run(-1), NOW), 0); // clock skew never runs backwards
});

test("the target is the estimate plus every +15 min; over it, the prompt shows", () => {
  const task = { size: 30 };
  assert.equal(targetMinutes(run(0), task), 30);
  assert.equal(targetMinutes(run(0, 30), task), 60);
  assert.equal(isOver(run(29), task, NOW), false);
  assert.equal(isOver(run(31), task, NOW), true);
  assert.equal(isOver(run(31, 15), task, NOW), false); // +15 min quiets it again
});

test("batch: each tick books the minutes since the last tick (or the start)", () => {
  const b = { taskId: "a", batch: ["a", "b"], done: [], startedAt: NOW - 20 * 60000, mark: NOW - 20 * 60000 };
  assert.equal(sinceMark(b, NOW), 20);
  assert.equal(sinceMark({ ...b, done: ["a"], mark: NOW - 7 * 60000 }, NOW), 7);
  assert.equal(sinceMark({ ...b, mark: undefined }, NOW), 20); // old run docs: from the start
});

test("batch names: 3 calls, 1 errand, 2 admin bits", () => {
  assert.equal(batchName("call", 3), "3 calls");
  assert.equal(batchName("errand", 1), "1 errand");
  assert.equal(batchName("admin", 2), "2 admin bits");
});

test("pause freezes the clock; resume carries on from where it stopped", () => {
  const run = { taskId: "a", startedAt: 0, extra: 0, mark: 0 };
  const p = F.paused(run, 10 * 60000);
  assert.equal(F.elapsedMinutes(p, 50 * 60000), 10); // still 10 forty minutes later
  const r = F.resumed(p, 50 * 60000);
  assert.equal("pausedAt" in r, false);
  assert.equal(F.elapsedMinutes(r, 55 * 60000), 15);
  assert.equal(F.sinceMark(r, 55 * 60000), 15);
});

test("runCap: a forgotten timer books at most 2× the plan, ≥30 min over it (2026-10-06)", () => {
  const start = new Date(2026, 9, 5, 22).getTime();
  const run = { taskId: "a", startedAt: start, extra: 0 };
  const task = { size: 30 };
  assert.equal(F.runCap(30), 60);
  assert.equal(F.runCap(5), 35);
  assert.equal(F.runCap(90), 180);
  assert.equal(F.bookedMinutes(run, task, start + 45 * 60000), 45); // under the cap: real time
  assert.equal(F.bookedMinutes(run, task, start + 14 * 3600000), 60); // overnight: capped
  // "Still on it" at 70 min moves the plan to 70, so the cap to 140.
  const more = { ...run, extra: F.stillOnMinutes(run, task, start + 70 * 60000) };
  assert.equal(F.targetMinutes(more, task), 70);
  assert.equal(F.bookedMinutes(more, task, start + 100 * 60000), 100);
});

test("tookOptions: half the plan to twice it, 5-min steps, never past the clock (2026-10-06)", () => {
  assert.deepEqual(F.tookOptions(60, 300), [30, 60, 90, 120]);
  assert.deepEqual(F.tookOptions(5, 300), [5, 10]);
  assert.deepEqual(F.tookOptions(15, 40), [10, 15, 25, 30]);
  assert.deepEqual(F.tookOptions(60, 70), [30, 60]);
});
