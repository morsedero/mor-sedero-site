// "More time?" under the card (model.moreTimePatch, Mor 2026-10-18).
import test from "node:test";
import assert from "node:assert/strict";
import { moreTimePatch, createTask, leftMinutes } from "../../app/js/model.js";

const at = (h, m) => new Date(2026, 9, 18, h, m).getTime();

test("moreTime: no timer, slot 10:00-10:30 at 10:22, +10 → 25 min worked, size 40, 15 left from 10:25", () => {
  const t = { ...createTask({ title: "Mix", size: 30 }) };
  const p = moreTimePatch(t, { start: at(10, 0), end: at(10, 30), minutes: 10, now: at(10, 22) });
  assert.equal(p.spentMinutes, 25);
  assert.equal(p.size, 40);
  assert.equal(leftMinutes({ ...t, ...p }), 15);
  assert.equal(p.touchedAt, at(10, 22));
});

test("moreTime: a running timer only grows the size by m (the timer logs its own minutes)", () => {
  const t = { ...createTask({ title: "Mix", size: 30 }) };
  assert.deepEqual(moreTimePatch(t, { start: at(10, 0), end: at(10, 30), minutes: 15, running: true, now: at(10, 22) }), { size: 45 });
});

test("moreTime: a progress % the user gave stays; the size grows under it", () => {
  const t = { ...createTask({ title: "Mix", size: 60 }), progress: 50 };
  const p = moreTimePatch(t, { start: at(10, 0), end: at(10, 30), minutes: 30, now: at(10, 22) });
  assert.equal(p.progress, undefined);
  assert.equal(p.size, 70);
  assert.equal(leftMinutes({ ...t, ...p }), 35); // 10:25 → 11:00
});
