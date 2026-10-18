// "More time?" under the card (model.moreTimePatch, Mor 2026-10-18).
import test from "node:test";
import assert from "node:assert/strict";
import { moreTimePatch, createTask, leftMinutes } from "../../app/js/model.js";
import { timeline } from "../../app/js/proposal.js";

const at = (h, m) => new Date(2026, 9, 18, h, m).getTime();
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);

test("moreTime: +10 on 30 min → size 40, only the size changes (no touch: the plan keeps its times)", () => {
  const t = createTask({ title: "Mix", size: 30 });
  assert.deepEqual(moreTimePatch(t, 10), { size: 40 });
});

test("moreTime: time already worked stays worked; what's left grows by m", () => {
  const t = { ...createTask({ title: "Mix", size: 30 }), spentMinutes: 20 };
  assert.equal(leftMinutes({ ...t, ...moreTimePatch(t, 15) }), 25);
});

test("moreTime: a progress % the user gave stays; the size grows under it", () => {
  const t = { ...createTask({ title: "Mix", size: 60 }), progress: 50 };
  const p = moreTimePatch(t, 30);
  assert.equal(p.progress, undefined);
  assert.equal(leftMinutes({ ...t, ...p }), 60);
});

test("moreTime: slot 10:00-10:30 at 10:22, +10 → 10:00-10:40, the start doesn't move to now", () => {
  const since = at(10, 0), now = at(10, 22);
  const t1 = { id: "t1", ...createTask({ title: "Mix", size: 30 }), touchedAt: since };
  const t2 = { id: "t2", ...createTask({ title: "Lesson", size: 60 }), touchedAt: at(9, 0) };
  const items = [{ taskId: "t1", minutes: 30 }, { taskId: "t2", minutes: 60 }];
  const rows = (tasks) => timeline(items, { tasks, events: [], now, since }).rows.map((r) => `${r.taskId} ${hhmm(r.start)}-${hhmm(r.end)}`);
  assert.deepEqual(rows([t1, t2]), ["t1 10:00-10:30", "t2 10:30-11:30"]);
  assert.deepEqual(rows([{ ...t1, ...moreTimePatch(t1, 10) }, t2]), ["t1 10:00-10:40", "t2 10:40-11:40"]);
});
