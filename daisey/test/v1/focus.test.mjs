// Focus mode's pure parts: elapsed, the target it's measured against, and
// when the "Still on it?" prompt appears. Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { elapsedMinutes, targetMinutes, isOver } from "../../app/js/focus.js";

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
