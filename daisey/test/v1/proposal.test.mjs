// The day's proposed schedule (proposal.js, 2026-10-07).
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const { proposeDay, timeline, withBreaks, trimBreaks, nextPlanned, parseAsk, planProgress, refit, topUp, daySig } = await import("../../app/js/proposal.js");

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
  assert.equal(rows[1].start, at(12, 10)); // 9:30-10:00 had room for b only; 2 h of teaching → a 10 min break (lunch waits for 13:00)
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

test("breaks: lunch 45 min inside 13-14, once; a 15 min idle gap resets the count", () => {
  const tasks = [t({ id: "a", size: 30 }), t({ id: "b", size: 30 })];
  const r = timeline([{ taskId: "a", minutes: 30 }, { taskId: "b", minutes: 30 }], { tasks, events: [], now: at(13, 5) });
  assert.deepEqual(r.breaks.map((b) => [b.type, b.name]), [["meal", "Lunch"]]);
  assert.equal(r.breaks[0].minutes, 45);
  assert.equal(r.rows[0].start, at(13, 5)); // not lunch first thing at one
  assert.equal(r.breaks[0].start, r.rows[0].end);
  const idle = timeline([{ taskId: "a", minutes: 60 }, { taskId: "b", minutes: 60 }], { tasks, events: [ev("X", [10], [10, 20])], now: at(9) });
  assert.equal(idle.breaks.length, 0);
});

test("meals from settings: own windows and lengths, several, or none", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 60 }), t({ id: "c", size: 60 })];
  const items = [{ taskId: "a", minutes: 60 }, { taskId: "b", minutes: 60 }, { taskId: "c", minutes: 60 }];
  const two = { start: 480, end: 1320, meals: [{ name: "Brunch", from: 600, to: 660, minutes: 20 }, { name: "Dinner", from: 690, to: 780, minutes: 60 }] };
  const r = timeline(items, { tasks, events: [], now: at(9, 30), hours: two });
  assert.deepEqual(r.breaks.filter((b) => b.type === "meal").map((b) => [b.name, b.minutes]), [["Brunch", 20], ["Dinner", 60]]);
  const off = timeline(items, { tasks, events: [], now: at(11, 30), hours: { start: 480, end: 1320, meals: [] } });
  assert.equal(off.breaks.filter((b) => b.type === "meal").length, 0);
  // Switched off: a meal already in the plan goes too.
  const kept = timeline([items[0], { brk: "meal", name: "Lunch", minutes: 45 }, items[1]], { tasks, events: [], now: at(11, 30), hours: { start: 480, end: 1320, meals: [] } });
  assert.equal(kept.breaks.length, 0);
  // An old "lunch" item still reads as the meal it falls in.
  const old = timeline([items[0], { brk: "lunch", minutes: 45 }, items[1]], { tasks, events: [], now: at(11, 30) });
  assert.deepEqual(old.breaks.map((b) => [b.type, b.name]), [["meal", "Lunch"]]);
});

test("breaks become plan items once, then stay where they're put", () => {
  const tasks = [t({ id: "a", size: 90 }), t({ id: "b", size: 30 }), t({ id: "c", size: 30 })];
  const ctx = { tasks, events: [], now: at(9) };
  const items = withBreaks([{ taskId: "a", minutes: 90 }, { taskId: "b", minutes: 30 }, { taskId: "c", minutes: 30 }], ctx);
  assert.deepEqual(items.map((i) => i.taskId || i.brk), ["a", "short", "b", "c"]);
  assert.equal(withBreaks(items, ctx), items); // already has its breaks
  // Moved: the break goes where it's put, and no rule adds another.
  const moved = [items[0], items[2], items[1], items[3]];
  const r = timeline(moved, ctx);
  assert.deepEqual(r.breaks.map((b) => [b.type, b.i]), [["short", 2]]);
  assert.equal(r.breaks[0].start, r.rows[1].end);
  assert.deepEqual(r.rows.map((x) => x.i), [0, 1, 3]);
  // A plan never starts or ends on a break.
  const edge = [items[1], items[0], items[2], items[1]];
  assert.deepEqual(trimBreaks(edge).map((i) => i.taskId || i.brk), ["a", "b"]);
  const first = timeline([items[1], items[0]], ctx);
  assert.equal(first.breaks.length, 0);
  assert.equal(first.rows[0].start, at(9));
  assert.equal(timeline([items[0], items[1]], ctx).breaks.length, 0);
  // A break after finished work, with nothing laid since, was had.
  const done = tasks.map((x) => (x.id === "a" ? { ...x, status: "done" } : x));
  assert.equal(timeline(items, { ...ctx, tasks: done }).breaks.length, 0);
});

test("a break runs on through free time to the next item, up to a meeting; its own minutes stay", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 90 })];
  const items = [{ taskId: "a", minutes: 60 }, { brk: "short", minutes: 10 }, { taskId: "b", minutes: 90 }];
  // b doesn't fit 10:10-11:00, so it goes after the meeting: the break holds to 11:00.
  const r = timeline(items, { tasks, events: [ev("Call", [11], [12])], now: at(9) });
  assert.deepEqual([r.breaks[0].start, r.breaks[0].end, r.breaks[0].minutes], [at(10), at(11), 10]);
  assert.equal(r.rows[1].start, at(12));
  // Nothing in the way: the break is its own length.
  assert.equal(timeline(items, { tasks, events: [], now: at(9) }).breaks[0].end, at(10, 10));
});

test("refit: when the day shrinks, what matters least goes, not what's last; the order of what stays is kept", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 60, dateKind: "deadline" }), t({ id: "c", size: 20 })];
  const items = [{ taskId: "a", minutes: 60 }, { brk: "short", minutes: 10 }, { taskId: "b", minutes: 60 }, { taskId: "c", minutes: 20 }];
  const ctx = { tasks, events: [], now: at(20) }; // 20:00-22:00 left, 150 min planned
  assert.deepEqual(refit(items, ctx), { items: [{ taskId: "b", minutes: 60 }, { taskId: "c", minutes: 20 }], cut: ["a"] });
  // Nothing to do when it all fits.
  const roomy = { ...ctx, now: at(9) };
  assert.equal(refit(items, roomy).items, items);
  // Put back with Undo: never cut again, even when it means something else goes.
  assert.deepEqual(refit(items, ctx, ["a"]).cut, ["b"]);
  // The running task never goes.
  assert.ok(!refit(items, { ...ctx, run: { taskId: "a", startedAt: at(9) } }).cut.includes("a"));
});

test("topUp: when the day opens up, fresh picks go on the end; what's there stays in order and in today", () => {
  const tasks = [t({ id: "a", size: 60 }), t({ id: "b", size: 30 }), t({ id: "c", size: 30 }), t({ id: "d", size: 45 })];
  const items = [{ taskId: "b", minutes: 30 }, { taskId: "a", minutes: 60 }];
  // 19:30-22:00 left: 90 planned, a break, room for one 30 more.
  const { items: out, added } = topUp(items, { tasks, events: [], now: at(19, 30) });
  assert.deepEqual(out.slice(0, 2), items);
  assert.equal(added.length, 1);
  assert.ok(["c", "d"].includes(added[0]));
  assert.ok(!timeline(out, { tasks, events: [], now: at(19, 30) }).over.length);
  // A full day adds nothing and hands the same list back.
  const full = topUp(items, { tasks, events: [ev("Gig", [21], [22])], now: at(19, 30) });
  assert.deepEqual(full, { items, added: [] });
  // skip (taken off with Undo) never comes back; the running task never goes in.
  const r = topUp(items, { tasks, events: [], now: at(9), run: { taskId: "d", startedAt: at(9) } }, ["c"]);
  assert.deepEqual(r.added, []);
});

test("daySig: changes with busy events and hours, not with the clock or free events", () => {
  const evs = [ev("Teaching", [10], [12])];
  const s = daySig(evs, { start: 480, end: 1320 }, at(9));
  assert.equal(daySig(evs, { start: 480, end: 1320 }, at(15)), s);
  assert.equal(daySig([...evs, { ...ev("Lunch", [13], [14]), busy: false }], { start: 480, end: 1320 }, at(9)), s);
  assert.notEqual(daySig([ev("Teaching", [10], [11])], { start: 480, end: 1320 }, at(9)), s);
  assert.notEqual(daySig([], { start: 480, end: 1320 }, at(9)), s);
  assert.notEqual(daySig(evs, { start: 480, end: 1380 }, at(9)), s);
});
