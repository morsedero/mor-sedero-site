// Plan my day (plan.js, 2026-10-06): flexible windows, a Daisey plan only.
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const { planDay } = await import("../../app/js/plan.js");

const at = (h, m = 0) => Date.UTC(2026, 9, 6, h - 3, m);
const il = (h, m = 0) => new Date(at(h, m)).toISOString();
const t = (o) => ({ id: String(Math.random()), title: "Task", status: "ready", due: "2026-10-06", dateKind: "target", size: 30, spentMinutes: 0, createdAt: at(0), ...o });
const ev = (title, s, e) => ({ id: title, title, start: il(...s), end: il(...e), busy: true });

test("free time becomes windows; busy time doesn't", () => {
  const plan = planDay({ tasks: [t({ title: "SFX pass", size: 60 })], events: [ev("Teaching", [12], [15])], now: at(9) });
  assert.deepEqual(plan.map((p) => [p.key, p.minutes]), [["morning", 180], ["afternoon", 120], ["evening", 300]]);
  assert.equal(plan.every((p) => p.picks.every((k) => typeof k.minutes === "number")), true);
});

test("a task is planned once, a window that's too short is dropped, the evening starts at now", () => {
  const tasks = [t({ title: "A", size: 90 }), t({ title: "B", size: 90 })];
  const plan = planDay({ tasks, events: [ev("Meeting", [9, 10], [20, 50])], now: at(9) });
  assert.deepEqual(plan.map((p) => p.key), ["evening"]); // 9:00-9:10 isn't a window; 20:50-22:00 is
  const ids = plan.flatMap((p) => p.picks.map((k) => k.task.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("a running task is left out of the plan; a meeting you worked through isn't busy", () => {
  const a = t({ id: "a", title: "A", size: 60 }), b = t({ id: "b", title: "B", size: 30 });
  const run = { taskId: "a", startedAt: at(9, 30), extra: 0 };
  const plan = planDay({ tasks: [a, b], events: [], now: at(10), run });
  assert.equal(plan.flatMap((p) => p.picks).some((k) => k.task.id === "a"), false);
  const meet = ev("Meeting", [9], [11]);
  const worked = planDay({ tasks: [t({ id: "w", workedAt: at(9, 30) }), b], events: [meet], now: at(10) });
  assert.equal(worked[0].key, "morning"); // 10:00-12:00 is free again
});

test("nothing planned for the day that's over", () => {
  assert.deepEqual(planDay({ tasks: [t({})], events: [], now: at(22, 30) }), []);
});
