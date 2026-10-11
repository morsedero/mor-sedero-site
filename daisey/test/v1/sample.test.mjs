// The sample day a new guest opens to (sample.js, 2026-10-11).
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const { sampleDay } = await import("../../app/js/sample.js");
const { rank } = await import("../../app/js/engine.js");
const { planProgress, timeline } = await import("../../app/js/proposal.js");

const at = (h, m = 0) => Date.UTC(2026, 9, 12, h - 3, m); // a Monday

test("a morning sample: five tasks, one real deadline, an approved plan, a pick", () => {
  const { tasks, plan } = sampleDay({ now: at(9) });
  assert.equal(tasks.length, 5);
  assert.equal(new Set(tasks.map((t) => t.id)).size, 5);
  const dl = tasks.filter((t) => t.dateKind === "deadline");
  assert.equal(dl.length, 1);
  assert.equal(dl[0].due, "2026-10-13");
  assert.ok(tasks.every((t) => t.size > 0 && t.status === "ready" && t.guessed.length === 0));
  assert.equal(plan.status, "approved");
  assert.equal(plan.date, "2026-10-12");
  const p = planProgress(plan, tasks);
  assert.ok(p.total >= 2, `plan has ${p.total} tasks`);
  assert.equal(p.done, 0);
  const tl = timeline(plan.items, { tasks, events: [], now: at(9) });
  assert.ok(tl.rows.length >= 2);
  assert.ok(rank(tasks, { now: at(9), window: 120 }).pick, "the card has a pick");
});

test("late at night there's no day left to plan: no plan, still the tasks", () => {
  const { tasks, plan } = sampleDay({ now: at(23, 50) });
  assert.equal(tasks.length, 5);
  assert.equal(plan, null);
});
