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
