// The day's proposed schedule (proposal.js, 2026-10-07).
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const { proposeDay, timeline, withBreaks, nextPlanned, parseAsk, planProgress } = await import("../../app/js/proposal.js");

const at = (h, m = 0) => Date.UTC(2026, 9, 7, h - 3, m);
const il = (h, m = 0) => new Date(at(h, m)).toISOString();
const t = (o) => ({ id: o.id || String(Math.random()), title: "Task", status: "ready", type: "deep", due: "2026-10-07", dateKind: "target", size: 30, spentMinutes: 0, createdAt: at(0), ...o });
const ev = (title, s, e) => ({ id: title, title, start: il(...s), end: il(...e), busy: true });

test("proposes open tasks once each, never the running one, within the free time", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 30 }), t({ id: "c", size: 45 }), t({ id: "w", status: "waiting" }), t({ id: "h", onHold: { who: "Yuval", since: 1 } })];
  const run = { taskId: "c", startedAt: at(9) };
  const items = proposeDay({ tasks, events: [], now: at(9), run });
  const ids = items.map((i) => i.taskId);
  assert.deepEqual([...ids].sort(), ["a", "b"]);
  assert.equal(new Set(ids).size, ids.length);
});

test("timeline keeps the user's order and steps around meetings", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 30 })];
  const events = [ev("Teaching", [10], [12])];
  const { rows, over } = timeline([{ taskId: "b", minutes: 30 }, { taskId: "a", minutes: 60 }], { tasks, events, now: at(9, 30) });
  assert.deepEqual(rows.map((r) => r.taskId), ["b", "a"]);
  assert.equal(rows[0].start, at(9, 30));
  assert.equal(rows[1].start, at(12, 45)); // 9:30-10:00 had room for b only; lunch 12:00-12:45
  assert.equal(over.length, 0);
});

test("an item that doesn't fit today is reported, not dropped silently", () => {
  const tasks = [t({ id: "a", size: 120 })];
  const { rows, over } = timeline([{ taskId: "a", minutes: 120 }], { tasks, events: [], now: at(21) });
  assert.equal(rows.length, 0);
  assert.deepEqual(over.map((o) => o.taskId), ["a"]);
});

test("approved plan: the card follows it in order, skipping what's done or on hold", () => {
  const tasks = [t({ id: "a", status: "done" }), t({ id: "b", onHold: { who: "", since: 1 } }), t({ id: "c" })];
  const plan = { date: "2026-10-07", status: "approved", items: [{ taskId: "a" }, { taskId: "b" }, { taskId: "c" }] };
  assert.equal(nextPlanned(plan, tasks, "2026-10-07", at(10)), "c");
  assert.equal(nextPlanned({ ...plan, status: "proposed" }, tasks, "2026-10-07", at(10)), null);
  assert.equal(nextPlanned(plan, tasks, "2026-10-08", at(10)), null);
  assert.deepEqual(planProgress(plan, tasks), { done: 1, total: 3 });
});

test("rethink in plain words", () => {
  const tasks = [t({ id: "mix", title: "Mix review", project: "Reprise" }), t({ id: "inv", title: "Send invoice", type: "admin" }), t({ id: "call", title: "Call Dana", type: "call" })];
  assert.deepEqual(parseAsk("no calls", tasks).skipTypes, ["call"]);
  assert.deepEqual(parseAsk("start with the mix review", tasks).first, ["mix"]);
  assert.deepEqual(parseAsk("skip Reprise today", tasks).exclude, ["mix"]);
  assert.equal(parseAsk("only 2 hours", tasks).maxMinutes, 120);
  assert.equal(parseAsk("done by 5pm", tasks).until, 17 * 60);
  assert.equal(parseAsk("I'm tired, lighter please", tasks).fewer, true); // no energy: tired means fewer things
  assert.equal(parseAsk("blah", tasks).understood, false);
});

test("rethink changes the proposal: excluded types and names stay out, first goes first", () => {
  const tasks = [t({ id: "a", title: "Mix review", size: 60 }), t({ id: "b", title: "Call Dana", type: "call", size: 15 }), t({ id: "c", title: "Lesson prep", size: 30 })];
  const ask = parseAsk("no calls, start with lesson prep", tasks);
  const ids = proposeDay({ tasks, events: [], now: at(9), ask }).map((i) => i.taskId);
  assert.equal(ids[0], "c");
  assert.equal(ids.includes("b"), false);
  const fewer = proposeDay({ tasks: [...tasks, t({}), t({}), t({})], events: [], now: at(9), ask: { fewer: true } });
  assert.equal(fewer.length, 3);
  const deleted = proposeDay({ tasks, events: [], now: at(9), exclude: ["a"] }).map((i) => i.taskId);
  assert.equal(deleted.includes("a"), false);
});

test("breaks: 10 min after 90 min of work, never before the first task", () => {
  const tasks = [t({ id: "a", size: 90 }), t({ id: "b", size: 30 })];
  const { rows, breaks } = timeline([{ taskId: "a", minutes: 90 }, { taskId: "b", minutes: 30 }], { tasks, events: [], now: at(9) });
  assert.equal(breaks.length, 1);
  assert.equal(breaks[0].type, "short");
  assert.equal(breaks[0].start, rows[0].end);
  assert.equal(rows[1].start, breaks[0].end);
});

test("breaks: back-to-back meetings count as work", () => {
  const tasks = [t({ id: "a", size: 30 })];
  const events = [ev("M1", [8], [9]), ev("M2", [9], [10, 30])];
  const { rows, breaks } = timeline([{ taskId: "a", minutes: 30 }], { tasks, events, now: at(8) });
  assert.equal(breaks.length, 1);
  assert.equal(rows[0].start, breaks[0].end);
});

test("breaks: lunch 45 min inside 12-14, once; a 15 min idle gap resets the count", () => {
  const tasks = [t({ id: "a", size: 30 }), t({ id: "b", size: 30 })];
  const r = timeline([{ taskId: "a", minutes: 30 }, { taskId: "b", minutes: 30 }], { tasks, events: [], now: at(12, 5) });
  assert.deepEqual(r.breaks.map((b) => b.type), ["lunch"]);
  assert.equal(r.breaks[0].minutes, 45);
  assert.equal(r.rows[0].start, at(12, 5)); // not lunch first thing at noon
  assert.equal(r.breaks[0].start, r.rows[0].end);
  const idle = timeline([{ taskId: "a", minutes: 60 }, { taskId: "b", minutes: 60 }], { tasks, events: [ev("X", [10], [10, 20])], now: at(9) });
  assert.equal(idle.breaks.length, 0);
});

test("breaks become plan items once, then stay where they're put", () => {
  const tasks = [t({ id: "a", size: 90 }), t({ id: "b", size: 30 }), t({ id: "c", size: 30 })];
  const ctx = { tasks, events: [], now: at(9) };
  const items = withBreaks([{ taskId: "a", minutes: 90 }, { taskId: "b", minutes: 30 }, { taskId: "c", minutes: 30 }], ctx);
  assert.deepEqual(items.map((i) => i.taskId || i.brk), ["a", "short", "b", "c"]);
  assert.equal(withBreaks(items, ctx), items); // already has its breaks
  // Moved: the break goes where it's put, and no rule adds another.
  const moved = [items[0], items[2], items[3], items[1]];
  const r = timeline(moved, ctx);
  assert.deepEqual(r.breaks.map((b) => [b.type, b.i]), [["short", 3]]);
  assert.equal(r.breaks[0].start, r.rows[2].end);
  assert.deepEqual(r.rows.map((x) => x.i), [0, 1, 2]);
  // A break first thing, before any work, stays where it's put too.
  const first = timeline([items[1], items[0]], ctx);
  assert.equal(first.breaks[0].start, at(9));
  assert.equal(first.rows[0].start, first.breaks[0].end);
  // A break after finished work, with nothing laid since, was had.
  const done = tasks.map((x) => (x.id === "a" ? { ...x, status: "done" } : x));
  assert.equal(timeline(items, { ...ctx, tasks: done }).breaks.length, 0);
});
