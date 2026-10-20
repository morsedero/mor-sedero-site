// Is the approved plan behind? (proposal.planStatus, 2026-10-11): only the
// clock against the plan's own slots and what's actually done. A task with
// No room from the start is never late, never a slip, never counted.
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const { timeline, planStatus, planProgress, unfitOf, refit } = await import("../../app/js/proposal.js");
const { lastActivity, planActivity } = await import("../../app/js/miss.js");
const { editTask } = await import("../../app/js/model.js");

const at = (h, m = 0) => Date.UTC(2026, 9, 12, h - 3, m); // a Monday
const il = (h, m = 0) => new Date(at(h, m)).toISOString();
const t = (o) => ({ title: "Task", status: "ready", type: "deep", area: "work", where: "anywhere", openHours: "anytime", due: "2026-10-12", dateKind: "target", size: 30, spentMinutes: 0, createdAt: at(0), touchedAt: at(0), ...o });
const ev = (title, s, e) => ({ id: title, title, start: il(...s), end: il(...e), busy: true, updated: il(0) });
// What now.js does on Approve: the items, when, and what had No room then.
const approve = (items, ctx) => ({ date: "2026-10-12", status: "approved", items, approvedAt: ctx.now, unfit: timeline(items, ctx).over.map((o) => o.taskId) });
const status = (plan, ctx) => planStatus(plan, ctx, lastActivity(ctx.tasks, plan.approvedAt));

test("(a) approved 3 min before the first slot: not late, not slipped, up to the slot and at it", () => {
  const tasks = [t({ id: "a" }), t({ id: "b" })];
  const events = [ev("Standup", [9], [10])];
  const items = [{ taskId: "a", minutes: 30 }, { taskId: "b", minutes: 30 }];
  const plan = approve(items, { tasks, events, now: at(9, 57) });
  assert.equal(timeline(items, { tasks, events, now: at(9, 57) }).rows[0].start, at(10));
  for (const now of [at(9, 57), at(9, 59), at(10)]) {
    const st = status(plan, { tasks, events, now });
    assert.equal(st.late, null, `late at ${new Date(now).toISOString()}`);
    assert.deepEqual(st.missed, []);
    assert.deepEqual(st.cut, []);
    assert.equal(st.behind, false);
  }
  // Past the slot with nothing started, it is late: that's the clock, not a guess.
  assert.equal(status(plan, { tasks, events, now: at(10, 3) }).late?.taskId, "a");
});

test("(b) a plan with a No-room task: counted out, never a slip", () => {
  const tasks = [t({ id: "a", size: 30 }), t({ id: "b", size: 20 }), t({ id: "c", size: 60 })];
  const events = [ev("Teaching", [10], [23])]; // 09:00-10:00 free
  const items = [{ taskId: "a", minutes: 30 }, { taskId: "b", minutes: 20 }, { taskId: "c", minutes: 60 }];
  const ctx = { tasks, events, now: at(9) };
  const plan = approve(items, ctx);
  assert.deepEqual(plan.unfit, ["c"]);
  // The old check (refit without it) wanted to cut something: that was the slip.
  assert.ok(refit(items, ctx).cut.length > 0);
  const st = status(plan, ctx);
  assert.equal(st.behind, false);
  assert.deepEqual(st.cut, []);
  assert.deepEqual(planProgress(plan, tasks, st.unfit), { done: 0, total: 2 });
  // Five minutes in, a is under way: still nothing behind.
  const started = tasks.map((x) => (x.id === "a" ? { ...x, touchedAt: at(9, 1) } : x));
  assert.equal(planStatus(plan, { ...ctx, tasks: started, now: at(9, 5) }, at(9, 1)).behind, false);
  // A plan saved before unfit was kept: worked out from its approval time.
  const { unfit, ...old } = plan;
  assert.deepEqual(unfitOf(old, { ...ctx, now: at(9, 30) }), ["c"]);
  // Done anyway: it counts, in both.
  const doneC = tasks.map((x) => (x.id === "c" ? { ...x, status: "done", doneAt: at(9, 30) } : x));
  assert.deepEqual(planProgress(plan, doneC, plan.unfit), { done: 1, total: 3 });
});

test("(c) Done on the first task: the rest is laid again from now", () => {
  const tasks = [t({ id: "a" }), t({ id: "b" }), t({ id: "c" })];
  const items = [{ taskId: "a", minutes: 30 }, { taskId: "b", minutes: 30 }, { taskId: "c", minutes: 30 }];
  const plan = approve(items, { tasks, events: [], now: at(9) });
  const before = timeline(items, { tasks, events: [], now: at(9) }).rows.map((r) => [r.taskId, r.start]);
  assert.deepEqual(before, [["a", at(9)], ["b", at(9, 30)], ["c", at(10)]]);
  // a done early, at 09:12.
  const done = tasks.map((x) => (x.id === "a" ? { ...x, status: "done", doneAt: at(9, 12), touchedAt: at(9, 12) } : x));
  const ctx = { tasks: done, events: [], now: at(9, 12) };
  const since = lastActivity(done, plan.approvedAt);
  const after = timeline(items, { ...ctx, since }).rows.map((r) => [r.taskId, r.start]);
  assert.deepEqual(after, [["b", at(9, 15)], ["c", at(9, 45)]]);
  const st = planStatus(plan, ctx, since);
  assert.equal(st.behind, false);
  assert.deepEqual(planProgress(plan, done, st.unfit), { done: 1, total: 3 });
  // a done late, at 09:40: b and c move later, from then, and nothing is "missed".
  const late = tasks.map((x) => (x.id === "a" ? { ...x, status: "done", doneAt: at(9, 40), touchedAt: at(9, 40) } : x));
  const ctx2 = { tasks: late, events: [], now: at(9, 40) }, since2 = lastActivity(late, plan.approvedAt);
  assert.deepEqual(timeline(items, { ...ctx2, since: since2 }).rows.map((r) => [r.taskId, r.start]), [["b", at(9, 40)], ["c", at(10, 10)]]);
  assert.equal(planStatus(plan, ctx2, since2).behind, false);
});

// Mor, 2026-10-19: a plan from 11:00, nothing done for two hours, a task
// shown "?". Editing it (the sheet's Done) moved the whole plan to start now,
// no ask, no undo. An edit isn't doing the plan: it stays where it was.
test("(d) An edit doesn't move the plan; a switch or Done still does", () => {
  const tasks = [t({ id: "a" }), t({ id: "b" }), t({ id: "c" })];
  const items = [{ taskId: "a", minutes: 30 }, { taskId: "b", minutes: 30 }, { taskId: "c", minutes: 30 }];
  const plan = approve(items, { tasks, events: [], now: at(10, 50) });
  const now = at(13);
  const edited = tasks.map((x) => (x.id === "b" ? { ...x, ...editTask(x, { title: "Renamed" }, { now }) } : x));
  const since = planActivity(edited, plan.approvedAt);
  assert.equal(since, plan.approvedAt);
  const tl = timeline(items, { tasks: edited, events: [], now, since });
  assert.deepEqual(tl.missed, ["a", "b", "c"]);
  assert.ok(lastActivity(edited, plan.approvedAt) === now); // the silence check still sees it
  // A touch that isn't an edit (Switch, Later, skip) still counts.
  const switched = edited.map((x) => (x.id === "c" ? { ...x, touchedAt: now } : x));
  assert.equal(planActivity(switched, plan.approvedAt), now);
});

test("(z) first item put off till later: the rest holds its times, it doesn't slide with the clock", () => {
  // Mor, 2026-10-20: nothing touched, the Today rows kept moving later.
  const tasks = [t({ id: "a", size: 15 }), t({ id: "b", size: 60 }), t({ id: "c", size: 20 })];
  const items = [{ taskId: "a", minutes: 15, hold: at(22) }, { taskId: "b", minutes: 60 }, { taskId: "c", minutes: 20 }];
  const since = at(19, 30), hours = { start: 480, end: 1440, meals: [] };
  const lay = (now) => timeline(items, { tasks, events: [], now, hours, since }).rows.map((r) => [r.taskId, r.start]);
  const first = lay(at(19, 46));
  assert.deepEqual(first, [["b", at(19, 30)], ["c", at(20, 30)], ["a", at(22)]]);
  for (const now of [at(19, 51), at(20, 5), at(20, 40)]) assert.deepEqual(lay(now), first, `moved at ${new Date(now).toISOString()}`);
  assert.equal(timeline(items, { tasks, events: [], now: at(20), hours, since }).late?.taskId, "b");
});
