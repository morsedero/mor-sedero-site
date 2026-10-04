// Daisey v1 learning: size from finished tasks, shrinking, the split offer.
// Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/js/model.js";

const NOW = Date.UTC(2026, 9, 5, 9);
const done = (type, min) => ({ title: "unrelated " + min, type, status: "done", spentMinutes: min, size: 30, guessed: [] });

test("size guess: a type's finished tasks teach it, once three are in", () => {
  const three = [done("call", 20), done("call", 22), done("call", 24)];
  assert.equal(M.guessSize("ring the dentist", three, "call"), 15); // snaps 22 → 15
  assert.equal(M.guessSize("ring the dentist", three.slice(0, 2), "call"), 15); // two: word/type default
  assert.equal(M.guessSize("ring the dentist", [done("call", 90), done("call", 90)], "call"), 15); // not enough yet
});

test("size guess: words and similar past tasks still come first", () => {
  assert.equal(M.guessSize("send invoices", [done("call", 90), done("call", 90), done("call", 90)], "call"), 15);
  assert.equal(M.guessSize("Lesson prep", [{ title: "Lesson prep", status: "done", spentMinutes: 25, guessed: ["size"] }], "deep"), 30);
});

test("shrink: half the size, on the buckets, never under 5", () => {
  assert.equal(M.shrunk(60), 30);
  assert.equal(M.shrunk(90), 30);
  assert.equal(M.shrunk(15), 5);
  assert.equal(M.shrunk(5), 5);
});

test("shrink patch: new size, stop and skip counts cleared", () => {
  const p = M.shrinkPatch({ size: 60, stopsUnfinished: 2, skipsSinceStart: 5 }, NOW);
  assert.deepEqual(p, { size: 30, stopsUnfinished: 0, skipsSinceStart: 0, touchedAt: NOW });
});
